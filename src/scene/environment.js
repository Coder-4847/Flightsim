import * as THREE from 'three';
import { smoothstep } from '../util/noise.js';

// Sky, sun/moon, stars, ambient light and fog, driven by the time of day. Weather (clouds,
// precipitation) is layered on top by weather.js and adjusts visibility and light through here.

const LATITUDE = 38 * (Math.PI / 180);
const DECLINATION = 14 * (Math.PI / 180); // late-spring sun

const PALETTE = {
  day: { zenith: new THREE.Color('#2c6cb0'), horizon: new THREE.Color('#b9d3e8'), sun: new THREE.Color('#fff4de') },
  golden: { zenith: new THREE.Color('#3d6aa8'), horizon: new THREE.Color('#f2b27c'), sun: new THREE.Color('#ffb36b') },
  dusk: { zenith: new THREE.Color('#1a2a4d'), horizon: new THREE.Color('#b0594f'), sun: new THREE.Color('#ff7a4a') },
  night: { zenith: new THREE.Color('#02040b'), horizon: new THREE.Color('#0b1328'), sun: new THREE.Color('#1c2a55') },
};

const _c = new THREE.Color();
const WHITE = new THREE.Color('#ffffff');
const OVERCAST_FOG = new THREE.Color('#8e98a4');
const MOON_COLOR = new THREE.Color('#9db4ff');
const GROUND_TINT = new THREE.Color('#4f5a48');

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.hour = 12;
    this.timeScale = 1; // simulated seconds per real second (1 = real time, 0 = frozen)
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.sunElevation = 1;
    this.night = 0; // 0 day .. 1 full night (drives lights-on behaviour)
    this.visibility = 60000; // metres
    this.cloudDim = 0; // 0 clear .. 1 heavy overcast (dims the sun)
    this.fogTint = new THREE.Color('#9aa5b3');
    this.zenith = new THREE.Color();
    this.horizon = new THREE.Color();
    this.listeners = [];

    scene.fog = new THREE.Fog(0xb9d3e8, 4000, 70000);
    this.hemi = new THREE.HemisphereLight(0xcfe3f5, 0x5d6a52, 1.1);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
    scene.add(this.hemi, this.sun);

    this.skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      uniforms: {
        horizon: { value: this.horizon }, zenith: { value: this.zenith },
        sunDir: { value: this.sunDir }, moonDir: { value: this.moonDir },
        sunColor: { value: new THREE.Color('#fff4de') }, night: { value: 0 }, overcast: { value: 0 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 horizon; uniform vec3 zenith; uniform vec3 sunDir; uniform vec3 moonDir; uniform vec3 sunColor;
        uniform float night; uniform float overcast;
        varying vec3 vDir;
        float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(horizon, zenith, pow(h, 0.5));
          float s = max(dot(d, sunDir), 0.0);
          col += sunColor * (pow(s, 900.0) * 3.0 + pow(s, 14.0) * 0.22 + pow(s, 3.0) * 0.06 * (1.0 - h));
          // Moon disc and stars fade in at night, and are hidden under cloud.
          float m = max(dot(d, moonDir), 0.0);
          col += vec3(0.85, 0.9, 1.0) * smoothstep(0.9993, 0.9996, m) * night * (1.0 - overcast);
          vec3 cell = floor(d * 260.0);
          float star = step(0.9965, hash(cell)) * smoothstep(0.02, 0.35, d.y);
          col += vec3(star) * night * (1.0 - overcast) * (0.5 + 0.5 * hash(cell + 3.0));
          if (d.y < 0.0) col = horizon * 0.9;
          col = mix(col, horizon * 0.85 + vec3(0.04), overcast * 0.85);
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
    this.night = 1 - smoothstep(-10, 0, el);
    // Palette: night -> dusk -> golden -> day by sun elevation.
    const blend = (a, b, t, key) => _c.copy(a[key]).lerp(b[key], t);
    let zen; let hor; let sunCol;
    if (el > 14) { zen = PALETTE.day.zenith; hor = PALETTE.day.horizon; sunCol = PALETTE.day.sun; this.zenith.copy(zen); this.horizon.copy(hor); this.skyMaterial.uniforms.sunColor.value.copy(sunCol); }
    else if (el > 2) {
      const t = (14 - el) / 12; // 0 day -> 1 golden
      this.zenith.copy(blend(PALETTE.day, PALETTE.golden, t, 'zenith')); this.horizon.copy(blend(PALETTE.day, PALETTE.golden, t, 'horizon'));
      this.skyMaterial.uniforms.sunColor.value.copy(blend(PALETTE.day, PALETTE.golden, t, 'sun'));
    } else if (el > -6) {
      const t = (2 - el) / 8; // golden -> dusk
      this.zenith.copy(blend(PALETTE.golden, PALETTE.dusk, t, 'zenith')); this.horizon.copy(blend(PALETTE.golden, PALETTE.dusk, t, 'horizon'));
      this.skyMaterial.uniforms.sunColor.value.copy(blend(PALETTE.golden, PALETTE.dusk, t, 'sun'));
    } else {
      const t = Math.min(1, (-6 - el) / 8); // dusk -> night
      this.zenith.copy(blend(PALETTE.dusk, PALETTE.night, t, 'zenith')); this.horizon.copy(blend(PALETTE.dusk, PALETTE.night, t, 'horizon'));
      this.skyMaterial.uniforms.sunColor.value.copy(blend(PALETTE.dusk, PALETTE.night, t, 'sun'));
    }
    this.skyMaterial.uniforms.night.value = this.night;
    this.skyMaterial.uniforms.overcast.value = this.cloudDim;

    // Direct light: sun by day, a dim bluish moon at night.
    const sunPower = dayAmt * (1 - 0.82 * this.cloudDim) * (0.55 + 0.45 * smoothstep(0, 25, el));
    const moonPower = this.night * 0.2 * (1 - 0.7 * this.cloudDim);
    if (sunPower >= moonPower) {
      this.sun.position.copy(this.sunDir).multiplyScalar(1000);
      this.sun.color.copy(el > 12 ? PALETTE.day.sun : this.skyMaterial.uniforms.sunColor.value);
      this.sun.intensity = Math.max(0.0001, sunPower * 2.8);
    } else {
      this.sun.position.copy(this.moonDir).multiplyScalar(1000);
      this.sun.color.copy(MOON_COLOR);
      this.sun.intensity = moonPower * 2.2;
    }
    this.hemi.color.copy(this.zenith).lerp(WHITE, 0.35);
    this.hemi.groundColor.copy(GROUND_TINT).multiplyScalar(0.25 + 0.75 * dayAmt);
    this.hemi.intensity = 0.1 + dayAmt * (1.0 - 0.45 * this.cloudDim) + this.night * 0.06;

    // Fog follows the horizon colour, dimmed at night and tinted grey in bad weather.
    this.fogTint.copy(this.horizon).lerp(OVERCAST_FOG, this.cloudDim * 0.6);
    this.scene.fog.color.copy(this.fogTint);
    this.#applyVisibility();
    for (const fn of this.listeners) fn(this);
  }

  #applyVisibility() {
    const v = this.visibility;
    this.scene.fog.near = Math.min(4000, v * 0.1);
    this.scene.fog.far = v * 1.15;
  }

  setVisibility(metres) {
    this.visibility = metres;
    this.#applyVisibility();
  }

  setCloudDim(amount) {
    this.cloudDim = amount;
    this.#applyLighting();
  }

  /** Advance the clock. `dt` is real seconds. */
  update(dt, cameraPosition) {
    if (this.timeScale > 0) {
      const before = this.hour;
      this.hour = (this.hour + (dt * this.timeScale) / 3600) % 24;
      // Re-light only when the hour moved enough to matter (cheap enough every frame at 1x anyway).
      if (Math.abs(this.hour - before) > 0.0005 || this.timeScale > 1) this.setHour(this.hour);
    }
    this.sky.position.copy(cameraPosition);
  }
}
