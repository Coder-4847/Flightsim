import { h } from './dom.js';

// Phase 2 flight HUD: a compact data strip, warnings, toasts, touchdown report and the
// crash screen. The full instrument HUD with panels and ATC arrives in Phase 4.

const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '--');

export function createFlightHud({ onRestart, onSelect, onMenu }) {
  const cell = (label, unit = '') => {
    const value = h('span.v', '--');
    const el = h('div.cell', h('span.l', label), value, unit && h('span.u', unit));
    return { el, value };
  };
  const cells = {
    ias: cell('IAS', 'kt'), alt: cell('ALT', 'ft'), hdg: cell('HDG', '°'),
    vs: cell('V/S', 'fpm'), thr: cell('THR', '%'), fuel: cell('FUEL', 'kg'),
  };
  const strip = h('div.strip', Object.values(cells).map((c) => c.el));
  const status = h('div.status');
  const warnings = h('div.warnings');
  const toast = h('div.toast');
  const info = h('div.cam-info');
  const hint = h('div.flight-hint');
  const touchdown = h('div.touchdown');

  const crashTitle = h('h2', 'Crashed');
  const crashReason = h('p.crash-reason');
  const crash = h('div.crash-card', { hidden: true },
    crashTitle, crashReason,
    h('div.crash-actions',
      h('button.btn.primary', { onclick: onRestart }, 'Restart flight'),
      h('button.btn', { onclick: onSelect }, 'Choose aircraft'),
      h('button.btn', { onclick: onMenu }, 'Main menu'),
    ),
  );

  const el = h('div.flight-hud', warnings, info, toast, touchdown, hint, strip, status, crash);

  let toastTimer = 0;
  let touchdownTimer = 0;
  let hintTimer = 0;

  el.showToast = (text) => {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
  };

  el.showTouchdown = (event) => {
    touchdown.replaceChildren(
      h('span.td-grade', { dataset: { grade: event.grade.toLowerCase().replace(' ', '-') } }, event.grade),
      h('span.td-detail', `${fmt(event.fpm)} ft/min · ${fmt(event.speed / 0.514444)} kt`),
    );
    touchdown.classList.add('show');
    clearTimeout(touchdownTimer);
    touchdownTimer = setTimeout(() => touchdown.classList.remove('show'), 6500);
  };

  el.showHint = (text) => {
    hint.textContent = text;
    hint.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.remove('show'), 14000);
  };

  el.setCrash = (reason) => {
    crash.hidden = !reason;
    if (reason) crashReason.textContent = reason;
  };

  // Called every few frames with the model telemetry.
  el.update = (t, extra) => {
    cells.ias.value.textContent = fmt(t.ias);
    cells.alt.value.textContent = fmt(t.altitudeFt);
    cells.hdg.value.textContent = fmt(t.heading).padStart(3, '0');
    cells.vs.value.textContent = fmt(Math.round(t.vsFpm / 10) * 10);
    cells.thr.value.textContent = fmt(Math.max(...t.throttle) * 100);
    cells.fuel.value.textContent = fmt(t.fuel);

    const gear = t.gear > 0.98 ? 'DOWN' : t.gear < 0.02 ? 'UP' : 'TRANSIT';
    const flags = [
      `FLAPS ${fmt(t.flaps)}°`,
      extra.fixedGear ? 'GEAR FIXED' : `GEAR ${gear}`,
      t.parkingBrake ? 'PARK BRAKE' : '',
      t.tanks.length ? `CG ${fmt(t.cg * 100, 1)}% MAC` : '',
      `G ${fmt(t.nz, 1)}`,
      `AoA ${fmt(t.alpha)}°`,
      `ASSIST ${extra.assist.toUpperCase()}`,
      extra.windText,
    ].filter(Boolean);
    status.textContent = flags.join('   ·   ');

    const w = [];
    if (t.stallWarning || t.stalled) w.push(['STALL', 'red']);
    if (t.overspeed) w.push(['OVERSPEED', 'red']);
    if (!extra.fixedGear && t.gear < 0.98 && t.aglFt < 600 && t.ias < extra.gearSpeed && !t.onGround) w.push(['GEAR', 'amber']);
    if (t.fuel < t.fuelCapacity * 0.08) w.push(['LOW FUEL', 'amber']);
    if (t.fuel <= 0) w.push(['FUEL EXHAUSTED', 'red']);
    if (t.speedbrake > 0.5) w.push(['SPEEDBRAKE', 'info']);
    if (t.afterburner > 0.5) w.push(['AFTERBURNER', 'info']);
    warnings.replaceChildren(...w.map(([text, tone]) => h('span.warn', { dataset: { tone } }, text)));
    info.textContent = extra.cameraLabel;
  };

  el.setVisible = (visible) => { el.classList.toggle('active', visible); };
  return el;
}
