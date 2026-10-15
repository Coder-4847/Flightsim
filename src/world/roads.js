import * as THREE from 'three';
import { smoothstep } from '../util/noise.js';
import { Terrain } from './terrainTiles.js';
import { lakeD } from './lakeShape.js';

// Road, railway and bridge ribbons per terrain tile, draped on the surface. One texture atlas holds
// the four surface types (highway, road, minor road, railway) with lane markings, edge lines, wear
// and gravel shoulders. Bridges lift the deck over rivers and get parapets and piers.

const COLS = { highway: 0, road: 1, minor: 2, rail: 3 };
const TEX_W = 512;
const TEX_H = 256;
const REPEAT = 24; // metres of road per texture repeat

let roadMat = null;
let bridgeMat = null;
let railMat = null;

function atlas() {
  const c = document.createElement('canvas');
  c.width = TEX_W; c.height = TEX_H;
  const g = c.getContext('2d');
  const cw = TEX_W / 4;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const noise = (x0, w, base, amp) => {
    for (let i = 0; i < w * TEX_H * 0.5; i++) {
      const x = x0 + rnd() * w; const y = rnd() * TEX_H;
      const v = base + (rnd() - 0.5) * amp;
      g.fillStyle = `rgba(${v},${v},${v},0.35)`;
      g.fillRect(x, y, 1 + rnd() * 2, 1 + rnd() * 2);
    }
  };
  const px = (col, frac) => col * cw + frac * cw;
  // --- highway: 15 m + shoulders; four lanes with a double centre line
  {
    const x0 = 0;
    g.fillStyle = '#8a8478'; g.fillRect(x0, 0, cw, TEX_H); // gravel shoulder
    g.fillStyle = '#383a3d'; g.fillRect(px(0, 0.08), 0, cw * 0.84, TEX_H);
    noise(px(0, 0.08), cw * 0.84, 70, 60);
    g.fillStyle = 'rgba(10,10,12,0.22)'; // tyre tracks
    for (const f of [0.19, 0.31, 0.69, 0.81]) g.fillRect(px(0, f) - 6, 0, 12, TEX_H);
    g.fillStyle = '#e8e8e0';
    g.fillRect(px(0, 0.1), 0, 5, TEX_H); g.fillRect(px(0, 0.9) - 5, 0, 5, TEX_H);
    for (const f of [0.3, 0.7]) for (let y = 0; y < TEX_H; y += TEX_H / 2) g.fillRect(px(0, f) - 2.5, y, 5, TEX_H * 0.22);
    g.fillStyle = '#d6b624'; g.fillRect(px(0, 0.5) - 8, 0, 4, TEX_H); g.fillRect(px(0, 0.5) + 4, 0, 4, TEX_H);
  }
  // --- road: 9.5 m two lane
  {
    g.fillStyle = '#7d7868'; g.fillRect(cw, 0, cw, TEX_H);
    g.fillStyle = '#3d3f42'; g.fillRect(px(1, 0.1), 0, cw * 0.8, TEX_H);
    noise(px(1, 0.1), cw * 0.8, 75, 60);
    g.fillStyle = 'rgba(10,10,12,0.2)';
    for (const f of [0.3, 0.7]) g.fillRect(px(1, f) - 5, 0, 10, TEX_H);
    g.fillStyle = '#e4e4dc';
    g.fillRect(px(1, 0.13), 0, 3, TEX_H); g.fillRect(px(1, 0.87) - 3, 0, 3, TEX_H);
    g.fillStyle = '#dcc13a';
    for (let y = 0; y < TEX_H; y += TEX_H / 2) g.fillRect(px(1, 0.5) - 2, y, 4, TEX_H * 0.25);
  }
  // --- minor road: 6.5 m worn tarmac
  {
    g.fillStyle = '#8a8070'; g.fillRect(cw * 2, 0, cw, TEX_H);
    g.fillStyle = '#4a4a49'; g.fillRect(px(2, 0.14), 0, cw * 0.72, TEX_H);
    noise(px(2, 0.14), cw * 0.72, 85, 70);
    g.fillStyle = 'rgba(20,20,20,0.16)';
    for (const f of [0.36, 0.64]) g.fillRect(px(2, f) - 7, 0, 14, TEX_H);
    g.fillStyle = 'rgba(60,70,40,0.25)'; g.fillRect(px(2, 0.5) - 3, 0, 6, TEX_H);
  }
  // --- railway: ballast, sleepers, two rails
  {
    g.fillStyle = '#85807a'; g.fillRect(cw * 3, 0, cw, TEX_H);
    noise(cw * 3, cw, 120, 90);
    g.fillStyle = '#6a625a'; g.fillRect(px(3, 0.16), 0, cw * 0.68, TEX_H);
    noise(px(3, 0.16), cw * 0.68, 110, 70);
    g.fillStyle = '#3b332c';
    for (let y = 0; y < TEX_H; y += TEX_H / 40) g.fillRect(px(3, 0.25), y, cw * 0.5, 3.4);
    g.fillStyle = '#b9bcc0';
    g.fillRect(px(3, 0.37), 0, 3.2, TEX_H); g.fillRect(px(3, 0.63) - 3.2, 0, 3.2, TEX_H);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  return tex;
}

function materials() {
  if (!roadMat) {
    const tex = atlas();
    roadMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
    bridgeMat = new THREE.MeshStandardMaterial({ color: 0x9a9c9e, roughness: 0.8 });
    roadMat.userData.tex = tex;
  }
  return { roadMat, bridgeMat };
}

/** Is this world point inside a lake? (roads skip these gaps instead of driving across water) */
function inLake(map, x, z) {
  for (const l of map.lakes) if (lakeD(l, x - l.x, z - l.z) < 1.08) return true;
  return false;
}

export function buildRoads(tile, map) {
  const { roadMat: rm, bridgeMat: bm } = materials();
  const positions = [];
  const uvs = [];
  const indices = [];
  const bridgeBoxes = [];
  const x0 = tile.x0 - 80;
  const x1 = tile.x0 + tile.size + 80;
  const z0 = tile.z0 - 80;
  const z1 = tile.z0 + tile.size + 80;
  const rivers = map.rivers;
  let vcount = 0;
  const STEP = 36;
  const lines = [...map.roads, ...(map.rails ?? [])];

  for (const road of lines) {
    const pts = road.points;
    const col = COLS[road.type] ?? 1;
    const half = road.width / 2 + (road.type === 'rail' ? 1.2 : 1.4);
    const u0 = col / 4 + 0.004;
    const u1 = (col + 1) / 4 - 0.004;
    let along = 0;
    let prev = null; // previous ribbon cross-section start index, or null when the strip is broken
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      if (segLen < 0.01) continue;
      // quick reject of segments far outside the tile
      if (Math.max(a.x, b.x) < x0 || Math.min(a.x, b.x) > x1 || Math.max(a.z, b.z) < z0 || Math.min(a.z, b.z) > z1) { along += segLen; prev = null; continue; }
      // Smooth direction: average of the neighbouring segments so the ribbon bends without gaps.
      const dir = (p, q) => { const l = Math.hypot(q.x - p.x, q.z - p.z) || 1; return [(q.x - p.x) / l, (q.z - p.z) / l]; };
      const dA = dir(pts[Math.max(0, i - 1)], b);
      const dB = dir(a, pts[Math.min(pts.length - 1, i + 2)]);
      const n = Math.max(1, Math.round(segLen / STEP));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        if (i > 0 && k === 0) continue;
        const dx = dA[0] + (dB[0] - dA[0]) * t;
        const dz = dA[1] + (dB[1] - dA[1]) * t;
        const dl = Math.hypot(dx, dz) || 1;
        const nx = -dz / dl;
        const nz = dx / dl;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        const dist = along + segLen * t;
        if (x < x0 || x > x1 || z < z0 || z > z1 || inLake(map, x, z)) { prev = null; continue; }
        let y = Terrain.heightIn(tile, x, z) + 0.1;
        if (rivers) {
          const r = rivers.nearest(x, z);
          if (r.dist < r.w * 3.8) {
            const deck = r.y + 4.4;
            const bridge = smoothstep(r.w * 3.8, r.w * 1.5, r.dist);
            y = y + (Math.max(deck, y) - y) * bridge;
            if (r.dist < r.w * 1.35 && k % 2 === 0) bridgeBoxes.push({ x, z, top: y, bottom: r.y - 1.4, nx, nz, w: road.width, ang: Math.atan2(nx, -nz), pier: r.dist < r.w * 0.8 });
          }
        }
        positions.push(x + nx * half, y, z + nz * half, x - nx * half, y, z - nz * half);
        const v = dist / REPEAT;
        uvs.push(u0, v, u1, v);
        if (prev !== null) {
          const p = prev;
          const c = vcount;
          indices.push(p, c, p + 1, p + 1, c, c + 1);
        }
        prev = vcount;
        vcount += 2;
      }
      along += segLen;
    }
  }
  if (!vcount && !bridgeBoxes.length) return null;
  const g = new THREE.Group();
  if (vcount) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    for (let i = 0; i < nrm.count; i++) if (nrm.getY(i) < 0) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, rm);
    mesh.userData.noShadow = true;
    mesh.castShadow = false;
    g.add(mesh);
  }
  if (bridgeBoxes.length) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.computeBoundingSphere();
    const inst = new THREE.InstancedMesh(box, bm, bridgeBoxes.length * 4);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    bridgeBoxes.forEach((b, i) => {
      q.setFromAxisAngle(up, b.ang);
      const w = b.w + 2.4;
      const side = new THREE.Vector3(b.nx, 0, b.nz);
      m.compose(new THREE.Vector3(b.x, b.top - 0.55, b.z), q, new THREE.Vector3(w, 1.1, STEP * 1.04));
      inst.setMatrixAt(i * 4, m);
      for (const s of [-1, 1]) {
        m.compose(new THREE.Vector3(b.x + side.x * s * (w / 2 - 0.2), b.top + 0.45, b.z + side.z * s * (w / 2 - 0.2)), q, new THREE.Vector3(0.35, 0.9, STEP * 1.04));
        inst.setMatrixAt(i * 4 + 1 + (s > 0 ? 1 : 0), m);
      }
      const ph = Math.max(0.1, b.top - b.bottom - 1.2);
      m.compose(new THREE.Vector3(b.x, b.bottom + ph / 2, b.z), q, new THREE.Vector3(w * 0.5, b.pier ? ph : 0.01, 2.2));
      inst.setMatrixAt(i * 4 + 3, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.userData.shadowSet = true;
    g.add(inst);
  }
  return g;
}

