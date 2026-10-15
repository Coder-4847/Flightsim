import * as THREE from 'three';
import { smoothstep } from '../util/noise.js';
import { ATMO_GLSL, atmosphere } from './atmosphere.js';

// Sky, sun/moon, stars, ambient light and fog, driven by the time of day. Weather (clouds,
// precipitation) is layered on top by weather.js and adjusts visibility and light through here.
// The atmosphere uniforms (atmosphere.js) are updated here, so the sky dome, the aerial-perspective
// fog, the water and the PMREM environment all agree.

const LATITUDE = 38 * (Math.PI / 180);
const DECLINATION = 14 * (Math.PI / 180); // late-spring sun

const PALETTE = {
  day: { zenith: new THREE.Color('#2a5ca8'), horizon: new THREE.Color('#bdd5e9'), sun: new THREE.Color('#fff2da') },
  golden: { zenith: new THREE.Color('#38609e'), horizon: new THREE.Color('#f0b583'), sun: new THREE.Color('#ffae62') },
  dusk: { zenith: new THREE.Color('#1a2a4d'), horizon: new THREE.Color('#b0594f'), sun: new THREE.Color('#ff7a4a') },
  night: { zenith: new THREE.Color('#02040b'), horizon: new THREE.Color('#0b1328'), sun: new THREE.Color('#1c2a55') },
};

const _c = new THREE.Color();
const WHITE = new THREE.Color('#ffffff');
const OVERCAST_SKY = new THREE.Color('#8f99a5');
const OVERCAST_ZENITH = new THREE.Color('#6d7885');
const MOON_COLOR = new THREE.Color('#9db4ff');
const GROUND_TINT = new THREE.Color('#4f5a48');

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.hour = 12;
    this.timeScale = 1; // simulated seconds per real second (1 = real time, 0 = frozen)
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.lightDir = new THREE.Vector3(0, 1, 0); // towards the active directional light (sun or moon)
    this.sunElevation = 1;
    this.dayAmt = 1;
    this.night = 0; // 0 day .. 1 full night (drives lights-on behaviour)
    this.visibility = 60000; // metres
    this.fogHeight = 2800; // scale height of the haze (ground fog uses a thin layer)
    this.groundRef = 0;
    this.cloudDim = 0; // 0 clear .. 1 heavy overcast (dims the sun)
    this.flash = 0; // lightning flash level 0..1
    this.hemiBase = 1;
    this.hemiScale = 1; // reduced when the image-based environment supplies the ambient light
    this.fogTint = new THREE.Color('#9aa5b3');
    this.zenith = new THREE.Color();
    this.horizon = new THREE.Color();
    this.listeners = [];
    this.time = 0;

    scene.fog = new THREE.Fog(0xb9d3e8, 4000, 70000);
    this.hemi = new THREE.HemisphereLight(0xcfe3f5, 0x5d6a52, 1.1);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
    scene.add(this.hemi, this.sun, this.sun.target);

    this.skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      uniforms: {
        ...atmosphere.uniforms,
        moonDir: { value: this.moonDir }, night: { value: 0 }, overcast: { value: 0 }, uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        ${ATMO_GLSL}
        uniform vec3 moonDir; uniform float night; uniform float overcast; uniform float uTime;
        varying vec3 vDir;
        float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float h2(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float n2(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
        void main() {
          vec3 d = normalize(vDir);
          vec3 col = atmoSky(d);
          float s = max(dot(d, uAtmoSunDir), 0.0);
          // Sun disc and a tight corona (the broad glow is part of atmoSky).
          col += uAtmoSunCol * (smoothstep(0.99994, 0.99998, s) * 40.0 + pow(s, 1500.0) * 4.0) * (1.0 - overcast * 0.9) * uAtmoFog.w;
          // Thin high cirrus streaks, drifting slowly; they thicken a little around the sun.
          if (d.y > 0.02 && overcast < 0.9) {
            vec2 p = d.xz / (d.y + 0.12);
            vec2 q = vec2(p.x * 0.55 + uTime * 0.004, p.y * 2.4);
            float c = n2(q * 3.0) * 0.55 + n2(q * 7.0 + 4.0) * 0.3 + n2(q * 17.0 + 9.0) * 0.15;
            float cirrus = smoothstep(0.52, 0.86, c) * smoothstep(0.02, 0.35, d.y) * 0.5 * (1.0 - overcast);
            vec3 cc = mix(atmoSky(vec3(d.x, 0.0, d.z)) * 1.1 + 0.04, uAtmoSunCol * 0.8 + 0.25, 0.35 + 0.4 * pow(s, 4.0));
            col = mix(col, cc * (1.0 - night * 0.9), cirrus);
          }
          // Moon disc and stars fade in at night, and are hidden under cloud.
          float m = max(dot(d, moonDir), 0.0);
          col += vec3(0.85, 0.9, 1.0) * smoothstep(0.9993, 0.9996, m) * night * (1.0 - overcast);
          vec3 cell = floor(d * 260.0);
          float star = step(0.9965, hash(cell)) * smoothstep(0.02, 0.35, d.y);
          col += vec3(star) * night * (1.0 - overcast) * (0.5 + 0.5 * hash(cell + 3.0));
          if (d.y < 0.0) col = atmoSky(vec3(d.x, 0.0, d.z)) * 0.93;
          col = mix(col, uAtmoHorizon * 0.9 + vec3(0.03), overcast * 0.85);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(100000, 32, 16), this.skyMaterial);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);
    this.setHour(12);
  }

  /** Sun direction (east +X, north -Z) from the hour of day. */
  #solar(hour) {
    const ha = (hour - 12) * (Math.PI / 12);
    const sinEl = Math.sin(LATITUDE) * Math.sin(DECLINATION) + Math.cos(LATITUDE) * Math.cos(DECLINATION) * Math.cos(ha);
    const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
    // Azimuth measured from north, clockwise.
    const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(LATITUDE) - Math.tan(DECLINATION) * Math.cos(LATITUDE)) + Math.PI;
    return { el, az };
  }

  setHour(hour) {
    this.hour = ((hour % 24) + 24) % 24;
    const { el, az } = this.#solar(this.hour);
    this.sunElevation = el;
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.moonDir.set(-this.sunDir.x * 0.9 + 0.1, -this.sunDir.y * 0.9 + 0.25, -this.sunDir.z * 0.9).normalize();
    this.#applyLighting();
  }

  #applyLighting() {
    const el = this.sunElevation / (Math.PI / 180); // degrees
    const dayAmt = smoothstep(-4, 12, el);
    this.dayAmt = dayAmt;
    this.night = 1 - smoothstep(-10, 0, el);
    // Palette: night -> dusk -> golden -> day by sun elevation.
    const blend = (a, b, t, key) => _c.copy(a[key]).lerp(b[key], t);
    const sunCol = this.skyMaterial.uniforms.uAtmoSunCol.value;
    if (el > 14) { this.zenith.copy(PALETTE.day.zenith); this.horizon.copy(PALETTE.day.horizon); sunCol.copy(PALETTE.day.sun); }
    else if (el > 2) {
      const t = (14 - el) / 12; // 0 day -> 1 golden
      this.zenith.copy(blend(PALETTE.day, PALETTE.golden, t, 'zenith')); this.horizon.copy(blend(PALETTE.day, PALETTE.golden, t, 'horizon'));
      sunCol.copy(blend(PALETTE.day, PALETTE.golden, t, 'sun'));
    } else if (el > -6) {
      const t = (2 - el) / 8; // golden -> dusk
      this.zenith.copy(blend(PALETTE.golden, PALETTE.dusk, t, 'zenith')); this.horizon.copy(blend(PALETTE.golden, PALETTE.dusk, t, 'horizon'));
      sunCol.copy(blend(PALETTE.golden, PALETTE.dusk, t, 'sun'));
    } else {
      const t = Math.min(1, (-6 - el) / 8); // dusk -> night
      this.zenith.copy(blend(PALETTE.dusk, PALETTE.night, t, 'zenith')); this.horizon.copy(blend(PALETTE.dusk, PALETTE.night, t, 'horizon'));
      sunCol.copy(blend(PALETTE.dusk, PALETTE.night, t, 'sun'));
    }
    // Cloud cover greys the sky.
    this.zenith.lerp(OVERCAST_ZENITH, this.cloudDim * 0.75 * Math.max(0.15, dayAmt));
    this.horizon.lerp(OVERCAST_SKY, this.cloudDim * 0.6 * Math.max(0.15, dayAmt));
    const u = atmosphere.uniforms;
    u.uAtmoZenith.value.copy(this.zenith);
    u.uAtmoHorizon.value.copy(this.horizon);
    u.uAtmoSunDir.value.copy(this.sunDir);
    u.uAtmoFog.value.w = (0.2 + 0.8 * dayAmt) * (1 - 0.8 * this.cloudDim);
    this.skyMaterial.uniforms.night.value = this.night;
    this.skyMaterial.uniforms.overcast.value = this.cloudDim;

    // Direct light: sun by day, a dim bluish moon at night.
    const sunPower = dayAmt * (1 - 0.82 * this.cloudDim) * (0.55 + 0.45 * smoothstep(0, 25, el));
    const moonPower = this.night * 0.2 * (1 - 0.7 * this.cloudDim);
    const target = this.sun.target.position;
    if (sunPower >= moonPower) {
      this.lightDir.copy(this.sunDir);
      this.sun.color.copy(el > 12 ? PALETTE.day.sun : sunCol);
      this.sun.intensity = Math.max(0.0001, sunPower * 2.8);
    } else {
      this.lightDir.copy(this.moonDir);
      this.sun.color.copy(MOON_COLOR);
      this.sun.intensity = moonPower * 2.2;
    }
    this.sun.position.copy(target).addScaledVector(this.lightDir, 1000);
    this.hemi.color.copy(this.zenith).lerp(WHITE, 0.35);
    this.hemi.groundColor.copy(GROUND_TINT).multiplyScalar(0.25 + 0.75 * dayAmt);
    this.hemiBase = 0.1 + dayAmt * (1.0 - 0.45 * this.cloudDim) + this.night * 0.06;
    this.hemi.intensity = this.hemiBase * this.hemiScale;

    // Fog follows the horizon colour (the shader recomputes it per direction; this is the fallback).
    this.fogTint.copy(this.horizon);
    this.scene.fog.color.copy(this.fogTint);
    this.#applyVisibility();
    for (const fn of this.listeners) fn(this);
  }

  #applyVisibility() {
    const v = this.visibility;
    this.scene.fog.near = Math.min(4000, v * 0.1);
    this.scene.fog.far = v * 1.15;
    const f = atmosphere.uniforms.uAtmoFog.value;
    f.x = 1.8 / Math.max(80, v);
    f.y = this.fogHeight;
    f.z = this.groundRef;
  }

  setVisibility(metres) {
    this.visibility = metres;
    this.#applyVisibility();
  }

  /** Thin low-lying fog uses a small scale height, ordinary haze a large one. */
  setFogHeight(h) {
    this.fogHeight = h;
    this.#applyVisibility();
  }

  setGroundReference(h) {
    this.groundRef = h;
    this.#applyVisibility();
  }

  setCloudDim(amount) {
    this.cloudDim = amount;
    this.#applyLighting();
  }

  /** Scale of the hemisphere light (the image-based environment replaces most of it when active). */
  setHemiScale(k) {
    this.hemiScale = k;
    this.hemi.intensity = this.hemiBase * k;
  }

  /** Advance the clock. `dt` is real seconds. */
  update(dt, cameraPosition) {
    this.time += dt;
    this.skyMaterial.uniforms.uTime.value = this.time;
    if (this.timeScale > 0) {
      const before = this.hour;
      this.hour = (this.hour + (dt * this.timeScale) / 3600) % 24;
      // Re-light only when the hour moved enough to matter (cheap enough every frame at 1x anyway).
      if (Math.abs(this.hour - before) > 0.0005 || this.timeScale > 1) this.setHour(this.hour);
    }
    this.sky.position.copy(cameraPosition);
    this.hemi.intensity = this.hemiBase * this.hemiScale + this.flash * 2.4;
  }
}
