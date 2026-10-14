import { buildMap } from '../world/mapBuilder.js';
import { MAP_HALF, MAP_LIST } from '../world/maps.js';
import { h } from './dom.js';

// Map picker: one card per map with a relief preview drawn from the generated world itself.

const PREVIEW = 176;

function drawPreview(canvas, map) {
  const ctx = canvas.getContext('2d');
  canvas.width = PREVIEW;
  canvas.height = PREVIEW;
  const img = ctx.createImageData(PREVIEW, PREVIEW);
  const cell = (MAP_HALF * 2) / PREVIEW;
  const hts = new Float32Array((PREVIEW + 2) * (PREVIEW + 2));
  const G = PREVIEW + 2;
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const v = map.hf.height(-MAP_HALF + (i - 0.5) * cell, -MAP_HALF + (j - 0.5) * cell);
      hts[j * G + i] = v;
      if (i && j && i < G - 1 && j < G - 1) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
  }
  const palette = {
    grass: [[78, 118, 56], [150, 150, 90], [235, 238, 240]],
    desert: [[205, 170, 110], [190, 130, 80], [240, 225, 200]],
    snow: [[96, 104, 96], [150, 155, 160], [246, 249, 252]],
  }[map.cfg.biome];
  for (let j = 0; j < PREVIEW; j++) {
    for (let i = 0; i < PREVIEW; i++) {
      const k = (j + 1) * G + (i + 1);
      const t = (hts[k] - lo) / (hi - lo + 1);
      const dx = hts[k + 1] - hts[k - 1];
      const dz = hts[k + G] - hts[k - G];
      const shade = Math.max(0.55, Math.min(1.35, 1 + (dx + dz) / 1400));
      const a = t < 0.5 ? palette[0] : palette[1];
      const b = t < 0.5 ? palette[1] : palette[2];
      const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
      const o = (j * PREVIEW + i) * 4;
      for (let c = 0; c < 3; c++) img.data[o + c] = Math.min(255, (a[c] + (b[c] - a[c]) * u) * shade);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const px = (v) => ((v + MAP_HALF) / (MAP_HALF * 2)) * PREVIEW;
  // Water, rivers, roads, towns, airports.
  ctx.fillStyle = map.cfg.biome === 'snow' ? '#cfe3f5' : '#4a90c8';
  for (const l of map.lakes) { ctx.beginPath(); ctx.arc(px(l.x), px(l.z), Math.max(1.5, l.radius / (MAP_HALF * 2) * PREVIEW), 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = map.cfg.biome === 'snow' ? '#cfe3f5' : '#4a90c8';
  ctx.lineWidth = 1.2;
  for (const line of map.riverLines) { ctx.beginPath(); line.points.forEach((p, i) => (i ? ctx.lineTo(px(p.x), px(p.z)) : ctx.moveTo(px(p.x), px(p.z)))); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(40,40,44,0.55)';
  ctx.lineWidth = 0.7;
  for (const road of map.roads) { ctx.beginPath(); road.points.forEach((p, i) => (i ? ctx.lineTo(px(p.x), px(p.z)) : ctx.moveTo(px(p.x), px(p.z)))); ctx.stroke(); }
  for (const c of map.cities) {
    ctx.fillStyle = 'rgba(60,60,66,0.85)';
    ctx.beginPath(); ctx.arc(px(c.x), px(c.z), c.kind === 'major' ? 4 : c.kind === 'town' ? 2.4 : 1.4, 0, Math.PI * 2); ctx.fill();
  }
  for (const a of map.airports) {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0b0f14';
    ctx.lineWidth = 1;
    const r = a.cls === 'hub' ? 4 : a.cls === 'regional' ? 3 : 2;
    ctx.beginPath(); ctx.moveTo(px(a.x), px(a.z) - r); ctx.lineTo(px(a.x) + r, px(a.z)); ctx.lineTo(px(a.x), px(a.z) + r); ctx.lineTo(px(a.x) - r, px(a.z)); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
}

export function createMapSelect({ onSelect, onBack }) {
  const grid = h('div.map-grid');
  const drawn = new Set();
  const cards = MAP_LIST.map((cfg) => {
    const canvas = h('canvas.map-preview');
    const card = h('button.map-card', { type: 'button', dataset: { id: cfg.id }, onclick: () => onSelect(cfg.id) },
      canvas,
      h('span.ac-class', cfg.biome === 'grass' ? 'Temperate' : cfg.biome === 'desert' ? 'Arid' : 'Alpine'),
      h('span.ac-name', cfg.name),
      h('span.ac-blurb', cfg.blurb),
      h('span.ac-stats', h('span', '120 × 120 km'), h('span.map-counts', '…')),
    );
    grid.append(card);
    return { cfg, canvas, card };
  });
  const el = h('section.select-screen',
    h('div.select-card',
      h('header.settings-head', h('h2', 'Choose a map'), h('button.btn.small', { onclick: onBack }, 'Back')),
      h('div.select-body', grid, h('p.help', 'Every map is generated from a fixed seed, so the terrain, towns and airports are identical each time. Previews show relief, roads, lakes, towns (grey dots) and airports (white diamonds).')),
    ),
  );
  // Draw previews lazily the first time the screen opens (world generation takes a moment).
  el.refresh = () => {
    for (const { cfg, canvas, card } of cards) {
      if (drawn.has(cfg.id)) continue;
      drawn.add(cfg.id);
      const map = buildMap(cfg.id);
      drawPreview(canvas, map);
      card.querySelector('.map-counts').textContent = `${map.airports.length} airports · ${map.cities.filter((c) => c.kind !== 'village').length} cities`;
    }
  };
  return el;
}
