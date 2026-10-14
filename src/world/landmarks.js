import * as THREE from 'three';
import { Rng } from '../util/random.js';

// Landmarks and navigation aids placed around the settlements of a map. Everything is built from
// a handful of shared primitives; counts stay small so they cost almost nothing.

const white = new THREE.MeshStandardMaterial({ color: 0xe9ebee, roughness: 0.7 });
const grey = new THREE.MeshStandardMaterial({ color: 0x8e949b, roughness: 0.6, metalness: 0.4 });
const red = new THREE.MeshStandardMaterial({ color: 0xc9332b, roughness: 0.7 });
const concrete = new THREE.MeshStandardMaterial({ color: 0xb7b4ad, roughness: 0.9 });
const panel = new THREE.MeshStandardMaterial({ color: 0x1b2d52, roughness: 0.25, metalness: 0.6 });
const sand = new THREE.MeshStandardMaterial({ color: 0xd9b57a, roughness: 0.9 });
const redLight = new THREE.MeshBasicMaterial({ color: 0xff3030, toneMapped: false });

function put(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

function radioMast(h = 150) {
  const g = new THREE.Group();
  const seg = 6;
  for (let i = 0; i < seg; i++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.7 - i * 0.06, 0.8 - i * 0.06, h / seg, 6), i % 2 ? white : red);
    s.position.y = (i + 0.5) * (h / seg);
    g.add(s);
  }
  const light = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 6), redLight);
  light.position.y = h + 1;
  g.add(light);
  g.userData.blink = light;
  return g;
}

function windTurbine() {
  const g = new THREE.Group();
  g.add(put(new THREE.CylinderGeometry(1.1, 2.2, 78, 10), white, 0, 39, 0));
  const nacelle = new THREE.Mesh(new THREE.BoxGeometry(9, 4.4, 4.4), white);
  nacelle.position.set(-1, 79, 0);
  g.add(nacelle);
  const rotor = new THREE.Group();
  rotor.position.set(3.4, 79, 0);
  for (let i = 0; i < 3; i++) {
    const arm = new THREE.Group();
    arm.rotation.x = (i / 3) * Math.PI * 2;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 38, 2.4), white);
    blade.position.y = 19;
    blade.rotation.y = 0.15;
    arm.add(blade);
    rotor.add(arm);
  }
  g.add(rotor);
  g.userData.rotor = rotor;
  g.userData.nacelle = nacelle;
  return g;
}

export function buildLandmarks(map) {
  const rng = new Rng(map.cfg.seed + 909);
  const group = new THREE.Group();
  const turbines = [];
  const masts = [];
  const at = (g, x, z, dy = 0) => { g.position.set(x, map.hf.height(x, z) + dy, z); group.add(g); return g; };
  const flatSpot = (cx, cz, minR, maxR) => {
    for (let i = 0; i < 40; i++) {
      const a = rng.range(0, 6.28);
      const r = rng.range(minR, maxR);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (map.lakes.some((l) => Math.hypot(x - l.x, z - l.z) < l.radius * 1.8)) continue;
      if (map.airports.some((ap) => Math.hypot(x - ap.x, z - ap.z) < ap.flatRadius * 2.6)) continue;
      if (map.rivers && map.rivers.nearest(x, z).dist < 600) continue;
      return { x, z };
    }
    return null;
  };

  const major = map.cities.find((c) => c.kind === 'major');
  const towns = map.cities.filter((c) => c.kind === 'town');

  // Radio masts beside major settlements.
  for (const c of [major, ...towns].filter(Boolean)) {
    const p = flatSpot(c.x, c.z, c.radius * 0.5, c.radius * 1.3);
    if (p) { const m = at(radioMast(c.kind === 'major' ? 190 : 120), p.x, p.z); masts.push(m); }
  }

  if (map.cfg.biome === 'grass') {
    // Wind farms near three towns; a stadium and a bridge-like landmark in the city.
    for (const t of towns.slice(0, 3)) {
      const base = flatSpot(t.x, t.z, 3500, 6500);
      if (!base) continue;
      for (let i = 0; i < 12; i++) {
        const p = { x: base.x + (i % 4) * 520 + rng.range(-60, 60), z: base.z + Math.floor(i / 4) * 560 + rng.range(-60, 60) };
        if (map.lakes.some((l) => Math.hypot(p.x - l.x, p.z - l.z) < l.radius * 1.8)) continue;
        const w = at(windTurbine(), p.x, p.z);
        w.rotation.y = rng.range(-0.1, 0.1);
        turbines.push(w);
      }
    }
    if (major) {
      const stadium = new THREE.Group();
      stadium.add(new THREE.Mesh(new THREE.CylinderGeometry(70, 58, 26, 36, 1, true), concrete));
      stadium.add(put(new THREE.CircleGeometry(52, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3f7a36, roughness: 1 }), 0, 2, 0));
      for (const a of [0.8, 2.4, 4.0, 5.5]) {
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 55, 6), grey);
        mast.position.set(Math.cos(a) * 66, 27, Math.sin(a) * 66);
        stadium.add(mast);
      }
      const p = flatSpot(major.x, major.z, major.radius * 0.15, major.radius * 0.5);
      if (p) at(stadium, p.x, p.z, 13);
    }
  } else if (map.cfg.biome === 'desert') {
    if (major) {
      const p = flatSpot(major.x, major.z, major.radius * 0.2, major.radius * 0.7);
      if (p) {
        // A pyramid-style hotel.
        const pyr = new THREE.Mesh(new THREE.ConeGeometry(85, 120, 4), sand);
        pyr.rotation.y = Math.PI / 4;
        at(pyr, p.x, p.z, 60);
      }
      // A solar farm: a block of tilted panels.
      const s = flatSpot(major.x, major.z, major.radius * 1.3, major.radius * 2.2);
      if (s) {
        const panelGeo = new THREE.BoxGeometry(14, 0.5, 8);
        panelGeo.computeBoundingSphere();
        const inst = new THREE.InstancedMesh(panelGeo, panel, 520);
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, 0, 0));
        for (let i = 0; i < 520; i++) {
          const x = s.x + (i % 26) * 22;
          const z = s.z + Math.floor(i / 26) * 20;
          m.compose(new THREE.Vector3(x, map.hf.height(x, z) + 1.6, z), q, new THREE.Vector3(1, 1, 1));
          inst.setMatrixAt(i, m);
        }
        inst.computeBoundingSphere();
        group.add(inst);
      }
    }
  } else if (towns.length) {
    // Ski lifts: a line of pylons climbing the slope above each ski town.
    for (const t of towns.slice(0, 3)) {
      let best = null;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const x = t.x + Math.cos(a) * 2600;
        const z = t.z + Math.sin(a) * 2600;
        const h = map.hf.height(x, z);
        if (!best || h > best.h) best = { x, z, h, a };
      }
      for (let k = 0; k < 14; k++) {
        const x = t.x + Math.cos(best.a) * (t.radius * 0.9 + k * 150);
        const z = t.z + Math.sin(best.a) * (t.radius * 0.9 + k * 150);
        at(put(new THREE.CylinderGeometry(0.4, 0.5, 14, 6), grey), x, z, 7);
      }
    }
  }
  return { group, turbines, masts };
}

/** VOR and NDB beacons. */
export function buildNavaids(map) {
  const group = new THREE.Group();
  const masts = [];
  for (const n of map.navaids) {
    const g = new THREE.Group();
    const y = map.hf.height(n.x, n.z);
    if (n.type === 'VOR') {
      g.add(put(new THREE.CylinderGeometry(7, 7, 2.5, 20), white, 0, 1.25, 0));
      g.add(put(new THREE.CylinderGeometry(1.6, 6.2, 5, 20), white, 0, 5, 0));
      g.add(put(new THREE.SphereGeometry(1.7, 12, 8), grey, 0, 8.2, 0));
    } else {
      const m = radioMast(30);
      g.add(m);
      masts.push(m);
    }
    g.position.set(n.x, y, n.z);
    group.add(g);
  }
  return { group, masts };
}
