import * as THREE from 'three';
import { lift } from './materials.js';
import { MeshBuf } from './mesh.js';
import * as P from './paint.js';
import { Y } from './surfaces.js';
import { makeSignAtlas } from './signs.js';
import { CAR_COLORS } from './vehicles.js';

// Everything that is not a building, a marking or a light: signs, floodlight masts, fences and service roads,
// parking lots with cars, trees, windsocks, ILS antennas, PAPI housings, strip markers, site vehicles.
// Frame coordinates throughout (x = u, z = v).

const PI = Math.PI;

/** True when (u, v) lies on pavement or a building footprint (with margin m). */
function blocked(ctx, u, v, m) {
  const w = ctx.layout.frame.toWorld(u, v);
  for (const r of ctx.layout.rects) {
    const dx = w.x - r.cx; const dz = w.z - r.cz;
    const al = dx * r.ux + dz * r.uz; const pe = -dx * r.uz + dz * r.ux;
    if (Math.abs(al) < r.hl + m && Math.abs(pe) < r.hw + m) return true;
  }
  for (const s of ctx.layout.sites) {
    if (s.type === 'trees' || s.type === 'windsock' || s.type === 'lot') {
      if (s.type === 'lot' && Math.abs(u - s.u) < s.w / 2 + m && Math.abs(v - s.v) < s.d / 2 + m) return true;
      continue;
    }
    const hw = (s.w ?? (s.concourse ? 350 : s.hall ? 100 : 30)) / 2 + m; const hd = (s.d ?? 30) / 2 + m;
    if (s.type === 'terminal' && s.variant === 'hub') {
      if (Math.abs(v) < 62 && u > -330 && u < 180) return true;
      continue;
    }
    if (Math.abs(u - s.u) < hw && Math.abs(v - s.v) < hd) return true;
  }
  return false;
}

// ---- signs -------------------------------------------------------------------------------------------------------------

export function finalizeSigns(ctx) {
  const { layout, a } = ctx;
  const specs = []; const placed = [];
  const full = ctx.cls === 'hub' || ctx.cls === 'regional';
  const addSpec = (id, kind, text, extra = {}) => { if (!specs.some((s) => s.id === id)) specs.push({ id, kind, text, ...extra }); return id; };
  const board = (id, u, v, f, h, y, opts = {}) => placed.push({ id, u, v, f, h, y, ...opts });

  const small = ctx.cls === 'small';
  const sh = ctx.cls === 'hub' ? 0.95 : small ? 0.62 : 0.8;
  for (const h of layout.holds) {
    if (ctx.cls === 'strip') continue;
    const n = { u: h.nu, v: h.nv }; const m = { u: -n.v, v: n.u };
    const f = { u: -n.u, v: -n.v }; // faces the approaching aircraft
    const label = h.rwName.replace('/', '-');
    const id = addSpec(`M:${label}`, 'mand', label);
    const lid = addSpec(`L:${h.taxi}`, 'loc', h.taxi);
    const off = h.half + 3.4;
    for (const sd of [-1, 1]) board(id, h.u + m.u * sd * off - n.u * 1.0, h.v + m.v * sd * off - n.v * 1.0, f, sh, 0.35);
    board(lid, h.u + m.u * (off + 2.2) - n.u * 1.0, h.v + m.v * (off + 2.2) - n.v * 1.0, f, sh * 0.9, 0.35);
    // direction + location signs along the taxiway before the junction (airports with a parallel taxiway)
    if (full && layout.taxiways.some((t) => t.kind === 'taxiway')) {
      const trunk = layout.taxiways.find((t) => t.kind === 'taxiway' && t.runway === h.rwName);
      if (!trunk) continue;
      const vt = trunk.pts[1].v;
      const sgn = h.sgn; // +1 at the end whose connector is at the low-u end
      const travel = { u: sgn === 1 ? -1 : 1, v: 0 };
      const fv = { u: -travel.u, v: 0 };
      const rv = { u: fv.v, v: -fv.u }; // viewer's right
      const arrow = (n.u * rv.u + n.v * rv.v) > 0 ? 'right' : 'left';
      const dtxt = h.taxi;
      const did = addSpec(`D:${dtxt}:${arrow}`, 'dir', dtxt, { arrow });
      const posU = h.u + (sgn === 1 ? 48 : -48);
      const posV = vt + Math.sign(h.runwayV - vt) * (trunk.half + 3.6);
      board(did, posU, posV, fv, sh, 0.35);
      const lid2 = addSpec(`L:${trunk.name}`, 'loc', trunk.name);
      board(lid2, posU + fv.u * 0 + (sgn === 1 ? 2.6 : -2.6) * 1, posV, fv, sh * 0.9, 0.35);
    }
  }
  // banners
  const banners = ctx.banners.map((b, i) => {
    const text = b.vertical ? 'AIRPORT HOTEL' : a.name.toUpperCase();
    const aspect = b.w / b.h;
    const id = addSpec(`B:${i}`, 'banner', text, { aspect, bg: b.vertical ? '#233b54' : undefined });
    return { id, b };
  });
  if (!specs.length) return null;
  const atlas = makeSignAtlas(specs, { accent: '#' + new THREE.Color(ctx.style.accent).getHexString() });
  const buf = ctx.bufs.get('signs'); const back = ctx.bufs.get('dark'); const steel = ctx.bufs.get('steel');
  const quad = (id, cu, cv, y, f, w, hh, offset) => {
    const r = atlas.rects.get(id);
    const R = { u: f.v, v: -f.u }; // viewer's right
    const c = { u: cu + f.u * offset, v: cv + f.v * offset };
    const BL = [c.u - R.u * w / 2, y, c.v - R.v * w / 2]; const BR = [c.u + R.u * w / 2, y, c.v + R.v * w / 2];
    const TR = [BR[0], y + hh, BR[2]]; const TL = [BL[0], y + hh, BL[2]];
    buf.quad(BL, BR, TR, TL, [r.u0, r.v0, r.u1, r.v0, r.u1, r.v1, r.u0, r.v1], new Array(12).fill(1), [f.u, 0, f.v]);
  };
  for (const p of placed) {
    const r = atlas.rects.get(p.id);
    const w = p.h * r.aspect;
    quad(p.id, p.u, p.v, p.y, p.f, w, p.h, 0.07);
    const R = { u: p.f.v, v: -p.f.u };
    const ryS = -Math.atan2(R.v, R.u);
    back.box(p.u, p.y, p.v, w + 0.05, p.h + 0.05, 0.09, { ry: ryS, tint: [0.02, 0.02, 0.02], ao: 0 });
    for (const sd of [-1, 1]) steel.box(p.u + R.u * sd * w * 0.4, 0, p.v + R.v * sd * w * 0.4, 0.07, p.y, 0.07, { ao: 0 });
  }
  for (const { id, b } of banners) {
    const f = { u: b.facing[0], v: b.facing[1] };
    quad(id, b.u, b.v, b.y, f, b.w, b.h, 0.12);
    ctx.bufs.get('dark').box(b.u, b.y - 0.1, b.v, 0.2, b.h + 0.2, 0.2, { tint: [0.03, 0.03, 0.03], ao: 0, sides: false });
  }
  return atlas;
}

// ---- floodlights ---------------------------------------------------------------------------------------------------------------

export function addMasts(ctx) {
  const { layout, lights, bufs } = ctx;
  const steel = bufs.get('steel'); const dk = bufs.get('dark');
  const pools = ctx.pools;
  const masts = [];
  const s = layout.side;
  if (ctx.cls === 'hub') for (const u of [-200, -100, 0, 100, 200]) for (const sd of [-1, 1]) masts.push({ u, v: sd * 101, h: 28, toward: { u: 0, v: -sd }, n: 6 });
  else if (ctx.cls === 'regional') for (const du of [-110, 0, 110]) masts.push({ u: layout.uc + du, v: s * 122, h: 22, toward: { u: 0, v: s }, n: 4 });
  else if (ctx.cls === 'small') for (const u of [-55, 55]) masts.push({ u, v: s * 80, h: 9, toward: { u: 0, v: s }, n: 1 });
  for (const m of masts) {
    steel.cyl(m.u, 0, m.v, 0.2, m.h > 12 ? 0.42 : 0.2, m.h, 8, { ao: 0.1 });
    if (m.h > 12) {
      steel.box(m.u, m.h, m.v, 2.8, 0.2, 2.8, { ao: 0 });
      for (let i = 0; i < m.n; i++) {
        const ang = (i / m.n) * PI * 2;
        const hx = m.u + Math.cos(ang) * 1.5; const hz = m.v + Math.sin(ang) * 1.5;
        dk.boxT(hx, m.h + 0.5, hz, 1.1, 0.5, 0.8, { ry: -ang, pitch: -0.3, tint: [0.05, 0.05, 0.06] });
        lights.add(hx, m.h + 0.45, hz, { color: 'sodium', size: 1.0, int: 1.5, day: 0.05 });
      }
      lights.add(m.u, m.h + 0.8, m.v, { color: 'red', size: 0.4, int: 1.2, day: 0.4 });
      pools.push({ u: m.u + m.toward.u * 14, v: m.v + m.toward.v * 14, r: m.h * 2.6 });
    } else {
      dk.box(m.u + m.toward.u * 0.6, m.h, m.v + m.toward.v * 0.6, 0.9, 0.18, 0.4, { tint: [0.06, 0.06, 0.07], ao: 0 });
      lights.add(m.u + m.toward.u * 0.8, m.h - 0.1, m.v + m.toward.v * 0.8, { color: 'sodium', size: 0.7, int: 1.4, day: 0.05 });
      pools.push({ u: m.u + m.toward.u * 6, v: m.v + m.toward.v * 6, r: 22 });
    }
  }
}

// ---- fence and perimeter road ----------------------------------------------------------------------------------------------------

export function addFence(ctx) {
  const { layout, cls } = ctx;
  if (cls === 'strip') return null;
  const s = layout.side;
  let box;
  if (cls === 'hub') box = { u0: -2150, u1: 2150, v0: -560, v1: 560 };
  else if (cls === 'regional') box = { u0: -1500, u1: 1500, v0: -650, v1: 650 };
  else box = { u0: -720, u1: 720, v0: s > 0 ? -90 : -230, v1: s > 0 ? 230 : 90 };
  const loop = [{ x: box.u0, z: box.v0 }, { x: box.u1, z: box.v0 }, { x: box.u1, z: box.v1 }, { x: box.u0, z: box.v1 }, { x: box.u0, z: box.v0 }];
  // gate position on the landside edge: leave a gap in the fence there
  const steel = ctx.bufs.get('steel');
  const fenceBuf = ctx.bufs.get('fence');
  const H = 2.4;
  const gate = ctx.gate ?? null;
  let total = 0;
  for (let i = 1; i < loop.length; i++) {
    const p = loop[i - 1]; const q = loop[i];
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    const dx = (q.x - p.x) / len; const dz = (q.z - p.z) / len;
    // fence panels
    const segs = [[0, len]];
    if (gate && Math.abs((gate.x - p.x) * dz - (gate.z - p.z) * dx) < 2) {
      const t = (gate.x - p.x) * dx + (gate.z - p.z) * dz;
      if (t > 0 && t < len) { segs[0] = [0, t - 7]; segs.push([t + 7, len]); }
    }
    for (const [s0, s1] of segs) {
      if (s1 - s0 < 1) continue;
      const A = [p.x + dx * s0, 0, p.z + dz * s0]; const B = [p.x + dx * s1, 0, p.z + dz * s1];
      const nrm = [dz, 0, -dx];
      fenceBuf.quad(A, B, [B[0], H, B[2]], [A[0], H, A[2]], [0, 0, (s1 - s0) / 4, 0, (s1 - s0) / 4, 1, 0, 1], new Array(12).fill(1), nrm);
      fenceBuf.quad(B, A, [A[0], H, A[2]], [B[0], H, B[2]], [0, 0, (s1 - s0) / 4, 0, (s1 - s0) / 4, 1, 0, 1], new Array(12).fill(1), [-nrm[0], 0, -nrm[2]]);
      for (let t = s0; t <= s1 + 0.1; t += 12) steel.box(p.x + dx * t, 0, p.z + dz * t, 0.12, H + 0.5, 0.12, { ao: 0 });
    }
    total += len;
  }
  // perimeter road inside the fence
  const inset = 14;
  const road = [
    { x: box.u0 + inset, z: box.v0 + inset }, { x: box.u1 - inset, z: box.v0 + inset }, { x: box.u1 - inset, z: box.v1 - inset },
    { x: box.u0 + inset, z: box.v1 - inset }, { x: box.u0 + inset, z: box.v0 + inset },
  ];
  const rp = P.roundPath(road, 25, 6);
  ctx.surf.get('asphalt').ribbon(rp, 2.6, 0.055, { color: 0.9 });
  return { box, total };
}

// ---- roads, lots and cars --------------------------------------------------------------------------------------------------------

export function addRoadsAndLots(ctx) {
  const { layout, rng, vf } = ctx;
  const asp = ctx.surf.get('asphalt'); const pw = ctx.surf.get('paintW'); const py = ctx.surf.get('paintY');
  for (const r of layout.roads) {
    const pts = r.pts.map((p) => ({ x: p.u, z: p.v }));
    asp.ribbon(pts, r.w / 2, 0.058, { color: 1.0, shoulder: 0.8, shoulderShade: 0.7 });
    P.line(pw, P.offsetLine(pts, r.w / 2 - 0.5), 0.16, Y.paint);
    P.line(pw, P.offsetLine(pts, -(r.w / 2 - 0.5)), 0.16, Y.paint);
    for (let i = 1; i < pts.length; i++) {
      if (r.kind === 'forecourt') P.dashed(py, pts[i - 1], pts[i], 0.15, 3, 3, Y.paint);
      else P.dashed(pw, pts[i - 1], pts[i], 0.15, 3, 6, Y.paint);
    }
    // traffic on the road
    if (r.kind !== 'forecourt' && rng.chance(0.8)) {
      const p = pts[0]; const q = pts[pts.length - 1];
      for (let k = 0; k < 2; k++) {
        const t = rng.range(0.15, 0.85); const dir = rng.chance(0.5) ? 1 : -1;
        const dx = q.x - p.x; const dz = q.z - p.z; const l = Math.hypot(dx, dz);
        const off = dir * r.w * 0.25;
        vf.add('car', p.x + dx * t - (dz / l) * off, p.z + dz * t + (dx / l) * off, dir * dx / l, dir * dz / l, { color: CAR_COLORS[rng.int(0, CAR_COLORS.length - 1)] });
      }
    }
  }
  for (const s of layout.sites) {
    if (s.type !== 'lot') continue;
    // tarmac
    asp.flat(s.u - s.w / 2, s.v - s.d / 2, s.u + s.w / 2, s.v + s.d / 2, 0.059);
    // double-row blocks of stalls running along u (cars park across v), aisle between blocks
    const stallW = 2.7; const stallD = 5.2; const aisle = 6.2;
    const blockD = stallD * 2; const pitchB = blockD + aisle;
    const nBlocks = Math.max(1, Math.floor((s.d - aisle) / pitchB));
    const nStalls = Math.floor(s.w / stallW) - 1;
    const v0 = s.v - s.d / 2 + (s.d - (nBlocks * pitchB - aisle)) / 2;
    for (let b = 0; b < nBlocks; b++) {
      const vb = v0 + b * pitchB; // block starts here
      for (let row = 0; row < 2; row++) {
        const vc = vb + row * stallD + stallD / 2;
        const dir = row === 0 ? 1 : -1;
        for (let i = 0; i <= nStalls; i++) {
          const x = s.u - (nStalls * stallW) / 2 + i * stallW;
          P.segment(pw, { x, z: vc - stallD / 2 }, { x, z: vc + stallD / 2 }, 0.1, Y.paint);
          if (i < nStalls && rng.chance(ctx.cls === 'hub' ? 0.72 : 0.55)) {
            vf.add('car', x + stallW / 2, vc + (row === 0 ? 0.1 : -0.1), 0, dir, { color: CAR_COLORS[rng.int(0, CAR_COLORS.length - 1)] });
          }
        }
        P.segment(pw, { x: s.u - (nStalls * stallW) / 2, z: vc - stallD / 2 }, { x: s.u + (nStalls * stallW) / 2, z: vc - stallD / 2 }, 0.1, Y.paint);
      }
    }
    // light poles around the lot
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      ctx.bufs.get('steel').cyl(s.u + sx * (s.w / 2 - 2), 0, s.v + sz * (s.d / 2 - 2), 0.1, 0.14, 8, 6, { ao: 0 });
      ctx.lights.add(s.u + sx * (s.w / 2 - 2), 8.1, s.v + sz * (s.d / 2 - 2), { color: 'sodium', size: 0.9, int: 1.3, day: 0.05 });
      ctx.pools.push({ u: s.u + sx * (s.w / 2 - 2) * 0.6, v: s.v + sz * (s.d / 2 - 2) * 0.6, r: 20 });
    }
  }
}

// ---- trees ----------------------------------------------------------------------------------------------------------------------------

function treeGeometry(kind) {
  const b = new MeshBuf();
  const brown = [0.12, 0.07, 0.04];
  if (kind === 'broadleaf') {
    b.cyl(0, 0, 0, 0.2, 0.32, 2.6, 6, { tint: brown, ao: 0 });
    b.sphere(0, 4.1, 0, 2.5, 8, 5, { sy: 0.9 });
    b.sphere(0.9, 5.3, 0.3, 1.7, 7, 5, { sy: 0.9 });
    b.sphere(-0.8, 3.7, -0.6, 1.6, 7, 5, { sy: 0.9 });
  } else if (kind === 'conifer') {
    b.cyl(0, 0, 0, 0.15, 0.25, 1.6, 6, { tint: brown, ao: 0 });
    b.cyl(0, 1.2, 0, 0.0, 2.1, 3.0, 8, { capTop: false, ao: 0.1 });
    b.cyl(0, 3.0, 0, 0.0, 1.6, 2.6, 8, { capTop: false, ao: 0.1 });
    b.cyl(0, 4.7, 0, 0.0, 1.1, 2.4, 8, { capTop: false, ao: 0.1 });
  } else if (kind === 'palm') {
    b.cyl(0, 0, 0, 0.18, 0.3, 7.5, 6, { tint: [0.3, 0.2, 0.1], ao: 0.1 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * PI * 2;
      const dx = Math.cos(a); const dz = Math.sin(a);
      const nx = -dz * 0.45; const nz = dx * 0.45;
      const P0 = [0, 7.5, 0]; const P1 = [dx * 3.2, 7.2, dz * 3.2];
      b.quad([P0[0] - nx, P0[1], P0[2] - nz], [P1[0] - nx * 1.4, P1[1] - 1.2, P1[2] - nz * 1.4], [P1[0] + nx * 1.4, P1[1] - 1.2, P1[2] + nz * 1.4], [P0[0] + nx, P0[1], P0[2] + nz], null, new Array(12).fill(1), [0, 1, 0]);
    }
  } else {
    b.sphere(0, 0.6, 0, 0.95, 7, 4, { sy: 0.7 });
  }
  return b.toGeometry();
}

const treeMat = () => lift(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));

export function addTrees(ctx) {
  const { layout, rng, biome } = ctx;
  const spots = { broadleaf: [], conifer: [], palm: [], shrub: [] };
  for (const s of layout.sites) {
    if (s.type !== 'trees' || !s.count) continue;
    let tries = 0; let placed = 0;
    while (placed < s.count && tries++ < s.count * 12) {
      let u; let v;
      if (s.zone) { u = rng.range(s.zone[0], s.zone[1]); v = rng.range(s.zone[2], s.zone[3]); }
      else { const a = rng.range(0, PI * 2); const r = s.spread * Math.sqrt(rng.float()); u = s.u + Math.cos(a) * r; v = s.v + Math.sin(a) * r; }
      if (blocked(ctx, u, v, 7)) continue;
      const roll = rng.float();
      const kind = biome === 'snow' ? (roll < 0.85 ? 'conifer' : 'shrub') : biome === 'desert' ? (roll < 0.6 ? 'palm' : 'shrub') : roll < 0.6 ? 'broadleaf' : roll < 0.8 ? 'conifer' : 'shrub';
      spots[kind].push({ u, v, ry: rng.range(0, PI * 2), s: rng.range(0.75, 1.5) });
      placed++;
    }
  }
  const group = new THREE.Group();
  const col = new THREE.Color();
  for (const [kind, list] of Object.entries(spots)) {
    if (!list.length) continue;
    const geo = treeGeometry(kind);
    const mesh = new THREE.InstancedMesh(geo, treeMat(), list.length);
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const sc = new THREE.Vector3(); const p = new THREE.Vector3();
    list.forEach((t, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.ry); sc.setScalar(t.s); p.set(t.u, 0, t.v);
      m.compose(p, q, sc); mesh.setMatrixAt(i, m);
      const base = biome === 'snow' ? [0.16, 0.3, 0.2] : biome === 'desert' ? [0.35, 0.42, 0.18] : kind === 'conifer' ? [0.12, 0.28, 0.16] : [0.25, 0.42, 0.14];
      const j = rng.range(0.7, 1.25);
      mesh.setColorAt(i, col.setRGB(base[0] * j, base[1] * j * (0.9 + rng.float() * 0.2), base[2] * j).convertSRGBToLinear?.() ?? col);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.userData.ownGeometry = true;
    group.add(mesh);
  }
  return group;
}

// ---- windsocks ------------------------------------------------------------------------------------------------------------------------

export function addWindsocks(ctx, frameGroup, anim) {
  const steel = ctx.bufs.get('steel');
  anim.windsocks = [];
  for (const s of ctx.layout.sites) {
    if (s.type !== 'windsock') continue;
    steel.cyl(s.u, 0, s.v, 0.07, 0.13, 7.6, 8, { ao: 0.1 });
    steel.cyl(s.u, 7.5, s.v, 0.5, 0.5, 0.1, 12, { ao: 0, capTop: false, capBot: false });
    const pivot = new THREE.Group();
    pivot.position.set(s.u, 7.4, s.v);
    const geo = new THREE.CylinderGeometry(0.16, 0.5, 3.6, 12, 6, true);
    geo.rotateZ(-PI / 2); // axis along +X, wide end at -X... flip so the wide end is at the pivot
    geo.translate(1.8, 0, 0);
    // orange and white bands
    const cols = []; const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const band = Math.floor((pos.getX(i) / 3.6) * 5); const c = band % 2 === 0 ? [0.9, 0.3, 0.04] : [0.9, 0.9, 0.88]; cols.push(...c); }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const sock = new THREE.Mesh(geo, ctx.mats.sock);
    pivot.add(sock);
    frameGroup.add(pivot);
    ctx.disposables.push({ dispose: () => geo.dispose() });
    anim.windsocks.push({ pivot, sock });
    ctx.lights.add(s.u, 7.9, s.v, { color: 'white', size: 0.5, int: 0.9, day: 0.05 });
  }
}

// ---- navigation aids, PAPI housings and strip markers ---------------------------------------------------------------------------

export function addNavaids(ctx, lightInfo) {
  const { layout, bufs, vf, rng } = ctx;
  const steel = bufs.get('steel'); const dk = bufs.get('dark'); const wall = bufs.get('wall2');
  // PAPI housings
  for (const p of lightInfo.papi) {
    for (const un of p.units) {
      const ry = -Math.atan2(un.dirz, un.dirx);
      dk.box(un.x, 0.15, un.z, 0.9, 0.9, 1.1, { ry, tint: [0.08, 0.08, 0.09], ao: 0 });
      steel.box(un.x, 0, un.z, 0.2, 0.2, 0.2, { ao: 0 });
    }
  }
  // localiser arrays and glide-slope masts for ILS ends
  for (const info of layout.runways) {
    for (let i = 0; i < 2; i++) {
      const end = info.rw.ends[i];
      if (!end.ils) continue;
      const B = P.endBasis(layout, info, i);
      // localiser sits beyond the far end of the runway, on the extended centreline
      const loc = P.ptST(B, info.L + 280, 0);
      const ry = -Math.atan2(B.dir.z, B.dir.x) + PI / 2; // local x along the array (perpendicular to the runway)
      steel.box(loc.x, 0.9, loc.z, 36, 0.15, 0.15, { ry, ao: 0 });
      for (let k = -7; k <= 7; k++) {
        const x = loc.x + B.right.x * k * 2.4; const z = loc.z + B.right.z * k * 2.4;
        steel.box(x, 0, z, 0.1, 1.2, 0.1, { ao: 0 });
        dk.box(x - B.dir.x * 0.4, 1.1, z - B.dir.z * 0.4, 0.5, 1.9, 0.08, { ry, tint: [0.35, 0.37, 0.4], ao: 0 });
      }
      wall.box(loc.x + B.dir.x * 3, 0, loc.z + B.dir.z * 3 + 0.0, 2.6, 2.2, 2.0, { ry, ao: 0.1 });
      // glide slope mast and cabinet, on the side away from the PAPI
      const gs = P.ptST(B, 300, info.W / 2 + 130);
      steel.cyl(gs.x, 0, gs.z, 0.1, 0.16, 14, 8, { ao: 0 });
      dk.box(gs.x, 5.5, gs.z, 0.6, 1.2, 0.2, { ry, tint: [0.4, 0.42, 0.45], ao: 0 });
      dk.box(gs.x, 9.5, gs.z, 0.6, 1.2, 0.2, { ry, tint: [0.4, 0.42, 0.45], ao: 0 });
      wall.box(gs.x + 3, 0, gs.z, 2.4, 2.4, 2.0, { ry, ao: 0.1 });
      ctx.lights.add(gs.x, 14.2, gs.z, { color: 'red', size: 0.4, int: 1.2, day: 0.4 });
    }
  }
  // grass strips: edge markers and end boards
  for (const info of layout.runways) {
    if (info.paved) continue;
    const dirR = { x: Math.cos(info.rel * PI / 180), z: Math.sin(info.rel * PI / 180) };
    const rightR = { x: -dirR.z, z: dirR.x };
    for (let s = -info.L / 2; s <= info.L / 2 + 0.1; s += 38) {
      for (const sd of [-1, 1]) vf.add('marker', info.cu + dirR.x * s + rightR.x * sd * (info.W / 2 + 0.8), info.cv + dirR.z * s + rightR.z * sd * (info.W / 2 + 0.8), 1, 0, { color: new THREE.Color(s % 76 === 0 || Math.abs(s) > info.L / 2 - 40 ? 0xe8e4d8 : 0xe9801e) });
    }
  }
  // fuel drums and bales for strips
  for (const s of layout.sites) {
    if (s.type === 'drums') {
      for (let i = 0; i < 5; i++) vf.add('drum', s.u + (i % 3) * 0.7, s.v + Math.floor(i / 3) * 0.7, 1, 0, { color: new THREE.Color([0x1f4f8f, 0xb3261e, 0x2f7d4f, 0x7a7d82, 0xb3261e][i]) });
      for (let i = 0; i < 3; i++) vf.add('bale', s.u - 10 + i * 2.4, s.v + 8, 1, 0);
    }
  }
  void rng;
}

// ---- vehicles around the site ----------------------------------------------------------------------------------------------------

export function addSiteVehicles(ctx) {
  const { layout, vf, rng } = ctx;
  for (const s of layout.sites) {
    if (s.type === 'fire') {
      const n = ctx.cls === 'hub' ? 3 : 2;
      const dv = layout.hasPair ? 1 : -layout.side;
      for (let i = 0; i < n; i++) vf.add('arff', s.u - s.w / 2 + (s.w / n) * (i + 0.5), s.v + dv * (s.d / 2 + 9), 0, dv);
    }
    if (s.type === 'depot') {
      for (let i = 0; i < 4; i++) vf.add(i % 2 ? 'tug' : 'beltloader', s.u - 16 + i * 10.5, s.v - 15, 0, -1);
      for (let i = 0; i < 6; i++) vf.add('cart', s.u - 20 + i * 4.5, s.v + 14, 1, 0);
    }
    if (s.type === 'cargo') {
      for (let i = 0; i < 5; i++) vf.add(i % 3 === 0 ? 'bus' : 'cart', s.u - s.w / 2 + 14 + i * 24, s.v + (rng.chance(0.5) ? 1 : -1) * (s.d / 2 + 11), 1, 0, { color: CAR_COLORS[i] });
    }
  }
  if (ctx.cls === 'hub') {
    // shuttle buses and follow-me cars on the apron roads
    for (let i = 0; i < 4; i++) vf.add('bus', -160 + i * 90 + rng.range(-10, 10), (i % 2 ? 1 : -1) * 98, 1, 0, { color: new THREE.Color(0xe6e9ec) });
    vf.add('followme', 215, -60, 0, 1);
    vf.add('followme', -215, 60, 0, -1);
    // service cars and a fire patrol vehicle by the tower
    vf.add('pickup', 255, 30, 1, 0, { color: new THREE.Color(0xdadada) });
  } else if (ctx.cls === 'regional') {
    vf.add('followme', layout.uc + 130, layout.side * 120, 1, 0);
    vf.add('bus', layout.uc - 30, layout.side * 168, 1, 0, { color: new THREE.Color(0xe6e9ec) });
  } else if (ctx.cls === 'small') {
    vf.add('pickup', 58, layout.side * 100, 0, 1, { color: new THREE.Color(0xa9232a) });
  } else if (ctx.cls === 'strip') {
    vf.add('pickup', 14, layout.side * 78, 1, 0, { color: new THREE.Color(0x4a5a4e) });
  }
}

// ---- light pools ---------------------------------------------------------------------------------------------------------------------

export function addPools(ctx, poolBuf) {
  for (const p of ctx.pools) {
    P.quadUp(poolBuf, [{ x: p.u - p.r, z: p.v - p.r }, { x: p.u + p.r, z: p.v - p.r }, { x: p.u + p.r, z: p.v + p.r }, { x: p.u - p.r, z: p.v + p.r }], 0.1, [0, 0, 1, 0, 1, 1, 0, 1], 1);
  }
}
