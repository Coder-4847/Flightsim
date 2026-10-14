import { COLORS, mfdMap, pfd } from '../../aircraft/cockpit/instruments.js';
import { h } from '../dom.js';
import { button } from './panels.js';

// Canvas-based panels: primary flight display, navigation map and the approach guide (localiser and
// glidepath needles, runway distance and a landing score preview).

function makeCanvas(w, hgt) {
  const canvas = h('canvas.hud-canvas', { width: w, height: hgt });
  return { canvas, ctx: canvas.getContext('2d') };
}

export function createPfdPanel(hud) {
  const panel = hud.panels.create({ id: 'pfd', title: 'Flight display', x: Math.max(12, window.innerWidth - 440), y: Math.max(64, window.innerHeight - 380), width: 290, hint: '2' });
  const { canvas, ctx } = makeCanvas(512, 512);
  panel.body.append(canvas);
  return {
    panel,
    update(t) {
      if (!panel.isOpen || !hud.model) return;
      pfd(ctx, 512, 512, t, hud.model.spec);
      if (!t.powered) {
        ctx.fillStyle = 'rgba(4,7,10,0.92)'; ctx.fillRect(0, 0, 512, 512);
        ctx.fillStyle = COLORS.amber; ctx.font = 'bold 34px Arial'; ctx.textAlign = 'center'; ctx.fillText('NO POWER', 256, 256);
      }
    },
  };
}

export function createNavPanel(hud) {
  const panel = hud.panels.create({ id: 'nav', title: 'Navigation', x: Math.max(12, window.innerWidth - 440), y: 64, width: 300, hint: 'M' });
  const { canvas, ctx } = makeCanvas(520, 520);
  const rangeLabel = h('span.nav-range', 'auto');
  const ranges = [null, 3000, 6000, 12000, 25000, 50000, 100000];
  let ri = 0;
  const setRange = (d) => { ri = Math.max(0, Math.min(ranges.length - 1, ri + d)); rangeLabel.textContent = ranges[ri] ? `${ranges[ri] / 1000} km` : 'auto'; };
  panel.body.append(canvas, h('div.ctl-row', button('−', { onClick: () => setRange(1), tooltip: 'Zoom out' }), rangeLabel, button('+', { onClick: () => setRange(-1), tooltip: 'Zoom in' })));
  return {
    panel,
    update(t) {
      const m = hud.model;
      if (!panel.isOpen || !m) return;
      m.nav.range = ranges[ri];
      mfdMap(ctx, 520, 520, t, m);
      if (!t.powered) { ctx.fillStyle = 'rgba(4,7,10,0.9)'; ctx.fillRect(0, 0, 520, 520); }
    },
  };
}

export function createApproachPanel(hud) {
  const panel = hud.panels.create({ id: 'approach', title: 'Approach guide', x: 692, y: 400, width: 250, hint: '6' });
  const { canvas, ctx } = makeCanvas(300, 300);
  const info = h('div.app-info');
  const score = h('div.app-score');
  panel.body.append(canvas, info, score);
  let dismissed = false;
  let wasValid = false;
  panel.el.querySelector('.hpanel-close').addEventListener('click', () => { dismissed = true; });
  const origOpen = panel.open;
  panel.open = () => { dismissed = false; origOpen(); };

  function draw(g) {
    const w = 300; const hh = 300;
    ctx.fillStyle = '#05080c'; ctx.fillRect(0, 0, w, hh);
    ctx.strokeStyle = '#26323f'; ctx.lineWidth = 1;
    // Localiser scale along the bottom, glidepath scale on the right.
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.arc(w / 2 + i * 50, hh - 28, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(w - 28, hh / 2 - 8 + i * 45, 5, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = COLORS.dim; ctx.font = '12px Arial'; ctx.textAlign = 'center';
    ctx.fillText(g.hasIls ? 'ILS' : 'VISUAL GUIDE', w / 2, 18);
    // Runway in perspective: a trapezoid that follows the lateral and vertical offset.
    const dx = Math.max(-1, Math.min(1, g.locDots / 2.5));
    const dy = Math.max(-1, Math.min(1, g.gsDots / 2.5));
    const horizon = 120 + dy * 40;
    ctx.fillStyle = '#10161d'; ctx.fillRect(10, 30, w - 60, hh - 80);
    ctx.fillStyle = '#2b3744';
    const farHalf = 14; const nearHalf = 70;
    const cx = w / 2 - 25 + dx * 90;
    ctx.beginPath();
    ctx.moveTo(cx - farHalf, horizon); ctx.lineTo(cx + farHalf, horizon); ctx.lineTo(cx + nearHalf, hh - 54); ctx.lineTo(cx - nearHalf, hh - 54);
    ctx.fill();
    ctx.strokeStyle = '#8fa2b5'; ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.moveTo(cx, horizon); ctx.lineTo(cx, hh - 54); ctx.stroke(); ctx.setLineDash([]);
    // Fixed aircraft reference.
    ctx.strokeStyle = COLORS.amber; ctx.lineWidth = 2;
    const rx = w / 2 - 25; const ry = 175;
    ctx.beginPath(); ctx.moveTo(rx - 22, ry); ctx.lineTo(rx - 6, ry); ctx.moveTo(rx + 6, ry); ctx.lineTo(rx + 22, ry); ctx.moveTo(rx, ry - 6); ctx.lineTo(rx, ry - 14); ctx.stroke();
    // Needles.
    const loc = Math.max(-2.4, Math.min(2.4, g.locDots));
    const gs = Math.max(-2.4, Math.min(2.4, g.gsDots));
    ctx.fillStyle = COLORS.green;
    ctx.fillRect(w / 2 + loc * 50 - 4, hh - 40, 8, 24);
    ctx.fillRect(w - 40, hh / 2 - 8 + gs * 45 - 4, 24, 8); // above the path: the needle sits below centre
    // Colour cue: far off the path.
    ctx.fillStyle = Math.abs(g.gsDots) > 1.5 || Math.abs(g.locDots) > 1.5 ? COLORS.amber : COLORS.green;
    ctx.font = 'bold 13px Arial'; ctx.textAlign = 'left';
    const cue = g.gsDots > 1.5 ? 'HIGH — descend' : g.gsDots < -1.5 ? 'LOW — climb' : g.locDots > 1.5 ? 'Fly right' : g.locDots < -1.5 ? 'Fly left' : 'On path';
    ctx.fillText(cue, 14, 50);
  }

  function update(t) {
    const guide = hud.guide;
    const valid = !!guide && guide.distNm < 20 && !t.onGround;
    // Show itself on the approach unless the player closed it; arcade mode relies on it most.
    if (valid && !wasValid && !panel.isOpen && !dismissed) panel.open();
    if (!valid && wasValid && panel.isOpen && !t.onGround) { /* keep open until landing */ }
    if (!valid && t.onGround) dismissed = false;
    wasValid = valid;
    if (!panel.isOpen) return;
    if (!guide) {
      info.textContent = 'No runway ahead. Line up within 20 km of a runway to see guidance.';
      score.textContent = '';
      ctx.fillStyle = '#05080c'; ctx.fillRect(0, 0, 300, 300);
      return;
    }
    draw(guide);
    info.replaceChildren(
      h('div', `${guide.airport.code} runway ${guide.end.id}${guide.end.ils ? ` · ILS ${guide.end.ils.frequency.toFixed(2)}` : ''}`),
      h('div', `${guide.distNm.toFixed(1)} nm · ${Math.round(guide.heightFt)} ft above runway`),
      h('div', `Speed ${Math.round(guide.ias)} kt (target ${guide.vref}) · sink ${Math.round(guide.sinkFpm)} fpm`),
    );
    const tone = guide.score >= 80 ? 'good' : guide.score >= 55 ? 'ok' : 'bad';
    score.replaceChildren(h(`span.score-${tone}`, `Landing preview: ${guide.predictedGrade} · ${guide.score}`));
  }
  return { panel, update };
}
