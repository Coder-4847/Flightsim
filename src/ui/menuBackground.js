import { mulberry32 } from '../util/random.js';

// The animated backdrop behind the menus: a golden-hour sky with drifting clouds, four layers of
// mountain ridges moving at different speeds and a small airliner that crosses now and then,
// leaving a contrail. It is drawn on a 2D canvas at 30 frames per second, only while a menu is
// visible, and as a single still frame when "Reduce motion" is on.

const W = 960;
const H = 540;
const rnd = mulberry32(20261014);

function ridge(width, height, base, amp, rough, color, seed) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const g = c.getContext('2d');
  const r = mulberry32(seed);
  // Midpoint displacement on a looping profile.
  const n = 256;
  let pts = new Float32Array(n + 1);
  pts[0] = pts[n] = 0;
  let step = n;
  let scale = 1;
  while (step > 1) {
    const half = step / 2;
    for (let i = half; i < n; i += step) pts[i] = (pts[i - half] + pts[i + half]) / 2 + (r() - 0.5) * scale;
    scale *= rough;
    step = half;
  }
  let lo = Infinity; let hi = -Infinity;
  for (const v of pts) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  g.beginPath();
  g.moveTo(0, height);
  for (let x = 0; x <= width; x++) {
    const t = (x / width) * n;
    const i = Math.floor(t);
    const f = t - i;
    const v = (pts[i] * (1 - f) + pts[Math.min(n, i + 1)] * f - lo) / (hi - lo || 1);
    g.lineTo(x, base - v * amp);
  }
  g.lineTo(width, height);
  g.closePath();
  const grad = g.createLinearGradient(0, base - amp, 0, height);
  grad.addColorStop(0, color[0]);
  grad.addColorStop(1, color[1]);
  g.fillStyle = grad;
  g.fill();
  return c;
}

function cloudStrip(width, height, count, seed, tint) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const g = c.getContext('2d');
  const r = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const x = r() * width;
    const y = height * (0.15 + r() * 0.7);
    const w = 90 + r() * 220;
    const hh = 14 + r() * 26;
    for (const dx of [0, width, -width]) {
      const grad = g.createRadialGradient(x + dx, y, 0, x + dx, y, w);
      grad.addColorStop(0, `rgba(${tint}, ${0.16 + r() * 0.16})`);
      grad.addColorStop(1, `rgba(${tint}, 0)`);
      g.save();
      g.translate(x + dx, y);
      g.scale(1, hh / w);
      g.translate(-(x + dx), -y);
      g.fillStyle = grad;
      g.beginPath(); g.arc(x + dx, y, w, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  }
  return c;
}

export function createMenuBackground({ settings }) {
  const canvas = document.createElement('canvas');
  canvas.id = 'menu-bg';
  canvas.width = W; canvas.height = H;
  canvas.setAttribute('aria-hidden', 'true');
  const g = canvas.getContext('2d');

  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#070d1d');
  sky.addColorStop(0.38, '#12294a');
  sky.addColorStop(0.62, '#2e4a6e');
  sky.addColorStop(0.8, '#b0725a');
  sky.addColorStop(0.92, '#f0a56a');
  sky.addColorStop(1, '#f7c58a');
  const stars = Array.from({ length: 70 }, () => ({ x: rnd() * W, y: rnd() * H * 0.45, a: 0.25 + rnd() * 0.6, p: rnd() * 6 }));
  const layers = [
    { img: cloudStrip(W * 2, 200, 14, 11, '255, 214, 190'), speed: 5, y: 150 },
    { img: ridge(W * 2, 300, 150, 120, 0.55, ['#5a5d78', '#2a2f48'], 3), speed: 6, y: H - 300 },
    { img: ridge(W * 2, 300, 170, 150, 0.52, ['#3b4160', '#1b2036'], 7), speed: 11, y: H - 280 },
    { img: cloudStrip(W * 2, 200, 10, 23, '230, 190, 175'), speed: 16, y: 250 },
    { img: ridge(W * 2, 300, 190, 150, 0.5, ['#252a45', '#10131f'], 13), speed: 24, y: H - 250 },
    { img: ridge(W * 2, 300, 215, 110, 0.5, ['#14172a', '#07080f'], 29), speed: 40, y: H - 220 },
  ];
  const plane = { x: -200, y: 120, speed: 38, active: false, wait: 6, trail: [] };

  function drawPlane(t) {
    g.save();
    g.translate(plane.x, plane.y);
    g.rotate(-0.07);
    g.fillStyle = 'rgba(10, 14, 24, 0.95)';
    // Fuselage, wings, tail: a small airliner in silhouette.
    g.beginPath(); g.ellipse(0, 0, 26, 3.2, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(-4, 0); g.lineTo(-17, 15); g.lineTo(-11, 15); g.lineTo(5, 0); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(-22, 0); g.lineTo(-28, -10); g.lineTo(-24, -10); g.lineTo(-16, 0); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(-20, 0); g.lineTo(-27, 5); g.lineTo(-23, 5); g.lineTo(-15, 0); g.closePath(); g.fill();
    if (Math.floor(t * 1.4) % 2 === 0) { g.fillStyle = '#ff5050'; g.fillRect(-1, -4.6, 2, 2); }
    g.restore();
  }

  let last = 0;
  let time = 0;
  let running = false;
  let acc = 0;

  function frame(dt) {
    time += dt;
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // Sun glow low on the horizon.
    const sun = g.createRadialGradient(W * 0.72, H * 0.84, 0, W * 0.72, H * 0.84, 340);
    sun.addColorStop(0, 'rgba(255, 220, 160, 0.75)');
    sun.addColorStop(0.35, 'rgba(255, 170, 110, 0.25)');
    sun.addColorStop(1, 'rgba(255, 140, 90, 0)');
    g.fillStyle = sun;
    g.fillRect(0, 0, W, H);
    for (const s of stars) {
      g.fillStyle = `rgba(255, 255, 255, ${s.a * (0.7 + 0.3 * Math.sin(time * 0.8 + s.p))})`;
      g.fillRect(s.x, s.y, 1.4, 1.4);
    }
    // Aircraft (behind the near ridges).
    if (!plane.active) {
      plane.wait -= dt;
      if (plane.wait <= 0) { plane.active = true; plane.x = -60; plane.y = 70 + rnd() * 90; plane.speed = 34 + rnd() * 14; plane.trail = []; }
    } else {
      plane.x += plane.speed * dt;
      plane.y -= dt * 2.2;
      plane.trail.push({ x: plane.x - 28, y: plane.y + 1, t: time });
      if (plane.x > W + 120) { plane.active = false; plane.wait = 14 + rnd() * 16; }
    }
    layers.forEach((l, i) => {
      if (i === 3 && plane.active) {
        // Contrail, then the aircraft, drawn between the far and near layers.
        g.lineCap = 'round';
        for (let k = 1; k < plane.trail.length; k++) {
          const a = plane.trail[k - 1]; const b = plane.trail[k];
          const age = time - b.t;
          const alpha = Math.max(0, 0.5 - age * 0.04);
          if (alpha <= 0) continue;
          g.strokeStyle = `rgba(255, 235, 215, ${alpha})`;
          g.lineWidth = 1.5 + age * 0.35;
          g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        }
        drawPlane(time);
      }
      const tile = l.img.width;
      const off = (time * l.speed) % tile;
      g.drawImage(l.img, -off, l.y);
      g.drawImage(l.img, tile - off, l.y);
    });
    while (plane.trail.length && time - plane.trail[0].t > 12) plane.trail.shift();
    // Vignette.
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.75);
    v.addColorStop(0, 'rgba(0, 0, 0, 0)');
    v.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
  }

  function tick(now) {
    if (!running) return;
    requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    if (acc < 1 / 30) return;
    frame(acc);
    acc = 0;
  }

  const api = {
    canvas,
    /** Show and animate (or just draw one still frame when motion is reduced). */
    show(on, moving = true) {
      canvas.hidden = !on;
      this.wanted = { on, moving };
      const animate = on && moving && !settings.get('reduceMotion');
      if (on && !animate) frame(0.016);
      if (animate && !running) { running = true; last = performance.now(); requestAnimationFrame(tick); }
      if (!animate) running = false;
    },
  };
  settings.on('change', ({ key }) => { if (key === 'reduceMotion' && api.wanted) api.show(api.wanted.on, api.wanted.moving); });
  frame(0);
  canvas.hidden = true;
  return api;
}
