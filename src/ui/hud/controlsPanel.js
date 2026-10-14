import { h } from '../dom.js';
import { button, tip } from './panels.js';

// Flight controls panel: flap detents, gear, speedbrake, brakes, lights, trim and flight assist,
// all clickable. Buttons that are automatic in the current mode say so in their tooltip.

export function createControlsPanel(hud) {
  const panel = hud.panels.create({ id: 'controls', title: 'Flight controls', x: 352, y: 380, width: 300, hint: 'F4' });
  const flapRow = h('div.ctl-row.flaps');
  const rows = h('div.ctl-grid');
  const trimBar = h('div.trim-bar', h('div.trim-mark'));
  const trimRow = h('div.ctl-row', h('span.ctl-label', 'Trim'), button('▼', { onClick: () => nudgeTrim(-0.04), tooltip: 'Nose down (Page Down)' }), trimBar, button('▲', { onClick: () => nudgeTrim(0.04), tooltip: 'Nose up (Page Up)' }));
  panel.body.append(h('div.ctl-row', h('span.ctl-label', 'Flaps'), flapRow), rows, trimRow);
  let built = null;
  const buttons = {};

  const nudgeTrim = (d) => { const c = hud.model?.controls; if (c) c.trim = Math.max(-1, Math.min(1, c.trim + d)); };

  function build() {
    const m = hud.model;
    if (!m) return;
    const key = m.spec.id;
    if (built === key) return;
    built = key;
    flapRow.replaceChildren();
    m.spec.flaps.stages.forEach((st, i) => {
      const b = button(st.deg === 0 ? 'UP' : `${st.deg}°`, { onClick: () => hud.controls.setFlaps(i), tooltip: `Flaps ${st.deg}° (F / V)` });
      b.dataset.stage = i;
      flapRow.append(b);
    });
    rows.replaceChildren();
    const add = (id, label, action, tooltip, cond = true) => {
      if (!cond) return;
      buttons[id] = button(label, { onClick: () => hud.controls.perform(action), tooltip });
      rows.append(buttons[id]);
    };
    add('gear', 'Gear', 'gear', 'Landing gear (G)', m.spec.gear.retractable);
    add('brake', 'Park brake', 'parking_brake', 'Parking brake (B)');
    add('speedbrake', 'Speedbrake', 'speedbrake', 'Speedbrake / spoilers (X)');
    add('lights', 'Lights', 'lights', 'Exterior lights (L)');
    add('assist', 'Assist', 'assist_cycle', 'Cycle flight assist: off / light / full (J)');
    add('camera', 'Camera', 'camera_cycle', 'Cycle camera (C)');
  }

  function update(t) {
    if (!panel.isOpen) return;
    build();
    const m = hud.model;
    flapRow.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.stage) === m.controls.flapsStage));
    flapRow.classList.toggle('auto', !hud.systems.manualFlaps);
    buttons.gear?.classList.toggle('on', t.gearLever !== false && m.controls.gearDown);
    if (buttons.gear) buttons.gear.textContent = !hud.systems.manualGear ? `Gear (auto) ${m.controls.gearDown ? '▼' : '▲'}` : `Gear ${m.controls.gearDown ? '▼ down' : '▲ up'}`;
    buttons.brake?.classList.toggle('on', m.controls.parkingBrake);
    buttons.speedbrake?.classList.toggle('on', m.controls.speedbrake);
    buttons.lights?.classList.toggle('on', m.controls.lights);
    if (buttons.assist) buttons.assist.textContent = `Assist: ${hud.settings.get('flightAssist')}`;
    trimBar.firstChild.style.left = `${50 + m.controls.trim * 48}%`;
  }
  void tip;
  return { panel, update };
}
