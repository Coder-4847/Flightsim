import { h } from './dom.js';
import { ACTIONS } from '../storage/keybinds.js';

// On-screen flight controls for phones and tablets: a control yoke (pitch and roll), a rudder slider, a throttle
// slider, the buttons used most, and a menu sheet that holds every other action the keyboard has. Everything goes
// through the same Input layer as the keys (virtualDown / virtualTap) or the analog touch axes that FlightControls
// reads like a gamepad stick, so it behaves exactly like the PC controls.

const STAY_OPEN = new Set(['time_faster', 'time_slower', 'throttle_idle', 'throttle_full', 'engine_cycle', 'engine_all', 'brake_left', 'brake_right']);
const HOLD = new Set(['brakes', 'brake_left', 'brake_right', 'throttle_up', 'throttle_down', 'trim_up', 'trim_down', 'mixture_rich', 'mixture_lean', 'prop_up', 'prop_down']);
const AXES = new Set(['pitch_up', 'pitch_down', 'roll_left', 'roll_right', 'yaw_left', 'yaw_right']);
const DIRECT = new Set(['pause', 'camera_cycle', 'map_toggle', 'gear', 'flaps_down', 'flaps_up', 'brakes', 'lights', 'speedbrake', 'trim_up', 'trim_down']);
const SHORT = {
  radio_menu: 'Radio', checklist_toggle: 'Checklist', panel_pfd: 'Display', panel_engines: 'Engines', panel_controls: 'Controls', panel_systems: 'Systems',
  panel_approach: 'Approach', panel_mission: 'Mission', panel_autopilot: 'Autopilot panel', hud_toggle: 'Hide HUD', dashboard_toggle: 'Dashboard',
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function isTouchDevice() {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse || (navigator.maxTouchPoints > 1 && !matchMedia('(hover: hover)').matches);
}

const YOKE_SVG = `<svg viewBox="0 0 200 200" aria-hidden="true">
  <rect x="92" y="96" width="16" height="104" rx="8" fill="#2a2825" stroke="#0a0908" stroke-width="2"/>
  <path d="M30 64 Q30 120 62 120 L138 120 Q170 120 170 64 L170 50 Q170 36 156 36 L146 36 Q132 36 132 50 L132 76 L68 76 L68 50 Q68 36 54 36 L44 36 Q30 36 30 50 Z" fill="#3a3733" stroke="#0a0908" stroke-width="3"/>
  <rect x="38" y="30" width="30" height="46" rx="12" fill="#17161a" stroke="#ffb02e" stroke-width="2"/>
  <rect x="132" y="30" width="30" height="46" rx="12" fill="#17161a" stroke="#ffb02e" stroke-width="2"/>
  <circle cx="100" cy="98" r="11" fill="#ffb02e" stroke="#1a1100" stroke-width="2"/>
</svg>`;

export function createTouchControls(hud, input, settings) {
  const controls = () => hud.controls;
  let active = false;
  let needHint = false;

  // ---- helpers ------------------------------------------------------------------------------------------------------
  const btn = (label, { action, hold = HOLD.has(action), cls = '', title = '' } = {}) => {
    const b = h(`button.tc-btn${cls ? `.${cls}` : ''}`, { type: 'button', title, dataset: { action } }, label);
    const down = (e) => {
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      b.classList.add('down');
      if (hold) input.virtualDown(action, true); else input.virtualTap(action);
    };
    const up = () => { if (!b.classList.contains('down')) return; b.classList.remove('down'); if (hold) input.virtualDown(action, false); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  };

  // ---- the yoke -------------------------------------------------------------------------------------------------------
  const knob = h('div.tc-knob');
  knob.innerHTML = YOKE_SVG;
  const yoke = h('div.tc-yoke', h('div.tc-yoke-ring'), h('span.tc-cap.up', 'NOSE DOWN'), h('span.tc-cap.down', 'NOSE UP'), knob);
  let yokePointer = null;
  const expo = (v) => { const k = settings.get('touchCurve'); return v * (1 - k) + v * v * v * k; };
  function yokeMove(e) {
    const r = yoke.getBoundingClientRect();
    const R = (r.width / 2) * 0.78;
    let dx = (e.clientX - (r.left + r.width / 2)) / R;
    let dy = (e.clientY - (r.top + r.height / 2)) / R;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    input.touch.roll = expo(dx);
    input.touch.pitch = expo(dy); // finger down = pull back = nose up
    knob.style.transform = `translate(${dx * R * 0.55}px, ${dy * R * 0.55}px) rotate(${dx * 40}deg) scale(${1 + dy * 0.08})`;
  }
  function yokeEnd() {
    if (yokePointer == null) return;
    yokePointer = null;
    input.touch.yoke = false;
    input.touch.pitch = input.touch.roll = 0;
    knob.style.transform = '';
    yoke.classList.remove('held');
  }
  yoke.addEventListener('pointerdown', (e) => {
    if (yokePointer != null) return;
    e.preventDefault();
    yokePointer = e.pointerId;
    yoke.setPointerCapture(e.pointerId);
    input.touch.yoke = true;
    yoke.classList.add('held');
    yokeMove(e);
  });
  yoke.addEventListener('pointermove', (e) => { if (e.pointerId === yokePointer) yokeMove(e); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) yoke.addEventListener(type, (e) => { if (e.pointerId === yokePointer) yokeEnd(); });

  // ---- rudder slider --------------------------------------------------------------------------------------------------
  const rudderKnob = h('div.tc-rknob', h('span', '◂ ▸'));
  const rudder = h('div.tc-rudder', h('span.tc-cap.l', 'L'), h('span.tc-cap.r', 'R'), h('div.tc-rtick'), rudderKnob, h('span.tc-name', 'RUDDER'));
  let rudderPointer = null;
  function rudderMove(e) {
    const r = rudder.getBoundingClientRect();
    const v = clamp(((e.clientX - (r.left + r.width / 2)) / (r.width / 2)) * 1.15, -1, 1);
    input.touch.yaw = v;
    rudderKnob.style.transform = `translateX(${v * (r.width / 2 - 34)}px)`;
  }
  function rudderEnd() {
    if (rudderPointer == null) return;
    rudderPointer = null;
    input.touch.rudder = false;
    input.touch.yaw = 0;
    rudderKnob.style.transform = '';
  }
  rudder.addEventListener('pointerdown', (e) => {
    if (rudderPointer != null) return;
    e.preventDefault();
    rudderPointer = e.pointerId;
    rudder.setPointerCapture(e.pointerId);
    input.touch.rudder = true;
    rudderMove(e);
  });
  rudder.addEventListener('pointermove', (e) => { if (e.pointerId === rudderPointer) rudderMove(e); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) rudder.addEventListener(type, (e) => { if (e.pointerId === rudderPointer) rudderEnd(); });

  // ---- throttle slider ---------------------------------------------------------------------------------------------------
  const thrFill = h('div.tc-tfill');
  const thrKnob = h('div.tc-tknob');
  const thrRead = h('span.tc-tread', '0%');
  const throttle = h('div.tc-throttle', h('span.tc-cap.top', 'FULL'), h('span.tc-cap.bottom', 'IDLE'), h('div.tc-ttrack', thrFill), thrKnob, thrRead, h('span.tc-name', 'THROTTLE'));
  let thrPointer = null;
  let thrValue = 0;
  function thrMove(e) {
    const r = throttle.getBoundingClientRect();
    const pad = 34;
    const v = clamp(1 - (e.clientY - r.top - pad) / (r.height - pad * 2), 0, 1);
    thrValue = v;
    controls()?.setThrottle(v);
    drawThrottle(v);
  }
  function drawThrottle(v) {
    const r = throttle.getBoundingClientRect();
    const usable = r.height - 68;
    thrFill.style.height = `${v * 100}%`;
    thrKnob.style.bottom = `${34 + v * usable - 17}px`;
    thrRead.textContent = `${Math.round(v * 100)}%`;
  }
  throttle.addEventListener('pointerdown', (e) => {
    if (thrPointer != null) return;
    e.preventDefault();
    thrPointer = e.pointerId;
    throttle.setPointerCapture(e.pointerId);
    thrMove(e);
  });
  throttle.addEventListener('pointermove', (e) => { if (e.pointerId === thrPointer) thrMove(e); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) throttle.addEventListener(type, (e) => { if (e.pointerId === thrPointer) thrPointer = null; });

  // ---- buttons -------------------------------------------------------------------------------------------------------------
  const bBrake = btn('BRAKES', { action: 'brakes', cls: 'wide', title: 'Wheel brakes (hold)' });
  const bGear = btn('GEAR', { action: 'gear' });
  const bFlapUp = btn('FLAPS −', { action: 'flaps_up' });
  const bFlapDn = btn('FLAPS +', { action: 'flaps_down' });
  const bLights = btn('LIGHTS', { action: 'lights' });
  const bSpd = btn('SPD BRK', { action: 'speedbrake' });
  const bar = h('div.tc-bar', bBrake, bGear, bFlapUp, bFlapDn, bLights, bSpd);
  const trimUp = btn('▲', { action: 'trim_up', cls: 'round', title: 'Trim nose up (hold)' });
  const trimDn = btn('▼', { action: 'trim_down', cls: 'round', title: 'Trim nose down (hold)' });
  const trim = h('div.tc-trim', trimUp, h('span.tc-name', 'TRIM'), trimDn);

  const bPause = btn('PAUSE', { action: 'pause', cls: 'top' });
  const bCam = btn('CAMERA', { action: 'camera_cycle', cls: 'top' });
  const bMap = btn('MAP', { action: 'map_toggle', cls: 'top' });
  const bMenu = h('button.tc-btn.top', { type: 'button' }, 'MENU');
  const top = h('div.tc-top', bPause, bCam, bMap, bMenu);

  // ---- the menu sheet: every other action ---------------------------------------------------------------------------------
  const sheetBody = h('div.tc-sheet-body');
  const sheet = h('div.tc-sheet', { hidden: true },
    h('div.tc-sheet-card',
      h('header', h('strong', 'All controls'), h('button.tc-btn.top', { type: 'button', onclick: () => toggleSheet(false) }, 'CLOSE')),
      sheetBody));
  const categories = [];
  for (const a of ACTIONS) {
    if (AXES.has(a.id) || DIRECT.has(a.id)) continue;
    let cat = categories.find((c) => c.name === a.category);
    if (!cat) { cat = { name: a.category, items: [] }; categories.push(cat); }
    cat.items.push(a);
  }
  const sheetButtons = [];
  for (const cat of categories) {
    sheetBody.append(h('h3', cat.name), h('div.tc-grid', cat.items.map((a) => {
      const b = btn(SHORT[a.id] ?? a.label, { action: a.id, cls: 'sheet' });
      // One-shot actions (panels, switches) close the sheet; repeatable ones keep it open for another tap.
      if (!HOLD.has(a.id) && !STAY_OPEN.has(a.id)) b.addEventListener('pointerup', () => setTimeout(() => toggleSheet(false), 120));
      sheetButtons.push(b);
      return b;
    })));
  }
  function toggleSheet(open = sheet.hidden) { sheet.hidden = !open; root.classList.toggle('sheet-open', open); }
  bMenu.addEventListener('pointerdown', (e) => { e.preventDefault(); toggleSheet(); });

  const rotate = h('div.tc-rotate', h('div', h('strong', 'Rotate your device'), h('span', 'The flight controls need landscape.')));
  const root = h('div.tc', { hidden: true }, top, throttle, rudder, trim, yoke, bar, sheet, rotate);
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- activation and look -------------------------------------------------------------------------------------------------------
  function shouldBeActive() {
    const mode = settings.get('touchControls');
    return mode === 'on' || (mode === 'auto' && isTouchDevice());
  }
  function apply() {
    const was = active;
    active = shouldBeActive();
    root.hidden = !active;
    document.body.classList.toggle('touch-ui', active);
    root.classList.toggle('tc-swap', !!settings.get('touchSwap'));
    root.style.setProperty('--tc-s', String(settings.get('touchSize')));
    root.style.setProperty('--tc-o', String(settings.get('touchOpacity')));
    if (!active) { yokeEnd(); rudderEnd(); toggleSheet(false); }
    if (active && !was) needHint = true;
  }
  settings.on?.('change', ({ key }) => { if (key.startsWith('touch')) apply(); });
  apply();
  // A touch on a device that reported a mouse (hybrid laptops) switches the controls on in Automatic mode.
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && !active && settings.get('touchControls') === 'auto') { settings.set('touchControls', 'on'); }
  }, { passive: true });

  return {
    el: root,
    get active() { return active; },
    /** Keep the sliders and the lit buttons in step with the aircraft (called from the HUD update). */
    update() {
      if (!active) return;
      const c = controls();
      const m = hud.model;
      if (!c || !m) return;
      if (needHint) { needHint = false; hud.toast('Touch controls: yoke bottom right, rudder bottom left, throttle at the left edge, MENU for everything else'); }
      if (thrPointer == null) { thrValue = c.master; drawThrottle(thrValue); }
      const lit = (b, on) => b.classList.toggle('on', !!on);
      lit(bGear, m.controls.gearDown);
      lit(bLights, m.controls.lights);
      lit(bSpd, m.controls.speedbrake);
      bGear.hidden = !m.spec.gear.retractable;
      const stage = m.spec.flaps.stages[m.controls.flapsStage];
      bFlapDn.textContent = stage && stage.deg > 0 ? `FLAPS ${stage.deg}°` : 'FLAPS +';
      for (const b of sheetButtons) {
        const a = b.dataset.action;
        if (a === 'parking_brake') lit(b, m.controls.parkingBrake);
        else if (a === 'autopilot_toggle') lit(b, c.autopilot.on);
        else if (a === 'autothrottle_toggle') lit(b, c.autopilot.at);
        else if (a === 'apu_toggle') lit(b, m.sys?.apu?.on);
      }
      bMap.classList.toggle('on', false);
    },
  };
}
