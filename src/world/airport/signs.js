import * as THREE from 'three';

// Taxiway guidance signs and terminal banners: one canvas atlas per airport with readable generated
// text (mandatory instruction = white on red, location = yellow on black, direction = black on yellow,
// banner = white on the airport's accent colour). The same canvas feeds the emissive map so the signs
// glow at night.

const CELL_H = 96;
const FONT = 'bold 62px "Arial Narrow", "Helvetica Neue", Arial, Helvetica, sans-serif';

function drawArrow(ctx, x, y, dir, size, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  const s = size;
  if (dir === 'left' || dir === 'right') {
    const k = dir === 'left' ? -1 : 1;
    ctx.moveTo(x - k * s * 0.5, y - s * 0.12); ctx.lineTo(x + k * s * 0.05, y - s * 0.12); ctx.lineTo(x + k * s * 0.05, y - s * 0.36);
    ctx.lineTo(x + k * s * 0.55, y); ctx.lineTo(x + k * s * 0.05, y + s * 0.36); ctx.lineTo(x + k * s * 0.05, y + s * 0.12); ctx.lineTo(x - k * s * 0.5, y + s * 0.12);
  } else {
    ctx.moveTo(x - s * 0.12, y + s * 0.5); ctx.lineTo(x - s * 0.12, y - s * 0.05); ctx.lineTo(x - s * 0.36, y - s * 0.05);
    ctx.lineTo(x, y - s * 0.55); ctx.lineTo(x + s * 0.36, y - s * 0.05); ctx.lineTo(x + s * 0.12, y - s * 0.05); ctx.lineTo(x + s * 0.12, y + s * 0.5);
  }
  ctx.closePath(); ctx.fill();
}

const STYLE = {
  mand: { bg: '#b01e22', fg: '#ffffff', border: '#ffffff' },
  loc: { bg: '#0b0b0c', fg: '#f0c020', border: '#f0c020' },
  dir: { bg: '#f0c020', fg: '#0b0b0c', border: '#0b0b0c' },
};

/**
 * Pack signs into an atlas. `signs`: [{ id, kind: 'mand'|'loc'|'dir'|'banner', text, arrow?, aspect? }].
 * Returns { texture, rects: Map(id -> { u0, v0, u1, v1, aspect }) }.
 */
export function makeSignAtlas(signs, { accent = '#1f5fae' } = {}) {
  const W = 1024;
  // measure
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = FONT;
  const cells = signs.map((s) => {
    if (s.kind === 'banner') { const w = 1024; const h = Math.round(w / (s.aspect ?? 10)); return { s, w, h: Math.max(64, h) }; }
    const tw = probe.measureText(s.text).width;
    const w = Math.round(Math.min(560, Math.max(150, tw + 70 + (s.arrow ? 80 : 0))));
    return { s, w, h: CELL_H };
  });
  // shelf packing
  let x = 0; let y = 0; let rowH = 0;
  for (const c of cells) {
    if (x + c.w > W) { x = 0; y += rowH + 4; rowH = 0; }
    c.x = x; c.y = y; x += c.w + 4; rowH = Math.max(rowH, c.h);
  }
  const H = Math.max(64, y + rowH + 4);
  const hp = 2 ** Math.ceil(Math.log2(H));
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = hp;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#202020'; ctx.fillRect(0, 0, W, hp);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  const rects = new Map();
  for (const c of cells) {
    const { s } = c;
    if (s.kind === 'banner') {
      ctx.fillStyle = s.bg ?? accent; ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(c.x, c.y + c.h - 6, c.w, 6);
      let size = Math.round(c.h * 0.58);
      ctx.font = `bold ${size}px Arial, Helvetica, sans-serif`;
      while (ctx.measureText(s.text).width > c.w * 0.92 && size > 12) { size -= 2; ctx.font = `bold ${size}px Arial, Helvetica, sans-serif`; }
      ctx.fillStyle = '#ffffff'; ctx.fillText(s.text, c.x + c.w / 2, c.y + c.h / 2 + 1);
    } else {
      const st = STYLE[s.kind];
      ctx.fillStyle = st.bg; ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.strokeStyle = st.border; ctx.lineWidth = s.kind === 'loc' ? 5 : 4;
      ctx.strokeRect(c.x + 6, c.y + 6, c.w - 12, c.h - 12);
      ctx.font = FONT; ctx.fillStyle = st.fg;
      const tx = c.x + c.w / 2 + (s.arrow === 'left' ? 34 : s.arrow === 'right' ? -34 : 0);
      ctx.fillText(s.text, tx, c.y + c.h / 2 + 3);
      if (s.arrow) drawArrow(ctx, s.arrow === 'left' ? c.x + 48 : s.arrow === 'right' ? c.x + c.w - 48 : c.x + c.w / 2, c.y + c.h / 2, s.arrow, 46, st.fg);
    }
    rects.set(s.id, { u0: c.x / W, u1: (c.x + c.w) / W, v0: 1 - (c.y + c.h) / hp, v1: 1 - c.y / hp, aspect: c.w / c.h });
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return { texture, rects };
}
