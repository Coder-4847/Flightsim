import { AIRCRAFT } from '../aircraft/index.js';
import { hasModel } from '../aircraft/aircraftView.js';
import { START_MODES } from '../game/session.js';
import { h } from './dom.js';

// Aircraft + start-position picker shown between the main menu and loading.
export function createAircraftSelect({ onFly, onBack }) {
  let selected = AIRCRAFT[0].id;
  let mode = START_MODES[0].id;
  const grid = h('div.aircraft-grid');
  const modeRow = h('div.segmented', { role: 'group' });
  const modeHint = h('p.help');

  const paint = () => {
    grid.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === selected));
    modeRow.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === mode));
    modeHint.textContent = START_MODES.find((m) => m.id === mode).hint;
  };

  for (const spec of AIRCRAFT) {
    const enabled = hasModel(spec.id);
    grid.append(h('button.aircraft-card', {
      type: 'button', dataset: { id: spec.id }, disabled: !enabled,
      onclick: () => { selected = spec.id; paint(); },
      ondblclick: () => enabled && onFly({ aircraftId: selected, startMode: mode }),
    },
    h('span.ac-class', spec.class),
    h('span.ac-name', spec.name),
    h('span.ac-blurb', spec.blurb),
    h('span.ac-stats',
      h('span', `${spec.engines.positions.length} × ${spec.engines.spec.type === 'piston' ? 'piston' : spec.engines.spec.type}`),
      h('span', `Vs ${spec.flaps.stages.at(-1).vs} kt`),
      h('span', `Vne ${spec.limits.vne} kt`),
    )));
  }
  for (const m of START_MODES) {
    modeRow.append(h('button', { type: 'button', dataset: { id: m.id }, onclick: () => { mode = m.id; paint(); } }, m.label));
  }
  paint();

  const el = h('section.select-screen',
    h('div.select-card',
      h('header.settings-head',
        h('h2', 'Choose your aircraft'),
        h('button.btn.small', { onclick: onBack }, 'Back'),
      ),
      h('div.select-body',
        grid,
        h('div.row',
          h('div.row-label', h('span', 'Start'), modeHint),
          modeRow,
        ),
        h('div.button-row',
          h('button.btn.primary', { onclick: () => onFly({ aircraftId: selected, startMode: mode }) }, 'Fly'),
        ),
      ),
    ),
  );
  el.select = (id) => { selected = id; paint(); };
  return el;
}
