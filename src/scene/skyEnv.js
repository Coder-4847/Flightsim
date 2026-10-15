import * as THREE from 'three';
import { ATMO_GLSL, atmosphere } from './atmosphere.js';

// Image-based lighting: the sky (the same model as the dome and the fog) plus a ground colour is
// rendered into a PMREM cube map that every standard material uses as scene.environment. That
// gives sky-coloured ambient light, plausible reflections on metal, glass and wet ground, and
// follows the time of day and the weather. It is regenerated only when the sky has changed enough.

const GROUND = { grass: '#46592f', desert: '#8b6f4b', snow: '#cfd8e2' };

export class SkyEnvironment {
  constructor(renderer, scene, env) {
    this.renderer = renderer;
    this.scene = scene;
    this.env = env;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.ground = new THREE.Color(GROUND.grass);
    this.groundUniform = { value: new THREE.Color() };
    this.skyScene = new THREE.Scene();
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(50, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
        uniforms: { ...atmosphere.uniforms, uGround: this.groundUniform, uOvercast: { value: 0 } },
        vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `
          ${ATMO_GLSL}
          uniform vec3 uGround; uniform float uOvercast;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            vec3 col = atmoSky(vec3(d.x, max(d.y, 0.0), d.z));
            // Ground: lit by the sun in proportion to how much sky and sun there is.
            float lit = max(uAtmoSunDir.y, 0.0) * 0.8 * (1.0 - uOvercast * 0.7) + 0.08;
            vec3 gcol = uGround * (lit * (0.55 + 0.45 * max(dot(d.xz, uAtmoSunDir.xz) * 0.5 + 0.5, 0.0)) + 0.06 * col);
            float g = smoothstep(0.02, -0.12, d.y);
            gl_FragColor = vec4(mix(col, gcol, g), 1.0);
          }`,
      }),
    );
    this.skyScene.add(this.dome);
    this.target = null;
    this.key = '';
    this.lastTime = -10;
    this.enabled = true;
    this.intensity = 0.8;
  }

  setBiome(biome) {
    this.ground.set(GROUND[biome] ?? GROUND.grass);
    this.key = '';
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) { this.scene.environment = null; this.env.setHemiScale(1); } else this.key = '';
  }

  #makeKey() {
    const u = atmosphere.uniforms;
    const e = this.env;
    const r = (v, k) => Math.round(v * k);
    return [r(u.uAtmoSunDir.value.x, 60), r(u.uAtmoSunDir.value.y, 60), r(e.cloudDim, 12), r(e.night, 8),
      r(u.uAtmoHorizon.value.r, 40), r(u.uAtmoHorizon.value.b, 40), r(u.uAtmoZenith.value.b, 40)].join(',');
  }

  /** Call every frame; regenerates the cube map when the sky changed (throttled). */
  update(now) {
    if (!this.enabled) return;
    const key = this.#makeKey();
    if (key === this.key && this.target) return;
    if (this.target && now - this.lastTime < 1.2) return;
    this.key = key;
    this.lastTime = now;
    this.groundUniform.value.copy(this.ground);
    this.dome.material.uniforms.uOvercast.value = this.env.cloudDim;
    const rt = this.pmrem.fromScene(this.skyScene, 0, 1, 100);
    this.target?.dispose();
    this.target = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = this.intensity * (0.35 + 0.65 * Math.max(this.env.dayAmt, 0.25));
    this.env.setHemiScale(0.26);
  }

  dispose() {
    this.target?.dispose();
    this.pmrem.dispose();
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.scene.environment = null;
  }
}
