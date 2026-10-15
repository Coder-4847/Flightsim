import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Models of the larger one-off structures: radio masts, VOR/NDB beacons, the city stadium. Built from
// a handful of shared primitives; counts stay small so they cost almost nothing.

const white = new THREE.MeshStandardMaterial({ color: 0xe9ebee, roughness: 0.7 });
const grey = new THREE.MeshStandardMaterial({ color: 0x8e949b, roughness: 0.6, metalness: 0.4 });
const red = new THREE.MeshStandardMaterial({ color: 0xc9332b, roughness: 0.7 });
const concrete = new THREE.MeshStandardMaterial({ color: 0xb7b4ad, roughness: 0.9, side: THREE.DoubleSide });
const redLight = new THREE.MeshBasicMaterial({ color: 0xff3030, toneMapped: false });

function put(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** A guyed lattice-style radio mast with red/white bands and a beacon. */
export function radioMast(h = 150) {
  const g = new THREE.Group();
  const seg = 8;
  for (let i = 0; i < seg; i++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.62 - i * 0.04, 0.72 - i * 0.04, h / seg, 6), i % 2 ? white : red);
    s.position.y = (i + 0.5) * (h / seg);
    g.add(s);
  }
  // Guy wires.
  const pts = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    pts.push(0, h * 0.78, 0, Math.cos(a) * h * 0.42, 0.5, Math.sin(a) * h * 0.42);
    pts.push(0, h * 0.45, 0, Math.cos(a) * h * 0.26, 0.5, Math.sin(a) * h * 0.26);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x6a6f74 })));
  // Dishes and a small equipment hut.
  g.add(put(new THREE.BoxGeometry(4, 2.4, 3), concrete, 8, 1.2, 3));
  const light = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 6), redLight);
  light.position.y = h + 1;
  g.add(light);
  g.userData.blink = light;
  return g;
}

/** Football stadium: stepped bowl, pitch with markings, roof ring and four floodlight masts. */
export function buildStadium() {
  const g = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const x = c.getContext('2d');
  for (let i = 0; i < 10; i++) { x.fillStyle = i % 2 ? '#3d7d34' : '#468a3b'; x.fillRect(i * 25.6, 0, 25.6, 160); }
  x.strokeStyle = 'rgba(255,255,255,0.85)'; x.lineWidth = 2;
  x.strokeRect(10, 8, 236, 144); x.beginPath(); x.moveTo(128, 8); x.lineTo(128, 152); x.stroke();
  x.beginPath(); x.arc(128, 80, 22, 0, Math.PI * 2); x.stroke();
  x.strokeRect(10, 50, 36, 60); x.strokeRect(210, 50, 36, 60);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(105, 68).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  pitch.position.y = 1.2;
  g.add(pitch);
  const track = new THREE.Mesh(new THREE.RingGeometry(58, 74, 48, 1).rotateX(-Math.PI / 2).scale(1.18, 1, 0.82), new THREE.MeshStandardMaterial({ color: 0x9a4b3a, roughness: 0.95 }));
  track.position.y = 0.9;
  g.add(track);
  const seat = new THREE.MeshStandardMaterial({ color: 0x2f4f8f, roughness: 0.8, side: THREE.DoubleSide });
  const tiers = [];
  for (let i = 0; i < 4; i++) {
    const r0 = 62 + i * 7; const r1 = 69 + i * 7;
    const h0 = 3 + i * 5; const h1 = 8 + i * 5;
    const wall = new THREE.CylinderGeometry(r1, r1, h1 - h0, 40, 1, true).translate(0, (h0 + h1) / 2, 0);
    const steps = new THREE.CylinderGeometry(r1, r0, 5, 40, 1, true).translate(0, h0 + 2.5, 0);
    tiers.push(wall, steps);
  }
  const bowl = new THREE.Mesh(mergeGeometries(tiers.map((t) => t.toNonIndexed())), seat);
  bowl.scale.set(1.18, 1, 0.82);
  g.add(bowl);
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(91, 93, 26, 48, 1, true).translate(0, 13, 0), concrete);
  outer.scale.set(1.18, 1, 0.82);
  g.add(outer);
  const roof = new THREE.Mesh(new THREE.RingGeometry(70, 93, 48, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8dadd, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }));
  roof.scale.set(1.18, 1, 0.82);
  roof.position.y = 27;
  g.add(roof);
  for (const a of [0.78, 2.36, 3.93, 5.5]) {
    g.add(put(new THREE.CylinderGeometry(0.9, 1.4, 52, 6), grey, Math.cos(a) * 100, 26, Math.sin(a) * 78));
    g.add(put(new THREE.BoxGeometry(9, 5, 1.2), new THREE.MeshStandardMaterial({ color: 0xdfe6ee, emissive: 0xffffff, emissiveIntensity: 0.0 }), Math.cos(a) * 100, 53, Math.sin(a) * 78));
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.shadowSet = true; } });
  return g;
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
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.shadowSet = true; } });
    group.add(g);
  }
  return { group, masts };
}
