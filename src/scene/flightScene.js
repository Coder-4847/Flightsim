import * as THREE from 'three';
import { createNoise, smoothstep } from '../util/noise.js';
import { SURFACES, SimWorld } from '../flight/world.js';
import { makeApronTexture, makeGroundDetailTexture, makeRunwayTexture } from './textures.js';

// World conventions (used everywhere): +X east, +Y up, -Z north. Heading 0 deg
// is north (-Z), 90 deg is east (+X). Units are metres.

const RUNWAY = { widthM: 45, lengthM: 2400 };
const TERRAIN_SIZE = 24000;
const TERRAIN_SEGMENTS = 240;
const SKY_COLOR_HORIZON = new THREE.Color('#b9d3e8');
const SKY_COLOR_ZENITH = new THREE.Color('#2c6cb0');
const SUN_DIRECTION = new THREE.Vector3(0.45, 0.62, -0.64).normalize();

const TERRAIN_NOISE = createNoise(1337);
const QUALITY_PIXEL_RATIO = { low: 1, medium: 1.5, high: 2 };

// Yield to the browser between build steps so the loading bar can repaint.
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export class FlightScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, 40000);
    this.camera.position.set(0, 60, 400);
    this.built = false;

    this.setQuality('medium');
    this.resize();
  }

  /** Build the world in steps, reporting progress 0..1 and a label. */
  async build(onProgress = () => {}) {
    if (this.built) return;
    const steps = [
      ['Sky', () => this.#buildSky()],
      ['Terrain', () => this.#buildTerrain()],
      ['Runway', () => this.#buildRunway()],
      ['Airfield', () => this.#buildAirfield()],
    ];
    for (let i = 0; i < steps.length; i++) {
      onProgress(i / steps.length, steps[i][0]);
      await nextFrame();
      steps[i][1]();
    }
    onProgress(1, 'Ready');
    await nextFrame();
    this.built = true;
  }

  setQuality(level) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY_PIXEL_RATIO[level] ?? 1.5));
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Ground height and surface type for the physics (the same function shapes the terrain mesh). */
  static createPhysicsWorld(weather = 'calm') {
    const inRect = (x, z, x0, x1, z0, z1) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
    return new SimWorld({
      groundHeight: (x, z) => FlightScene.terrainHeight(TERRAIN_NOISE, x, z),
      surface: (x, z) => (
        inRect(x, z, -30, 30, -1260, 1260) || inRect(x, z, 20, 65, 76, 104) || inRect(x, z, 60, 242, 33, 147)
          ? SURFACES.paved : SURFACES.grass),
      weather,
    });
  }

  /** Where the tower camera sits (the control tower cab). */
  static get TOWER_POSITION() {
    return new THREE.Vector3(205, 33.5, 15);
  }

  render(cameraPosition) {
    this.sky?.position.copy(cameraPosition); // sky dome follows the camera
    this.renderer.render(this.scene, this.camera);
  }

  // ---- world construction ------------------------------------------------
  #buildSky() {
    this.scene.fog = new THREE.Fog(SKY_COLOR_HORIZON, 2500, 11000);
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        horizon: { value: SKY_COLOR_HORIZON },
        zenith: { value: SKY_COLOR_ZENITH },
        sunDir: { value: SUN_DIRECTION },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 horizon; uniform vec3 zenith; uniform vec3 sunDir;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 col = mix(horizon, zenith, pow(h, 0.55));
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          col += vec3(1.0, 0.92, 0.75) * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.18);
          if (vDir.y < 0.0) col = horizon; // below the horizon blends into terrain fog
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(20000, 32, 16), material);
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    this.scene.add(new THREE.HemisphereLight(0xcfe3f5, 0x5d6a52, 1.1));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
    sun.position.copy(SUN_DIRECTION).multiplyScalar(1000);
    this.scene.add(sun);
  }

  /** Height of the demo terrain at (x, z): flat near the airfield, rolling hills beyond. */
  static terrainHeight(noise, x, z) {
    const r = Math.hypot(x, z * 0.5);
    const hills = noise.fbm(x / 2600, z / 2600, 5);
    return (hills - 0.4) * 520 * smoothstep(1800, 5200, r);
  }

  #buildTerrain() {
    const noise = TERRAIN_NOISE;
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const lowland = new THREE.Color('#5d7a3f');
    const meadow = new THREE.Color('#7b8f48');
    const upland = new THREE.Color('#8a8466');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = FlightScene.terrainHeight(noise, x, z);
      pos.setY(i, y);
      const patch = noise.fbm(x / 700 + 40, z / 700, 3);
      c.copy(lowland).lerp(meadow, patch).lerp(upland, smoothstep(40, 220, y));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const detail = makeGroundDetailTexture();
    detail.repeat.set(TERRAIN_SIZE / 60, TERRAIN_SIZE / 60);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: detail, vertexColors: true, roughness: 1, metalness: 0,
    }));
    mesh.matrixAutoUpdate = false;
    this.scene.add(mesh);
  }

  #buildRunway() {
    const { widthM, lengthM } = RUNWAY;
    const tex = makeRunwayTexture({ widthM, lengthM, northNumber: '18', southNumber: '36' });
    const geo = new THREE.PlaneGeometry(widthM, lengthM);
    geo.rotateX(-Math.PI / 2);
    const runway = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    runway.position.y = 0.05;
    this.scene.add(runway);

    // Edge lights, instanced: one draw call for the whole runway.
    const count = Math.floor(lengthM / 60) + 1;
    const lights = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.35, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xfff2c4 }),
      count * 2,
    );
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const z = -lengthM / 2 + i * 60;
      m.setPosition(-widthM / 2 - 1.5, 0.4, z); lights.setMatrixAt(i * 2, m);
      m.setPosition(widthM / 2 + 1.5, 0.4, z); lights.setMatrixAt(i * 2 + 1, m);
    }
    this.scene.add(lights);
  }

  #buildAirfield() {
    // Apron east of the runway, joined by a short taxiway stub (all flat, just above terrain).
    const paved = (w, d, repeatX, repeatY) => {
      const tex = makeApronTexture();
      tex.repeat.set(repeatX, repeatY);
      return new THREE.Mesh(
        new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }),
      );
    };
    const apron = paved(180, 110, 12, 8);
    apron.position.set(150, 0.04, 90);
    const taxiway = paved(38, 22, 3, 2);
    taxiway.position.set(41.25, 0.045, 90);
    this.scene.add(apron, taxiway);

    const wall = new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.85 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.7 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x1b2a38, roughness: 0.15, metalness: 0.4 });

    // Three hangars with gabled roofs.
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(44, 12, 36), wall);
      body.position.y = 6;
      const shape = new THREE.Shape([
        new THREE.Vector2(-23, 12), new THREE.Vector2(23, 12), new THREE.Vector2(0, 17.5),
      ]);
      const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 37, bevelEnabled: false }), roof);
      gable.position.z = -18.5;
      g.add(body, gable);
      g.position.set(110 + i * 55, 0, 160);
      this.scene.add(g);
    }

    // Terminal + control tower.
    const terminal = new THREE.Mesh(new THREE.BoxGeometry(70, 9, 24), wall);
    terminal.position.set(150, 4.5, 15);
    this.scene.add(terminal);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.2, 26, 16), wall);
    shaft.position.set(205, 13, 15);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 4, 5.5, 16), glass);
    cab.position.set(205, 28.5, 15);
    const cabRoof = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 0.8, 16), roof);
    cabRoof.position.set(205, 31.6, 15);
    this.scene.add(shaft, cab, cabRoof);

    // Windsock.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 8, 6), wall);
    pole.position.set(-60, 4, -300);
    const sock = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 4.5, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xff7a1a, side: THREE.DoubleSide, roughness: 0.8 }),
    );
    sock.rotation.z = -Math.PI / 2 + 0.25;
    sock.position.set(-58, 7.6, -300);
    this.scene.add(pole, sock);
  }
}
