import * as THREE from 'three';

// Every light of an airport (runway edge/centreline/threshold/end, taxiway, approach system, PAPI, strobes,
// beacon, floods, obstruction lights) is one point in a single THREE.Points object. The vertex shader sizes
// the sprite by distance, applies directionality and the PAPI colour logic from the camera position, and
// drives the flashers from a time uniform, so one draw call lights the whole field and the PAPI really
// shows the right red/white mix for the viewer's glide path.

export const LIGHT_COLORS = {
  white: [1.0, 0.93, 0.8], warm: [1.0, 0.78, 0.45], amber: [1.0, 0.55, 0.08], green: [0.08, 1.0, 0.3],
  red: [1.0, 0.07, 0.05], blue: [0.12, 0.32, 1.0], sodium: [1.0, 0.62, 0.25], strobe: [1.0, 1.0, 1.0],
};

export const MODE = { STEADY: 0, PAPI: 1, BEACON: 2, SEQ: 3, SYNC: 4 };

const VERT = /* glsl */`
  attribute vec3 aColor; attribute vec3 aDir; attribute vec4 aParam; attribute vec4 aExtra;
  uniform vec2 uViewport; uniform float uTime; uniform float uNight; uniform float uMinPx; uniform float uMaxPx; uniform float uDetail;
  varying vec3 vColor; varying float vInt;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    float dist = max(-mvPosition.z, 0.5);
    float scale = uViewport.y * 0.5 * projectionMatrix[1][1];
    float rawPx = aParam.x * scale / dist;
    gl_PointSize = clamp(rawPx, uMinPx, uMaxPx);
    float fall = clamp(sqrt(rawPx / uMinPx), 0.5, 1.0);
    vec3 toCam = cameraPosition - wp.xyz;
    float dcam = max(length(toCam), 0.001);
    vec3 v = toCam / dcam;
    float inten = aParam.y;
    vec3 col = aColor;
    int mode = int(aParam.w + 0.5);
    vec3 dirW = mat3(modelMatrix) * aDir;
    if (mode == 1) {
      // PAPI: aDir points from the lamp back along the approach path; aExtra.z is the unit's threshold angle (degrees)
      vec2 h = dirW.xz;
      float hl = max(length(h), 0.0001);
      vec2 hd = h / hl;
      float along = dot(toCam.xz, hd);
      float lateral = dot(toCam.xz, vec2(-hd.y, hd.x));
      float elev = degrees(atan(toCam.y, max(along, 0.001)));
      float latAng = abs(degrees(atan(lateral, max(along, 0.001))));
      float white = smoothstep(aExtra.z - 0.06, aExtra.z + 0.06, elev);
      col = mix(vec3(1.0, 0.05, 0.03), vec3(1.0, 0.95, 0.85), white);
      inten *= step(0.0, along) * (1.0 - smoothstep(6.0, 11.0, latAng)) * (1.0 - smoothstep(9.0, 16.0, elev));
    } else if (mode == 2) {
      float f = pow(max(0.0, cos(uTime * 2.6 + aExtra.y)), 18.0);
      inten *= f;
    } else if (mode == 3) {
      float ph = fract(uTime * 2.0 - aExtra.y * 0.05);
      inten *= step(ph, 0.09) * 3.2;
    } else if (mode == 4) {
      inten *= step(fract(uTime * 1.0), 0.07) * 3.5;
    }
    float dl = length(dirW);
    if (dl > 0.01 && aParam.z > 0.0) {
      float c = max(dot(v, dirW / dl), 0.0);
      inten *= pow(c, aParam.z);
    }
    // lights are dim by day (except the high intensity ones) and full at night
    float dayMix = mix(aExtra.x, 1.0, uNight);
    inten *= dayMix * fall;
    vColor = col;
    vInt = inten * uDetail;
    #include <logdepthbuf_vertex>
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */`
  varying vec3 vColor; varying float vInt;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  #include <fog_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    if (vInt < 0.003) discard;
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    if (r > 1.0) discard;
    float core = 1.0 - r;
    float a = core * core;
    vec3 col = vColor * (a * 1.7) + vec3(1.0) * pow(core, 7.0) * 0.9;
    #ifdef USE_FOG
      float f = smoothstep(fogNear, fogFar, vFogDepth);
      col *= 1.0 - 0.85 * f;
    #endif
    gl_FragColor = vec4(col * vInt, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

let sharedMat = null;
export function lightMaterial() {
  if (sharedMat) return sharedMat;
  sharedMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, fog: true,
    uniforms: {
      uViewport: { value: new THREE.Vector2(1280, 720) }, uTime: { value: 0 }, uNight: { value: 0 }, uMinPx: { value: 2.2 }, uMaxPx: { value: 56 },
      uDetail: { value: 1 },
      ...THREE.UniformsLib.fog,
    },
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  sharedMat.userData.shared = true;
  return sharedMat;
}

export function disposeLightMaterial() { sharedMat?.dispose(); sharedMat = null; }

/** Collects lights, then builds a Points object. Positions are in the airport frame (x = u, y up, z = v). */
export class LightSet {
  constructor() { this.pos = []; this.col = []; this.dir = []; this.par = []; this.ext = []; this.n = 0; }

  /**
   * @param o.color name or [r,g,b]; o.dir [x,y,z] facing (omit for omni); o.size world radius in metres;
   * o.int brightness; o.k cone sharpness exponent; o.mode MODE.*; o.day brightness factor by day (0..1);
   * o.phase flasher phase / sequence index; o.thr PAPI threshold angle in degrees.
   */
  add(x, y, z, o = {}) {
    const c = typeof o.color === 'string' ? LIGHT_COLORS[o.color] : o.color ?? LIGHT_COLORS.white;
    const d = o.dir ?? [0, 0, 0];
    this.pos.push(x, y, z); this.col.push(c[0], c[1], c[2]); this.dir.push(d[0], d[1], d[2]);
    this.par.push(o.size ?? 0.35, o.int ?? 1, o.k ?? 0, o.mode ?? 0);
    this.ext.push(o.day ?? 0.2, o.phase ?? 0, o.thr ?? 0, 0);
    this.n++;
  }

  build() {
    if (!this.n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aDir', new THREE.Float32BufferAttribute(this.dir, 3));
    g.setAttribute('aParam', new THREE.Float32BufferAttribute(this.par, 4));
    g.setAttribute('aExtra', new THREE.Float32BufferAttribute(this.ext, 4));
    g.computeBoundingSphere();
    const pts = new THREE.Points(g, lightMaterial());
    pts.frustumCulled = false;
    pts.renderOrder = 10;
    pts.onBeforeRender = (renderer) => {
      const m = lightMaterial();
      const s = renderer.getDrawingBufferSize(_v2);
      m.uniforms.uViewport.value.copy(s);
    };
    return pts;
  }
}
const _v2 = new THREE.Vector2();
