import { MAP_HALF } from '../world/maps.js';
import { drawPreview } from './mapSelect.js';
import { h } from './dom.js';

// The chart: a large moving map that pauses the flight. Drag to pan, wheel to zoom, click to set a waypoint
// (click an airport to route to it), click a waypoint's marker to remove it. Waypoints show their bearing on
// the compass dials and the autopilot's NAV mode flies them in order.

const DEG = Math.PI / 180;
const NM = 1852;
const BASE_SIZE = 1024;
const baseCache = new Map();

function baseFor(map) {
  if (!baseCache.has(map.id)) {
    const canvas = document.createElement('canvas');
    drawPreview(canvas, map, BASE_SIZE);
    baseCache.set(map.id, canvas);
  }
  return baseCache.get(map.id);
}

export function createMapScreen({ getSession, onClose }) {
  const canvas = h('canvas.chart-canvas');
  const readout = h('div.chart-read');
  const list = h('div.chart-wpts');
  const hint = h('div.chart-hint', 'Drag to pan · scroll to zoom · click to set a waypoint · click a waypoint to remove it · Home centres on you · M or Esc closes');
  const bezel = h('div.chart-bezel',
    h('header.chart-head', h('span.chart-title', 'Navigation chart'), h('span.chart-sub'), h('button.btn.small', { onclick: () => close() }, 'Close  (M)')),
    h('div.chart-body', h('div.chart-view', canvas, readout), h('aside.chart-side', h('div.chart-side-title', 'Route'), list,
      h('div.chart-actions', h('button.btn.small', { onclick: () => { getSession()?.controls.waypoints.clear(); renderList(); } }, 'Clear route')))),
    hint,
  );
  const el = h('section.chart-screen', bezel);

  let view = { cx: 0, cz: 0, scale: 0.012 }; // px per metre
  let ctx = null;
  let drag = null;
  let raf = 0;
  let open = false;
  let mouse = null;
  const session = () => getSession();

  const toScreen = (x, z) => [canvas.width / 2 + (x - view.cx) * view.scale, canvas.height / 2 + (z - view.cz) * view.scale];
  const toWorld = (sx, sz) => [view.cx + (sx - canvas.width / 2) / view.scale, view.cz + (sz - canvas.height / 2) / view.scale];
  const clampScale = () => { view.scale = Math.min(0.6, Math.max(canvas.width / (MAP_HALF * 2.4), view.scale)); };

  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1;
    canvas.width = Math.max(300, Math.round(r.width / z));
    canvas.height = Math.max(200, Math.round(r.height / z));
    clampScale();
  }

  function renderList() {
    const s = session();
    if (!s) return;
    const wp = s.controls.waypoints;
    const m = s.model;
    list.replaceChildren(...(wp.list.length ? wp.list.map((w, i) => {
      const dx = w.x - m.pos.x; const dz = w.z - m.pos.z;
      const brg = ((Math.atan2(dx, -dz) / DEG) + 360) % 360;
      return h('div.chart-wpt', { className: `chart-wpt${i === 0 ? ' active' : ''}` },
        h('b', w.name), h('span', `${String(Math.round(brg) % 360).padStart(3, '0')}°  ${(Math.hypot(dx, dz) / NM).toFixed(1)} NM`),
        h('button.hbtn', { onclick: () => { wp.direct(i); renderList(); }, title: 'Fly to this one first' }, 'Direct'),
        h('button.hbtn', { onclick: () => { wp.remove(i); renderList(); }, title: 'Remove' }, '×'));
    }) : [h('div.chart-empty', 'No waypoints. Click the chart to add one.')]));
  }

  function draw() {
    const s = session();
    if (!open || !s?.model) return;
    const map = s.flightScene.map;
    const m = s.model;
    const W = canvas.width; const H = canvas.height;
    ctx.fillStyle = '#0c0b0a'; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const k = view.scale;
    ctx.translate(W / 2 - view.cx * k, H / 2 - view.cz * k);
    ctx.scale(k, k);
    ctx.drawImage(baseFor(map), -MAP_HALF, -MAP_HALF, MAP_HALF * 2, MAP_HALF * 2);
    ctx.restore();
    const [ex0, ez0] = toScreen(-MAP_HALF, -MAP_HALF); const [ex1, ez1] = toScreen(MAP_HALF, MAP_HALF);
    ctx.strokeStyle = 'rgba(255,176,46,0.5)'; ctx.lineWidth = 2; ctx.strokeRect(ex0, ez0, ex1 - ex0, ez1 - ez0);
    // Grid every 10 km (finer when zoomed in).
    const step = k > 0.08 ? 1000 : k > 0.02 ? 5000 : 10000;
    ctx.strokeStyle = 'rgba(255,244,220,0.10)'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(255,244,220,0.45)'; ctx.font = '10px sans-serif';
    const [wx0, wz0] = toWorld(0, 0); const [wx1, wz1] = toWorld(W, H);
    for (let x = Math.ceil(wx0 / step) * step; x <= wx1; x += step) { const [sx] = toScreen(x, 0); ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke(); ctx.fillText(`${x / 1000 + MAP_HALF / 1000} E`, sx + 3, H - 4); }
    for (let z = Math.ceil(wz0 / step) * step; z <= wz1; z += step) { const [, sz] = toScreen(0, z); ctx.beginPath(); ctx.moveTo(0, sz); ctx.lineTo(W, sz); ctx.stroke(); ctx.fillText(`${MAP_HALF / 1000 - z / 1000} N`, 4, sz - 3); }

    // Vector detail when zoomed in: roads and railways.
    if (k > 0.03) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const road of map.roads) {
        ctx.strokeStyle = road.major ? 'rgba(255,214,140,0.85)' : 'rgba(235,225,205,0.55)';
        ctx.lineWidth = road.major ? 2.2 : 1.1;
        ctx.beginPath(); road.points.forEach((p, i) => { const [sx, sz] = toScreen(p.x, p.z); if (i) ctx.lineTo(sx, sz); else ctx.moveTo(sx, sz); }); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(60,50,40,0.9)'; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.2;
      for (const rail of map.rails ?? []) { ctx.beginPath(); rail.points.forEach((p, i) => { const [sx, sz] = toScreen(p.x, p.z); if (i) ctx.lineTo(sx, sz); else ctx.moveTo(sx, sz); }); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    // Towns.
    ctx.textAlign = 'left';
    for (const c of map.cities) {
      const [sx, sz] = toScreen(c.x, c.z);
      if (sx < -60 || sz < -60 || sx > W + 60 || sz > H + 60) continue;
      const r = Math.max(2.5, c.radius * k);
      ctx.fillStyle = 'rgba(70,60,50,0.55)'; ctx.beginPath(); ctx.arc(sx, sz, r, 0, Math.PI * 2); ctx.fill();
      if (c.kind !== 'village' || k > 0.05) { ctx.fillStyle = '#f1e8d4'; ctx.font = `${c.kind === 'major' ? 13 : 11}px sans-serif`; ctx.fillText(c.name, sx + r + 3, sz + 4); }
    }
    // Navaids.
    for (const n of map.navaids ?? []) {
      const [sx, sz] = toScreen(n.x, n.z);
      if (sx < -20 || sz < -20 || sx > W + 20 || sz > H + 20 || k < 0.015) continue;
      ctx.strokeStyle = '#7ab8ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(sx, sz, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#9ccaff'; ctx.font = '10px sans-serif'; ctx.fillText(n.id ?? n.name ?? 'VOR', sx + 8, sz + 3);
    }
    // Airports, with runways to scale when zoomed in.
    for (const a of map.airports) {
      const [sx, sz] = toScreen(a.x, a.z);
      if (sx < -80 || sz < -80 || sx > W + 80 || sz > H + 80) continue;
      if (k > 0.05) {
        ctx.strokeStyle = '#efe7d2'; ctx.lineCap = 'butt';
        for (const rw of a.runways) {
          const e = rw.ends[0]; const f = rw.ends[1] ?? rw.ends[0];
          const [ax, az] = toScreen(e.threshold.x, e.threshold.z); const [bx, bz] = toScreen(f.threshold.x, f.threshold.z);
          ctx.lineWidth = Math.max(2, (rw.width ?? 30) * k); ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(bx, bz); ctx.stroke();
        }
      }
      const r = a.cls === 'hub' ? 7 : a.cls === 'regional' ? 6 : 5;
      ctx.fillStyle = '#ffb02e'; ctx.strokeStyle = '#1a1100'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx, sz - r); ctx.lineTo(sx + r, sz); ctx.lineTo(sx, sz + r); ctx.lineTo(sx - r, sz); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff1d6'; ctx.font = 'bold 12px sans-serif'; ctx.fillText(a.code, sx + r + 4, sz - 2);
      ctx.fillStyle = 'rgba(255,241,214,0.7)'; ctx.font = '10px sans-serif'; if (k > 0.02) ctx.fillText(a.name, sx + r + 4, sz + 10);
    }
    // Trail, route and the aircraft.
    const trail = m.nav.trail ?? [];
    if (trail.length > 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2; ctx.beginPath();
      trail.forEach((p, i) => { const [sx, sz] = toScreen(p[0], p[1]); if (i) ctx.lineTo(sx, sz); else ctx.moveTo(sx, sz); }); ctx.stroke();
    }
    const [px, pz] = toScreen(m.pos.x, m.pos.z);
    const wps = s.controls.waypoints.list;
    if (wps.length) {
      ctx.strokeStyle = '#ff5dd0'; ctx.lineWidth = 2.5; ctx.setLineDash([10, 6]); ctx.beginPath(); ctx.moveTo(px, pz);
      for (const w of wps) { const [sx, sz] = toScreen(w.x, w.z); ctx.lineTo(sx, sz); }
      ctx.stroke(); ctx.setLineDash([]);
      wps.forEach((w, i) => {
        const [sx, sz] = toScreen(w.x, w.z);
        ctx.fillStyle = i === 0 ? '#ff5dd0' : '#c04a9c'; ctx.strokeStyle = '#220018'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx, sz - 9); ctx.lineTo(sx + 8, sz + 6); ctx.lineTo(sx - 8, sz + 6); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffd9f3'; ctx.font = 'bold 11px sans-serif'; ctx.fillText(w.name, sx + 11, sz + 4);
      });
    }
    ctx.save(); ctx.translate(px, pz); ctx.rotate(m.telemetry.heading * DEG);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(0, -Math.max(60, m.telemetry.groundSpeed * 0.514 * 120 * k)); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(8, 10); ctx.lineTo(0, 5); ctx.lineTo(-8, 10); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    // Scale bar.
    const metres = [100, 200, 500, 1000, 2000, 5000, 10000, 20000].find((v) => v * k > 90) ?? 20000;
    ctx.strokeStyle = '#fff1d6'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(16, H - 22); ctx.lineTo(16 + metres * k, H - 22); ctx.stroke();
    ctx.fillStyle = '#fff1d6'; ctx.font = '12px sans-serif'; ctx.fillText(`${metres >= 1000 ? metres / 1000 + ' km' : metres + ' m'}`, 16, H - 28);
    // Cursor readout: bearing and distance from the aircraft.
    if (mouse) {
      const [wx, wz] = toWorld(mouse.x, mouse.y);
      const dx = wx - m.pos.x; const dz = wz - m.pos.z;
      const brg = ((Math.atan2(dx, -dz) / DEG) + 360) % 360;
      readout.textContent = `${String(Math.round(brg) % 360).padStart(3, '0')}°  ${(Math.hypot(dx, dz) / NM).toFixed(1)} NM from you`;
    }
    raf = requestAnimationFrame(draw);
  }

  function pointer(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
  }
  canvas.addEventListener('pointerdown', (e) => { drag = { ...pointer(e), cx: view.cx, cz: view.cz, moved: false, id: e.pointerId }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointer(e); mouse = p;
    if (!drag) return;
    if (Math.hypot(p.x - drag.x, p.y - drag.y) > 4) drag.moved = true;
    if (drag.moved) { view.cx = drag.cx - (p.x - drag.x) / view.scale; view.cz = drag.cz - (p.y - drag.y) / view.scale; }
  });
  canvas.addEventListener('pointerleave', () => { mouse = null; readout.textContent = ''; });
  canvas.addEventListener('pointerup', (e) => {
    const was = drag; drag = null;
    if (!was || was.moved) return;
    const s = session(); const p = pointer(e);
    const wp = s.controls.waypoints;
    // Click on an existing waypoint removes it.
    for (let i = 0; i < wp.list.length; i++) { const [sx, sz] = toScreen(wp.list[i].x, wp.list[i].z); if (Math.hypot(sx - p.x, sz - p.y) < 14) { wp.remove(i); renderList(); return; } }
    const [wx, wz] = toWorld(p.x, p.y);
    // Snap to an airport when the click is on one.
    const ap = s.flightScene.map.airports.find((a) => Math.hypot(toScreen(a.x, a.z)[0] - p.x, toScreen(a.x, a.z)[1] - p.y) < 14);
    if (ap) wp.add(ap.x, ap.z, ap.code); else if (!wp.add(wx, wz)) s.onToast?.('Route is full (12 waypoints)');
    renderList();
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = pointer(e);
    const [wx, wz] = toWorld(p.x, p.y);
    view.scale *= Math.exp(-e.deltaY * 0.0016);
    clampScale();
    // Keep the point under the cursor fixed.
    view.cx = wx - (p.x - canvas.width / 2) / view.scale; view.cz = wz - (p.y - canvas.height / 2) / view.scale;
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.code === 'Escape' || e.code === 'KeyM') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if (e.code === 'Home') { const m = session()?.model; if (m) { view.cx = m.pos.x; view.cz = m.pos.z; } e.preventDefault(); e.stopImmediatePropagation(); }
    if (e.code === 'Equal' || e.code === 'NumpadAdd') { view.scale *= 1.25; clampScale(); e.stopImmediatePropagation(); }
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') { view.scale /= 1.25; clampScale(); e.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('resize', () => { if (open) resize(); });

  function close() {
    if (!open) return;
    open = false;
    document.body.classList.remove('chart-open');
    cancelAnimationFrame(raf);
    onClose?.();
  }

  el.openChart = () => {
    const s = session();
    if (!s?.model) return;
    open = true;
    document.body.classList.add('chart-open');
    ctx ??= canvas.getContext('2d');
    el.querySelector('.chart-sub').textContent = `${s.flightScene.map.cfg.name} · ${s.flightScene.map.airports.length} airports`;
    requestAnimationFrame(() => {
      resize();
      view = { cx: s.model.pos.x, cz: s.model.pos.z, scale: 0.012 };
      clampScale();
      renderList();
      cancelAnimationFrame(raf);
      draw();
    });
  };
  el.closeChart = close;
  el.isOpen = () => open;
  return el;
}
