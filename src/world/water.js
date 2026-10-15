import * as THREE from 'three';
import { atmosphere, ATMO_GLSL } from '../scene/atmosphere.js';
import { getNoiseTexture } from './noiseTexture.js';
import { lakeFactor } from './lakeShape.js';

// Lakes (irregular discs at their water level) and river ribbons. One shader draws all water: wind
// driven ripple normals from the shared noise texture, Fresnel reflection of the real sky model plus
// sun glints, depth-dependent body colour, shore foam and breaking wave crests. Frozen lakes use
// the same mesh with an ice look (snow patches, cracks, a blurred reflection).

const VERT = /* glsl */ `
attribute vec2 aW; // x: 0 centre .. 1 shore (lakes) or across -1..1 (rivers); y: along-river distance
varying vec3 vWP;
varying vec2 vW;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWP = w.xyz;
  vW = aW;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${ATMO_GLSL}
uniform sampler2D uNoise;
uniform float uTime; uniform float uWind; uniform float uFrozen; uniform float uRiver; uniform float uLight; uniform float uRain;
uniform vec3 uLightDir; uniform vec3 uLightCol; uniform vec3 uShallow; uniform vec3 uDeep;
varying vec3 vWP; varying vec2 vW;
vec4 tx(vec2 p, float P){ return texture2D(uNoise, mod(p, P) / P); }
vec2 gradAt(vec2 p, float P){ return (tx(p, P).ba - 0.5) * 0.102 * (512.0 / P); }
void main() {
  #include <logdepthbuf_fragment>
  vec2 p = vWP.xz;
  vec3 toCam = cameraPosition - vWP;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float pix = max(max(fwidth(p.x), fwidth(p.y)), 0.01);
  float lakeD = uRiver > 0.5 ? abs(vW.x) : vW.x;
  // Ripples: three scrolling layers, stronger with wind and rain; fine ones fade with distance.
  float amp = 0.12 + 0.7 * uWind + 0.25 * uRain;
  vec2 flow = uRiver > 0.5 ? vec2(0.0, 1.0) : vec2(0.0);
  vec2 g = vec2(0.0);
  vec2 t1 = vec2(uTime * 0.6, uTime * 0.35); vec2 t2 = vec2(-uTime * 0.4, uTime * 0.55);
  g += gradAt(p + t1 - flow * uTime * 1.2, 4.1) * 0.020 * (1.0 - smoothstep(0.5, 4.0, pix));
  g += gradAt(p * 1.0 + t2 - flow * uTime * 0.9, 11.0) * 0.050 * (1.0 - smoothstep(2.0, 14.0, pix));
  g += gradAt(p + t1 * 2.0, 38.0) * 0.18 * (1.0 - smoothstep(6.0, 60.0, pix));
  g += gradAt(p - t2 * 3.0, 140.0) * 0.5 * (1.0 - smoothstep(20.0, 200.0, pix));
  g *= amp;
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  float cosV = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y) + 0.002;
  vec3 sky = atmoSky(normalize(R));
  // Depth colour: shallow near the shore, deep in the middle.
  float depth = uRiver > 0.5 ? 2.5 + 3.0 * (1.0 - lakeD) : 1.0 + 16.0 * (1.0 - lakeD * lakeD);
  float k = 1.0 - exp(-depth * 0.22);
  vec3 body = mix(uShallow, uDeep, k);
  float turb = tx(p * 0.7, 211.0).g;
  body *= 0.85 + 0.3 * turb;
  vec3 col;
  float glintPow = 700.0;
  vec3 H = normalize(V + uLightDir);
  float glint = pow(max(dot(N, H), 0.0), glintPow) * 3.0 * step(0.0, uLightDir.y);
  if (uFrozen > 0.5) {
    // Ice: pale blue-white with snow patches and fine cracks.
    float sn = smoothstep(0.42, 0.62, tx(p * 0.6, 900.0).r + 0.25 * (tx(p, 120.0).g - 0.5));
    float crack = smoothstep(0.0, 0.03, abs(tx(p * 0.9, 61.0).r - 0.5) - 0.012) ;
    vec3 ice = mix(vec3(0.62, 0.78, 0.9), vec3(0.78, 0.88, 0.95), tx(p, 400.0).g);
    ice *= mix(0.78, 1.0, crack * (1.0 - clamp(pix / 6.0, 0.0, 1.0)) + clamp(pix / 6.0, 0.0, 1.0));
    ice = mix(ice, vec3(0.93, 0.96, 1.0), sn * 0.85);
    col = ice * (0.3 + 0.9 * uLight);
    col = mix(col, sky, 0.12 + 0.2 * F);
    col += glint * 0.15 * uLightCol;
  } else {
    col = body * (0.12 + 0.9 * uLight);
    col = mix(col, sky, F);
    col += glint * uLightCol * (1.0 - 0.7 * uRain);
    // Shore foam and wave crests.
    float shore = uRiver > 0.5 ? smoothstep(0.78, 1.0, lakeD) : smoothstep(0.955, 1.02, lakeD);
    float fn = tx(p * 0.8 + vec2(uTime * 0.3, 0.0), 23.0).g;
    float foam = shore * smoothstep(0.35, 0.7, fn) * 0.7;
    float crest = smoothstep(0.62, 0.8, tx(p * 0.35 + vec2(uTime * 0.9, uTime * 0.4), 52.0).r) * smoothstep(0.35, 0.9, uWind) * (1.0 - clamp(pix / 12.0, 0.0, 1.0));
    float wake = foam + crest * 0.5;
    col = mix(col, vec3(0.9, 0.93, 0.95) * (0.3 + 0.8 * uLight), clamp(wake, 0.0, 0.85));
  }
  // Far shores fade slightly into the haze like everything else.
  vec3 fogOff = vWP - cameraPosition;
  col = atmoApply(col, dist, fogOff / dist, cameraPosition.y, vWP.y);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function lakeGeometry(l) {
  const rings = [0, 0.45, 0.8, 0.94, 1.0, 1.045];
  const seg = 72;
  const pos = [];
  const aw = [];
  const idx = [];
  pos.push(0, 0, 0); aw.push(0, 0);
  rings.slice(1).forEach((r, ri) => {
    for (let i = 0; i < seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      const rad = l.radius * lakeFactor(l, th) * r;
      pos.push(Math.cos(th) * rad, 0, Math.sin(th) * rad);
      aw.push(Math.min(1, r), 0);
    }
  });
  const ringStart = (ri) => 1 + ri * seg;
  for (let i = 0; i < seg; i++) idx.push(0, ringStart(0) + (i + 1) % seg, ringStart(0) + i);
  for (let ri = 0; ri < rings.length - 2; ri++) {
    for (let i = 0; i < seg; i++) {
      const a = ringStart(ri) + i; const b = ringStart(ri) + (i + 1) % seg;
      const c = ringStart(ri + 1) + i; const d = ringStart(ri + 1) + (i + 1) % seg;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aW', new THREE.Float32BufferAttribute(aw, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export function buildWater(map) {
  const group = new THREE.Group();
  const biome = map.cfg.biome;
  const frozen = biome === 'snow';
  const noise = getNoiseTexture();
  const shared = {
    uNoise: { value: noise }, uTime: { value: 0 }, uWind: { value: 0.2 }, uRain: { value: 0 }, uLight: { value: 1 },
    uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uLightCol: { value: new THREE.Color(1, 0.95, 0.85) },
    ...atmosphere.uniforms,
  };
  const make = (river, oasis) => new THREE.ShaderMaterial({
    uniforms: {
      ...shared, uFrozen: { value: frozen && !oasis ? 1 : 0 }, uRiver: { value: river ? 1 : 0 },
      uShallow: { value: new THREE.Color(biome === 'desert' ? '#3fb0a8' : biome === 'snow' ? '#4e7f90' : '#4f8a78') },
      uDeep: { value: new THREE.Color(biome === 'desert' ? '#0f5a66' : biome === 'snow' ? '#0e3550' : '#14424e') },
    },
    vertexShader: VERT, fragmentShader: FRAG, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, fog: false,
  });
  const lakeMat = make(false, false);
  const oasisMat = make(false, true);
  const riverMat = make(true, false);
  riverMat.side = THREE.DoubleSide;
  const mats = [lakeMat, oasisMat, riverMat];

  for (const l of map.lakes) {
    const mesh = new THREE.Mesh(lakeGeometry(l), l.oasis ? oasisMat : lakeMat);
    mesh.position.set(l.x, l.level, l.z);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.userData.noShadow = true;
    group.add(mesh);
  }
  for (const line of map.riverLines) {
    const pos = [];
    const aw = [];
    const idx = [];
    let along = 0;
    line.points.forEach((p, i) => {
      const a = line.points[Math.max(0, i - 1)];
      const b = line.points[Math.min(line.points.length - 1, i + 1)];
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const nx = -(b.z - a.z) / len;
      const nz = (b.x - a.x) / len;
      const hw = p.w * 1.0;
      pos.push(p.x + nx * hw, p.y + 0.3, p.z + nz * hw, p.x - nx * hw, p.y + 0.3, p.z - nz * hw);
      aw.push(-1, along, 1, along);
      if (i) along += Math.hypot(p.x - line.points[i - 1].x, p.z - line.points[i - 1].z);
      if (i < line.points.length - 1) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aW', new THREE.Float32BufferAttribute(aw, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, riverMat);
    m.userData.noShadow = true;
    group.add(m);
  }
  return {
    group,
    /** env: Environment; weather: Weather; wind: speed in m/s. */
    update(t, env, rain, windSpeed) {
      shared.uTime.value = t;
      shared.uWind.value = Math.min(1, windSpeed / 14);
      shared.uRain.value = rain;
      shared.uLight.value = Math.max(0.02, env.dayAmt * (1 - 0.6 * env.cloudDim) + env.night * 0.04);
      shared.uLightDir.value.copy(env.lightDir);
      shared.uLightCol.value.copy(env.sun.color).multiplyScalar(Math.min(1, env.sun.intensity / 2.6));
    },
    dispose() { group.traverse((o) => o.geometry?.dispose?.()); mats.forEach((m) => m.dispose()); },
  };
}
