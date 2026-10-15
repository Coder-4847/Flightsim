// Canvas 2D instrument painters used by every cockpit. All draw into a given context, in
// pixels, from the telemetry snapshot produced by FlightModel.telemetry.

const DEG = Math.PI / 180;
export const COLORS = {
  panel: '#15181d', bezel: '#07090b', face: '#0d1014', white: '#eef1f4', dim: '#8d96a1',
  green: '#37d67a', yellow: '#f2c230', red: '#ef4b4b', cyan: '#4cc2ff', sky: '#2f78c2', ground: '#7a5a34', amber: '#ffb000',
};

const NORMAL_COLORS = { green: COLORS.green, yellow: COLORS.yellow, red: COLORS.red, amber: COLORS.amber };
const CVD_COLORS = { green: '#56b4e9', yellow: '#f0e442', red: '#ff8a3d', amber: '#f0e442' };
/** Swap the red/green status colours of every instrument for a colour-blind safe set (and back). */
export function setColorBlind(on) {
  Object.assign(COLORS, on ? CVD_COLORS : NORMAL_COLORS);
}

const polar = (cx, cy, r, deg) => [cx + r * Math.sin(deg * DEG), cy - r * Math.cos(deg * DEG)];

export function bezel(ctx, cx, cy, r) {
  ctx.fillStyle = COLORS.bezel;
  ctx.beginPath(); ctx.arc(cx, cy, r + 5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#2b3037'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, r + 4, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = COLORS.face;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
}

/** Tick marks and labels for a circular scale sweeping a0..a1 degrees clockwise from 12 o'clock. */
export function scale(ctx, cx, cy, r, o) {
  const { min, max, a0, a1, major, minor = 0, labelEvery = 1, label = (v) => v, font = 'bold 13px Arial', len = 0.12 } = o;
  ctx.strokeStyle = COLORS.white; ctx.fillStyle = COLORS.white;
  ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const angle = (v) => a0 + ((v - min) / (max - min)) * (a1 - a0);
  if (minor) {
    ctx.lineWidth = 1;
    for (let v = min; v <= max + 1e-6; v += minor) {
      const [x0, y0] = polar(cx, cy, r * (1 - len * 0.5), angle(v));
      const [x1, y1] = polar(cx, cy, r * 0.97, angle(v));
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
  }
  let i = 0;
  ctx.lineWidth = 2;
  for (let v = min; v <= max + 1e-6; v += major, i++) {
    const [x0, y0] = polar(cx, cy, r * (1 - len), angle(v));
    const [x1, y1] = polar(cx, cy, r * 0.97, angle(v));
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    if (i % labelEvery === 0) {
      const [tx, ty] = polar(cx, cy, r * (1 - len - 0.17), angle(v));
      ctx.fillText(String(label(v)), tx, ty);
    }
  }
}

export function arc(ctx, cx, cy, r, width, a0, a1, color) {
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(cx, cy, r, (a0 - 90) * DEG, (a1 - 90) * DEG);
  ctx.stroke();
}

export function needle(ctx, cx, cy, length, deg, { width = 3, color = COLORS.white, tail = 0.15 } = {}) {
  const [x1, y1] = polar(cx, cy, length, deg);
  const [x0, y0] = polar(cx, cy, -length * tail, deg);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(cx, cy, width * 1.4, 0, Math.PI * 2); ctx.fill();
}

export function title(ctx, text, cx, y, size = 11, color = COLORS.dim) {
  ctx.fillStyle = color; ctx.font = `${size}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, y);
}

// ---- individual round instruments ------------------------------------------------------------
export function airspeedDial(ctx, cx, cy, r, t, spec) {
  bezel(ctx, cx, cy, r);
  const vne = spec.limits.vne;
  const max = Math.ceil((vne * 1.08) / 20) * 20;
  const a0 = 30; const a1 = 330;
  const ang = (v) => a0 + (v / max) * (a1 - a0);
  const s = spec.flaps.stages;
  const vs0 = s.at(-1).vs; const vs1 = s[0].vs;
  const vfe = spec.speeds.vfe ?? vne * 0.5; const vno = spec.speeds.vno ?? vne * 0.8;
  arc(ctx, cx, cy, r * 0.86, 5, ang(vs0), ang(vfe), COLORS.white);
  arc(ctx, cx, cy, r * 0.8, 5, ang(vs1), ang(vno), COLORS.green);
  arc(ctx, cx, cy, r * 0.8, 5, ang(vno), ang(vne), COLORS.yellow);
  const [rx0, ry0] = polar(cx, cy, r * 0.72, ang(vne)); const [rx1, ry1] = polar(cx, cy, r * 0.95, ang(vne));
  ctx.strokeStyle = COLORS.red; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(rx0, ry0); ctx.lineTo(rx1, ry1); ctx.stroke();
  scale(ctx, cx, cy, r, { min: 0, max, a0, a1, major: max > 300 ? 50 : 20, minor: max > 300 ? 10 : 5, labelEvery: 1, font: `bold ${Math.round(r * 0.14)}px Arial`, len: 0.1 });
  title(ctx, 'AIRSPEED', cx, cy - r * 0.38); title(ctx, 'KNOTS', cx, cy + r * 0.4);
  needle(ctx, cx, cy, r * 0.82, ang(Math.min(t.ias, max)), { width: 3 });
}

export function attitudeDial(ctx, cx, cy, r, t) {
  bezel(ctx, cx, cy, r);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r - 1, 0, Math.PI * 2); ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-t.bank * DEG);
  const k = r / 28; // pixels per degree of pitch
  const off = t.pitch * k;
  ctx.fillStyle = COLORS.sky; ctx.fillRect(-r * 2, -r * 2 + off, r * 4, r * 2);
  ctx.fillStyle = COLORS.ground; ctx.fillRect(-r * 2, off, r * 4, r * 2);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-r * 2, off); ctx.lineTo(r * 2, off); ctx.stroke();
  ctx.font = `${Math.round(r * 0.12)}px Arial`; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let p = -30; p <= 30; p += 10) {
    if (!p) continue;
    const y = off - p * k; const w = p % 20 === 0 ? r * 0.38 : r * 0.22;
    ctx.beginPath(); ctx.moveTo(-w, y); ctx.lineTo(w, y); ctx.stroke();
    if (p % 20 === 0) { ctx.fillText(Math.abs(p), -w - 12, y); ctx.fillText(Math.abs(p), w + 12, y); }
  }
  // Bank scale rotates with the horizon.
  for (const b of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const [x0, y0] = polar(0, 0, r * 0.9, b); const [x1, y1] = polar(0, 0, r * (b % 30 === 0 ? 0.78 : 0.84), b);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  ctx.restore();
  // Fixed aircraft symbol and bank pointer.
  ctx.strokeStyle = COLORS.amber; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(cx - r * 0.55, cy); ctx.lineTo(cx - r * 0.18, cy); ctx.lineTo(cx - r * 0.18, cy + r * 0.08);
  ctx.moveTo(cx + r * 0.55, cy); ctx.lineTo(cx + r * 0.18, cy); ctx.lineTo(cx + r * 0.18, cy + r * 0.08); ctx.stroke();
  ctx.fillStyle = COLORS.amber; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.9); ctx.lineTo(cx - 6, cy - r * 0.78); ctx.lineTo(cx + 6, cy - r * 0.78); ctx.fill();
}

export function altimeterDial(ctx, cx, cy, r, t) {
  bezel(ctx, cx, cy, r);
  scale(ctx, cx, cy, r, { min: 0, max: 10, a0: 0, a1: 360 - 36, major: 1, minor: 0.5, label: (v) => v, font: `bold ${Math.round(r * 0.18)}px Arial` });
  title(ctx, 'ALT', cx, cy - r * 0.4); title(ctx, 'FEET', cx, cy + r * 0.44);
  const alt = Math.max(0, t.altitudeFt);
  needle(ctx, cx, cy, r * 0.5, (alt / 10000) * 360, { width: 4, tail: 0.05 });
  needle(ctx, cx, cy, r * 0.62, ((alt % 10000) / 1000) * 36, { width: 5, tail: 0.1 });
  needle(ctx, cx, cy, r * 0.84, ((alt % 1000) / 1000) * 360, { width: 2, color: COLORS.amber });
}

export function vsiDial(ctx, cx, cy, r, t) {
  bezel(ctx, cx, cy, r);
  // Scale in units of 100 ft/min: zero at 9 o'clock, +20 swinging over the top, -20 under the bottom.
  scale(ctx, cx, cy, r, {
    min: -20, max: 20, a0: 100, a1: 440, major: 5, minor: 1, labelEvery: 1,
    label: (v) => (v === 0 ? '0' : String(Math.abs(v) / 10)), font: `bold ${Math.round(r * 0.15)}px Arial`,
  });
  title(ctx, 'VERTICAL SPEED', cx, cy - r * 0.3, 9); title(ctx, '1000 FPM', cx, cy + r * 0.45, 9);
  const v = Math.max(-20, Math.min(20, t.vsFpm / 100));
  needle(ctx, cx, cy, r * 0.82, 100 + ((v + 20) / 40) * 340, { width: 3, tail: 0.1 });
}

export function headingDial(ctx, cx, cy, r, t) {
  bezel(ctx, cx, cy, r);
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(-t.heading * DEG);
  scale(ctx, 0, 0, r * 0.97, {
    min: 0, max: 350, a0: 0, a1: 350, major: 10, minor: 5, labelEvery: 3, len: 0.1,
    label: (v) => ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[v] ?? v / 10), font: `bold ${Math.round(r * 0.15)}px Arial`,
  });
  if (t.wpt) {
    // The active waypoint rides the compass card as a magenta bug.
    ctx.rotate(t.wpt.brg * DEG);
    ctx.fillStyle = '#ff5dd0'; ctx.strokeStyle = '#2a0020'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -r * 0.99); ctx.lineTo(r * 0.09, -r * 0.8); ctx.lineTo(0, -r * 0.7); ctx.lineTo(-r * 0.09, -r * 0.8); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -r * 0.7); ctx.lineTo(0, -r * 0.35); ctx.stroke();
  }
  ctx.restore();
  if (t.wpt) { ctx.fillStyle = '#ff5dd0'; ctx.font = `bold ${Math.round(r * 0.13)}px Arial`; ctx.textAlign = 'center'; ctx.fillText(`${t.wpt.name} ${(t.wpt.dist / 1852).toFixed(1)}nm`, cx, cy + r * 0.5); }
  ctx.fillStyle = COLORS.amber;
  ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.28); ctx.lineTo(cx - 9, cy + r * 0.12); ctx.lineTo(cx, cy + r * 0.05); ctx.lineTo(cx + 9, cy + r * 0.12); ctx.fill();
  ctx.fillStyle = COLORS.white; ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.97); ctx.lineTo(cx - 5, cy - r * 0.85); ctx.lineTo(cx + 5, cy - r * 0.85); ctx.fill();
}

export function turnCoordinator(ctx, cx, cy, r, t) {
  bezel(ctx, cx, cy, r);
  const turn = (9.81 * Math.tan(t.bank * DEG)) / Math.max(t.tas * 0.514, 20); // rad/s
  const tilt = Math.max(-1, Math.min(1, turn / (3 * DEG))) * 30; // standard rate = 3 deg/s => 30 deg
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(tilt * DEG);
  ctx.fillStyle = COLORS.white;
  ctx.fillRect(-r * 0.7, -2, r * 1.4, 4); ctx.fillRect(-3, -r * 0.3, 6, r * 0.3);
  ctx.beginPath(); ctx.moveTo(-r * 0.12, 0); ctx.lineTo(0, r * 0.12); ctx.lineTo(r * 0.12, 0); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = COLORS.white; ctx.lineWidth = 2;
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + s * r * 0.8, cy - 2); ctx.lineTo(cx + s * r * 0.95, cy - 2 - (s * 0)); ctx.stroke(); }
  // Inclinometer ball.
  const ballX = Math.max(-1, Math.min(1, -t.beta / 8)) * r * 0.32;
  ctx.fillStyle = '#111'; ctx.beginPath(); ctx.roundRect(cx - r * 0.45, cy + r * 0.5, r * 0.9, r * 0.2, 8); ctx.fill();
  ctx.fillStyle = COLORS.white; ctx.beginPath(); ctx.arc(cx + ballX, cy + r * 0.6, r * 0.08, 0, Math.PI * 2); ctx.fill();
  title(ctx, 'TURN COORDINATOR', cx, cy - r * 0.55, 9);
}

export function simpleGauge(ctx, cx, cy, r, { label, unit, value, min, max, major, bands = [], format = (v) => v, labelEvery = 1, a0 = 40, a1 = 320 }) {
  bezel(ctx, cx, cy, r);
  const ang = (v) => a0 + ((v - min) / (max - min)) * (a1 - a0);
  for (const b of bands) arc(ctx, cx, cy, r * 0.86, 5, ang(b.from), ang(b.to), b.color);
  scale(ctx, cx, cy, r, { min, max, a0, a1, major, minor: major / 2, labelEvery, label: format, font: `bold ${Math.round(r * 0.15)}px Arial` });
  title(ctx, label, cx, cy - r * 0.35, Math.max(9, r * 0.14)); title(ctx, unit, cx, cy + r * 0.42, Math.max(8, r * 0.12));
  needle(ctx, cx, cy, r * 0.78, ang(Math.max(min, Math.min(max, value))), { width: 3, tail: 0.1 });
}

export function led(ctx, x, y, w, h, text, color = COLORS.green) {
  ctx.fillStyle = '#050607'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#2b3037'; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = color; ctx.font = `bold ${Math.round(h * 0.6)}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2 + 1);
}

export function annunciator(ctx, x, y, w, h, text, on, color = COLORS.amber) {
  ctx.fillStyle = on ? color : '#1b1d21'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#000'; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = on ? '#150f00' : '#4a4f56'; ctx.font = `bold ${Math.round(h * 0.42)}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2);
}

// ---- glass cockpit displays --------------------------------------------------------------------
/** Primary flight display: attitude, airspeed and altitude tapes, heading, vertical speed, flaps. */
export function pfd(ctx, w, h, t, spec) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  const cx = w / 2; const cy = h * 0.46;
  ctx.save();
  ctx.beginPath(); ctx.rect(w * 0.16, 0, w * 0.68, h * 0.9); ctx.clip();
  ctx.translate(cx, cy); ctx.rotate(-t.bank * DEG);
  const k = h / 38; const off = t.pitch * k;
  ctx.fillStyle = '#2d73c4'; ctx.fillRect(-w, -h * 2 + off, w * 2, h * 2);
  ctx.fillStyle = '#7b5a35'; ctx.fillRect(-w, off, w * 2, h * 2);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.fillStyle = '#fff'; ctx.font = `${Math.round(h * 0.04)}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.beginPath(); ctx.moveTo(-w, off); ctx.lineTo(w, off); ctx.stroke();
  for (let p = -30; p <= 30; p += 5) {
    if (!p) continue;
    const y = off - p * k; const ww = p % 10 === 0 ? w * 0.09 : w * 0.045;
    ctx.beginPath(); ctx.moveTo(-ww, y); ctx.lineTo(ww, y); ctx.stroke();
    if (p % 10 === 0) { ctx.fillText(Math.abs(p), -ww - 18, y); ctx.fillText(Math.abs(p), ww + 18, y); }
  }
  ctx.restore();
  // Bank arc.
  ctx.save(); ctx.translate(cx, cy); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  for (const b of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const [x0, y0] = polar(0, 0, h * 0.38, b - t.bank * 0); const [x1, y1] = polar(0, 0, h * (b % 30 === 0 ? 0.33 : 0.355), b);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = COLORS.yellow;
  ctx.beginPath(); ctx.moveTo(cx, cy - h * 0.38); ctx.lineTo(cx - 8, cy - h * 0.33); ctx.lineTo(cx + 8, cy - h * 0.33); ctx.fill();
  ctx.strokeStyle = COLORS.yellow; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(cx - w * 0.14, cy); ctx.lineTo(cx - w * 0.05, cy); ctx.lineTo(cx - w * 0.05, cy + 10);
  ctx.moveTo(cx + w * 0.14, cy); ctx.lineTo(cx + w * 0.05, cy); ctx.lineTo(cx + w * 0.05, cy + 10); ctx.stroke();
  ctx.fillStyle = COLORS.yellow; ctx.fillRect(cx - 4, cy - 4, 8, 8);

  // Airspeed tape (left) and altitude tape (right).
  const tape = (x, value, step, tickEvery, fmt, align) => {
    ctx.fillStyle = 'rgba(8,10,14,0.88)'; ctx.fillRect(x, h * 0.08, w * 0.14, h * 0.76);
    ctx.save(); ctx.beginPath(); ctx.rect(x, h * 0.08, w * 0.14, h * 0.76); ctx.clip();
    const mid = h * 0.46; const ppu = h * 0.76 / (step * 8);
    ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(h * 0.04)}px Arial`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.lineWidth = 2;
    const base = Math.round(value / (step / 2)) * (step / 2);
    for (let v = base - step * 5; v <= base + step * 5; v += step / 2) {
      const y = mid - (v - value) * ppu;
      const major = Math.abs(v % step) < 1e-6;
      const tx = align === 'right' ? x + w * 0.14 : x;
      ctx.beginPath(); ctx.moveTo(tx, y); ctx.lineTo(tx + (align === 'right' ? -1 : 1) * (major ? w * 0.025 : w * 0.012), y); ctx.stroke();
      if (major && v >= 0) ctx.fillText(fmt(v), align === 'right' ? x + w * 0.105 : x + w * 0.035, y);
    }
    ctx.restore();
    ctx.fillStyle = '#000'; ctx.strokeStyle = COLORS.yellow; ctx.lineWidth = 2;
    ctx.fillRect(x - 2, h * 0.41, w * 0.15, h * 0.1); ctx.strokeRect(x - 2, h * 0.41, w * 0.15, h * 0.1);
    ctx.fillStyle = COLORS.white; ctx.font = `bold ${Math.round(h * 0.06)}px Arial`; ctx.textAlign = 'center';
    ctx.fillText(Math.round(value), x + w * 0.07, h * 0.46);
  };
  tape(w * 0.02, Math.max(0, t.ias), 10, 5, (v) => Math.round(v), 'right');
  tape(w * 0.84, Math.max(0, t.altitudeFt), 100, 5, (v) => Math.round(v), 'left');
  // Speed bugs: stall and Vne markers.
  const ppu = h * 0.76 / 80;
  const vne = spec.limits.vne; const vs = spec.flaps.stages[0].vs;
  const mark = (v, color) => { const y = h * 0.46 - (v - t.ias) * ppu; if (y > h * 0.08 && y < h * 0.84) { ctx.fillStyle = color; ctx.fillRect(w * 0.155, y - 2, w * 0.012, 4); } };
  mark(vs, COLORS.red); mark(vne, COLORS.red); mark(spec.speeds.vr, COLORS.cyan);
  // Heading strip.
  ctx.fillStyle = 'rgba(8,10,14,0.9)'; ctx.fillRect(w * 0.22, h * 0.9, w * 0.56, h * 0.1);
  ctx.save(); ctx.beginPath(); ctx.rect(w * 0.22, h * 0.9, w * 0.56, h * 0.1); ctx.clip();
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.font = `bold ${Math.round(h * 0.035)}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const ppd = (w * 0.56) / 60;
  for (let d = Math.floor(t.heading / 5) * 5 - 40; d <= t.heading + 40; d += 5) {
    const x = cx + (d - t.heading) * ppd; const hd = ((d % 360) + 360) % 360;
    ctx.beginPath(); ctx.moveTo(x, h * 0.9); ctx.lineTo(x, h * (hd % 10 === 0 ? 0.925 : 0.915)); ctx.stroke();
    if (hd % 10 === 0) ctx.fillText(hd % 90 === 0 ? 'NESW'[hd / 90] : String(hd / 10).padStart(2, '0'), x, h * 0.955);
  }
  if (t.wpt) {
    let rel = ((t.wpt.brg - t.heading + 540) % 360) - 180;
    const lim = 29; const edge = Math.abs(rel) > lim; rel = Math.max(-lim, Math.min(lim, rel));
    const bx = cx + rel * ppd;
    ctx.fillStyle = '#ff5dd0'; ctx.beginPath(); ctx.moveTo(bx, h * 0.9); ctx.lineTo(bx - 7, h * 0.93); ctx.lineTo(bx + 7, h * 0.93); ctx.closePath(); ctx.fill();
    if (edge) ctx.fillRect(bx - 1, h * 0.9, 2, h * 0.1);
  }
  ctx.restore();
  ctx.fillStyle = COLORS.yellow; ctx.beginPath(); ctx.moveTo(cx, h * 0.9); ctx.lineTo(cx - 6, h * 0.885); ctx.lineTo(cx + 6, h * 0.885); ctx.fill();
  // Vertical speed and mode text.
  ctx.fillStyle = COLORS.green; ctx.font = `bold ${Math.round(h * 0.045)}px Arial`; ctx.textAlign = 'left';
  ctx.fillText(`VS ${Math.round(t.vsFpm / 50) * 50}`, w * 0.845, h * 0.9);
  ctx.textAlign = 'center'; ctx.fillStyle = COLORS.white; ctx.font = `${Math.round(h * 0.035)}px Arial`;
  ctx.fillText(`G ${t.nz.toFixed(1)}   AoA ${t.alpha.toFixed(0)}°   M ${t.mach.toFixed(2)}`, cx, h * 0.04);
  if (t.stallWarning || t.stalled) { ctx.fillStyle = COLORS.red; ctx.font = `bold ${Math.round(h * 0.08)}px Arial`; ctx.fillText('STALL', cx, h * 0.72); }
}

/** Multi-function display: a north-up map with the runway, a range ring and the aircraft symbol. */
export function mfdMap(ctx, w, h, t, model) {
  ctx.fillStyle = '#04101a'; ctx.fillRect(0, 0, w, h);
  const cx = w / 2; const cy = h * 0.66;
  // Range: the smallest step that covers about 90 s of flight.
  const reach = Math.max(1, t.groundSpeed * 0.514) * 90;
  const range = model.nav?.range ?? ([3000, 6000, 12000, 25000, 50000, 100000].find((r) => r >= reach) ?? 100000);
  const pxPerM = (h * 0.58) / range;
  const px = model.pos.x; const pz = model.pos.z;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-t.heading * DEG); // track-up
  ctx.strokeStyle = '#124a66'; ctx.lineWidth = 1;
  for (const f of [0.25, 0.5, 0.75, 1]) { ctx.beginPath(); ctx.arc(0, 0, range * f * pxPerM, 0, Math.PI * 2); ctx.stroke(); }
  const nav = model.nav;
  const label = [];
  for (const ap of nav?.airports ?? []) {
    const dx = ap.x - px; const dz = ap.z - pz;
    if (Math.hypot(dx, dz) > range * 1.6) continue;
    const active = ap === nav.active;
    ctx.fillStyle = active ? '#d6e9f5' : '#7f95a6';
    for (const rw of ap.runways) {
      ctx.save();
      ctx.translate((rw.cx - px) * pxPerM, (rw.cz - pz) * pxPerM);
      ctx.rotate(rw.heading * DEG);
      const rwW = Math.max(2.5, rw.width * pxPerM * 2.5);
      ctx.fillRect(-rwW / 2, -(rw.length * pxPerM) / 2, rwW, Math.max(3, rw.length * pxPerM));
      ctx.restore();
    }
    label.push({ x: dx * pxPerM, y: dz * pxPerM, text: ap.code, active });
  }
  // Approach course and traffic.
  const course = nav?.course;
  if (course) {
    ctx.save();
    ctx.strokeStyle = '#4cc2ff'; ctx.lineWidth = 1.5; ctx.setLineDash([8, 6]);
    const d = { x: Math.sin(course.heading * DEG), z: -Math.cos(course.heading * DEG) };
    ctx.beginPath();
    ctx.moveTo((course.x - px) * pxPerM, (course.z - pz) * pxPerM);
    ctx.lineTo((course.x - d.x * 24000 - px) * pxPerM, (course.z - d.z * 24000 - pz) * pxPerM);
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = '#ffe27a';
  for (const tr of nav?.traffic ?? []) {
    const tx = (tr.x - px) * pxPerM; const tz = (tr.z - pz) * pxPerM;
    if (Math.hypot(tx, tz) > h) continue;
    ctx.beginPath(); ctx.arc(tx, tz, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  if (nav?.hdgBug != null) {
    ctx.save();
    ctx.rotate((nav.hdgBug) * DEG);
    ctx.strokeStyle = COLORS.amber; ctx.lineWidth = 3;
    const r = range * pxPerM;
    ctx.beginPath(); ctx.moveTo(-8, -r); ctx.lineTo(8, -r); ctx.stroke();
    ctx.restore();
  }
  if (t.wpt) {
    // Route leg to the active waypoint (the map is track-up, so world offsets are drawn in the rotated frame).
    ctx.strokeStyle = '#ff5dd0'; ctx.lineWidth = 2.5; ctx.setLineDash([10, 6]);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo((t.wpt.x - px) * pxPerM, (t.wpt.z - pz) * pxPerM); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.restore();
  // Labels stay upright: rotate each anchor into screen space.
  const cs = Math.cos(t.heading * DEG); const sn = Math.sin(t.heading * DEG);
  ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center';
  for (const l of label) {
    const sx = cx + l.x * cs + l.y * sn; const sy = cy - l.x * sn + l.y * cs;
    if (sx < 10 || sx > w - 10 || sy < 30 || sy > h - 20) continue;
    ctx.fillStyle = l.active ? COLORS.cyan : '#9fb0bd';
    ctx.fillText(l.text, sx, sy - 12);
  }
  // Own-ship symbol.
  ctx.fillStyle = COLORS.white;
  ctx.beginPath(); ctx.moveTo(cx, cy - 14); ctx.lineTo(cx - 9, cy + 10); ctx.lineTo(cx, cy + 5); ctx.lineTo(cx + 9, cy + 10); ctx.fill();
  ctx.fillStyle = COLORS.cyan; ctx.font = 'bold 16px Arial'; ctx.textAlign = 'left';
  ctx.fillText(`HDG ${String(Math.round(t.heading)).padStart(3, '0')}°`, 14, 24);
  ctx.textAlign = 'right'; ctx.fillText(`GS ${Math.round(t.groundSpeed)} kt`, w - 14, 24);
  if (nav?.active) {
    const dx = nav.active.x - px; const dz = nav.active.z - pz;
    const brg = (Math.atan2(dx, -dz) / DEG + 360) % 360;
    ctx.textAlign = 'left'; ctx.fillStyle = COLORS.white; ctx.font = '14px Arial';
    ctx.fillText(`${nav.active.code}  ${String(Math.round(brg)).padStart(3, '0')}°  ${(Math.hypot(dx, dz) / 1852).toFixed(1)} nm`, 14, h - 12);
  }
  ctx.textAlign = 'right'; ctx.fillStyle = COLORS.dim; ctx.font = '12px Arial';
  ctx.fillText(`TRACK UP  ·  ${(range / 1000).toFixed(0)} km`, w - 14, h - 12);
}

/** Engine display for glass cockpits: N1 bars per engine, fuel flow, fuel quantity. */
export function engineDisplay(ctx, w, h, t, spec) {
  ctx.fillStyle = '#04070a'; ctx.fillRect(0, 0, w, h);
  const n = t.engines.length;
  ctx.textBaseline = 'middle';
  t.engines.forEach((e, i) => {
    const cx = w * ((i + 0.5) / n);
    ctx.fillStyle = COLORS.dim; ctx.font = 'bold 16px Arial'; ctx.textAlign = 'center';
    ctx.fillText(n > 1 ? `ENG ${i + 1}` : 'ENGINE', cx, 22);
    // N1 vertical bar.
    const bw = 34; const bh = h * 0.46; const by = 44;
    ctx.fillStyle = '#10161c'; ctx.fillRect(cx - bw / 2, by, bw, bh);
    const fill = Math.min(1, e.n1 / 100);
    ctx.fillStyle = e.n1 > 98 ? COLORS.red : COLORS.green;
    ctx.fillRect(cx - bw / 2, by + bh * (1 - fill), bw, bh * fill);
    ctx.strokeStyle = '#2b3037'; ctx.strokeRect(cx - bw / 2 + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.fillStyle = COLORS.white; ctx.font = 'bold 22px Arial';
    ctx.fillText(e.n1.toFixed(1), cx, by + bh + 22);
    ctx.fillStyle = COLORS.dim; ctx.font = '13px Arial';
    ctx.fillText('N1 %', cx, by + bh + 42);
    ctx.fillStyle = COLORS.white; ctx.font = '15px Arial';
    ctx.fillText(`FF ${(e.fuelFlow * 3600).toFixed(0)} kg/h`, cx, h - 22);
  });
  ctx.fillStyle = COLORS.cyan; ctx.font = 'bold 15px Arial'; ctx.textAlign = 'left';
  ctx.fillText(`FUEL ${Math.round(t.fuel)} kg`, 12, h - 8 - 40);
}

/** Head-up display symbology (green on transparent). */
/**
 * Fuel / weight page: one bar per tank (or left/right wing for single-tank aircraft), total, gross
 * weight and the centre of gravity as % of the mean aerodynamic chord.
 */
export function fuelDisplay(ctx, w, h, t, spec) {
  ctx.fillStyle = '#04070a'; ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.cyan; ctx.font = 'bold 18px Arial';
  ctx.fillText('FUEL', w / 2, 20);
  const tanks = t.tanks?.length
    ? t.tanks.map((k) => ({ name: k.name, content: k.content, capacity: k.capacity }))
    : [{ name: 'L', content: t.fuel / 2, capacity: t.fuelCapacity / 2 }, { name: 'R', content: t.fuel / 2, capacity: t.fuelCapacity / 2 }];
  const n = tanks.length;
  const bw = Math.min(46, (w - 24) / n - 10);
  const by = 48; const bh = h * 0.42;
  tanks.forEach((k, i) => {
    const cx = (w * (i + 0.5)) / n;
    ctx.fillStyle = '#10161c'; ctx.fillRect(cx - bw / 2, by, bw, bh);
    const fill = k.capacity ? Math.min(1, k.content / k.capacity) : 0;
    ctx.fillStyle = fill < 0.08 ? COLORS.amber : COLORS.green;
    ctx.fillRect(cx - bw / 2, by + bh * (1 - fill), bw, bh * fill);
    ctx.strokeStyle = '#2b3037'; ctx.strokeRect(cx - bw / 2 + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.fillStyle = COLORS.white; ctx.font = 'bold 14px Arial';
    ctx.fillText(k.name, cx, by + bh + 16);
    ctx.fillStyle = COLORS.dim; ctx.font = '12px Arial';
    ctx.fillText(`${Math.round(k.content / 100) / 10}t`, cx, by + bh + 32);
  });
  ctx.fillStyle = COLORS.white; ctx.font = 'bold 17px Arial'; ctx.textAlign = 'left';
  ctx.fillText(`TOTAL  ${(t.fuel / 1000).toFixed(1)} t`, 14, h - 56);
  ctx.fillText(`GW     ${(t.mass / 1000).toFixed(1)} t`, 14, h - 34);
  ctx.fillStyle = COLORS.cyan;
  ctx.fillText(`CG ${(t.cg * 100).toFixed(1)} % MAC`, 14, h - 12);
}

export function hud(ctx, w, h, t) {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2; const cy = h / 2; const k = h / 40;
  ctx.strokeStyle = COLORS.green; ctx.fillStyle = COLORS.green; ctx.lineWidth = 2.5;
  ctx.font = `bold ${Math.round(h * 0.045)}px monospace`; ctx.textBaseline = 'middle';
  // Boresight cross.
  ctx.beginPath(); ctx.moveTo(cx - 14, cy); ctx.lineTo(cx + 14, cy); ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy + 14); ctx.stroke();
  // Pitch ladder, rotated with bank.
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(-t.bank * DEG);
  for (let p = -40; p <= 60; p += 5) {
    const y = -(p - t.pitch) * k;
    if (Math.abs(y) > h * 0.4) continue;
    const half = p === 0 ? w * 0.28 : w * 0.1;
    ctx.beginPath();
    if (p >= 0) { ctx.moveTo(-half, y); ctx.lineTo(-half * 0.45, y); ctx.moveTo(half * 0.45, y); ctx.lineTo(half, y); if (p) { ctx.moveTo(-half, y); ctx.lineTo(-half, y + 8); ctx.moveTo(half, y); ctx.lineTo(half, y + 8); } }
    else { for (let i = 0; i < 4; i++) { ctx.moveTo(-half + i * half * 0.28, y); ctx.lineTo(-half + i * half * 0.28 + half * 0.16, y); ctx.moveTo(half - i * half * 0.28, y); ctx.lineTo(half - i * half * 0.28 - half * 0.16, y); } }
    ctx.stroke();
    if (p && p % 10 === 0) { ctx.textAlign = 'right'; ctx.fillText(Math.abs(p), -half - 8, y); ctx.textAlign = 'left'; ctx.fillText(Math.abs(p), half + 8, y); }
  }
  ctx.restore();
  // Flight path marker.
  const fx = cx + (-t.beta) * k * 1.0; const fy = cy + t.alpha * k;
  ctx.beginPath(); ctx.arc(fx, fy, 9, 0, Math.PI * 2); ctx.moveTo(fx - 22, fy); ctx.lineTo(fx - 9, fy); ctx.moveTo(fx + 9, fy); ctx.lineTo(fx + 22, fy); ctx.moveTo(fx, fy - 9); ctx.lineTo(fx, fy - 18); ctx.stroke();
  // Speed (left), altitude (right), heading (top).
  ctx.textAlign = 'right'; ctx.fillText(Math.round(t.ias), cx - w * 0.31, cy);
  ctx.strokeRect(cx - w * 0.31 - 80, cy - 20, 90, 40);
  ctx.textAlign = 'left'; ctx.fillText(Math.round(t.altitudeFt / 10) * 10, cx + w * 0.3 - 10, cy);
  ctx.strokeRect(cx + w * 0.3 - 20, cy - 20, 110, 40);
  ctx.textAlign = 'center'; ctx.fillText(String(Math.round(t.heading)).padStart(3, '0'), cx, h * 0.08);
  ctx.beginPath(); ctx.moveTo(cx, h * 0.12); ctx.lineTo(cx - 6, h * 0.14); ctx.lineTo(cx + 6, h * 0.14); ctx.closePath(); ctx.stroke();
  ctx.font = `bold ${Math.round(h * 0.036)}px monospace`;
  ctx.textAlign = 'left'; ctx.fillText(`M ${t.mach.toFixed(2)}`, cx - w * 0.43, h * 0.78);
  ctx.fillText(`G ${t.nz.toFixed(1)}`, cx - w * 0.43, h * 0.84);
  ctx.textAlign = 'right'; ctx.fillText(`α ${t.alpha.toFixed(0)}`, cx + w * 0.43, h * 0.78);
  ctx.fillText(`${t.gear > 0.98 ? 'GEAR' : t.gear < 0.02 ? '' : 'GEAR ...'}`, cx + w * 0.43, h * 0.84);
  if (t.stallWarning) { ctx.textAlign = 'center'; ctx.font = `bold ${Math.round(h * 0.07)}px monospace`; ctx.fillText('ALPHA', cx, h * 0.7); }
}
