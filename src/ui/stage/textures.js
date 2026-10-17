import * as THREE from 'three';
import { mulberry32 } from '../../util/random.js';

// Small procedural textures shared by the menu and hangar scenes. Everything is drawn on 2D canvases.

const make = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
};
const tex = (c, srgb = true) => {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

/** A soft, lumpy cloud puff (white with alpha) in four variants. */
export function cloudTextures() {
  return [1, 2, 3, 4].map((seed) => {
    const [c, g] = make(256, 160);
    const r = mulberry32(seed * 97);
    g.clearRect(0, 0, 256, 160);
    const lumps = 9 + Math.floor(r() * 5);
    for (let i = 0; i < lumps; i++) {
      const x = 50 + r() * 156;
      const y = 70 + (r() - 0.35) * 46;
      const rad = 26 + r() * 40;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.62, 'rgba(255,255,255,0.9)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    }
    // Sunlit top, blue-grey shaded underside: the colour comes from the texture, the sprite tint only warms or cools it.
    const shade = g.createLinearGradient(0, 35, 0, 140);
    shade.addColorStop(0, 'rgb(255,242,226)');
    shade.addColorStop(0.55, 'rgb(205,200,225)');
    shade.addColorStop(1, 'rgb(112,128,186)');
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = shade;
    g.fillRect(0, 0, 256, 160);
    g.globalCompositeOperation = 'source-over';
    return tex(c);
  });
}

/** Radial glow (sun, lamps). */
export function glowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.25)') {
  const [c, g] = make(256, 256);
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.18, mid);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return tex(c);
}

/** Polished concrete: dark slate with expansion joints every `cell` pixels and faint wear. */
export function floorTexture() {
  const [c, g] = make(1024, 1024);
  const r = mulberry32(5);
  g.fillStyle = '#1a2332';
  g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.006 + r() * 0.014})`;
    const s = 6 + r() * 60;
    g.fillRect(r() * 1024, r() * 1024, s, s * (0.3 + r()));
  }
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 2;
  for (let i = 0; i <= 1024; i += 512) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 1024); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(1024, i); g.stroke();
  }
  g.strokeStyle = 'rgba(120,170,230,0.07)';
  g.lineWidth = 1;
  for (let i = 4; i <= 1024; i += 512) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 1024); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(1024, i); g.stroke();
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** The big window wall behind the aircraft: a sunset sky split into panes by dark mullions. */
export function windowWallTexture() {
  const [c, g] = make(2048, 512);
  const sky = g.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#16275a');
  sky.addColorStop(0.35, '#3d5ea8');
  sky.addColorStop(0.62, '#e58a73');
  sky.addColorStop(0.85, '#ffc58a');
  sky.addColorStop(1, '#ffe2b0');
  g.fillStyle = sky;
  g.fillRect(0, 0, 2048, 512);
  const r = mulberry32(31);
  for (let i = 0; i < 26; i++) {
    const x = r() * 2048; const y = 220 + r() * 220; const w = 90 + r() * 260;
    const grad = g.createRadialGradient(x, y, 0, x, y, w);
    grad.addColorStop(0, 'rgba(255,205,170,0.45)');
    grad.addColorStop(1, 'rgba(255,205,170,0)');
    g.save(); g.translate(x, y); g.scale(1, 0.16); g.translate(-x, -y);
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, w, 0, Math.PI * 2); g.fill(); g.restore();
  }
  // Distant mountains.
  g.fillStyle = 'rgba(48,40,86,0.85)';
  g.beginPath(); g.moveTo(0, 512);
  for (let x = 0; x <= 2048; x += 16) g.lineTo(x, 430 - 38 * Math.abs(Math.sin(x * 0.006 + 1)) - 22 * Math.sin(x * 0.021) - 10 * r());
  g.lineTo(2048, 512); g.closePath(); g.fill();
  // Mullions.
  g.fillStyle = '#05080f';
  for (let x = 0; x <= 2048; x += 256) g.fillRect(x - 5, 0, 10, 512);
  for (const y of [170, 340]) g.fillRect(0, y - 4, 2048, 8);
  g.fillRect(0, 0, 2048, 10);
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Floor decal for a bay: the aircraft's name in large letters with a thin frame. */
export function bayDecal(name, sub, accent = '#3cc0ff') {
  const [c, g] = make(1024, 256);
  g.clearRect(0, 0, 1024, 256);
  g.fillStyle = 'rgba(255,255,255,0.0)';
  g.fillRect(0, 0, 1024, 256);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.font = '800 120px Inter, "Segoe UI", system-ui, sans-serif';
  g.fillStyle = 'rgba(214,232,255,0.82)';
  g.fillText(name.toUpperCase(), 30, 102);
  g.font = '600 40px Inter, "Segoe UI", system-ui, sans-serif';
  g.fillStyle = accent;
  g.fillText(sub.toUpperCase(), 34, 196);
  g.fillStyle = accent;
  g.fillRect(30, 18, 150, 6);
  return tex(c);
}
