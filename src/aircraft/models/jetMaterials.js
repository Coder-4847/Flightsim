import * as THREE from 'three';
import { makeJetTextures } from './jetTextures.js';

// Physically based material set for the jet models. Created once per AircraftView (cached on the shared `mats` object) and
// shared by the three LOD levels. A small procedural sky/ground cube map gives the paint and glass something to reflect; its
// strength follows the scene's hemisphere light so night stays dark.

let envTexture = null;
function getEnv() {
  if (envTexture) return envTexture;
  const faces = [];
  const mk = (fn) => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    fn(g);
    faces.push(c);
  };
  const side = (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, '#5f8fc9');
    grad.addColorStop(0.42, '#cfe0f0');
    grad.addColorStop(0.5, '#e8eef2');
    grad.addColorStop(0.52, '#9aa08f');
    grad.addColorStop(1, '#7d846f');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  };
  mk(side); mk(side); // +x -x
  mk((g) => { g.fillStyle = '#3f78c0'; g.fillRect(0, 0, 64, 64); const r = g.createRadialGradient(32, 32, 0, 32, 32, 40); r.addColorStop(0, 'rgba(255,255,255,0.5)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }); // +y
  mk((g) => { g.fillStyle = '#868c78'; g.fillRect(0, 0, 64, 64); }); // -y
  mk(side); mk(side); // +z -z
  const tex = new THREE.CubeTexture(faces);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  tex.userData.shared = true;
  envTexture = tex;
  return tex;
}

let hemiLight = null;
let hemiScene = null;
function envDrive(renderer, scene) {
  if (hemiScene !== scene) {
    hemiScene = scene;
    hemiLight = null;
    scene.traverse((o) => { if (o.isHemisphereLight && !hemiLight) hemiLight = o; });
  }
  const k = hemiLight ? Math.min(1.2, hemiLight.intensity) : 0.8;
  this.envMapIntensity = this.userData.envBase * (0.12 + 0.88 * k);
}

function std(params, envBase = 0.8) {
  const m = new THREE.MeshStandardMaterial({ envMap: getEnv(), ...params });
  m.userData.envBase = envBase;
  m.envMapIntensity = envBase;
  m.onBeforeRender = envDrive;
  return m;
}

/** Materials for jet `spec`, cached on `mats` so all three LODs share them. */
export function getJetMaterials(spec, mats) {
  if (mats.__jet) return mats.__jet;
  const T = makeJetTextures(spec);
  const livery = spec.livery;
  const J = { textures: T };
  J.skin = std({
    color: 0xe4e4e4, map: T.fus.map, normalMap: T.fus.normal, normalScale: new THREE.Vector2(0.9, 0.9),
    aoMap: T.fus.orm, roughnessMap: T.fus.orm, metalnessMap: T.fus.orm, roughness: 1, metalness: 1,
  }, 0.7);
  J.wing = std({
    color: 0xe4e4e4, map: T.wing.map, normalMap: T.wing.normal, normalScale: new THREE.Vector2(0.9, 0.9),
    aoMap: T.wing.orm, roughnessMap: T.wing.orm, metalnessMap: T.wing.orm, roughness: 1, metalness: 1,
  }, 0.55);
  J.fin = std({
    color: 0xe4e4e4, map: T.fin.map, normalMap: T.fin.normal, aoMap: T.fin.orm, roughnessMap: T.fin.orm, metalnessMap: T.fin.orm, roughness: 1, metalness: 1,
  }, 0.7);
  J.nacelle = std({ color: 0xe4e4e4, map: T.nacelle.map, normalMap: T.nacelle.normal, aoMap: T.nacelle.orm, roughnessMap: T.nacelle.orm, metalnessMap: T.nacelle.orm, roughness: 1, metalness: 1 }, 0.7);
  J.dark = std({ color: 0x1b1e23, roughness: 0.65, metalness: 0.2 }, 0.3);
  J.rubber = std({ map: T.tyre.map, normalMap: T.tyre.normal, color: 0xffffff, roughness: 0.92, metalness: 0 }, 0.15);
  J.chrome = std({ color: 0xdfe3e8, roughness: 0.18, metalness: 1 }, 1.1);
  J.steel = std({ color: 0x8b9199, roughness: 0.42, metalness: 0.85 }, 0.9);
  J.gearPaint = std({ color: 0xd9dcdf, roughness: 0.5, metalness: 0.35 }, 0.6);
  J.wheel = std({ color: 0xb8bec6, roughness: 0.3, metalness: 0.9 }, 1.0);
  J.brake = std({ color: 0x5a4d44, roughness: 0.6, metalness: 0.6 }, 0.6);
  J.engineMetal = std({ color: 0xb4b9bf, roughness: 0.28, metalness: 1 }, 1.0);
  J.hot = std({ color: 0x77726c, roughness: 0.55, metalness: 0.85 }, 0.7);
  J.intake = std({ color: 0x3d4248, roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide }, 0.5);
  J.fanBlade = std({ color: 0x9aa1a8, roughness: 0.32, metalness: 0.85, side: THREE.DoubleSide }, 1.0);
  J.black = std({ color: 0x0c0d0f, roughness: 0.5, metalness: 0.1 }, 0.3);
  J.rim = std({ color: 0x2a2d31, roughness: 0.55, metalness: 0.3 }, 0.4);
  J.lensRed = new THREE.MeshStandardMaterial({ color: 0x7a0f12, emissive: 0x300506, roughness: 0.2, metalness: 0.1 });
  J.lensGreen = new THREE.MeshStandardMaterial({ color: 0x0c6a2c, emissive: 0x031a0b, roughness: 0.2, metalness: 0.1 });
  J.lensWhite = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.15, metalness: 0.2 });
  J.lensClear = new THREE.MeshStandardMaterial({ color: 0xc9d4de, roughness: 0.1, metalness: 0.3 });
  // Glass: shared existing materials get an environment so they reflect the sky.
  J.window = mats.window;
  J.window.envMap = getEnv();
  J.window.userData.envBase = 1.0;
  J.window.onBeforeRender = envDrive;
  J.window.color.set(0x24394d);
  J.window.roughness = 0.05;
  J.window.metalness = 0.65;
  J.glass = std({ color: 0x182736, roughness: 0.04, metalness: 0.8 }, 1.3);
  for (const [k, v] of Object.entries(J)) if (v && v.isMaterial) v.name = k;
  void livery;
  mats.__jet = J;
  return J;
}
