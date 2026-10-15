import * as THREE from 'three';
import { addParkedTraffic } from '../traffic/parked.js';
import { Rng } from '../util/random.js';
import { layoutAirport } from './airportLayout.js';
import { airportStyle, decalMaterial, paintMaterial, surfaceMaterial } from './airport/materials.js';
import { addAirfieldLights } from './airport/airfieldLights.js';
import { LightSet, disposeLightMaterial, lightMaterial } from './airport/lightField.js';
import { buildSurfaces } from './airport/surfaces.js';
import { disposeAirportTextures, rubberTexture, streakTexture } from './airport/textures.js';

// Builds the 3D airport for a map's airport record. The group sits at (x, elevation, z) in the world; its
// child `frame` is rotated so that local +X runs along the main runway heading and +Z to its right, which
// is the coordinate system of airportLayout.js. Content is split into LOD sets that the manager shows and
// hides by distance.

const DEG = Math.PI / 180;

export function setLightBrightness() {}

export function buildAirport(a, { biome = 'grass' } = {}) {
  const layout = layoutAirport(a);
  let seed = layout.seed;
  const rng = new Rng(seed ^ 0x51ed);
  const style = airportStyle(rng, biome);
  const group = new THREE.Group();
  group.position.set(a.x, a.elevation, a.z);
  const frame = new THREE.Group();
  frame.rotation.y = Math.PI / 2 - a.runways[0].heading * DEG;
  group.add(frame);
  const disposables = [];
  const mats = {};
  const mk = (key, m) => { mats[key] = m; disposables.push(m); return m; };

  const groundKind = { grass: 'grass', desert: 'dirt', snow: 'snow' }[biome] ?? 'grass';
  mk('asphalt', surfaceMaterial('asphalt', style.asphaltTint));
  mk('concrete', surfaceMaterial('concrete', new THREE.Color(...style.concreteTint)));
  mk('gravel', surfaceMaterial('dirt', 0.8));
  mk('infield', surfaceMaterial(groundKind, groundKind === 'grass' ? new THREE.Color(0.8, 0.95, 0.72) : 1));
  mk('strip', surfaceMaterial(groundKind, groundKind === 'grass' ? new THREE.Color(1.05, 1.15, 0.8) : groundKind === 'snow' ? 0.95 : 1.1));
  mk('paintW', paintMaterial(0xf2f2ee));
  mk('paintY', paintMaterial(0xe8b712));
  mk('paintR', paintMaterial(0xb01e22));
  mk('glyphW', paintMaterial(0xf2f2ee, { glyph: true }));
  mk('glyphY', paintMaterial(0xe8b712, { glyph: true }));
  mk('rubber', decalMaterial(rubberTexture(), 0x08080a));
  const streak = decalMaterial(streakTexture(), 0x0a0a0a, { opacity: 0.9 });
  mk('streak', streak);

  // ---- surfaces and markings ------------------------------------------------------------------------------------
  const surf = buildSurfaces({ a, layout, rng, style, biome });
  const surfaceGroup = new THREE.Group();
  frame.add(surfaceGroup);
  const meshes = surf.bufs.build(mats, surfaceGroup);
  for (const m of meshes) {
    m.receiveShadow = false;
    if (m.name === 'rubber' || m.name === 'streak') { m.renderOrder = 2; }
    if (m.name.startsWith('paint') || m.name.startsWith('glyph')) { m.renderOrder = 3; }
  }
  disposables.push(...meshes.map((m) => ({ dispose: () => m.geometry.dispose() })));

  // ---- lights ------------------------------------------------------------------------------------------------------
  const lights = new LightSet();
  const lightInfo = addAirfieldLights(lights, { a, layout });
  const lightPoints = lights.build();
  if (lightPoints) { frame.add(lightPoints); disposables.push({ dispose: () => lightPoints.geometry.dispose() }); }
  group.userData.lightInfo = lightInfo;

  // ---- parked traffic (placed in world axes, so it is a child of the group, not of the frame) --------------------------------
  addParkedTraffic(group, a);
  group.userData.anim = { windsock: null, papi: [], beacon: null };
  group.userData.airport = a;
  group.userData.frame = frame;
  group.userData.disposables = disposables;
  return group;
}

/** Streams airports in and out around the camera and animates windsocks. */
export class AirportManager {
  constructor(scene, map, env) {
    this.scene = scene;
    this.map = map;
    this.env = env;
    this.built = new Map();
    this.buildRadius = 28000;
    this.dropRadius = 42000;
  }

  update(camPos) {
    const lm = lightMaterial();
    lm.uniforms.uNight.value = this.env.night;
    lm.uniforms.uTime.value = performance.now() / 1000;
    let builtThisFrame = 0;
    for (const a of this.map.airports) {
      const d = Math.hypot(camPos.x - a.x, camPos.z - a.z);
      const have = this.built.get(a.code);
      if (!have && d < this.buildRadius && builtThisFrame < 1) {
        const g = buildAirport(a, { biome: this.map.cfg.biome });
        this.scene.add(g);
        this.built.set(a.code, g);
        builtThisFrame++;
      } else if (have && d > this.dropRadius) {
        this.#drop(have);
        this.built.delete(a.code);
      }
    }
  }

  #drop(g) {
    this.scene.remove(g);
    for (const d of g.userData.disposables ?? []) d.dispose?.();
    g.traverse((o) => { if (o.userData?.fleetClone) return; });
  }

  dispose() {
    for (const g of this.built.values()) this.#drop(g);
    this.built.clear();
    disposeAirportTextures();
    disposeLightMaterial();
  }
}
