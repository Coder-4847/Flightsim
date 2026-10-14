import { h } from '../dom.js';
import { bar, button, tip, vSlider } from './panels.js';

// Engine panel: one column per engine with its N1, fuel flow and a draggable throttle lever. With
// per-engine throttle off a single lever drives them all. Mixture and propeller sliders appear on
// piston and turboprop aircraft when the systems are on.

export function createEnginePanel(hud) {
  const panel = hud.panels.create({ id: 'engines', title: 'Engines', x: 352, y: 64, width: 280, hint: 'F3' });
  const columns = h('div.eng-cols');
  const extra = h('div.eng-extra');
  const selectRow = h('div.eng-select');
  panel.body.append(columns, selectRow, extra);
  let built = null;

  function build() {
    const m = hud.model;
    if (!m) return;
    const systems = hud.systems;
    const n = m.engines.length;
    const key = `${m.spec.id}:${systems.perEngine}:${systems.fuel}`;
    if (built === key) return;
    built = key;
    columns.replaceChildren();
    selectRow.replaceChildren();
    extra.replaceChildren();
    hud.engineUi = [];
    const levers = systems.perEngine ? n : 1;
    for (let i = 0; i < levers; i++) {
      const slider = vSlider({
        height: 120, notches: 3,
        onInput: (v) => { if (systems.perEngine) hud.controls.setEngine(i, v); else hud.controls.setMaster(v); },
        tooltip: systems.perEngine ? `Engine ${i + 1} throttle (drag)` : 'Throttle (drag)',
      });
      const n1 = bar('N1');
      const ff = h('div.eng-ff', '--');
      const label = h('div.eng-name', systems.perEngine ? `ENG ${i + 1}` : n > 1 ? 'ALL' : 'ENG');
      columns.append(h('div.eng-col', label, slider.el, n1.el, ff));
      hud.engineUi.push({ slider, n1, ff, label, index: i });
    }
    if (systems.perEngine && n > 1) {
      selectRow.append(button('All', { onClick: () => hud.controls.perform('engine_all'), tooltip: 'Throttle keys move every engine ( \\ )' }));
      for (let i = 0; i < n; i++) selectRow.append(button(`${i + 1}`, { onClick: () => { hud.controls.selected = i; hud.toast(`Throttle: engine ${i + 1}`); }, tooltip: `Throttle keys move engine ${i + 1} only ( ] cycles )` }));
    }
    const type = m.spec.engines.spec.type;
    if (systems.fuel && (type === 'piston' || type === 'turboprop')) {
      if (type === 'piston') {
        const mix = vSlider({ height: 70, onInput: (v) => { m.controls.mixture = v; }, tooltip: 'Mixture: lean for thin air, rich for takeoff and landing ( − / = )' });
        extra.append(h('div.eng-col', h('div.eng-name', 'MIX'), mix.el));
        hud.engineUi.mix = mix;
      }
      const prop = vSlider({ height: 70, onInput: (v) => { m.controls.prop = v; }, tooltip: 'Propeller speed: high for takeoff and landing, lower in cruise ( 8 / 9 )' });
      extra.append(h('div.eng-col', h('div.eng-name', 'PROP'), prop.el));
      hud.engineUi.prop = prop;
    }
  }

  function update(t) {
    if (!panel.isOpen) return;
    build();
    const ui = hud.engineUi ?? [];
    ui.forEach((u) => {
      const e = t.engines[u.index] ?? t.engines[0];
      if (!u.slider.dragging) u.slider.set(hud.systems.perEngine ? t.throttle[u.index] : Math.max(...t.throttle));
      u.n1.set(e.n1 / 100, `${e.n1.toFixed(0)}%`);
      u.n1.fill.style.background = e.n1 > 98 ? 'var(--danger)' : 'var(--accent)';
      u.ff.textContent = `${(e.fuelFlow * 3600).toFixed(0)} kg/h`;
      u.label.classList.toggle('on', hud.systems.perEngine && (hud.controls.selected === u.index || hud.controls.selected == null));
      const failed = hud.model.engines[u.index]?.failed;
      u.label.classList.toggle('bad', !!failed);
    });
    if (ui.mix && !ui.mix.dragging) ui.mix.set(t.mixture);
    if (ui.prop && !ui.prop.dragging) ui.prop.set(t.prop);
  }
  void tip;
  return { panel, update, rebuild: () => { built = null; } };
}
