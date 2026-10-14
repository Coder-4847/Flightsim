import * as THREE from 'three';
import { smoothstep } from '../util/noise.js';
import { Terrain } from './terrainTiles.js';

// Road ribbons per terrain tile (draped on the surface), with simple bridges where a road
// crosses a river.

let roadMat = null;
let bridgeMat = null;
function materials() {
  if (!roadMat) {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#34363a'; g.fillRect(0, 0, 16, 64);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 0, 3, 64); g.fillRect(13, 0, 3, 64);
    g.fillStyle = '#d8c14a'; g.fillRect(7, 0, 2, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    roadMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    bridgeMat = new THREE.MeshStandardMaterial({ color: 0x8c8f93, roughness: 0.8 });
  }
  return { roadMat, bridgeMat };
}

/** Is this world point inside a lake? (roads skip these gaps instead of driving across water) */
function inLake(map, x, z) {
  for (const l of map.lakes) if (Math.hypot(x - l.x, z - l.z) < l.radius * 1.05) return true;
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
  const STEP = 40;

  for (const road of map.roads) {
    const pts = road.points;
    const half = road.width / 2;
    let along = 0;
    let prev = null; // previous ribbon cross-section start index, or null when the strip is broken
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      const nx = -(b.z - a.z) / segLen;
      const nz = (b.x - a.x) / segLen;
      const n = Math.max(1, Math.round(segLen / STEP));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        if (i > 0 && k === 0) continue;
        const dist = (i === 0 ? 0 : 0) + along + segLen * t;
        if (x < x0 || x > x1 || z < z0 || z > z1 || inLake(map, x, z)) { prev = null; continue; }
        let y = Terrain.heightIn(tile, x, z) + 0.12;
        let bridge = 0;
        if (rivers) {
          const r = rivers.nearest(x, z);
          if (r.dist < r.w * 3.6) {
            const deck = r.y + 4.2;
            bridge = smoothstep(r.w * 3.6, r.w * 1.4, r.dist);
            y = y + (Math.max(deck, y) - y) * bridge;
            if (r.dist < r.w * 1.1 && k % 2 === 0) bridgeBoxes.push({ x, z, top: y, bottom: r.y - 1.4, nx, nz });
          }
        }
        positions.push(x + nx * half, y, z + nz * half, x - nx * half, y, z - nz * half);
        const v = dist / 16;
        uvs.push(0, v, 1, v);
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
    // Normals of a flat ribbon should face up regardless of winding.
    const nrm = geo.attributes.normal;
    for (let i = 0; i < nrm.count; i++) if (nrm.getY(i) < 0) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, rm);
    mesh.material.side = THREE.DoubleSide;
    g.add(mesh);
  }
  if (bridgeBoxes.length) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.computeBoundingSphere();
    const inst = new THREE.InstancedMesh(box, bm, bridgeBoxes.length * 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    bridgeBoxes.forEach((b, i) => {
      // Deck slab and a pier.
      const ang = Math.atan2(b.nx, -b.nz);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      m.compose(new THREE.Vector3(b.x, b.top - 0.5, b.z), q, new THREE.Vector3(10.5, 1, STEP * 1.05));
      inst.setMatrixAt(i * 2, m);
      m.compose(new THREE.Vector3(b.x, (b.top + b.bottom) / 2 - 1, b.z), q, new THREE.Vector3(3, b.top - b.bottom - 2, 3));
      inst.setMatrixAt(i * 2 + 1, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    g.add(inst);
  }
  return g;
}
