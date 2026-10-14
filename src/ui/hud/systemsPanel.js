import { h } from '../dom.js';
import { bar, button, tip } from './panels.js';

// Fuel and systems panel: tank quantities with pump switches, crossfeed, fuel dump, APU, pitot heat,
// electrical and hydraulic status, and the emergency actions (gear extension, engine shutdown, fire
// bottle). Fuel switches need the "Fuel management and APU" system.

export function createSystemsPanel(hud) {
  const panel = hud.panels.create({ id: 'systems', title: 'Fuel and systems', x: 692, y: 64, width: 300, hint: 'F7' });
  const tanks = h('div.sys-tanks');
  const switches = h('div.ctl-grid');
  const status = h('div.sys-status');
  const failures = h('div.sys-failures');
  panel.body.append(tanks, switches, status, failures);
  let built = null;
  let tankUi = [];
  const sw = {};

  function build() {
    const m = hud.model;
    if (!m) return;
    const key = `${m.spec.id}:${hud.systems.fuel}`;
    if (built === key) return;
    built = key;
    tanks.replaceChildren();
    switches.replaceChildren();
    tankUi = [];
    const list = m.tanks.length ? m.tanks : [{ id: 'all', name: 'Fuel', capacity: m.spec.mass.fuelCapacity, content: m.fuel }];
    list.forEach((tk, i) => {
      const b = bar(tk.name);
      const pump = m.tanks.length ? button('on', {
        className: 'pump', onClick: () => { if (hud.systems.fuel) { tk.pump = tk.pump === false; } else hud.toast('Pump control needs Fuel management and APU (Settings)'); },
        tooltip: `Boost pump for the ${tk.name} tank`,
      }) : null;
      tanks.append(h('div.tank-row', b.el, pump));
      tankUi.push({ b, pump, i });
    });
    const add = (id, label, action, tooltip) => { sw[id] = button(label, { onClick: () => hud.controls.perform(action), tooltip }); switches.append(sw[id]); };
    add('apu', 'APU', 'apu_toggle', 'Auxiliary power unit (U)');
    add('pitot', 'Pitot heat', 'pitot_heat', 'Pitot heat clears ice from the airspeed probe (I)');
    if (m.tanks.length) add('xfeed', 'Crossfeed', 'crossfeed', 'Let any tank feed any engine');
    if (m.sys.dumpRate) add('dump', 'Fuel dump', 'fuel_dump', 'Dump fuel down to landing weight (O)');
    add('gearEm', 'Gear emergency', 'gear_emergency', 'Gravity extension of the landing gear (Y)');
    add('shut', 'Shut engine', 'engine_shutdown', 'Shut down the selected engine (N)');
    add('restart', 'Restart', 'engine_restart', 'Restart the selected engine (T)');
    add('fire', 'Fire bottle', 'fire_extinguish', 'Discharge the fire bottle into the burning engine (Z)');
  }

  function update(t) {
    if (!panel.isOpen) return;
    build();
    const m = hud.model;
    const list = m.tanks.length ? m.tanks : [{ capacity: m.spec.mass.fuelCapacity, content: m.fuel }];
    for (const u of tankUi) {
      const tk = list[u.i];
      const frac = tk.capacity ? tk.content / tk.capacity : 0;
      u.b.set(frac, `${Math.round(tk.content)} kg`);
      u.b.fill.style.background = frac < 0.08 ? 'var(--danger)' : 'var(--accent)';
      if (u.pump) { const off = tk.pump === false; u.pump.textContent = off ? 'off' : 'on'; u.pump.classList.toggle('on', !off); }
    }
    const s = m.sys;
    sw.apu?.classList.toggle('on', s.apu.switchOn);
    if (sw.apu) sw.apu.textContent = s.apuRunning ? 'APU running' : s.apu.switchOn ? 'APU starting…' : 'APU';
    sw.pitot?.classList.toggle('on', s.pitot.heat);
    sw.xfeed?.classList.toggle('on', m.crossfeed);
    sw.dump?.classList.toggle('on', s.dumping);
    const light = (label, ok) => h(`span.sys-light.${ok ? 'ok' : 'bad'}`, label);
    status.replaceChildren(
      light(`ELEC ${s.powered ? (s.busGenerators ? 'GEN' : 'BAT') : 'OFF'}`, s.powered),
      light(`HYD ${Math.round(s.hydPressure * 100)}%`, !s.hydLost),
      light(`GEAR ${t.gear > 0.98 ? 'DOWN' : t.gear < 0.02 ? 'UP' : 'MOVING'}`, !s.gearStuck),
      h('span.sys-light.ok', `CG ${(t.cg * 100).toFixed(1)}%`),
      h('span.sys-light.ok', `GW ${(t.mass / 1000).toFixed(1)} t`),
    );
    failures.replaceChildren(...t.failures.map((f) => h(`div.sys-fail.${f.level}`, f.text)));
    if (!t.failures.length) failures.append(h('div.sys-fail.ok', 'No faults'));
  }
  void tip;
  return { panel, update, rebuild: () => { built = null; } };
}
