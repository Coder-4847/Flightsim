import { h } from '../dom.js';
import { button } from './panels.js';
import { TIME_SCALES } from '../../game/timeScale.js';

// Autopilot and time compression. Everything here drives the same objects the keys do
// (FlightControls.autopilot and FlightControls.time), so keys and clicks stay in step.

const pad3 = (n) => String(((Math.round(n) % 360) + 360) % 360 || 360).padStart(3, '0');

export function createAutopilotPanel(hud) {
  const panel = hud.panels.create({ id: 'autopilot', title: 'Autopilot and time', x: 352, y: 120, width: 350, hint: 'F6' });
  const status = h('div.ap-status', 'AP OFF');
  const master = button('AP', { onClick: () => hud.controls.perform('autopilot_toggle'), tooltip: 'Autopilot on / off (\\)', className: 'ap-master' });
  const thrBtn = button('A/T', { onClick: () => hud.controls.perform('autothrottle_toggle'), tooltip: 'Autothrottle holds the speed below (/)' });
  const apprBtn = button('APPR', { onClick: () => { const ap = hud.controls.autopilot; if (ap.on) ap.toggleApproach(); else hud.toast('Engage the autopilot first'); }, tooltip: 'Arm the approach: captures the localiser and glide slope of the runway ahead' });
  const hdgBtn = button('HDG', { onClick: () => mode('lat', 'HDG'), tooltip: 'Fly the heading bug' });
  const navBtn = button('NAV', { onClick: () => mode('lat', 'NAV'), tooltip: 'Track to the selected airport' });
  const altBtn = button('ALT', { onClick: () => mode('vert', 'ALT'), tooltip: 'Hold or capture the selected altitude' });
  const vsBtn = button('V/S', { onClick: () => mode('vert', 'VS'), tooltip: 'Climb or descend at the selected rate to the altitude' });
  const row = (label, ...kids) => h('div.ap-row', h('span.ap-label', label), ...kids);

  const vals = { hdg: h('span.ap-val'), alt: h('span.ap-val'), vs: h('span.ap-val'), ias: h('span.ap-val') };
  const step = (key, d) => button(d > 0 ? `+${Math.abs(d)}` : `−${Math.abs(d)}`, { onClick: () => adjust(key, d), className: 'ap-step', tooltip: 'Click, or scroll over the value' });
  const adjusters = (key, big, small) => [step(key, -big), step(key, -small), vals[key], step(key, small), step(key, big)];

  const airportSel = h('select.ap-select', { onchange: () => pickAirport() });
  const timeBtns = TIME_SCALES.map((s) => button(`${s}×`, { onClick: () => hud.controls.time.set(s, hud.model, hud.controls.autopilot), tooltip: s === 1 ? 'Real time (* or `)' : `Time compression ×${s} (+ / −, or ' and ;)`, className: 'ap-time' }));
  const timeNote = h('div.ap-note');

  panel.body.append(
    h('div.ap-top', master, thrBtn, apprBtn, status),
    row('Heading', ...adjusters('hdg', 10, 1)),
    row('Altitude', ...adjusters('alt', 1000, 100)),
    row('V/S', ...adjusters('vs', 500, 100)),
    row('Speed', ...adjusters('ias', 10, 5)),
    row('Lateral', hdgBtn, navBtn, airportSel),
    row('Vertical', altBtn, vsBtn),
    h('div.ap-sep'),
    row('Time', h('div.ap-times', ...timeBtns)),
    timeNote,
  );

  const ap = () => hud.controls.autopilot;
  const STEP = { hdg: [0, 360], alt: [0, 45000], vs: [-4000, 4000], ias: [40, 700] };
  function adjust(key, d) {
    const a = ap();
    if (key === 'hdg') a.hdg = ((a.hdg + d) % 360 + 360) % 360;
    else a[key] = Math.min(STEP[key][1], Math.max(STEP[key][0], a[key] + d));
    if (key === 'hdg' && a.lat === 'NAV') a.lat = 'HDG';
    if (key === 'vs' && a.on && a.vert !== 'GS') a.vert = 'VS';
    refresh();
  }
  function mode(axis, value) {
    const a = ap();
    if (!a.on) return hud.toast('Engage the autopilot first');
    const tel = hud.model.telemetry;
    if (axis === 'lat') {
      if (value === 'NAV' && !a.nav) return hud.toast('Choose an airport to navigate to');
      a.lat = value;
      if (value === 'HDG') a.hdg = Math.round(tel.heading) % 360;
      a.appr = false;
    } else if (value === 'VS') {
      a.vert = 'VS';
      if (Math.abs(a.vs) < 100) a.vs = a.alt > tel.altitudeFt ? 1000 : -1000;
    } else {
      a.vert = 'ALT';
    }
    refresh();
  }
  function pickAirport() {
    const ap_ = hud.model?.nav.airports.find((x) => x.code === airportSel.value);
    const a = ap();
    if (!ap_) { a.nav = null; if (a.lat === 'NAV') a.lat = 'HDG'; return; }
    a.nav = { x: ap_.x, z: ap_.z, name: ap_.name ?? ap_.code };
    if (a.on) { a.lat = 'NAV'; hud.toast(`Direct to ${ap_.code}`); } else hud.toast(`${ap_.code} selected: engage the autopilot (\\)`);
    refresh();
  }
  function fillAirports() {
    const m = hud.model;
    if (!m) return;
    const list = [...m.nav.airports].map((x) => ({ x, d: Math.hypot(x.x - m.pos.x, x.z - m.pos.z) })).sort((a, b) => a.d - b.d);
    const sig = list.map((e) => e.x.code).join();
    if (airportSel.dataset.sig === sig) return;
    airportSel.dataset.sig = sig;
    const keep = airportSel.value;
    airportSel.replaceChildren(h('option', { value: '' }, 'Direct to…'), ...list.map((e) => h('option', { value: e.x.code }, `${e.x.code} · ${(e.d / 1852).toFixed(0)} NM`)));
    airportSel.value = keep;
  }

  // Scroll over a value to change it.
  for (const [key, el] of Object.entries(vals)) {
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const unit = { hdg: 1, alt: 100, vs: 100, ias: 5 }[key];
      adjust(key, (e.deltaY < 0 ? 1 : -1) * unit);
    }, { passive: false });
  }

  function refresh() {
    const a = ap();
    vals.hdg.textContent = `${pad3(a.hdg)}°`;
    vals.alt.textContent = `${Math.round(a.alt)} ft`;
    vals.vs.textContent = `${a.vs > 0 ? '+' : ''}${Math.round(a.vs)}`;
    vals.ias.textContent = `${Math.round(a.ias)} kt`;
    master.classList.toggle('on', a.on);
    thrBtn.classList.toggle('on', a.at);
    apprBtn.classList.toggle('on', a.on && (a.appr || a.lat === 'LOC'));
    hdgBtn.classList.toggle('on', a.on && a.lat === 'HDG');
    navBtn.classList.toggle('on', a.on && a.lat === 'NAV');
    altBtn.classList.toggle('on', a.on && a.vert === 'ALT');
    vsBtn.classList.toggle('on', a.on && a.vert === 'VS');
    status.textContent = a.on ? `AP ${a.status}` : 'AP OFF';
    status.classList.toggle('live', a.on);
    const t = hud.controls.time;
    TIME_SCALES.forEach((s, i) => timeBtns[i].classList.toggle('on', t.scale === s));
    const lim = hud.model ? t.limit(hud.model, a) : { max: 1 };
    TIME_SCALES.forEach((s, i) => { timeBtns[i].classList.toggle('blocked', s > lim.max); });
    timeNote.textContent = lim.reason ?? 'Time compression is available';
  }

  let lastRefresh = 0;
  return {
    panel,
    update() {
      if (!panel.isOpen) return;
      const now = performance.now();
      if (now - lastRefresh < 150) return;
      lastRefresh = now;
      fillAirports();
      refresh();
    },
  };
}
