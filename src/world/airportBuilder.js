import * as THREE from 'three';
import { addParkedTraffic } from '../traffic/parked.js';
import { makeGrassStripTexture, makeRunwayTexture, makeTaxiTexture } from '../scene/textures.js';
import { layoutAirport } from './airportLayout.js';

// Builds the 3D airport for a map's airport record: surfaces, buildings, lights, PAPI, windsock.
// Local frame: origin at the airport reference point on the flat pad, +Y up. The group is
// positioned at (x, elevation, z) in the world.

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const dirOf = (h) => ({ x: Math.sin(h * DEG), z: -Math.cos(h * DEG) });
const FLAT = -Math.PI / 2;

const shared = {};
function sharedMaterials() {
  if (shared.ready) return shared;
  shared.ready = true;
  shared.taxiTex = makeTaxiTexture();
  shared.apron = new THREE.MeshStandardMaterial({ color: 0x6d7076, roughness: 0.95 });
  shared.wall = new THREE.MeshStandardMaterial({ color: 0xd8d5ce, roughness: 0.85 });
  shared.wallDark = new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.8 });
  shared.roof = new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.7 });
  shared.glass = new THREE.MeshStandardMaterial({ color: 0x1b2a38, roughness: 0.15, metalness: 0.4, emissive: 0xffc46b, emissiveIntensity: 0 });
  shared.tank = new THREE.MeshStandardMaterial({ color: 0xe5e7ea, roughness: 0.6, metalness: 0.2 });
  shared.metal = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.4, metalness: 0.7 });
  shared.discGeo = new THREE.CircleGeometry(0.55, 8);
  shared.sphereGeo = new THREE.SphereGeometry(0.4, 6, 4);
  // Light materials: colour is per-instance, brightness is set globally from the time of day.
  shared.lightDisc = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  shared.lightSphere = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  return shared;
}

export function setLightBrightness(level) {
  const m = sharedMaterials();
  m.lightDisc.color.setScalar(level);
  m.lightSphere.color.setScalar(level);
}

/** Instanced lights: `items` of {x, y, z, color, facing?} -> disc (directional) or sphere (omni). */
function lightSet(items, directional) {
  const geo = directional ? shared.discGeo : shared.sphereGeo;
  const mesh = new THREE.InstancedMesh(geo, directional ? shared.lightDisc : shared.lightSphere, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  const c = new THREE.Color();
  items.forEach((it, i) => {
    if (directional) {
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(it.facing.x, it.facing.y ?? 0.1, it.facing.z).normalize());
    } else q.identity();
    m.compose(new THREE.Vector3(it.x, it.y, it.z), q, s);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.set(it.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

export function buildAirport(a) {
  const mats = sharedMaterials();
  const layout = layoutAirport(a);
  const group = new THREE.Group();
  group.position.set(a.x, a.elevation, a.z);
  const anim = { windsock: null, papi: [], beacon: null, windowMats: [mats.glass] };
  const Y_GROUND = 0.04;

  // ---- surfaces: aprons and taxiways, then runways on top --------------------------------------
  for (const r of layout.rects) {
    if (r.kind === 'runway') continue;
    const len = r.hl * 2;
    const wid = r.hw * 2;
    const geo = new THREE.PlaneGeometry(wid, len).rotateX(FLAT);
    let mat;
    if (r.kind === 'taxiway') {
      const tex = mats.taxiTex.clone();
      tex.needsUpdate = true;
      tex.repeat.set(1, Math.max(1, len / 40));
      mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    } else {
      mat = r.surface === 'grass'
        ? new THREE.MeshStandardMaterial({ color: 0x8b8a6a, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
        : mats.apron;
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(r.cx - a.x, Y_GROUND + (r.kind === 'apron' ? 0.0 : 0.01), r.cz - a.z);
    mesh.rotation.y = Math.PI - r.heading * DEG;
    group.add(mesh);
  }

  // ---- runways with markings -------------------------------------------------------------------------
  const lightsOmni = [];
  const lightsDisc = [];
  for (const rw of a.runways) {
    const [endA, endB] = rw.ends;
    const geo = new THREE.PlaneGeometry(rw.width, rw.length).rotateX(FLAT);
    const tex = rw.surface === 'grass'
      ? makeGrassStripTexture({ widthM: rw.width, lengthM: rw.length, northNumber: endA.id, southNumber: endB.id })
      : makeRunwayTexture({ widthM: rw.width, lengthM: rw.length, northNumber: endA.id, southNumber: endB.id });
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    mesh.position.set(rw.cx - a.x, Y_GROUND + 0.03, rw.cz - a.z);
    mesh.rotation.y = Math.PI - rw.heading * DEG;
    group.add(mesh);

    const d = dirOf(rw.heading);
    const side = { x: -d.z, z: d.x };
    const lx = rw.cx - a.x;
    const lz = rw.cz - a.z;
    const at = (along, perp, y = 0.5) => ({ x: lx + d.x * along + side.x * perp, y, z: lz + d.z * along + side.z * perp });
    if (rw.surface === 'grass') {
      // Marker cones instead of electric lights.
      for (let al = -rw.length / 2; al <= rw.length / 2; al += 80) for (const sd of [-1, 1]) lightsOmni.push({ ...at(al, sd * (rw.width / 2 + 1), 0.3), color: 0xfff4d0 });
      continue;
    }
    // Edge lights: white, amber on the last 600 m of the runway.
    for (let al = -rw.length / 2; al <= rw.length / 2 + 0.1; al += 60) {
      const amber = Math.abs(al) > rw.length / 2 - 600;
      for (const sd of [-1, 1]) lightsOmni.push({ ...at(al, sd * (rw.width / 2 + 1.8), 0.45), color: amber ? 0xffc23a : 0xfff4e0 });
    }
    // Threshold (green, facing approach) and runway-end (red, facing along the runway) rows.
    for (const [end, sgn] of [[endA, -1], [endB, 1]]) {
      const faceOut = { x: d.x * sgn, z: d.z * sgn, y: 0.12 }; // away from the runway = toward an arriving pilot
      const faceIn = { x: -d.x * sgn, z: -d.z * sgn, y: 0.12 };
      for (let p = -rw.width / 2; p <= rw.width / 2; p += 3) {
        lightsDisc.push({ ...at(sgn * (rw.length / 2 - 1), p, 0.3), color: 0x35e07a, facing: faceOut });
        lightsDisc.push({ ...at(sgn * (rw.length / 2 + 1.5), p, 0.3), color: 0xff3030, facing: faceIn });
      }
      // Approach lights: centreline every 30 m, crossbars every 150 m, facing the arriving aircraft.
      if (a.spec.approachLights && end.ils) {
        const reach = a.cls === 'hub' ? 900 : 600;
        for (let al = 60; al <= reach; al += 30) {
          lightsDisc.push({ ...at(sgn * (rw.length / 2 + al), 0, 1.4), color: al % 150 === 0 ? 0xffffff : 0xfff0c8, facing: { x: faceOut.x, z: faceOut.z, y: 0.25 } });
          if (al % 150 === 0) for (let p = -9; p <= 9; p += 3) if (p) lightsDisc.push({ ...at(sgn * (rw.length / 2 + al), p, 1.4), color: 0xffffff, facing: { x: faceOut.x, z: faceOut.z, y: 0.25 } });
        }
      }
      // PAPI: four lamps 300 m past the threshold, left of the runway as the arriving pilot sees it.
      // Lamp 0 is the outermost one and needs the lowest angle to show white (2.5 deg ... 3.5 deg).
      if (a.spec.papi) {
        const lamps = [];
        let pos = null;
        for (let k = 0; k < 4; k++) {
          const perp = sgn * (rw.width / 2 + 16 + (3 - k) * 9);
          const p = at(sgn * (rw.length / 2 - 300), perp, 0.5);
          const lamp = box(1.4, 0.9, 1.4, new THREE.MeshBasicMaterial({ color: 0xff2a2a, toneMapped: false }), p.x, p.y, p.z);
          group.add(lamp);
          lamps.push(lamp);
          if (k === 1) pos = p;
        }
        anim.papi.push({ lamps, pos: { x: a.x + pos.x, y: a.elevation + 0.6, z: a.z + pos.z }, approachDir: { x: -d.x * sgn, z: -d.z * sgn } });
      }
    }
  }

  // Taxiway edge lights (blue).
  for (const r of layout.rects.filter((q) => q.kind === 'taxiway')) {
    for (let al = -r.hl; al <= r.hl; al += 45) for (const sd of [-1, 1]) {
      lightsOmni.push({
        x: r.cx - a.x + r.ux * al + -r.uz * sd * (r.hw + 1), y: 0.3, z: r.cz - a.z + r.uz * al + r.ux * sd * (r.hw + 1), color: 0x3a7bff,
      });
    }
  }
  if (lightsOmni.length) group.add(lightSet(lightsOmni, false));
  if (lightsDisc.length) group.add(lightSet(lightsDisc, true));

  // ---- buildings --------------------------------------------------------------------------------------------
  for (const b of layout.buildings) {
    const g = new THREE.Group();
    g.position.set(b.x - a.x, 0, b.z - a.z);
    g.rotation.y = Math.PI - b.heading * DEG - Math.PI / 2; // local +X runs along the runway
    if (b.type === 'terminal') {
      g.add(box(b.w, b.h, b.d, mats.wall, 0, b.h / 2, 0));
      const glass = box(b.w * 0.96, b.h * 0.42, b.d + 0.4, mats.glass, 0, b.h * 0.55, 0);
      g.add(glass);
      g.add(box(b.w * 1.02, 1.2, b.d * 1.06, mats.roof, 0, b.h + 0.6, 0));
      if (b.size === 'large') {
        // Concourse fingers with jet bridges toward the apron.
        for (let i = -3; i <= 3; i++) {
          const x = i * (b.w / 8);
          g.add(box(7, 6, 70, mats.wallDark, x, 3, -(b.d / 2 + 35)));
          g.add(box(1.4, 1.4, 22, mats.metal, x + 5, 4.2, -(b.d / 2 + 78)));
        }
      }
    } else if (b.type === 'hangar') {
      g.add(box(b.w, b.h, b.d, mats.wall, 0, b.h / 2, 0));
      const shape = new THREE.Shape([new THREE.Vector2(-b.w / 2, b.h), new THREE.Vector2(b.w / 2, b.h), new THREE.Vector2(0, b.h + b.h * 0.3)]);
      const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: b.d + 0.6, bevelEnabled: false }), mats.roof);
      gable.position.z = -(b.d + 0.6) / 2;
      g.add(gable);
      g.add(box(b.w * 0.7, b.h * 0.7, 0.4, mats.wallDark, 0, b.h * 0.35, b.d / 2 + 0.1));
    } else if (b.type === 'tower') {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.6, b.h, 16), mats.wall);
      shaft.position.y = b.h / 2;
      const cab = new THREE.Mesh(new THREE.CylinderGeometry(6, 4.4, 6, 16), mats.glass);
      cab.position.y = b.h + 3;
      const cabRoof = new THREE.Mesh(new THREE.CylinderGeometry(6.8, 6.8, 0.8, 16), mats.roof);
      cabRoof.position.y = b.h + 6.4;
      g.add(shaft, cab, cabRoof);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0x35e07a, toneMapped: false }));
      beacon.position.y = b.h + 8.4;
      g.add(beacon);
      anim.beacon = beacon;
    } else if (b.type === 'tanks') {
      for (let i = 0; i < 4; i++) {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 14, 20), mats.tank);
        t.position.set(i * 26 - 39, 7, 0);
        g.add(t);
      }
    }
    group.add(g);
  }

  // ---- windsock near the touchdown zone of the main runway ---------------------------------------------------
  const main = a.runways[0];
  const md = dirOf(main.heading);
  const wsPos = { x: main.cx - a.x + md.x * 280 + -md.z * (main.width / 2 + 45), z: main.cz - a.z + md.z * 280 + md.x * (main.width / 2 + 45) };
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 8, 8), mats.metal);
  pole.position.set(wsPos.x, 4, wsPos.z);
  const sockPivot = new THREE.Group();
  sockPivot.position.set(wsPos.x, 7.7, wsPos.z);
  const sock = new THREE.Mesh(new THREE.ConeGeometry(0.85, 3.6, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0xff7a1a, side: THREE.DoubleSide, roughness: 0.8 }));
  sock.rotation.z = -Math.PI / 2; // cone axis along +X, narrow end pointing downwind
  sock.position.x = 1.8;
  sockPivot.add(sock);
  group.add(pole, sockPivot);
  anim.windsock = { pivot: sockPivot, sock };

  addParkedTraffic(group, a);
  group.userData.anim = anim;
  group.userData.airport = a;
  return group;
}

/** Streams airports in and out around the camera and animates windsocks and PAPI lamps. */
export class AirportManager {
  constructor(scene, map, env) {
    this.scene = scene;
    this.map = map;
    this.env = env;
    this.built = new Map();
    this.buildRadius = 28000;
    this.dropRadius = 42000;
  }

  /** `wind`: Vector3 of the wind velocity at the camera (m/s). */
  update(camPos, wind) {
    let builtThisFrame = 0;
    for (const a of this.map.airports) {
      const d = Math.hypot(camPos.x - a.x, camPos.z - a.z);
      const have = this.built.get(a.code);
      if (!have && d < this.buildRadius && builtThisFrame < 1) {
        const g = buildAirport(a);
        this.scene.add(g);
        this.built.set(a.code, g);
        builtThisFrame++;
      } else if (have && d > this.dropRadius) {
        this.scene.remove(have);
        have.traverse((o) => { o.geometry?.dispose?.(); });
        this.built.delete(a.code);
      }
    }
    // Lights glow brighter at night; dim by day.
    setLightBrightness(0.3 + 0.7 * this.env.night);
    const night = this.env.night;
    sharedMaterials().glass.emissiveIntensity = night * 0.9;
    const speed = Math.hypot(wind.x, wind.z);
    for (const g of this.built.values()) {
      const anim = g.userData.anim;
      if (anim.windsock) {
        const heading = Math.atan2(wind.x, wind.z); // direction the wind blows toward, in the XZ plane
        anim.windsock.pivot.rotation.y = heading - Math.PI / 2;
        anim.windsock.sock.rotation.z = -Math.PI / 2 + Math.max(0, 1 - speed / 8) * 1.1; // droops in light wind
      }
      if (anim.beacon) anim.beacon.material.color.setHex(Math.sin(performance.now() / 700) > 0 ? 0x35e07a : 0xffffff);
      for (const p of anim.papi) {
        const dx = camPos.x - p.pos.x;
        const dz = camPos.z - p.pos.z;
        const along = dx * p.approachDir.x + dz * p.approachDir.z; // metres out on the approach side
        const angle = along > 50 ? Math.atan2(camPos.y - p.pos.y, along) / DEG : 0;
        p.lamps.forEach((lamp, k) => {
          const threshold = [2.5, 2.83, 3.17, 3.5][k];
          lamp.material.color.setHex(angle > threshold ? 0xffffff : 0xff2a2a);
        });
      }
    }
  }

  dispose() {
    for (const g of this.built.values()) this.scene.remove(g);
    this.built.clear();
  }
}
