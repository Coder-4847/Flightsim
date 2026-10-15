import * as THREE from 'three';
import { smoothstep } from '../util/noise.js';
import { createNoise } from '../util/noise.js';
import { hash2 } from '../util/random.js';

// Sky presets and their visuals: puffy cloud layers and a stratus deck you can fly through,
// rain and snow that streak with your airspeed, fog, and lightning in storms. The physics side
// of each preset (turbulence, wind shear, wet runways) lives in flight/world.js.

export const SKY_PRESETS = {
  clear: { label: 'Clear', cover: 0.04, deck: 0, base: 2600, thickness: 500, precip: null, rate: 0, visibility: 60000, dim: 0, fogGround: 0 },
  scattered: { label: 'Scattered', cover: 0.38, deck: 0, base: 1900, thickness: 700, precip: null, rate: 0, visibility: 50000, dim: 0.1, fogGround: 0 },
  overcast: { label: 'Overcast', cover: 0.5, deck: 0.92, base: 1300, thickness: 900, precip: null, rate: 0, visibility: 22000, dim: 0.55, fogGround: 0 },
  rain: { label: 'Rain', cover: 0.5, deck: 1, base: 850, thickness: 1500, precip: 'rain', rate: 0.6, visibility: 7500, dim: 0.68, fogGround: 0 },
  storm: { label: 'Storm', cover: 0.7, deck: 1, base: 650, thickness: 3500, precip: 'rain', rate: 1, visibility: 3800, dim: 0.85, fogGround: 0, lightning: true },
  fog: { label: 'Fog', cover: 0.08, deck: 0, base: 2800, thickness: 400, precip: null, rate: 0, visibility: 1200, dim: 0.25, fogGround: 1 },
  snow: { label: 'Snow', cover: 0.5, deck: 0.95, base: 900, thickness: 1200, precip: 'snow', rate: 0.7, visibility: 2600, dim: 0.5, fogGround: 0 },
};

const CELL = 1100; // metres per cloud-grid cell
const RADIUS_CELLS = 21;

function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const blobs = [[64, 70, 40], [38, 78, 28], [92, 76, 30], [56, 50, 28], [80, 54, 24], [30, 62, 20], [100, 66, 18]];
  for (const [x, y, r] of blobs) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const LOG_VERT_PARS = '#include <common>\n#include <logdepthbuf_pars_vertex>';
const LOG_VERT = '#include <logdepthbuf_vertex>';
const LOG_FRAG_PARS = '#include <common>\n#include <logdepthbuf_pars_fragment>';
const LOG_FRAG = '#include <logdepthbuf_fragment>';

export class Weather {
  constructor(scene, env) {
    this.scene = scene;
    this.env = env;
    this.preset = SKY_PRESETS.clear;
    this.presetId = 'clear';
    this.groundRef = 0; // MSL height clouds are measured from (airport elevation)
    this.time = 0;
    this.noise = createNoise(777);
    this.flashTimer = 0;
    this.flash = 0;
    this.clusters = [];
    this.lastCell = { x: 1e9, z: 1e9 };
    this.inCloud = 0;
    this.baseVisibility = 60000;

    // ---- cumulus billboards -----------------------------------------------------------
    const quad = new THREE.PlaneGeometry(1, 1);
    this.maxSprites = 2600;
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(this.maxSprites * 3), 3);
    this.iSize = new THREE.InstancedBufferAttribute(new Float32Array(this.maxSprites * 2), 2);
    this.iShade = new THREE.InstancedBufferAttribute(new Float32Array(this.maxSprites), 1);
    geo.setAttribute('iPos', this.iPos);
    geo.setAttribute('iSize', this.iSize);
    geo.setAttribute('iShade', this.iShade);
    geo.instanceCount = 0;
    this.cloudUniforms = {
      uMap: { value: puffTexture() }, uSunColor: { value: new THREE.Color() }, uAmbient: { value: new THREE.Color() },
      uFogColor: { value: new THREE.Color() }, uFogFar: { value: 60000 }, uDim: { value: 0 }, uFade: { value: RADIUS_CELLS * CELL },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.cloudUniforms, transparent: true, depthWrite: false, fog: false,
      vertexShader: `
        attribute vec3 iPos; attribute vec2 iSize; attribute float iShade;
        varying vec2 vUv; varying float vShade; varying float vDist;
        ${LOG_VERT_PARS}
        void main() {
          vUv = uv; vShade = iShade;
          vec4 mv = viewMatrix * vec4(iPos, 1.0);
          vDist = length(mv.xyz);
          mv.xy += position.xy * iSize;
          gl_Position = projectionMatrix * mv;
          ${LOG_VERT}
        }`,
      fragmentShader: `
        uniform sampler2D uMap; uniform vec3 uSunColor; uniform vec3 uAmbient; uniform vec3 uFogColor; uniform float uFogFar; uniform float uDim; uniform float uFade;
        varying vec2 vUv; varying float vShade; varying float vDist;
        ${LOG_FRAG_PARS}
        void main() {
          ${LOG_FRAG}
          vec4 t = texture2D(uMap, vUv);
          float a = t.a * smoothstep(120.0, 700.0, vDist) * (1.0 - smoothstep(uFade * 0.7, uFade, vDist));
          if (a < 0.01) discard;
          float lit = clamp(vUv.y * 1.15 + vShade * 0.35 + 0.1, 0.0, 1.0);
          vec3 col = mix(uAmbient, uSunColor, lit * (1.0 - uDim * 0.8));
          col = mix(col, uFogColor, smoothstep(uFogFar * 0.25, uFogFar, vDist) * 0.75);
          gl_FragColor = vec4(col, a * 0.92);
        }`,
    });
    this.clouds = new THREE.Mesh(geo, mat);
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = 5;
    scene.add(this.clouds);

    // ---- stratus deck --------------------------------------------------------------------
    this.deckUniforms = {
      uCover: { value: 0 }, uTime: { value: 0 }, uColorTop: { value: new THREE.Color('#f2f4f7') }, uColorBottom: { value: new THREE.Color('#8d96a1') },
      uCamY: { value: 0 }, uDeckY: { value: 1500 }, uFogColor: { value: new THREE.Color() }, uFogFar: { value: 60000 },
    };
    this.deck = new THREE.Mesh(
      new THREE.PlaneGeometry(260000, 260000, 1, 1).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        uniforms: this.deckUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
        vertexShader: `
          varying vec3 vWP;
          ${LOG_VERT_PARS}
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWP = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
            ${LOG_VERT}
          }`,
        fragmentShader: `
          uniform float uCover; uniform float uTime; uniform vec3 uColorTop; uniform vec3 uColorBottom; uniform float uCamY; uniform float uDeckY; uniform vec3 uFogColor; uniform float uFogFar;
          varying vec3 vWP;
          ${LOG_FRAG_PARS}
          float h(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
          float n(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1,0)), f.x), mix(h(i + vec2(0,1)), h(i + vec2(1,1)), f.x), f.y); }
          float fbm(vec2 p){ return 0.5 * n(p) + 0.25 * n(p * 2.1 + 3.7) + 0.125 * n(p * 4.3 + 9.1) + 0.0625 * n(p * 8.7); }
          void main() {
            ${LOG_FRAG}
            vec2 p = vWP.xz / 5200.0 + vec2(uTime * 0.004, uTime * 0.002);
            float d = fbm(p);
            float a = smoothstep(1.0 - uCover * 1.15, 1.0 - uCover * 1.15 + 0.22, d);
            float dist = length(vWP - cameraPosition);
            vec3 col = uCamY < uDeckY ? mix(uColorBottom, uColorBottom * 0.8, d) : mix(uColorTop, uColorTop * 0.92, d);
            col = mix(col, uFogColor, smoothstep(uFogFar * 0.15, uFogFar * 0.9, dist));
            if (a < 0.01) discard;
            gl_FragColor = vec4(col, a);
          }`,
      }),
    );
    this.deck.frustumCulled = false;
    this.deck.renderOrder = 4;
    scene.add(this.deck);

    // ---- precipitation --------------------------------------------------------------------
    this.precipUniforms = {
      uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uRel: { value: new THREE.Vector3(0, -9, 0) }, uBox: { value: 140 },
      uAlpha: { value: 0 }, uColor: { value: new THREE.Color('#bcc7d4') }, uMode: { value: 0 }, uPix: { value: 1 },
    };
    const count = 5200;
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) seeds[i] = Math.random();
    const vertexCommon = `
      attribute vec3 seed; uniform float uTime; uniform vec3 uCam; uniform vec3 uRel; uniform float uBox;
      vec3 particle() {
        vec3 p = seed * uBox - uRel * uTime;
        p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
        return uCam + p;
      }`;
    // Rain: line streaks whose length and slant come from the relative air velocity.
    const rg = new THREE.BufferGeometry();
    const rainSeeds = new Float32Array(count * 6);
    const tailFlag = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 2; k++) {
        rainSeeds.set([seeds[i * 3], seeds[i * 3 + 1], seeds[i * 3 + 2]], (i * 2 + k) * 3);
        tailFlag[i * 2 + k] = k;
      }
    }
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 6), 3));
    rg.setAttribute('seed', new THREE.BufferAttribute(rainSeeds, 3));
    rg.setAttribute('tail', new THREE.BufferAttribute(tailFlag, 1));
    this.rainLines = new THREE.LineSegments(rg, new THREE.ShaderMaterial({
      uniforms: this.precipUniforms, transparent: true, depthWrite: false, fog: false,
      vertexShader: `
        ${vertexCommon}
        attribute float tail; varying float vA;
        ${LOG_VERT_PARS}
        void main() {
          vec3 world = particle() - uRel * 0.028 * tail;
          vec4 mv = viewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = length(mv.xyz);
          vA = (1.0 - tail * 0.85) * smoothstep(uBox * 0.5, uBox * 0.3, d) * smoothstep(1.0, 8.0, d);
          ${LOG_VERT}
        }`,
      fragmentShader: `
        uniform float uAlpha; uniform vec3 uColor; varying float vA;
        ${LOG_FRAG_PARS}
        void main() {
          ${LOG_FRAG}
          gl_FragColor = vec4(uColor, uAlpha * vA);
        }`,
    }));
    this.rainLines.frustumCulled = false;
    this.rainLines.renderOrder = 6;
    this.rainLines.visible = false;
    scene.add(this.rainLines);

    // Snow: soft round flakes that drift with the relative air.
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    sg.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
    this.snow = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: this.precipUniforms, transparent: true, depthWrite: false, fog: false,
      vertexShader: `
        ${vertexCommon}
        uniform float uPix; varying float vA;
        ${LOG_VERT_PARS}
        void main() {
          vec4 mv = viewMatrix * vec4(particle(), 1.0);
          gl_Position = projectionMatrix * mv;
          float d = length(mv.xyz);
          gl_PointSize = 5.0 * uPix * clamp(60.0 / max(d, 1.0), 0.4, 3.0);
          vA = smoothstep(uBox * 0.5, uBox * 0.3, d) * smoothstep(1.0, 6.0, d);
          ${LOG_VERT}
        }`,
      fragmentShader: `
        uniform float uAlpha; uniform vec3 uColor; varying float vA;
        ${LOG_FRAG_PARS}
        void main() {
          ${LOG_FRAG}
          float r = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(uColor, smoothstep(0.5, 0.1, r) * uAlpha * vA);
        }`,
    }));
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 6;
    this.snow.visible = false;
    scene.add(this.snow);

    this.setSky('clear');
  }

  /** Cloud heights are measured from this MSL height (use the airport elevation). */
  setReference(h) {
    this.groundRef = h;
    this.env.setGroundReference(h);
    this.lastCell.x = 1e9;
  }

  setSky(id) {
    this.presetId = SKY_PRESETS[id] ? id : 'clear';
    this.preset = SKY_PRESETS[this.presetId];
    const p = this.preset;
    this.baseVisibility = p.visibility;
    this.env.setFogHeight(p.fogGround > 0 ? 380 : p.visibility < 10000 ? 1800 : 2800);
    this.env.setVisibility(p.visibility);
    this.env.setCloudDim(p.dim);
    this.deck.visible = p.deck > 0;
    this.deckUniforms.uCover.value = p.deck;
    this.deckUniforms.uDeckY.value = this.groundRef + p.base;
    this.rainLines.visible = p.precip === 'rain';
    this.snow.visible = p.precip === 'snow';
    this.precipUniforms.uMode.value = p.precip === 'snow' ? 1 : 0;
    this.precipUniforms.uColor.value.set(p.precip === 'snow' ? '#ffffff' : '#aab6c4');
    this.precipUniforms.uAlpha.value = p.precip === 'snow' ? 0.9 : 0.55 * (0.4 + p.rate * 0.6);
    this.lastCell.x = 1e9;
  }

  /** Rebuild the cumulus clusters around the camera (deterministic per world cell). */
  #rebuild(cam) {
    const p = this.preset;
    const cx = Math.floor(cam.x / CELL);
    const cz = Math.floor(cam.z / CELL);
    this.clusters.length = 0;
    const baseY = this.groundRef + p.base;
    for (let dz = -RADIUS_CELLS; dz <= RADIUS_CELLS; dz++) {
      for (let dx = -RADIUS_CELLS; dx <= RADIUS_CELLS; dx++) {
        if (dx * dx + dz * dz > RADIUS_CELLS * RADIUS_CELLS) continue;
        const gx = cx + dx;
        const gz = cz + dz;
        // Large-scale coverage pattern so clouds clump into fields.
        const field = this.noise.fbm(gx / 14 + 3.3, gz / 14 + 1.1, 3);
        const coverage = (0.12 + p.cover * 1.1) * (0.4 + field * 1.1);
        if (hash2(gx, gz, 1) > coverage * 0.55) continue;
        const x = (gx + hash2(gx, gz, 2)) * CELL;
        const z = (gz + hash2(gx, gz, 3)) * CELL;
        const y = baseY + hash2(gx, gz, 4) * 220;
        const size = 700 + hash2(gx, gz, 5) * 900;
        const towers = 1 + Math.floor(hash2(gx, gz, 6) * 3 * (0.4 + p.thickness / 1500));
        this.clusters.push({ x, y, z, size, towers, key: hash2(gx, gz, 7) });
      }
    }
    // Far to near so alpha blending composes sensibly.
    const sortKey = (c) => (c.x - cam.x) ** 2 + (c.z - cam.z) ** 2;
    this.clusters.sort((a, b) => sortKey(b) - sortKey(a));
    let n = 0;
    for (const c of this.clusters) {
      for (let k = 0; k < c.towers + 2 && n < this.maxSprites; k++) {
        const lateral = (k - (c.towers + 1) / 2) * c.size * 0.42 * (hash2(k, c.key * 1000, 9) - 0.2);
        const rise = k * c.size * 0.18 * (0.5 + hash2(k, c.key * 1000, 10));
        const s = c.size * (1 - k * 0.1) * (0.8 + hash2(k, c.key * 999, 11) * 0.5);
        this.iPos.array[n * 3] = c.x + lateral;
        this.iPos.array[n * 3 + 1] = c.y + rise + s * 0.25;
        this.iPos.array[n * 3 + 2] = c.z + lateral * 0.6;
        this.iSize.array[n * 2] = s * 1.5;
        this.iSize.array[n * 2 + 1] = s;
        this.iShade.array[n] = k / (c.towers + 2);
        n++;
      }
    }
    this.clouds.geometry.instanceCount = n;
    this.iPos.needsUpdate = true;
    this.iSize.needsUpdate = true;
    this.iShade.needsUpdate = true;
  }

  /**
   * `camera` is the render camera, `camVel` the aircraft velocity (m/s), `wind` the local wind.
   * Returns the local visibility factor so the caller can dim sound or HUD if wanted.
   */
  update(dt, camera, camVel, wind) {
    this.time += dt;
    const cam = camera.position;
    const p = this.preset;
    if (Math.abs(cam.x / CELL - this.lastCell.x) > 0.5 || Math.abs(cam.z / CELL - this.lastCell.z) > 0.5) {
      this.lastCell.x = cam.x / CELL;
      this.lastCell.z = cam.z / CELL;
      this.#rebuild(cam);
    }
    // Cloud colours follow the sky.
    const cu = this.cloudUniforms;
    cu.uSunColor.value.copy(this.env.sun.color).multiplyScalar(Math.min(1, this.env.sun.intensity / 2.6) * 0.95 + 0.05).lerp(this.env.horizon, 0.25);
    cu.uAmbient.value.copy(this.env.horizon).multiplyScalar(0.85 * (0.25 + 0.75 * Math.min(1, this.env.sun.intensity / 2.2))).lerp(this.env.zenith, 0.1);
    cu.uFogColor.value.copy(this.env.fogTint);
    cu.uFogFar.value = this.env.scene.fog.far;
    cu.uDim.value = this.env.cloudDim;
    const du = this.deckUniforms;
    du.uTime.value = this.time;
    du.uCamY.value = cam.y;
    du.uColorBottom.value.copy(this.env.horizon).multiplyScalar(0.62).lerp(this.env.zenith, 0.1);
    du.uColorTop.value.copy(this.env.sun.color).multiplyScalar(0.55 + 0.3 * Math.min(1, this.env.sun.intensity / 2.6)).lerp(this.env.horizon, 0.4);
    du.uFogColor.value.copy(this.env.fogTint);
    du.uFogFar.value = this.env.scene.fog.far;
    this.deck.position.set(cam.x, p.deck > 0 ? this.groundRef + p.base : 0, cam.z);

    // Flying through cloud: whiteout. Inside the stratus deck or close to a cumulus puff.
    let inside = 0;
    if (p.deck > 0.5) {
      const y0 = this.groundRef + p.base;
      const y1 = y0 + p.thickness;
      if (cam.y > y0 && cam.y < y1) inside = Math.min(smoothstep(y0, y0 + 60, cam.y), smoothstep(y1, y1 - 120, cam.y));
    }
    for (const c of this.clusters) {
      const dx = cam.x - c.x;
      const dz = cam.z - c.z;
      if (dx * dx + dz * dz > c.size * c.size) continue;
      const d = Math.hypot(dx, (cam.y - (c.y + c.size * 0.3)) * 2.2, dz);
      inside = Math.max(inside, 1 - smoothstep(c.size * 0.2, c.size * 0.55, d));
    }
    this.inCloud += (inside - this.inCloud) * (1 - Math.exp(-dt * 1.5));
    // Ground fog: visibility collapses close to the surface.
    // (the ground-fog preset uses a thin haze layer: see Environment.setFogHeight)
    let vis = this.baseVisibility;
    vis = vis + (260 - vis) * this.inCloud;
    this.env.setVisibility(Math.max(120, vis));
    this.currentVisibility = vis;

    // Precipitation relative velocity: fall speed plus wind minus the aircraft's own motion.
    if (p.precip) {
      const u = this.precipUniforms;
      u.uTime.value = this.time;
      u.uCam.value.copy(cam);
      const fall = p.precip === 'snow' ? 1.6 : 9;
      u.uRel.value.set(wind.x - camVel.x, -fall + wind.y - camVel.y, wind.z - camVel.z);
      u.uPix.value = camera.userData.pixelScale ?? 1;
      const under = cam.y < this.groundRef + p.base + p.thickness ? 1 : 0.1;
      u.uAlpha.value = (p.precip === 'snow' ? 0.9 : 0.5 * (0.4 + p.rate * 0.6)) * under;
    }

    // Lightning flashes in storms.
    if (p.lightning) {
      this.flashTimer -= dt;
      if (this.flashTimer < 0) { this.flashTimer = 3 + Math.random() * 9; this.flash = 1; }
    }
    this.flash = Math.max(0, this.flash - dt * 6);
    this.env.flash = this.flash;
    return vis;
  }

  dispose() {
    this.scene.remove(this.clouds, this.deck, this.rainLines, this.snow);
    this.clouds.geometry.dispose();
    this.deck.geometry.dispose();
    this.rainLines.geometry.dispose();
    this.snow.geometry.dispose();
  }
}
