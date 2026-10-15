import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rnd2 } from './fields.js';
import { buildingMeshes } from './buildings.js';
import { buildNavaids, buildStadium, radioMast } from './landmarks.js';
import { lakeFactor } from './lakeShape.js';

// The map-wide static structures, built once per map: power lines with pylons and wires, wind
// farms (instanced, with turning rotors), solar farms, desert pipelines, railway stations, quarry
// machinery, ski lifts, lakeside jetties and houses, churches and mosques, radio masts, the stadium
// and the VOR/NDB beacons. Everything stands on the exact ground height and clear of airports.

const UP = new THREE.Vector3(0, 1, 0);
const mat = {
  steel: new THREE.MeshStandardMaterial({ color: 0x8f969b, roughness: 0.55, metalness: 0.45, side: THREE.DoubleSide }),
  white: new THREE.MeshStandardMaterial({ color: 0xeef0f2, roughness: 0.45, metalness: 0.05 }),
  pipe: new THREE.MeshStandardMaterial({ color: 0xa4a8ac, roughness: 0.4, metalness: 0.6 }),
  wire: new THREE.LineBasicMaterial({ color: 0x6a7075 }),
  cable: new THREE.LineBasicMaterial({ color: 0x1f2124 }),
};
let solarMat = null;
function panelMaterial() {
  if (solarMat) return solarMat;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#16264a'; g.fillRect(0, 0, 128, 64);
  g.strokeStyle = 'rgba(170,190,220,0.55)'; g.lineWidth = 1;
  for (let i = 0; i <= 12; i++) { g.beginPath(); g.moveTo(i * 128 / 12, 0); g.lineTo(i * 128 / 12, 64); g.stroke(); }
  for (let j = 0; j <= 4; j++) { g.beginPath(); g.moveTo(0, j * 16); g.lineTo(128, j * 16); g.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  solarMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.18, metalness: 0.65 });
  return solarMat;
}

function pylonGeometry() {
  const parts = [];
  const mast = new THREE.CylinderGeometry(0.55, 2.3, 38, 4, 1, true).rotateY(Math.PI / 4).translate(0, 19, 0);
  parts.push(mast);
  for (const [w, y] of [[13, 31], [10.4, 25.5], [5.2, 36.5]]) parts.push(new THREE.BoxGeometry(w, 0.45, 0.45).translate(0, y, 0));
  parts.push(new THREE.BoxGeometry(0.5, 4, 0.5).translate(0, 38.5, 0));
  const g = mergeGeometries(parts.map((p) => { const q = p.index ? p.toNonIndexed() : p; q.deleteAttribute('uv'); return q; }));
  g.computeBoundingSphere();
  return g;
}

const ATTACH = [[-6.2, 31], [6.2, 31], [-4.9, 25.5], [4.9, 25.5]];

function buildPower(map, group) {
  const lines = map.infra.power;
  const towers = lines.flatMap((l) => l.towers);
  if (!towers.length) return;
  const mesh = new THREE.InstancedMesh(pylonGeometry(), mat.steel, towers.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  towers.forEach((t, i) => {
    const y = map.hf.height(t.x, t.z);
    q.setFromAxisAngle(UP, -t.yaw);
    m.compose(new THREE.Vector3(t.x, y - 0.5, t.z), q, new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, m);
    t.y = y;
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = true;
  group.add(mesh);
  // Wires: catenaries between consecutive towers of a line.
  const pos = [];
  for (const line of lines) {
    for (let i = 0; i < line.towers.length - 1; i++) {
      const a = line.towers[i]; const b = line.towers[i + 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L > 700 || L < 20) continue;
      const ca = [Math.cos(a.yaw), Math.sin(a.yaw)]; const cb = [Math.cos(b.yaw), Math.sin(b.yaw)];
      for (const [lx, ly] of ATTACH) {
        let px = a.x + ca[0] * lx; let pz = a.z + ca[1] * lx; let py = a.y + ly;
        const ex = b.x + cb[0] * lx; const ez = b.z + cb[1] * lx; const ey = b.y + ly;
        const sag = L * 0.03;
        const N = 7;
        for (let k = 1; k <= N; k++) {
          const t = k / N;
          const nx = a.x + ca[0] * lx + (ex - (a.x + ca[0] * lx)) * t;
          const nz = a.z + ca[1] * lx + (ez - (a.z + ca[1] * lx)) * t;
          const ny = a.y + ly + (ey - (a.y + ly)) * t - sag * 4 * t * (1 - t);
          pos.push(px, py, pz, nx, ny, nz);
          px = nx; py = ny; pz = nz;
        }
      }
    }
  }
  if (pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeBoundingSphere();
    const ls = new THREE.LineSegments(g, mat.wire);
    ls.userData.noShadow = true;
    group.add(ls);
  }
}

function turbineParts() {
  const tower = new THREE.CylinderGeometry(1.5, 2.8, 90, 14).translate(0, 45, 0);
  const nacelle = new THREE.BoxGeometry(12, 4.6, 4.6).translate(-1.5, 0, 0);
  const blades = [];
  for (let i = 0; i < 3; i++) {
    const b = new THREE.BoxGeometry(0.7, 46, 3.4, 1, 6, 1).translate(0, 25, 0);
    const p = b.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const t = Math.min(1, Math.max(0, (p.getY(k) - 2) / 46));
      p.setZ(k, p.getZ(k) * (1 - 0.72 * t) * (0.5 + 0.9 * Math.min(1, t * 6)));
      p.setX(k, p.getX(k) + Math.sin(t * 2.2) * 0.4);
    }
    b.computeVertexNormals();
    b.rotateX((i / 3) * Math.PI * 2);
    blades.push(b.toNonIndexed());
  }
  blades.push(new THREE.SphereGeometry(2.3, 10, 8).scale(1.3, 1, 1).translate(1.5, 0, 0).toNonIndexed());
  const strip = (g) => { const q = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(q.attributes)) if (!['position', 'normal'].includes(k)) q.deleteAttribute(k); return q; };
  return { tower: strip(tower), nacelle: strip(nacelle), rotor: mergeGeometries(blades.map(strip)) };
}

function buildWind(map, group) {
  const list = map.infra.windFarms.flatMap((w) => w.turbines);
  if (!list.length) return null;
  const parts = turbineParts();
  const mk = (geo) => { const m = new THREE.InstancedMesh(geo, mat.white, list.length); m.castShadow = true; m.receiveShadow = true; m.userData.shadowSet = true; m.frustumCulled = false; return m; };
  const tower = mk(parts.tower); const nacelle = mk(parts.nacelle); const rotor = mk(parts.rotor);
  const m = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  const q = new THREE.Quaternion();
  const tq = new THREE.Quaternion();
  const ground = list.map((t) => map.hf.height(t.x, t.z));
  const state = { yaw: map.cfg.prevailingWind * Math.PI / 180, angle: 0 };
  const phase = list.map((t, i) => rnd2(Math.round(t.x), Math.round(t.z), 77 + i) * 6.28);
  list.forEach((t, i) => { m.compose(new THREE.Vector3(t.x, ground[i] - 0.5, t.z), q.identity(), one); tower.setMatrixAt(i, m); });
  tower.instanceMatrix.needsUpdate = true;
  group.add(tower, nacelle, rotor);
  const axis = new THREE.Vector3(1, 0, 0);
  const place = (cam, dt, wind) => {
    const sp = Math.hypot(wind.x, wind.z);
    if (sp > 0.5) {
      const target = Math.atan2(wind.z, -wind.x); // rotor axis points into the wind
      let d = target - state.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      state.yaw += d * Math.min(1, dt * 0.4);
    }
    state.angle += dt * (0.5 + Math.min(sp, 16) * 0.2);
    q.setFromAxisAngle(UP, state.yaw);
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if ((t.x - cam.x) ** 2 + (t.z - cam.z) ** 2 > 40000 * 40000) continue;
      const hub = new THREE.Vector3(t.x, ground[i] + 88.5, t.z);
      m.compose(hub, q, one);
      nacelle.setMatrixAt(i, m);
      tq.setFromAxisAngle(axis, state.angle * (1 + 0.03 * Math.sin(phase[i])) + phase[i]);
      tq.premultiply(q);
      m.compose(hub, tq, one);
      rotor.setMatrixAt(i, m);
    }
    nacelle.instanceMatrix.needsUpdate = true;
    rotor.instanceMatrix.needsUpdate = true;
  };
  place({ x: 0, z: 0 }, 0.01, { x: 0, z: 0 });
  return { place };
}

function buildSolar(map, group) {
  for (const f of map.infra.solarFarms) {
    const rows = Math.floor(f.d / f.rowSpacing);
    const per = Math.floor(f.w / 27);
    const geo = new THREE.BoxGeometry(24, 0.14, 4.6);
    const mesh = new THREE.InstancedMesh(geo, panelMaterial(), rows * per);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.52);
    const mid = map.hf.height(f.x, f.z);
    let n = 0;
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < per; i++) {
        const x = f.x - f.w / 2 + 13 + i * 27;
        const z = f.z - f.d / 2 + r * f.rowSpacing;
        const y = map.hf.height(x, z);
        if (Math.abs(y - mid) > 14) continue;
        m.compose(new THREE.Vector3(x, y + 1.7, z), q, new THREE.Vector3(1, 1, 1));
        mesh.setMatrixAt(n++, m);
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.shadowSet = true;
    group.add(mesh);
    // Inverter huts and a fence line.
    const items = [];
    for (let k = 0; k < 4; k++) items.push({ t: 'box', x: f.x - f.w / 2 - 9, z: f.z - 40 + k * 22, w: 6, d: 9, h: 3, yaw: 0, wall: '#c8cacb', roof: '#9a9d9f', kind: 3 });
    for (const mm of buildingMeshes(items, (x, z) => map.hf.height(x, z))) group.add(mm);
  }
}

function buildPipelines(map, group) {
  for (const p of map.infra.pipelines) {
    const pts = [];
    for (let i = 0; i < p.points.length - 1; i++) {
      const a = p.points[i]; const b = p.points[i + 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(1, Math.round(L / 28));
      for (let k = 0; k < n; k++) { const t = k / n; pts.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }); }
    }
    pts.push(p.points[p.points.length - 1]);
    const ys = pts.map((q) => map.hf.height(q.x, q.z) + 2.4);
    // smooth the pipe height so it does not follow every bump
    for (let it = 0; it < 3; it++) for (let i = 1; i < ys.length - 1; i++) ys[i] = Math.max(ys[i], (ys[i - 1] + ys[i] * 2 + ys[i + 1]) / 4);
    const sides = 8; const r = 0.6;
    const pos = []; const idx = [];
    pts.forEach((q, i) => {
      const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x; const dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l; const nz = dx / l;
      for (let s = 0; s < sides; s++) {
        const th = (s / sides) * Math.PI * 2;
        pos.push(q.x + nx * Math.cos(th) * r, ys[i] + Math.sin(th) * r, q.z + nz * Math.cos(th) * r);
      }
      if (i) for (let s = 0; s < sides; s++) {
        const a0 = (i - 1) * sides + s; const a1 = (i - 1) * sides + (s + 1) % sides;
        const b0 = i * sides + s; const b1 = i * sides + (s + 1) % sides;
        idx.push(a0, b0, a1, a1, b0, b1);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat.pipe);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.shadowSet = true;
    group.add(mesh);
    // supports
    const sup = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 1, 1.4), mat.steel, pts.length);
    const m = new THREE.Matrix4();
    pts.forEach((q, i) => {
      const gy = map.hf.height(q.x, q.z);
      m.compose(new THREE.Vector3(q.x, (gy + ys[i]) / 2 - 0.3, q.z), new THREE.Quaternion(), new THREE.Vector3(1, Math.max(0.2, ys[i] - gy - 0.4), 1));
      sup.setMatrixAt(i, m);
    });
    sup.instanceMatrix.needsUpdate = true;
    sup.computeBoundingSphere();
    group.add(sup);
  }
}

function pointOnLake(l, th, k = 1) {
  const r = l.radius * lakeFactor(l, th) * k;
  return { x: l.x + Math.cos(th) * r, z: l.z + Math.sin(th) * r };
}

/** Item lists for everything built with the instanced building geometries. */
function structureItems(map) {
  const items = [];
  const biome = map.cfg.biome;
  const H = (x, z) => map.hf.height(x, z);
  const wood = ['#8a6a4a', '#9a7a58', '#a88c68'];
  // Stations.
  for (const s of map.infra.stations) {
    const yaw = s.heading;
    const dx = Math.sin(yaw); const dz = -Math.cos(yaw);
    const sx = -dz; const sz = dx;
    const px = s.x + dx * -30 + sx * 6; const pz = s.z + dz * -30 + sz * 6;
    items.push({ t: 'box', x: px, z: pz, w: 4.2, d: 70, h: 1.0, yaw: -yaw + Math.PI, wall: '#a9a69e', roof: '#a9a69e', kind: 5 });
    const bx = s.x + dx * -22 + sx * 15; const bz = s.z + dz * -22 + sz * 15;
    items.push({ t: 'gable', x: bx, z: bz, w: 11, d: 26, h: 5.5, yaw: -yaw + Math.PI / 2, wall: '#cdbf9f', roof: '#7a3a2e', kind: 0 });
    items.push({ t: 'box', x: s.x + dx * -45 + sx * 9, z: s.z + dz * -45 + sz * 9, w: 3, d: 30, h: 3.4, yaw: -yaw + Math.PI, wall: '#6f757a', roof: '#6f757a', kind: 5 });
  }
  // Churches, mosques and chapels at the heart of towns and villages.
  for (const c of map.cities) {
    if (!c.civic) continue;
    const { x, z } = c.civic;
    const yaw = (rnd2(Math.round(x), Math.round(z), 3) < 0.5 ? 0 : Math.PI / 2);
    const gy = H(x, z);
    if (biome === 'desert') {
      items.push({ t: 'box', x, z, w: 24, d: 24, h: 9, yaw: 0, wall: '#eadfc3', roof: '#d9cfb1', kind: 6, y: gy });
      items.push({ t: 'dome', x, z, w: 17, d: 17, h: 9, yaw: 0, wall: '#d8e0d4', roof: '#6fa8a0', kind: 7, y: gy, yo: 9 });
      for (const [ox, oz] of [[-14, -14], [14, 14]]) {
        items.push({ t: 'cyl', x: x + ox, z: z + oz, w: 2.8, d: 2.8, h: 26, yaw: 0, wall: '#eee6d0', roof: '#eee6d0', kind: 6, y: gy });
        items.push({ t: 'spire', x: x + ox, z: z + oz, w: 3.8, d: 3.8, h: 5, yaw: 0, wall: '#6fa8a0', roof: '#6fa8a0', kind: 7, y: gy, yo: 26 });
      }
    } else {
      const stone = biome === 'snow' ? '#9a7a58' : '#c9c1b0';
      const slate = biome === 'snow' ? '#3a3330' : '#5a4a44';
      const ca = Math.cos(yaw); const sa = Math.sin(yaw);
      items.push({ t: 'gable', x, z, w: 9, d: 24, h: 8, yaw: yaw + Math.PI / 2, wall: stone, roof: slate, kind: 6, y: gy });
      const tx = x + (yaw === 0 ? -14 : 0); const tz = z + (yaw === 0 ? 0 : -14);
      void ca; void sa;
      items.push({ t: 'box', x: tx, z: tz, w: 6, d: 6, h: biome === 'snow' ? 14 : 20, yaw: 0, wall: stone, roof: slate, kind: 6, y: gy });
      items.push({ t: 'spire', x: tx, z: tz, w: 6.4, d: 6.4, h: biome === 'snow' ? 10 : 15, yaw: 0, wall: slate, roof: slate, kind: 7, y: gy, yo: biome === 'snow' ? 14 : 20 });
    }
  }
  // Quarry machinery on the pit floor.
  for (const q of map.infra.quarries) {
    const floor = H(q.x, q.z);
    for (let i = 0; i < 5; i++) {
      const a = rnd2(Math.round(q.x), i, 5) * 6.28; const r = q.r * (0.1 + 0.2 * rnd2(i, Math.round(q.z), 6));
      const x = q.x + Math.cos(a) * r; const z = q.z + Math.sin(a) * r;
      if (i < 2) items.push({ t: 'box', x, z, w: 5, d: 9, h: 4, yaw: a, wall: '#e2b422', roof: '#444', kind: 3, y: H(x, z) });
      else items.push({ t: 'dome', x, z, w: 24 + 8 * i % 3, d: 24, h: 9, yaw: 0, wall: '#a79d90', roof: '#a79d90', kind: 5, y: H(x, z) });
    }
    items.push({ t: 'box', x: q.x + q.r * 0.7, z: q.z - q.r * 0.2, w: 10, d: 24, h: 9, yaw: 0, wall: '#9aa0a4', roof: '#7d8387', kind: 3, y: H(q.x + q.r * 0.7, q.z - q.r * 0.2) });
    void floor;
  }
  // Ski stations and lodges.
  for (const lift of map.infra.skiLifts) {
    const [a, b] = lift.points;
    const yaw = Math.atan2(b.x - a.x, -(b.z - a.z));
    items.push({ t: 'gable', x: a.x, z: a.z, w: 20, d: 12, h: 7, yaw: yaw, wall: wood[0], roof: '#3a2f2a', kind: 0, y: H(a.x, a.z) });
    items.push({ t: 'box', x: b.x, z: b.z, w: 8, d: 8, h: 5, yaw, wall: '#7a5a3c', roof: '#3a2f2a', kind: 0, y: H(b.x, b.z) });
    for (let k = 0; k < 4; k++) {
      const ox = a.x + Math.cos(yaw) * (28 + k * 20) + Math.sin(yaw) * 20;
      const oz = a.z + Math.sin(yaw) * (28 + k * 20) - Math.cos(yaw) * 20;
      items.push({ t: 'gable', x: ox, z: oz, w: 11, d: 9, h: 6, yaw: k * 1.57, wall: wood[k % 3], roof: '#41362f', kind: 0, y: H(ox, oz) });
    }
  }
  // Lake harbours: jetty, boathouse, boats and a few lakeside houses.
  for (const hbr of map.infra.harbours) {
    const l = map.lakes[hbr.lake];
    const th = hbr.theta;
    const shore = pointOnLake(l, th, 1.0);
    const inward = { x: -Math.cos(th), z: -Math.sin(th) };
    const yaw = Math.atan2(-inward.x, inward.z) + Math.PI; // jetty runs along `inward`
    const len = 54 + 30 * rnd2(Math.round(l.x), hbr.lake, 9);
    const jc = { x: shore.x + inward.x * (len / 2 - 6), z: shore.z + inward.z * (len / 2 - 6) };
    const rot = Math.atan2(inward.x, -inward.z);
    items.push({ t: 'box', x: jc.x, z: jc.z, w: 2.8, d: len, h: 0.55, yaw: -rot + Math.PI, wall: '#7b6448', roof: '#7b6448', kind: 4, y: l.level + 0.15 });
    for (let k = 0; k < 4; k++) {
      const side = k % 2 ? 1 : -1;
      const along = -len * 0.12 - Math.floor(k / 2) * 14;
      const bx = jc.x + inward.x * (len * 0.2 + along) + (-inward.z) * side * 4.2;
      const bz = jc.z + inward.z * (len * 0.2 + along) + inward.x * side * 4.2;
      items.push({ t: 'box', x: bx, z: bz, w: 2.2, d: 6.4, h: 0.8, yaw: -rot + Math.PI + (k * 0.07), wall: k % 3 === 0 ? '#e8e8e4' : k % 3 === 1 ? '#2c5f8a' : '#b83c32', roof: '#d8d8d4', kind: 7, y: l.level - 0.1 });
    }
    const out = pointOnLake(l, th, 1.04);
    const bh = { x: out.x - inward.x * 18, z: out.z - inward.z * 18 };
    items.push({ t: 'gable', x: bh.x, z: bh.z, w: 8, d: 12, h: 4, yaw: -rot + Math.PI, wall: '#8a3a2c', roof: '#4a4a4c', kind: 4, y: H(bh.x, bh.z) });
    for (let k = 0; k < 6; k++) {
      const s = (rnd2(hbr.lake, k, 14) - 0.5) * 0.7;
      const p = pointOnLake(l, th + s + (k % 2 ? 0.05 : -0.05), 1.0 + 0.05 + 0.04 * (k % 3));
      const hx = p.x - Math.cos(th + s) * 18; const hz = p.z - Math.sin(th + s) * 18;
      if (Math.abs(H(hx, hz) - l.level) > 14) continue;
      const pal = biome === 'snow' ? wood : ['#e6dfd0', '#d9cdb6', '#c9b79b'];
      items.push({ t: 'gable', x: hx, z: hz, w: 9, d: 7.5, h: 3.2, yaw: th + s + Math.PI / 2, wall: pal[k % 3], roof: biome === 'snow' ? '#3a3330' : '#8c4a38', kind: 0, y: H(hx, hz) });
    }
  }
  return items;
}

function buildSkyLifts(map, group) {
  const pos = [];
  const pylons = [];
  for (const lift of map.infra.skiLifts) {
    const [a, b] = lift.points;
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(2, Math.round(L / 110));
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t; const z = a.z + (b.z - a.z) * t;
      const y = map.hf.height(x, z);
      pylons.push({ x, y, z, yaw: Math.atan2(b.x - a.x, -(b.z - a.z)) });
      const top = { x, y: y + 11.5, z };
      if (prev) for (const off of [-1.6, 1.6]) {
        const nx = -(b.z - a.z) / L * off; const nz = (b.x - a.x) / L * off;
        pos.push(prev.x + nx, prev.y, prev.z + nz, x + nx, top.y - 0.4 * Math.sin(t * 3.14) * 0, z + nz);
      }
      prev = top;
    }
  }
  if (!pylons.length) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeBoundingSphere();
  group.add(new THREE.LineSegments(g, mat.cable));
  const geo = mergeGeometries([new THREE.CylinderGeometry(0.28, 0.4, 12, 6).translate(0, 6, 0).toNonIndexed(), new THREE.BoxGeometry(4, 0.35, 0.35).translate(0, 11.5, 0).toNonIndexed()].map((q) => { q.deleteAttribute('uv'); return q; }));
  const inst = new THREE.InstancedMesh(geo, mat.steel, pylons.length);
  const m = new THREE.Matrix4(); const q = new THREE.Quaternion();
  pylons.forEach((p, i) => { q.setFromAxisAngle(UP, -p.yaw); m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(1, 1, 1)); inst.setMatrixAt(i, m); });
  inst.instanceMatrix.needsUpdate = true;
  inst.computeBoundingSphere();
  inst.castShadow = true;
  group.add(inst);
}

export function buildInfrastructure(map) {
  const group = new THREE.Group();
  const masts = [];
  buildPower(map, group);
  const wind = buildWind(map, group);
  buildSolar(map, group);
  buildPipelines(map, group);
  buildSkyLifts(map, group);
  for (const mm of buildingMeshes(structureItems(map), (x, z) => map.hf.height(x, z))) { mm.castShadow = true; mm.receiveShadow = true; mm.userData.shadowSet = true; group.add(mm); }
  for (const mast of map.infra.masts) {
    const o = radioMast(mast.h);
    o.position.set(mast.x, map.hf.height(mast.x, mast.z), mast.z);
    o.traverse((x) => { if (x.isMesh) { x.castShadow = true; x.userData.shadowSet = true; } });
    group.add(o);
    masts.push(o);
  }
  if (map.infra.stadium) {
    const s = buildStadium();
    s.position.set(map.infra.stadium.x, map.hf.height(map.infra.stadium.x, map.infra.stadium.z) - 0.3, map.infra.stadium.z);
    s.rotation.y = map.infra.stadium.yaw;
    group.add(s);
  }
  const nav = buildNavaids(map);
  group.add(nav.group);
  masts.push(...nav.masts);
  return { group, masts, wind, dispose() { group.traverse((o) => { o.geometry?.dispose?.(); }); } };
}
