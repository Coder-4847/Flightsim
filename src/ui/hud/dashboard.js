import {
  COLORS, airspeedDial, altimeterDial, attitudeDial, engineDisplay, headingDial, mfdMap, pfd, simpleGauge, vsiDial,
} from '../../aircraft/cockpit/instruments.js';
import { h } from '../dom.js';
import { tip } from './panels.js';

// The dashboard: a realistic instrument panel along the bottom of the screen in the outside
// camera views (it gives way to the real cockpit when the cockpit camera is selected). Steam-gauge
// aircraft get a round-dial cluster, glass aircraft get PFD, map and engine screens. On the right is
// the control quadrant: throttle levers (one per engine in per-engine mode), mixture and
// propeller, flap lever, gear lever and trim wheel; on the left the switches. Everything is
// operable with the mouse and mirrors the real controls, so keys, controller and mouse all
// move the same levers.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const GLASS = new Set(['glass', 'airliner', 'fighter', 'trainer']);

/** A vertical lever in a slot: drag the knob, scroll over it, or use the arrow keys when focused. */
function lever({ label, tone = 'throttle', height = 100, ticks = [], caps = null, scaleLabels = false, zone = null, onInput, tooltip: text, detents = null }) {
  const knob = h('div.d-knob', h('i'), h('i'), h('i'));
  const fill = h('div.d-slot-fill');
  const zoneEl = zone ? h('div.d-slot-zone', { style: `bottom:${zone.from * 100}%;height:${(zone.to - zone.from) * 100}%` }) : null;
  const track = h('div.d-track', { style: `height:${height}px` }, h('div.d-slot'), fill, zoneEl,
    ...ticks.map((tk) => h('span.d-tick', { style: `bottom:calc(13px + (100% - 26px) * ${tk.v})` }, scaleLabels ? (tk.label ?? '') : '')), knob);
  const readout = h('div.d-read', '0');
  const nameEl = h('div.d-name', label);
  const el = h(`div.d-lever.${tone}${scaleLabels ? '.wide' : ''}`, { role: 'slider', tabIndex: -1, 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100 }, caps && h('div.d-cap', caps[0]), track, caps && h('div.d-cap', caps[1]), readout, nameEl);
  tip(el, text);
  let value = 0;
  let dragging = false;
  const paint = () => {
    const pct = value * 100;
    knob.style.bottom = `calc(${pct}% - ${value * 26}px)`;
    fill.style.height = `${pct}%`;
    el.setAttribute('aria-valuenow', String(Math.round(pct)));
  };
  const snap = (v) => (detents ? detents.reduce((b, d) => (Math.abs(d - v) < Math.abs(b - v) ? d : b), detents[0]) : v);
  const fromEvent = (e) => {
    const r = track.getBoundingClientRect();
    const yCss = (e.clientY - r.top) / (r.height / track.offsetHeight); // the HUD can be zoomed
    return clamp(1 - (yCss - 13) / (track.offsetHeight - 26), 0, 1);
  };
  const apply = (v) => { value = snap(v); paint(); onInput?.(value); };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    el.setPointerCapture(e.pointerId);
    el.classList.add('drag');
    apply(fromEvent(e));
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => { if (dragging) apply(fromEvent(e)); });
  const end = () => { dragging = false; el.classList.remove('drag'); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); apply(value - Math.sign(e.deltaY) * (detents ? 1 / (detents.length - 1) : 0.05)); }, { passive: false });
  el.addEventListener('dblclick', () => apply(value > 0.5 ? 0 : 1));
  return {
    el, readout, get dragging() { return dragging; }, get value() { return value; },
    set(v) { value = clamp(v, 0, 1); paint(); },
  };
}

/** A two-position toggle switch with a lit lamp. */
function toggle({ label, onClick, tooltip: text, tone = 'amber', guard = false }) {
  const bat = h('div.d-bat', h('i'));
  const lamp = h('div.d-lamp');
  const el = h('button.d-switch', { type: 'button', dataset: { tone } }, lamp, h('div.d-bat-wrap', bat), h('span.d-switch-label', label));
  if (guard) el.classList.add('guarded');
  el.addEventListener('pointerdown', (e) => e.preventDefault());
  el.addEventListener('click', (e) => { onClick?.(e); });
  tip(el, text);
  return { el, set(on, alert = false) { el.classList.toggle('on', !!on); el.classList.toggle('alert', !!alert); } };
}

function dial(size = 124) {
  const canvas = h('canvas.d-dial', { width: size * 2, height: size * 2 });
  return { canvas, ctx: canvas.getContext('2d'), size: size * 2 };
}

function screen(label, w = 210, hh = 190) {
  const canvas = h('canvas.d-screen', { width: w * 2, height: hh * 2 });
  return { el: h('div.d-screen-wrap', canvas, h('span.d-screen-label', label)), canvas, ctx: canvas.getContext('2d'), w: w * 2, h: hh * 2 };
}

export function createDashboard(hud) {
  const annunciators = h('div.d-annun');
  const switches = h('div.d-switches');
  const instruments = h('div.d-instruments');
  const quadrant = h('div.d-quadrant');
  const tab = h('button.d-tab', { type: 'button', 'aria-label': 'Collapse the dashboard', onclick: () => setCollapsed(!collapsed) }, '▾');
  const el = h('section.dash', { 'aria-label': 'Instrument panel', hidden: true },
    h('i.d-screw.tl'), h('i.d-screw.tr'), tab, annunciators,
    h('div.d-body', h('div.d-bay.left', switches), h('div.d-bay.mid', instruments), h('div.d-bay.right', quadrant)));
  tip(tab, 'Collapse or open the dashboard (F10)');
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

  // Keep the other HUD elements (hint, subtitles) clear of the panel, whatever its size.
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => hud.root?.style.setProperty('--dash-h', el.hidden ? '0px' : `${el.getBoundingClientRect().height}px`)).observe(el);
  }

  let collapsed = false;
  try { collapsed = localStorage.getItem('flightsim:dashcollapsed') === '1'; } catch { /* optional */ }
  function setCollapsed(v) {
    collapsed = v;
    el.classList.toggle('collapsed', v);
    tab.textContent = v ? '▴' : '▾';
    try { localStorage.setItem('flightsim:dashcollapsed', v ? '1' : '0'); } catch { /* optional */ }
  }
  setCollapsed(collapsed);

  let built = null;
  let ui = null; // handles to the live widgets

  const ANN = [
    ['MASTER', 'red', (t) => t.failures.some((f) => f.level === 'red') || t.stallWarning || t.overspeed],
    ['STALL', 'red', (t) => t.stallWarning || t.stalled],
    ['OVERSPD', 'red', (t) => t.overspeed],
    ['FIRE', 'red', (t) => t.failures.some((f) => f.id.startsWith('fire'))],
    ['ENG FAIL', 'amber', (t) => t.failures.some((f) => f.id.startsWith('eng'))],
    ['GEAR', 'amber', (t, m) => m.spec.gear.retractable && t.gear > 0.02 && t.gear < 0.98],
    ['LOW FUEL', 'amber', (t) => t.fuel < t.fuelCapacity * 0.1],
    ['HYD', 'amber', (t) => t.failures.some((f) => f.id === 'hyd')],
    ['ELEC', 'amber', (t) => !t.powered || t.failures.some((f) => f.id === 'elec')],
    ['PITOT', 'amber', (t) => t.failures.some((f) => f.id === 'pitot')],
    ['PARK BRK', 'amber', (t) => t.parkingBrake],
  ];

  function build() {
    const m = hud.model;
    if (!m) return;
    const sys = hud.systems;
    const key = `${m.spec.id}:${sys.perEngine}:${sys.fuel}:${sys.manualFlaps}:${sys.manualGear}`;
    if (built === key) return;
    built = key;
    const spec = m.spec;
    const c = hud.controls;
    const engineType = spec.engines.spec.type;
    const nEng = m.engines.length;
    ui = { levers: [], dials: [], screens: [], switches: {}, ann: [] };

    // ---- annunciators ----
    annunciators.replaceChildren(...ANN.map(([text, tone, test]) => {
      const lamp = h('span.d-ann', { dataset: { tone } }, text);
      ui.ann.push({ lamp, test });
      return lamp;
    }));

    // ---- instruments ----
    instruments.replaceChildren();
    const panel = spec.cockpit.panel;
    if (GLASS.has(panel)) {
      const p = screen('PRIMARY FLIGHT DISPLAY');
      const n = screen('NAVIGATION');
      const e = screen('ENGINE');
      ui.screens = [{ ...p, draw: (t) => pfd(p.ctx, p.w, p.h, t, spec) }, { ...n, draw: (t) => {
        if (hud.perks && !hud.perks.has('gps')) {
          n.ctx.fillStyle = '#04070a'; n.ctx.fillRect(0, 0, n.w, n.h);
          n.ctx.fillStyle = COLORS.dim; n.ctx.font = 'bold 26px Arial'; n.ctx.textAlign = 'center';
          n.ctx.fillText('NAV MAP', n.w / 2, n.h / 2 - 16); n.ctx.font = '20px Arial'; n.ctx.fillText('needs the GPS upgrade', n.w / 2, n.h / 2 + 22);
          return;
        }
        m.nav.range = null;
        mfdMap(n.ctx, n.w, n.h, t, m);
      } }, { ...e, draw: (t) => engineDisplay(e.ctx, e.w, e.h, t, spec) }];
      instruments.append(p.el, n.el, e.el);
    } else {
      const d = Array.from({ length: 6 }, () => dial());
      const draw = [
        (t) => airspeedDial(d[0].ctx, 124, 124, 112, t, spec),
        (t) => attitudeDial(d[1].ctx, 124, 124, 112, t),
        (t) => altimeterDial(d[2].ctx, 124, 124, 112, t),
        (t) => vsiDial(d[3].ctx, 124, 124, 112, t),
        (t) => headingDial(d[4].ctx, 124, 124, 112, t),
        (t) => {
          const e = t.engines[0];
          const turbine = engineType !== 'piston';
          simpleGauge(d[5].ctx, 124, 124, 112, turbine
            ? { label: 'N1', unit: '%', value: e.n1, min: 0, max: 110, major: 20, bands: [{ from: 60, to: 100, color: COLORS.green }, { from: 100, to: 110, color: COLORS.red }] }
            : { label: 'RPM', unit: 'x100', value: e.rpm / 100, min: 0, max: 30, major: 5, bands: [{ from: 0, to: 22, color: COLORS.green }, { from: 22, to: 27, color: COLORS.yellow }, { from: 27, to: 30, color: COLORS.red }] });
        },
      ];
      ui.dials = d.map((x, i) => ({ ...x, draw: draw[i] }));
      const rows = h('div.d-dials');
      d.forEach((x, i) => rows.append(h('div.d-dial-wrap', x.canvas, h('span.d-dial-label', ['AIRSPEED', 'ATTITUDE', 'ALTIMETER', 'VERT SPEED', 'HEADING', engineType === 'piston' ? 'ENGINE RPM' : 'ENGINE N1'][i]))));
      instruments.append(rows);
    }

    // ---- switches (left) ----
    switches.replaceChildren();
    const sw = (id, label, action, tooltip, o = {}) => {
      const s = toggle({ label, tone: o.tone, guard: o.guard, tooltip, onClick: () => c.perform(action) });
      ui.switches[id] = s;
      switches.append(s.el);
    };
    sw('lights', 'LIGHTS', 'lights', 'Exterior lights (L)', { tone: 'green' });
    sw('pitot', 'PITOT', 'pitot_heat', 'Pitot heat clears ice from the airspeed sensor (I)', { tone: 'green' });
    if (spec.class === 'Airliner' || spec.class === 'Business jet') sw('apu', 'APU', 'apu_toggle', 'Auxiliary power unit (U): needs Fuel management and APU', { tone: 'green' });
    sw('assist', 'ASSIST', 'assist_cycle', 'Flight assist: off / light / full (J)', { tone: 'cyan' });
    sw('camera', 'VIEW', 'camera_cycle', 'Change camera (C)', { tone: 'cyan' });
    if (nEng > 1 && sys.perEngine) sw('sel', 'ENG', 'engine_cycle', 'Choose which engine the throttle keys move ( ] )', { tone: 'cyan' });
    sw('fire', 'FIRE', 'fire_extinguish', 'Discharge the fire bottle (shut the engine down first)', { tone: 'red', guard: true });
    // Brake pedal (hold) and parking brake handle.
    const pedal = h('button.d-pedal', { type: 'button' }, 'BRAKES');
    const hold = (on) => { c.uiBrake = on; pedal.classList.toggle('on', on); };
    pedal.addEventListener('pointerdown', (e) => { e.preventDefault(); pedal.setPointerCapture(e.pointerId); hold(true); });
    pedal.addEventListener('pointerup', () => hold(false));
    pedal.addEventListener('pointercancel', () => hold(false));
    tip(pedal, 'Hold for wheel brakes (Space)');
    const park = h('button.d-tbar', { type: 'button', 'aria-label': 'Parking brake' }, h('i'), h('span', 'PARK'));
    park.addEventListener('pointerdown', (e) => e.preventDefault());
    park.addEventListener('click', () => c.perform('parking_brake'));
    tip(park, 'Parking brake (B)');
    ui.park = park;
    switches.append(h('div.d-brakes', pedal, park));

    // ---- quadrant (right) ----
    quadrant.replaceChildren();
    const abSpec = spec.engines.spec;
    const zone = abSpec.afterburner ? { from: abSpec.abThreshold ?? 0.85, to: 1 } : null;
    const levers = sys.perEngine ? nEng : 1;
    const group = h('div.d-group');
    for (let i = 0; i < levers; i++) {
      const lv = lever({
        label: sys.perEngine ? `THR ${i + 1}` : nEng > 1 ? 'THR ALL' : 'THR',
        tone: 'throttle', zone, ticks: [{ v: 0 }, { v: 0.25 }, { v: 0.5 }, { v: 0.75 }, { v: 1 }], caps: [abSpec.afterburner ? 'AB' : 'MAX', 'IDLE'],
        onInput: (v) => { if (sys.perEngine) c.setEngine(i, v); else c.setMaster(v); },
        tooltip: sys.perEngine ? `Engine ${i + 1} throttle: drag, scroll or use the keys` : 'Throttle: drag, scroll, Shift/Ctrl or the triggers',
      });
      ui.levers.push({ lv, index: i });
      group.append(lv.el);
    }
    if (sys.fuel && (engineType === 'piston' || engineType === 'turboprop')) {
      if (engineType === 'piston') {
        const mix = lever({ label: 'MIXTURE', tone: 'mixture', ticks: [{ v: 0 }, { v: 0.5 }, { v: 1 }], caps: ['RICH', 'LEAN'], onInput: (v) => { m.controls.mixture = v; }, tooltip: 'Mixture: lean for thin air, rich for takeoff and landing ( - / = )' });
        ui.mix = mix; group.append(mix.el);
      }
      const prop = lever({ label: 'PROP', tone: 'prop', ticks: [{ v: 0 }, { v: 0.5 }, { v: 1 }], caps: ['HIGH', 'LOW'], onInput: (v) => { m.controls.prop = v; }, tooltip: 'Propeller speed: high for takeoff and landing ( 8 / 9 )' });
      ui.prop = prop; group.append(prop.el);
    }
    quadrant.append(group);

    // Flap lever with detents.
    const stages = spec.flaps.stages;
    const fl = lever({
      label: 'FLAPS', tone: 'flaps', height: 100, scaleLabels: true, detents: stages.map((_, i) => 1 - i / (stages.length - 1)),
      ticks: stages.map((st, i) => ({ v: 1 - i / (stages.length - 1), label: st.deg === 0 ? 'UP' : `${st.deg}` })),
      onInput: (v) => c.setFlaps(Math.round((1 - v) * (stages.length - 1))),
      tooltip: 'Flap lever: drag to a detent (F / V). Automatic flaps follow airspeed unless Manual flaps is on.',
    });
    ui.flaps = fl;
    const right = h('div.d-group.small', fl.el);

    // Gear lever.
    if (spec.gear.retractable) {
      const lights = h('div.d-gear-lights', h('i.g', { title: 'Down and locked' }), h('i.r', { title: 'In transit' }), h('i.u', { title: 'Up' }));
      const handle = h('div.d-gear-handle', h('i.d-wheel'));
      const gear = h('button.d-gear', { type: 'button', 'aria-label': 'Landing gear lever' }, h('div.d-gear-slot'), handle, lights, h('span.d-name', 'GEAR'));
      gear.addEventListener('pointerdown', (e) => e.preventDefault());
      gear.addEventListener('click', () => c.perform('gear'));
      tip(gear, 'Landing gear lever (G): down and locked shows green');
      ui.gear = { gear, handle, lights };
      right.append(gear);
    } else right.append(h('div.d-fixed', h('span', 'GEAR'), h('b', 'FIXED')));

    // Trim wheel.
    const wheel = h('div.d-wheel-trim', h('div.d-drum'));
    const tbar = h('div.d-trim-mark');
    const trim = h('div.d-trim', h('span.d-name', 'TRIM'), h('div.d-trim-body', wheel, h('div.d-trim-scale', tbar)));
    let lastY = null;
    const nudge = (d) => { m.controls.trim = clamp(m.controls.trim + d, -1, 1); };
    wheel.addEventListener('pointerdown', (e) => { lastY = e.clientY; wheel.setPointerCapture(e.pointerId); e.preventDefault(); });
    wheel.addEventListener('pointermove', (e) => { if (lastY == null) return; nudge(-(e.clientY - lastY) * 0.012); lastY = e.clientY; });
    wheel.addEventListener('pointerup', () => { lastY = null; });
    wheel.addEventListener('pointercancel', () => { lastY = null; });
    wheel.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); nudge(-Math.sign(e.deltaY) * 0.03); }, { passive: false });
    wheel.addEventListener('dblclick', () => { m.controls.trim = 0; });
    tip(wheel, 'Pitch trim: drag or scroll (Page Up / Down); double-click to centre');
    ui.trim = { tbar, drum: wheel.firstChild };
    right.append(trim);

    // Speedbrake lever.
    if (spec.aero.speedbrakeCd > 0) {
      const sb = toggle({ label: 'SPD BRK', tone: 'amber', tooltip: 'Speedbrake (X)', onClick: () => c.perform('speedbrake') });
      ui.switches.speedbrake = sb;
      switches.insertBefore(sb.el, switches.querySelector('.d-brakes'));
    }
    quadrant.append(right);
  }

  let flash = 0;

  /** Per-frame refresh: instruments and the state of every control from the real aircraft. */
  function update(t, show) {
    const m = hud.model;
    const visible = show && !!m;
    if (el.hidden === visible) el.hidden = !visible;
    if (!visible) return;
    build();
    if (collapsed) {
      ui.ann.forEach(({ lamp, test }) => lamp.classList.toggle('lit', !!test(t, m)));
      return;
    }
    flash = (flash + 1) % 8;
    for (const d of ui.dials) d.draw(t);
    for (const s of ui.screens) {
      s.draw(t);
      if (!t.powered) { s.ctx.fillStyle = 'rgba(4,7,10,0.93)'; s.ctx.fillRect(0, 0, s.w, s.h); s.ctx.fillStyle = COLORS.amber; s.ctx.font = 'bold 30px Arial'; s.ctx.textAlign = 'center'; s.ctx.fillText('NO POWER', s.w / 2, s.h / 2); }
    }
    ui.ann.forEach(({ lamp, test }) => {
      const on = !!test(t, m);
      lamp.classList.toggle('lit', on);
      lamp.classList.toggle('flash', on && lamp.dataset.tone === 'red' && flash < 4);
    });
    const per = hud.systems.perEngine;
    for (const { lv, index } of ui.levers) {
      const v = per ? t.throttle[index] : Math.max(...t.throttle);
      if (!lv.dragging) lv.set(v);
      const e = t.engines[Math.min(index, t.engines.length - 1)];
      lv.readout.textContent = `${Math.round(v * 100)}%`;
      lv.el.classList.toggle('dead', !!hud.model.engines[index]?.failed);
      lv.el.classList.toggle('sel', per && (hud.controls.selected === index || hud.controls.selected == null));
      lv.el.dataset.n1 = e.n1.toFixed(0);
    }
    if (ui.mix && !ui.mix.dragging) ui.mix.set(t.mixture);
    if (ui.prop && !ui.prop.dragging) ui.prop.set(t.prop);
    const stages = m.spec.flaps.stages;
    if (!ui.flaps.dragging) ui.flaps.set(1 - m.controls.flapsStage / (stages.length - 1));
    ui.flaps.readout.textContent = `${Math.round(t.flaps)}°`;
    ui.flaps.el.classList.toggle('auto', !hud.systems.manualFlaps);
    if (ui.gear) {
      const down = m.controls.gearDown;
      ui.gear.gear.classList.toggle('down', down);
      ui.gear.gear.classList.toggle('auto', !hud.systems.manualGear);
      const transit = t.gear > 0.02 && t.gear < 0.98;
      const [g, r, u] = ui.gear.lights.children;
      g.classList.toggle('lit', t.gear >= 0.98);
      r.classList.toggle('lit', transit);
      u.classList.toggle('lit', t.gear <= 0.02 && !down);
    }
    ui.trim.tbar.style.top = `${50 - m.controls.trim * 46}%`;
    ui.trim.drum.style.backgroundPositionY = `${m.controls.trim * 160}px`;
    ui.park.classList.toggle('on', m.controls.parkingBrake);
    const s = ui.switches;
    s.lights?.set(m.controls.lights);
    s.pitot?.set(m.sys.pitot.heat, t.failures.some((f) => f.id === 'pitot'));
    s.apu?.set(m.sys.apu.switchOn, false);
    s.assist?.set(hud.settings.get('flightAssist') !== 'off');
    s.assist?.el.setAttribute('data-value', hud.settings.get('flightAssist'));
    s.speedbrake?.set(m.controls.speedbrake);
    s.camera?.set(false);
    s.sel?.set(hud.controls.selected != null);
    const fire = t.failures.some((f) => f.id.startsWith('fire'));
    s.fire?.set(false, fire && flash < 4);
  }

  return { el, update, rebuild: () => { built = null; }, setCollapsed, toggleCollapsed: () => setCollapsed(!collapsed), get collapsed() { return collapsed; } };
}
