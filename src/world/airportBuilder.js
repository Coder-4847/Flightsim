import * as THREE from 'three';
import { addParkedTraffic } from '../traffic/parked.js';
import { Rng } from '../util/random.js';
import { layoutAirport } from './airportLayout.js';
import { addAirfieldLights } from './airport/airfieldLights.js';
import { addBuildings } from './airport/buildings.js';
import { LightSet, disposeLightMaterial, lightMaterial } from './airport/lightField.js';
import { airportStyle, ambientBoost, decalMaterial, lift, paintMaterial, surfaceMaterial } from './airport/materials.js';
import { BufSet } from './airport/mesh.js';
import {
  addFence, addMasts, addNavaids, addPools, addRoadsAndLots, addSiteVehicles, addTrees, addWindsocks, finalizeSigns,
} from './airport/props.js';
import { buildSurfaces } from './airport/surfaces.js';
import * as TX from './airport/textures.js';
import { VehicleField, disposeVehicleAssets } from './airport/vehicles.js';

// Builds the 3D airport for a map's airport record. The group sits at (x, elevation, z) in the world; its
// child `frame` is rotated so that local +X runs along the main runway heading and +Z to its right, which
// is the coordinate system of airportLayout.js. Content is split into LOD sets (`userData.lod`) that the
// manager shows and hides by distance.

const DEG = Math.PI / 180;

const UV_TILE = {
  wall: [4, 3], wall2: [4, 3], accent: [4, 3], glass: [18, 9], punched: [28.8, 10.8], metal: [2, 2], metalH: [2, 2], roof: [3, 3],
  roofLight: [3, 3], carpark: [8, 4], cab: [4, 2], bridge: [2, 2],
};

export function setLightBrightness() {}

function buildingMaterials(style, mk, signTexture) {
  const std = (o) => lift(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, ...o }));
  const pre = TX.precastPanel(); const curtain = TX.curtainWall(); const punched = TX.punchedFacade(); const metal = TX.metalCladding(); const metalH = TX.metalCladdingH();
  const roof = TX.roofSheet(); const cp = TX.carParkFacade(); const cab = TX.cabGlass();
  const night = [];
  const nm = (key, m, k) => { mk(key, m); night.push({ mat: m, k }); return m; };
  mk('wall', std({ map: pre, color: style.wall }));
  mk('wall2', std({ map: pre, color: style.wall2 }));
  mk('accent', std({ map: pre, color: style.accent, roughness: 0.7 }));
  mk('plain', std({ color: 0xb3b1aa, roughness: 1 }));
  nm('glass', std({ map: curtain.map, emissiveMap: curtain.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.22, metalness: 0.3, color: 0xffffff }), 1.0);
  nm('cab', std({ map: cab, emissive: 0xffc27a, emissiveIntensity: 0, roughness: 0.2, metalness: 0.2, color: 0xffffff }), 0.55);
  nm('punched', std({ map: punched.map, emissiveMap: punched.emissive, emissive: 0xffffff, emissiveIntensity: 0, color: style.wall2 }), 1.0);
  mk('metal', std({ map: metal, color: style.hangar, roughness: 0.6, metalness: 0.15 }));
  mk('metalH', std({ map: metalH, color: new THREE.Color(style.hangar).multiplyScalar(0.8), roughness: 0.6, metalness: 0.15 }));
  mk('roof', std({ map: roof, color: style.roof, roughness: 0.75 }));
  mk('roofLight', std({ map: roof, color: 0xdadde0, roughness: 0.7 }));
  nm('carpark', std({ map: cp.map, emissiveMap: cp.emissive, emissive: 0xffffff, emissiveIntensity: 0, color: 0xffffff }), 0.9);
  mk('steel', std({ color: 0x6a7077, roughness: 0.45, metalness: 0.5 }));
  mk('dark', std({ color: 0x1a1c1f, roughness: 0.6 }));
  mk('tank', std({ color: 0xdfe3e6, roughness: 0.5, metalness: 0.2 }));
  mk('bridge', std({ map: metal, color: 0xc7cbcf, roughness: 0.55, metalness: 0.2 }));
  mk('white', std({ color: 0xe8ebee, roughness: 0.55 }));
  mk('red', std({ color: 0xa32420, roughness: 0.6 }));
  mk('wood', std({ color: 0x6e4f35, roughness: 1 }));
  if (signTexture) nm('signs', std({ map: signTexture, emissiveMap: signTexture, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.5 }), 0.85);
  const fence = std({ map: TX.fenceTexture(), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4, depthWrite: true });
  mk('fence', fence);
  mk('sock', lift(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide })));
  return night;
}

export function buildAirport(a, { biome = 'grass' } = {}) {
  const layout = layoutAirport(a);
  const rng = new Rng(layout.seed ^ 0x51ed);
  const style = airportStyle(rng, biome);
  const group = new THREE.Group();
  group.position.set(a.x, a.elevation, a.z);
  const frame = new THREE.Group();
  frame.rotation.y = Math.PI / 2 - a.runways[0].heading * DEG;
  group.add(frame);
  const disposables = [];
  const mats = {};
  const mk = (key, m) => { mats[key] = m; disposables.push(m); return m; };
  const anim = { windsocks: [], night: [], pools: null };

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
  mk('rubber', decalMaterial(TX.rubberTexture(), 0x08080a));
  mk('streak', decalMaterial(TX.streakTexture(), 0x0a0a0a, { opacity: 0.9 }));
  const poolMat = mk('pool', new THREE.MeshBasicMaterial({ map: TX.lightPoolTexture(), color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, vertexColors: true }));

  // ---- shared context ---------------------------------------------------------------------------------------------------------------
  const mainBufs = new BufSet();
  const detailBufs = new BufSet();
  const lights = new LightSet();
  const vf = new VehicleField();
  const term = layout.sites.find((s) => s.type === 'terminal');
  const ctx = {
    a, layout, rng, style, biome, cls: a.cls, lights, vf, banners: [], pools: [], mats, disposables, anim,
    bufs: mainBufs, surf: null,
    faceDist: (st) => (term.variant === 'hub' ? Math.abs(st.S.v) - term.concourse.half : Math.abs(st.S.v - (term.v + term.face * term.d / 2))),
  };

  // surfaces and markings
  const surf = buildSurfaces({ a, layout, rng, style, biome });
  ctx.surf = surf.bufs;

  // lights
  const lightInfo = addAirfieldLights(lights, { a, layout });

  // buildings (main set), then props (detail set)
  addBuildings(ctx);
  ctx.bufs = detailBufs;
  addNavaids(ctx, lightInfo);
  addMasts(ctx);
  addRoadsAndLots(ctx);
  addFence(ctx);
  addSiteVehicles(ctx);
  const detailGroup = new THREE.Group();
  const treeGroup = addTrees(ctx);
  detailGroup.add(treeGroup);
  const atlas = finalizeSigns(ctx);
  addPools(ctx, detailBufs.get('pool'));

  // parked traffic and its equipment
  addParkedTraffic(group, a, vf);

  // materials that depend on the atlas
  anim.night = buildingMaterials(style, mk, atlas?.texture ?? null);
  if (atlas) disposables.push({ dispose: () => atlas.texture.dispose() });
  addWindsocks(ctx, detailGroup, anim);

  // ---- meshes --------------------------------------------------------------------------------------------------------------------------
  const surfaceGroup = new THREE.Group(); const paintGroup = new THREE.Group(); const mainGroup = new THREE.Group();
  frame.add(surfaceGroup, paintGroup, mainGroup, detailGroup);
  const keep = (list) => { for (const m of list) disposables.push({ dispose: () => m.geometry.dispose() }); };
  const surfMeshes = surf.bufs.build(mats, null);
  for (const m of surfMeshes) {
    const paint = m.name.startsWith('paint') || m.name.startsWith('glyph') || m.name === 'rubber' || m.name === 'streak';
    if (m.name === 'rubber' || m.name === 'streak') m.renderOrder = 2;
    if (m.name.startsWith('paint') || m.name.startsWith('glyph')) m.renderOrder = 3;
    (paint ? paintGroup : surfaceGroup).add(m);
  }
  keep(surfMeshes);
  const mainMeshes = mainBufs.build(mats, mainGroup, { uvTile: UV_TILE });
  keep(mainMeshes);
  const detailMeshes = detailBufs.build(mats, detailGroup, { uvTile: UV_TILE });
  for (const m of detailMeshes) if (m.name === 'pool') { m.renderOrder = 4; m.frustumCulled = false; }
  keep(detailMeshes);
  const vehicles = vf.build();
  detailGroup.add(vehicles);
  vehicles.traverse((o) => { if (o.isInstanceMesh || o.isMesh) o.userData.sharedGeometry = true; });
  treeGroup.traverse((o) => { if (o.isMesh) disposables.push({ dispose: () => { o.geometry.dispose(); o.material.dispose(); } }); });
  vehicles.traverse((o) => { if (o.isInstancedMesh) disposables.push({ dispose: () => o.dispose() }); });
  void poolMat;

  const lightPoints = lights.build();
  if (lightPoints) { frame.add(lightPoints); disposables.push({ dispose: () => lightPoints.geometry.dispose() }); }

  group.userData.anim = anim;
  group.userData.airport = a;
  group.userData.frame = frame;
  group.userData.disposables = disposables;
  group.userData.lightInfo = lightInfo;
  group.userData.lod = { detail: detailGroup, paint: paintGroup, tier: 0 };
  group.userData.pools = poolMat;
  return group;
}

const LOD_DETAIL = 5200; const LOD_PAINT = 13000;

/** Streams airports in and out around the camera, applies distance LOD and animates windsocks and night lighting. */
export class AirportManager {
  constructor(scene, map, env) {
    this.scene = scene;
    this.map = map;
    this.env = env;
    this.built = new Map();
    this.buildRadius = 28000;
    this.dropRadius = 42000;
    this.nightLevel = -1;
  }

  update(camPos, wind) {
    const lm = lightMaterial();
    const night = this.env.night;
    lm.uniforms.uNight.value = night;
    ambientBoost.value = 0.24 * (1 - night);
    lm.uniforms.uTime.value = performance.now() / 1000;
    let builtThisFrame = 0;
    for (const a of this.map.airports) {
      const d = Math.hypot(camPos.x - a.x, camPos.z - a.z);
      const have = this.built.get(a.code);
      if (!have && d < this.buildRadius && builtThisFrame < 1) {
        const g = buildAirport(a, { biome: this.map.cfg.biome });
        this.scene.add(g);
        this.built.set(a.code, g);
        this.#applyNight(g, night);
        builtThisFrame++;
      } else if (have && d > this.dropRadius) {
        this.#drop(have);
        this.built.delete(a.code);
      }
    }
    const speed = wind ? Math.hypot(wind.x, wind.z) : 0;
    const nightChanged = Math.abs(night - this.nightLevel) > 0.004;
    for (const [code, g] of this.built) {
      const a = g.userData.airport;
      const d = Math.hypot(camPos.x - a.x, camPos.z - a.z);
      const lod = g.userData.lod;
      const wantDetail = d < LOD_DETAIL + (lod.detail.visible ? 400 : -400);
      const wantPaint = d < LOD_PAINT + (lod.paint.visible ? 600 : -600);
      if (lod.detail.visible !== wantDetail) lod.detail.visible = wantDetail;
      if (lod.paint.visible !== wantPaint) lod.paint.visible = wantPaint;
      if (nightChanged) this.#applyNight(g, night);
      if (wind && speed > 0.2 && lod.detail.visible) {
        const th = Math.atan2(-wind.z, wind.x) - g.userData.frame.rotation.y;
        const droop = -Math.max(0, 1 - speed / 8) * 1.1;
        for (const w of g.userData.anim.windsocks) { w.pivot.rotation.y = th; w.sock.rotation.z = droop; }
      }
      void code;
    }
    this.nightLevel = night;
  }

  #applyNight(g, night) {
    for (const { mat, k } of g.userData.anim.night) mat.emissiveIntensity = night * k;
    const p = g.userData.pools;
    if (p) p.color.setRGB(1.0, 0.72, 0.4).multiplyScalar(night * 0.55);
  }

  #drop(g) {
    this.scene.remove(g);
    for (const d of g.userData.disposables ?? []) d.dispose?.();
  }

  dispose() {
    for (const g of this.built.values()) this.#drop(g);
    this.built.clear();
    TX.disposeAirportTextures();
    disposeLightMaterial();
    disposeVehicleAssets();
  }
}
