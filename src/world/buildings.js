import * as THREE from 'three';
import { rnd2 as hash2 } from './fields.js';
import { Terrain } from './terrainTiles.js';
import { applyAtmosphere } from '../scene/atmosphere.js';
import { getNoiseTexture } from './noiseTexture.js';

// Instanced buildings. Blocks sit on the same 88 m grid the terrain shader paints streets on. A
// block belongs to a district (downtown towers, mid-rise offices, apartment slabs, commercial,
// industrial, residential houses, parks) chosen from its distance to the city centre and noise.
// Four shared geometries (box, gable, low shed, cylinder) carry every building; walls, windows,
// roofs and the night lighting are drawn in one material from world position, a per-instance wall
// colour (instanceColor) and a per-instance roof colour and kind (iRoof).

export const BLOCK = 88;
export const KIND = { HOUSE: 0, OFFICE: 1, GLASS: 2, SHED: 3, BARN: 4, CONCRETE: 5, STONE: 6, FLAT: 7 };

function indexedBox(rise, ridgeX) {
  // Walls from y = 0 to 1, a gabled roof from 1 to rise. Footprint 1 x 1 centred on the origin,
  // ridge along local X. No floor.
  const p = [];
  const n = [];
  const quad = (a, b, c, d, nn) => { p.push(...a, ...b, ...c, ...a, ...c, ...d); for (let i = 0; i < 6; i++) n.push(...nn); };
  const h = 0.5;
  // walls
  quad([-h, 0, h], [h, 0, h], [h, 1, h], [-h, 1, h], [0, 0, 1]);
  quad([h, 0, -h], [-h, 0, -h], [-h, 1, -h], [h, 1, -h], [0, 0, -1]);
  quad([h, 0, h], [h, 0, -h], [h, 1, -h], [h, 1, h], [1, 0, 0]);
  quad([-h, 0, -h], [-h, 0, h], [-h, 1, h], [-h, 1, -h], [-1, 0, 0]);
  if (rise <= 1) {
    quad([-h, 1, h], [h, 1, h], [h, 1, -h], [-h, 1, -h], [0, 1, 0]);
  } else {
    const k = (rise - 1) / h; // slope of the roof planes
    const nl = Math.hypot(k, 1);
    // ridge along X at y = rise, z = 0: two roof planes (front +z, back -z)
    quad([-h, 1, h], [h, 1, h], [h, rise, 0], [-h, rise, 0], [0, 1 / nl, k / nl]);
    quad([h, 1, -h], [-h, 1, -h], [-h, rise, 0], [h, rise, 0], [0, 1 / nl, -k / nl]);
    // gable ends
    p.push(h, 1, h, h, 1, -h, h, rise, 0); for (let i = 0; i < 3; i++) n.push(1, 0, 0);
    p.push(-h, 1, -h, -h, 1, h, -h, rise, 0); for (let i = 0; i < 3; i++) n.push(-1, 0, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  return g;
}

function cylinder(sides) {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, sides, 1, false).translate(0, 0.5, 0).toNonIndexed();
  g.deleteAttribute('uv');
  return g;
}

let geos = null;
function baseGeometries() {
  if (!geos) {
    geos = {
      box: indexedBox(1),
      gable: indexedBox(1.55),
      shed: indexedBox(1.12),
      cyl: cylinder(12),
    };
    for (const g of Object.values(geos)) g.computeBoundingSphere();
  }
  return geos;
}

let material = null;
export function buildingMaterial() {
  if (material) return material;
  material = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  const uniforms = { uNight: { value: 0 }, uSnow: { value: 0 }, uNoise: { value: getNoiseTexture() } };
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 iRoof;\nvarying vec3 vWPos;\nvarying vec3 vWN;\nvarying vec4 vRoof;\nvarying float vHm;\nvarying float vBaseY;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 bw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        vWPos = bw.xyz;
        vWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * (normal / vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz))));
        vRoof = iRoof;
        vBaseY = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).y;
        vHm = bw.y - vBaseY;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; uniform float uSnow; uniform sampler2D uNoise;
        varying vec3 vWPos; varying vec3 vWN; varying vec4 vRoof; varying float vHm; varying float vBaseY;
        float bh(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float bn(vec2 p, float P){ return texture2D(uNoise, mod(p, P) / P).r; }
        float bwin; float blit; vec3 bglow;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        bwin = 0.0; blit = 0.0;
        float kind = vRoof.w;
        vec3 wall = diffuseColor.rgb;
        vec3 wn = normalize(vWN);
        float roofF = smoothstep(0.25, 0.45, wn.y);
        vec2 pix = fwidth(vWPos.xz) + fwidth(vWPos.y);
        float pixM = max(pix.x, pix.y);
        vec3 col = wall;
        float glassF = 0.0;
        if (roofF < 0.99) {
          vec2 tang = normalize(vec2(-wn.z, wn.x) + vec2(1e-5, 0.0));
          float fh = kind < 0.5 ? 2.8 : kind < 1.5 ? 3.5 : kind < 2.5 ? 3.9 : 4.0;
          float ww = kind < 0.5 ? 2.5 : kind < 1.5 ? 1.8 : 1.5;
          vec2 wc = vec2(dot(vWPos.xz, tang) / ww, vHm / fh);
          vec2 cell = floor(wc);
          vec2 wf = fract(wc);
          float r = bh(cell + floor(vBaseY) * 0.37 + floor(vWPos.xz * 0.02));
          float win = 0.0;
          if (kind < 0.5) { // house: punched windows, a door on the ground floor
            win = step(0.3, wf.x) * step(wf.x, 0.7) * step(0.3, wf.y) * step(wf.y, 0.78) * step(0.15, r);
            if (cell.y < 0.5) win = max(win * 0.0, step(0.38, wf.x) * step(wf.x, 0.62) * step(wf.y, 0.7) * step(0.8, r));
          } else if (kind < 1.5) { // office: ribbon windows
            win = step(0.08, wf.x) * step(wf.x, 0.92) * step(0.28, wf.y) * step(wf.y, 0.82);
          } else if (kind < 2.5) { // glass tower: curtain wall with spandrel bands and mullions
            win = step(0.03, wf.x) * step(wf.x, 0.97) * step(0.12, wf.y) * step(wf.y, 0.86);
            glassF = win;
          } else if (kind < 3.5) { // shed: ribbed cladding, a high window band
            win = step(0.72, wf.y) * step(wf.y, 0.9) * step(0.5, fract(wc.x * 0.25)) * step(3.0, vHm);
            col *= 0.9 + 0.1 * step(0.5, fract(dot(vWPos.xz, tang) * 1.4));
          } else if (kind < 4.5) { // barn: vertical boards
            col *= 0.84 + 0.2 * step(0.5, fract(dot(vWPos.xz, tang) * 3.0));
            win = step(0.4, wf.x) * step(wf.x, 0.6) * step(0.55, wf.y) * step(wf.y, 0.75) * step(0.75, r) * 0.0;
          } else if (kind < 5.5) { // concrete silo/tank rings
            col *= 0.9 + 0.1 * step(0.5, fract(vHm * 0.5));
          } else if (kind < 6.5) { // stone church: narrow tall windows
            win = step(0.4, wf.x) * step(wf.x, 0.6) * step(0.2, wf.y) * step(wf.y, 0.85) * step(0.4, r);
            col *= 0.88 + 0.16 * bn(vWPos.xz + vWPos.y, 11.0);
          }
          col *= 0.9 + 0.2 * bn(vWPos.xz * 0.5 + vWPos.y * 0.3, 37.0) * (1.0 - clamp(pixM / 6.0, 0.0, 1.0));
          // Floor lines on office/glass facades and ground contact shading.
          if (kind > 0.5 && kind < 2.5) col *= 1.0 - 0.18 * step(wf.y, 0.06);
          float vis = 1.0 - clamp(pixM / (kind < 0.5 ? 1.4 : 1.8), 0.0, 1.0);
          vec3 glass = kind > 1.5 && kind < 2.5 ? mix(vec3(0.10, 0.16, 0.20), vec3(0.20, 0.30, 0.36), r) : mix(vec3(0.06, 0.09, 0.12), vec3(0.14, 0.18, 0.22), r);
          float winAvg = kind < 0.5 ? 0.28 : kind < 1.5 ? 0.5 : kind < 2.5 ? 0.82 : 0.1;
          float winEff = mix(winAvg, win, vis);
          col = mix(col, glass, winEff * 0.9);
          if (win > 0.5 && vis > 0.0) { bwin = win; float ls = kind < 0.5 ? 0.32 : kind < 1.5 ? 0.45 : 0.5; blit = step(r * 1.7 - 0.35, ls) * vis; bglow = kind < 0.5 ? vec3(1.0, 0.74, 0.42) : mix(vec3(1.0, 0.8, 0.5), vec3(0.78, 0.88, 1.0), step(0.5, bh(cell + 5.0))); }
          else { bglow = vec3(1.0); }
          col *= mix(0.72, 1.0, smoothstep(0.0, 5.0, vHm));
        } else { bglow = vec3(1.0); }
        // Roofs: tiles / membrane in the instance's roof colour.
        vec3 roofc = vRoof.rgb;
        float tileLines = 0.88 + 0.12 * smoothstep(0.3, 0.7, abs(fract(vHm * 2.4) - 0.5) * 2.0) * (1.0 - clamp(pixM / 0.6, 0.0, 1.0));
        roofc *= (0.86 + 0.28 * bn(vWPos.xz, 53.0)) * mix(1.0, tileLines, step(0.9, 1.0 - wn.y * 0.0) * step(wn.y, 0.995));
        roofc = mix(roofc, roofc * 1.06 + 0.02, step(0.995, wn.y));
        col = mix(col, roofc, roofF);
        col = mix(col, vec3(0.92, 0.95, 1.0), uSnow * smoothstep(0.5, 0.9, wn.y) * 0.9);
        diffuseColor.rgb = col;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.85, 0.1, bwin);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = bwin * 0.55 * (0.4 + 0.6 * step(1.5, vRoof.w) * step(vRoof.w, 2.5));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += bglow * blit * uNight * 0.9;`);
    applyAtmosphere(shader);
  };
  return material;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

const PAL = {
  grass: {
    walls: ['#e6dfd0', '#d9cdb6', '#f0ece2', '#c9b79b', '#d7d1c4', '#b7a58c', '#e8d9b8', '#cfd6d8', '#a8553c', '#9a6a4a'],
    roofs: ['#8c4a38', '#a05a40', '#4c4f57', '#5a4a40', '#6b3b30', '#7a7a7e', '#3f4a40', '#9a5a3a'],
  },
  desert: {
    walls: ['#e8d8b4', '#dcc89a', '#f2e8d0', '#d2b88a', '#e6cfa0', '#cbb38a', '#f6efe0'],
    roofs: ['#e2cfa4', '#d9c394', '#efe2c4', '#c8ad82'],
  },
  snow: {
    walls: ['#8a6a4a', '#9a7a58', '#b8a07c', '#7a5a3c', '#cfc7b8', '#a89070', '#c8b090'],
    roofs: ['#3e3a3a', '#4a2f26', '#5a3c2c', '#34404a', '#6a4a36'],
  },
};
const OFFICE_WALLS = ['#c2bcb0', '#a9a8a4', '#b9b4a8', '#9a9ea3', '#cfc9bb', '#8d949b', '#bbb0a0'];
const GLASS_WALLS = ['#8fa4b6', '#7b93a6', '#9cb0c0', '#6f8798', '#a6b3be', '#86a09a', '#9fa7b3', '#b5a58f'];
const INDUSTRIAL_WALLS = ['#b9bdc0', '#a4a9ad', '#c8c6bd', '#8e9ea8', '#b9a98f', '#9fb0a6'];
const FLAT_ROOFS = ['#6d6f72', '#8a8a86', '#5e6165', '#7a7366'];

const pick = (list, r) => list[Math.floor(r * list.length) % list.length];

/** Smooth value noise from hashes (0..1). */
function vnoise(x, z, cell, seed) {
  const gx = x / cell; const gz = z / cell;
  const ix = Math.floor(gx); const iz = Math.floor(gz);
  const fx = gx - ix; const fz = gz - iz;
  const a = hash2(ix, iz, seed); const b = hash2(ix + 1, iz, seed); const c = hash2(ix, iz + 1, seed); const d = hash2(ix + 1, iz + 1, seed);
  const ux = fx * fx * (3 - 2 * fx); const uz = fz * fz * (3 - 2 * fz);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

const isArterial = (line) => ((Math.round(line) % 4) + 4) % 4 === 0;

/** District of a block. */
export function districtOf(city, bx, bz, seed) {
  const cx = bx * BLOCK + BLOCK / 2;
  const cz = bz * BLOCK + BLOCK / 2;
  const dc = Math.hypot(cx - city.x, cz - city.z) / city.radius;
  const r = hash2(bx, bz, seed);
  const nz = vnoise(cx, cz, 700, seed + 5);
  if (city.kind === 'major') {
    if (dc < 0.1) return r < 0.08 ? 'park' : 'downtown';
    if (dc < 0.19) return r < 0.5 ? 'downtown' : r < 0.58 ? 'park' : 'midrise';
    if (dc < 0.4) return r < 0.07 ? 'park' : nz > 0.58 ? 'apartments' : r < 0.55 ? 'midrise' : 'commercial';
    const ang = Math.atan2(cz - city.z, cx - city.x);
    const sector = vnoise(Math.cos(ang) * 3000, Math.sin(ang) * 3000, 2400, seed + 9);
    if (sector > 0.62 && dc > 0.36 && dc < 0.95) return r < 0.82 ? 'industrial' : 'commercial';
    if (r < 0.045) return 'park';
    if (dc < 0.62 && nz > 0.66) return 'apartments';
    if (dc < 0.55 && r > 0.93) return 'commercial';
    return 'residential';
  }
  if (city.kind === 'town') {
    if (dc < 0.2) return r < 0.4 ? 'midrise' : r < 0.7 ? 'commercial' : 'residential';
    if (dc > 0.55 && nz > 0.8 && r < 0.6) return 'industrial';
    if (r < 0.05) return 'park';
    return 'residential';
  }
  return 'residential';
}

/** Buildings of one block, as items {t: 'box'|'gable'|'shed'|'cyl', x, z, w, d, h, yaw, wall, roof, kind}. */
export function blockBuildings(bx, bz, city, biome, seed, tall, out) {
  const dist = districtOf(city, bx, bz, seed);
  if (dist === 'park') return dist;
  const baseX = bx * BLOCK;
  const baseZ = bz * BLOCK;
  const mL = isArterial(bx) ? 11 : 8;
  const mR = isArterial(bx + 1) ? 11 : 8;
  const mT = isArterial(bz) ? 11 : 8;
  const mB = isArterial(bz + 1) ? 11 : 8;
  const x0 = baseX + mL; const x1 = baseX + BLOCK - mR;
  const z0 = baseZ + mT; const z1 = baseZ + BLOCK - mB;
  const cx = (x0 + x1) / 2; const cz = (z0 + z1) / 2;
  const W = x1 - x0; const D = z1 - z0;
  const cxw = baseX + BLOCK / 2; const czw = baseZ + BLOCK / 2;
  const dc = Math.hypot(cxw - city.x, czw - city.z) / city.radius;
  const R = (k) => hash2(bx * 31 + k, bz * 17 + k * 3, seed + 100 + k);
  const pal = PAL[biome] ?? PAL.grass;
  const add = (it) => { if ((it.h >= 45) === tall) out.push(it); };

  if (dist === 'downtown') {
    const coreK = Math.max(0, 1 - dc / 0.2);
    const hMax = 55 + 205 * R(1) * R(1) * (0.3 + 0.7 * coreK);
    const podW = W * (0.82 + 0.16 * R(2)); const podD = D * (0.82 + 0.16 * R(3));
    const glass = pick(GLASS_WALLS, R(4));
    const podH = 9 + 8 * R(5);
    add({ t: 'box', x: cx, z: cz, w: podW, d: podD, h: podH, yaw: 0, wall: pick(OFFICE_WALLS, R(6)), roof: pick(FLAT_ROOFS, R(7)), kind: KIND.OFFICE });
    const two = R(8) < 0.3;
    const towers = two ? [[-0.25, -0.2, 0.42], [0.25, 0.22, 0.4]] : [[(R(9) - 0.5) * 0.2, (R(10) - 0.5) * 0.2, 0.55 + 0.22 * R(11)]];
    towers.forEach(([ox, oz, fs], i) => {
      const tw = podW * fs; const td = podD * fs * (0.85 + 0.3 * R(12 + i));
      const h = hMax * (i ? 0.7 + 0.25 * R(14) : 1);
      const tx = cx + ox * podW; const tz = cz + oz * podD;
      add({ t: 'box', x: tx, z: tz, w: tw, d: td, h: podH + h, yaw: 0, wall: glass, roof: pick(FLAT_ROOFS, R(15)), kind: KIND.GLASS });
      if (h > 90 && R(16) < 0.6) add({ t: 'box', x: tx, z: tz, w: tw * 0.68, d: td * 0.68, h: podH + h + 10 + 12 * R(17), yaw: 0, wall: glass, roof: pick(FLAT_ROOFS, R(15)), kind: KIND.GLASS });
      if (h > 120 && R(18) < 0.5) add({ t: 'box', x: tx, z: tz, w: 1.4, d: 1.4, h: podH + h + 30 + 40 * R(19), yaw: 0, wall: '#9aa0a6', roof: '#9aa0a6', kind: KIND.CONCRETE });
    });
    return dist;
  }
  if (dist === 'midrise') {
    const n = R(1) < 0.45 ? 1 : 2;
    for (let i = 0; i < n; i++) {
      const fw = n === 1 ? 0.7 + 0.25 * R(2) : 0.42 + 0.1 * R(2 + i);
      const w = W * fw; const d = D * (n === 1 ? 0.65 + 0.3 * R(3) : 0.5 + 0.25 * R(3 + i));
      const x = n === 1 ? cx : cx + (i ? 1 : -1) * W * 0.26;
      const z = n === 1 ? cz + (R(4) - 0.5) * D * 0.1 : cz + (R(5 + i) - 0.5) * D * 0.2;
      const h = 17 + 30 * R(6 + i) * R(7 + i);
      const glass = R(8 + i) < 0.35;
      add({ t: 'box', x, z, w, d, h, yaw: 0, wall: glass ? pick(GLASS_WALLS, R(9)) : pick(OFFICE_WALLS, R(9 + i)), roof: pick(FLAT_ROOFS, R(10)), kind: glass ? KIND.GLASS : KIND.OFFICE });
      if (R(11 + i) < 0.7) add({ t: 'box', x: x + w * 0.1, z: z - d * 0.1, w: w * 0.3, d: d * 0.3, h: h + 3.2, yaw: 0, wall: '#8a8d91', roof: '#8a8d91', kind: KIND.CONCRETE });
    }
    return dist;
  }
  if (dist === 'apartments') {
    const slabs = [[0, -0.34, 1, 0.26], [0, 0.34, 1, 0.26], [-0.38, 0, 0.26, 0.5], [0.38, 0, 0.26, 0.5]];
    const h = 13 + 12 * R(1);
    slabs.forEach(([ox, oz, fw, fd], i) => {
      if (i > 1 && R(2 + i) < 0.4) return;
      add({ t: 'box', x: cx + ox * W, z: cz + oz * D, w: W * fw * 0.94, d: D * fd, h: h * (0.85 + 0.3 * R(6 + i)), yaw: 0, wall: pick(['#d6b995', '#c9a98a', '#d8cfc0', '#b9ad9b', '#cfc4b2', '#b4a58f'], R(10 + i)), roof: pick(FLAT_ROOFS, R(14)), kind: KIND.OFFICE });
    });
    return dist;
  }
  if (dist === 'commercial') {
    const n = 1 + (R(1) < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const w = W * (n === 1 ? 0.8 : 0.45); const d = D * (n === 1 ? 0.6 + 0.25 * R(2) : 0.7);
      add({ t: R(3) < 0.5 ? 'shed' : 'box', x: n === 1 ? cx : cx + (i ? 1 : -1) * W * 0.26, z: cz + (R(4) - 0.5) * D * 0.15, w, d, h: 6.5 + 8 * R(5 + i), yaw: 0, wall: pick(OFFICE_WALLS, R(6 + i)), roof: pick(FLAT_ROOFS, R(7)), kind: R(8) < 0.5 ? KIND.OFFICE : KIND.SHED });
    }
    return dist;
  }
  if (dist === 'industrial') {
    const n = 1 + Math.floor(R(1) * 3);
    for (let i = 0; i < n; i++) {
      const w = W * (0.4 + 0.45 * R(2 + i)); const d = D * (0.3 + 0.3 * R(5 + i));
      const z = z0 + (i + 0.5) * (D / n) * (0.8 + 0.4 * R(9));
      add({ t: 'shed', x: cx + (R(8 + i) - 0.5) * (W - w) * 0.8, z: Math.min(z1 - d / 2, Math.max(z0 + d / 2, z)), w, d, h: 7 + 7 * R(11 + i), yaw: 0, wall: pick(INDUSTRIAL_WALLS, R(12 + i)), roof: pick(['#7b8085', '#8e9396', '#6c7176', '#9a8f80'], R(13 + i)), kind: KIND.SHED });
    }
    if (R(20) < 0.35) {
      const k = 1 + Math.floor(R(21) * 3);
      for (let i = 0; i < k; i++) add({ t: 'cyl', x: x1 - 8 - i * 11, z: z1 - 9, w: 9 + 3 * R(22), d: 9 + 3 * R(22), h: 10 + 14 * R(23 + i), yaw: 0, wall: '#d8d8d4', roof: '#c0c0bc', kind: KIND.CONCRETE });
    }
    if (R(30) < 0.18) add({ t: 'cyl', x: x0 + 10, z: z0 + 9, w: 3.2, d: 3.2, h: 38 + 24 * R(31), yaw: 0, wall: '#a9a29a', roof: '#a9a29a', kind: KIND.CONCRETE });
    return dist;
  }
  // residential: two rows of houses facing the streets
  const dens = city.kind === 'major' ? Math.max(0.2, 1.05 - dc * 0.85) : city.kind === 'town' ? Math.max(0.25, 0.95 - dc * 0.7) : 0.55;
  const flat = biome === 'desert';
  const rows = [[z0 + D * 0.24, 0], [z1 - D * 0.24, Math.PI]];
  for (let row = 0; row < 2; row++) {
    const nLots = city.kind === 'village' ? 3 : 4;
    for (let k = 0; k < nLots; k++) {
      const rr = (j) => hash2(bx * 61 + k * 7 + row * 3 + j, bz * 59 + j, seed + 300);
      if (rr(1) > dens) continue;
      const lotW = W / nLots;
      const w = Math.min(lotW - 3, 8.5 + 4.5 * rr(2));
      const d = 7 + 4 * rr(3);
      const x = x0 + (k + 0.5) * lotW + (rr(4) - 0.5) * 2;
      const z = rows[row][0] + (rr(5) - 0.5) * 3;
      const floors = (rr(6) < (city.kind === 'major' ? 0.4 : 0.2) ? 2 : 1);
      const wallH = 2.7 * floors + 0.4;
      add({
        t: flat ? 'box' : 'gable', x, z, w, d, h: wallH, yaw: rows[row][1] + (rr(7) < 0.5 ? 0 : Math.PI),
        wall: pick(pal.walls, rr(8)), roof: pick(pal.roofs, rr(9)), kind: KIND.HOUSE,
      });
      if (!flat && rr(10) < 0.35) add({ t: 'box', x: x + (rr(11) < 0.5 ? -1 : 1) * (w / 2 + 2.2), z, w: 3.6, d: 5.6, h: 2.6, yaw: 0, wall: pick(pal.walls, rr(12)), roof: '#6d6f72', kind: KIND.HOUSE });
    }
  }
  return dist;
}

function toMeshes(items, ground) {
  const base = baseGeometries();
  const byType = { box: [], gable: [], shed: [], cyl: [] };
  for (const it of items) byType[it.t].push(it);
  const meshes = [];
  for (const [type, list] of Object.entries(byType)) {
    if (!list.length) continue;
    const src = base[type];
    const geo = new THREE.BufferGeometry();
    geo.index = src.index;
    geo.setAttribute('position', src.attributes.position);
    geo.setAttribute('normal', src.attributes.normal);
    const roof = new Float32Array(list.length * 4);
    geo.setAttribute('iRoof', new THREE.InstancedBufferAttribute(roof, 4));
    const mesh = new THREE.InstancedMesh(geo, buildingMaterial(), list.length);
    list.forEach((b, i) => {
      const y = ground(b.x, b.z);
      _q.setFromAxisAngle(UP, b.yaw);
      _p.set(b.x, y - 0.5, b.z);
      _s.set(b.w, b.h + 0.5, b.d);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
      mesh.setColorAt(i, _c.set(b.wall));
      _c.set(b.roof);
      roof[i * 4] = _c.r; roof[i * 4 + 1] = _c.g; roof[i * 4 + 2] = _c.b; roof[i * 4 + 3] = b.kind;
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.userData.btype = type;
    meshes.push(mesh);
  }
  return meshes;
}

/**
 * Low and mid-rise buildings and houses for a tile (towers live in the skyline mesh). Also adds
 * park and garden trees to `batch`. Returns a Group or null.
 */
export function buildCityTile(tile, map, zones, batch, clear) {
  const x0 = Math.floor(tile.x0 / BLOCK);
  const x1 = Math.floor((tile.x0 + tile.size) / BLOCK);
  const z0 = Math.floor(tile.z0 / BLOCK);
  const z1 = Math.floor((tile.z0 + tile.size) / BLOCK);
  const cities = map.cities.filter((c) => c.x + c.radius > tile.x0 && c.x - c.radius < tile.x0 + tile.size && c.z + c.radius > tile.z0 && c.z - c.radius < tile.z0 + tile.size);
  if (!cities.length) return null;
  const items = [];
  const zone = {};
  const seed = map.cfg.seed + 77;
  const biome = map.cfg.biome;
  const treeKind = biome === 'desert' ? 'palm' : biome === 'snow' ? 'spruce' : 'oak';
  for (let bz = z0; bz <= z1; bz++) {
    for (let bx = x0; bx <= x1; bx++) {
      const cx = bx * BLOCK + BLOCK / 2;
      const cz = bz * BLOCK + BLOCK / 2;
      const city = cities.find((c) => Math.hypot(cx - c.x, cz - c.z) < c.radius * 1.05);
      if (!city) continue;
      if (cx < tile.x0 || cx >= tile.x0 + tile.size || cz < tile.z0 || cz >= tile.z0 + tile.size) continue; // each block belongs to one tile
      const h = Terrain.heightIn(tile, cx, cz);
      zones.sample(cx, cz, h, 0.02, zone);
      if (zone.urban < 0.12) continue;
      if (clear.airport(cx, cz, 40) || clear.waterDist(cx, cz) < 50) continue;
      const before = items.length;
      const dist = blockBuildings(bx, bz, city, biome, seed, false, items);
      // Trees in parks and gardens.
      if (batch && batch.count < 1100) {
        const nT = dist === 'park' ? 12 : dist === 'residential' ? 5 : dist === 'apartments' || dist === 'commercial' ? 3 : 0;
        for (let i = 0; i < nT; i++) {
          const tx = bx * BLOCK + 8 + hash2(bx * 13 + i, bz, seed + 50) * (BLOCK - 16);
          const tz = bz * BLOCK + 8 + hash2(bx, bz * 13 + i, seed + 51) * (BLOCK - 16);
          if (dist !== 'park' && items.slice(before).some((b) => Math.abs(b.x - tx) < b.w / 2 + 2 && Math.abs(b.z - tz) < b.d / 2 + 2)) continue;
          batch.add(treeKind, tx, tz, (dist === 'park' ? 0.9 : 0.6) + hash2(i, bx + bz, seed + 52) * 0.5, hash2(i, bx, seed + 53) * 6.28, hash2(i, bz, seed + 54));
        }
      }
    }
  }
  if (!items.length) return null;
  const meshes = toMeshes(items, (x, z) => Terrain.heightIn(tile, x, z));
  const g = new THREE.Group();
  g.userData.kind = 'buildings';
  meshes.forEach((m) => { m.userData.shadowSet = true; m.castShadow = true; m.receiveShadow = true; g.add(m); });
  return g;
}

/** All towers of a city in one mesh, visible from any distance (the skyline). */
export function buildSkyline(map, zones, city) {
  const items = [];
  const zone = {};
  const seed = map.cfg.seed + 77;
  const reach = city.radius * (city.kind === 'major' ? 0.5 : 0.3);
  const b0x = Math.floor((city.x - reach) / BLOCK);
  const b1x = Math.floor((city.x + reach) / BLOCK);
  const b0z = Math.floor((city.z - reach) / BLOCK);
  const b1z = Math.floor((city.z + reach) / BLOCK);
  for (let bz = b0z; bz <= b1z; bz++) {
    for (let bx = b0x; bx <= b1x; bx++) {
      const cx = bx * BLOCK + BLOCK / 2;
      const cz = bz * BLOCK + BLOCK / 2;
      if (Math.hypot(cx - city.x, cz - city.z) > reach) continue;
      zones.sample(cx, cz, map.hf.height(cx, cz), 0.02, zone);
      if (zone.urban < 0.12) continue;
      blockBuildings(bx, bz, city, map.cfg.biome, seed, true, items);
    }
  }
  if (!items.length) return null;
  const meshes = toMeshes(items, (x, z) => map.hf.height(x, z));
  const g = new THREE.Group();
  meshes.forEach((m) => { m.userData.shadowSet = true; m.castShadow = true; m.receiveShadow = true; g.add(m); });
  g.userData.kind = 'skyline';
  return g;
}

export { toMeshes as buildingMeshes };
