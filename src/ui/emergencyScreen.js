import { getAircraft } from '../aircraft/index.js';
import { FAILURE_NAMES } from '../game/failures.js';
import { dailySeed, generateScenario } from '../modes/emergency.js';
import { MAPS } from '../world/maps.js';
import { h } from './dom.js';
import { createPilotBar } from './pilotBar.js';

// Emergency Landing setup: a seed picks the whole scenario. Use today's seed, roll a random one or
// type a number to replay a scenario exactly.

export function createEmergencyScreen({ saves, onStart, onBack, onPilots }) {
  let seed = dailySeed();
  let difficulty = 0; // 0 = decided by the seed
  const bar = createPilotBar(saves, { onClick: onPilots });
  const input = h('input', { type: 'number', min: 1, max: 99999999, value: seed, 'aria-label': 'Scenario seed' });
  const diffRow = h('div.segmented', { role: 'group' });
  const summary = h('dl.spec-sheet.wide');
  const best = h('p.help');
  const reveal = h('label.system-toggle', h('input', { type: 'checkbox', onchange: () => paint() }), h('span', 'Show the failures in advance (spoils the surprise)'));
  for (const [v, label] of [[0, 'By seed'], [1, 'Easy'], [2, 'Hard'], [3, 'Extreme']]) {
    diffRow.append(h('button', { type: 'button', dataset: { v }, onclick: () => { difficulty = v; paint(); } }, label));
  }
  const scenario = () => generateScenario(seed, difficulty || null);

  function paint() {
    input.value = seed;
    diffRow.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === difficulty));
    const sc = scenario();
    const spec = getAircraft(sc.aircraftId);
    const show = reveal.querySelector('input').checked;
    const rows = [
      ['Aircraft', `${spec.name} (${spec.class}) · loaned`],
      ['Map', MAPS[sc.mapId].name],
      ['Conditions', `${sc.sky}, ${sc.weather} wind, ${String(Math.floor(sc.hour)).padStart(2, '0')}:${String(Math.round((sc.hour % 1) * 60)).padStart(2, '0')}`],
      ['Starting', `${Math.round(sc.spawn.altitude * 3.281).toLocaleString('en-US')} ft in cruise, ${(Math.hypot(sc.spawn.x - sc.target.x, sc.spawn.z - sc.target.z) / 1000).toFixed(0)} km from the nearest suitable field`],
      ['Difficulty', ['', 'Easy', 'Hard', 'Extreme'][sc.difficulty]],
      ['Failures', show ? sc.failures.map((f) => FAILURE_NAMES[f.type]).join(' then ') : `${sc.failures.length} (revealed in flight)`],
    ];
    summary.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', k), h('dd', v)]));
    const rec = saves.active?.emergency.best[String(seed)];
    best.textContent = rec ? `Your best on seed ${seed}: grade ${rec.grade} (${rec.score}/100)` : `You have not flown seed ${seed} yet.`;
  }

  const setSeed = (n) => { seed = Math.max(1, Math.min(99999999, Math.floor(Number(n)) || 1)); paint(); };
  input.addEventListener('change', () => setSeed(input.value));
  const el = h('section.select-screen',
    h('div.select-card',
      h('header.settings-head',
        h('div.setup-title', h('h2', 'Emergency Landing'), h('span.setup-map', 'Systems fail in flight: find a suitable airport and land safely.')),
        h('div.head-actions', bar, h('button.btn.small', { onclick: onBack }, 'Back'))),
      h('div.select-body',
        h('div.setup-row', h('span.setup-label', 'Seed'), h('div.setup-controls', input,
          h('button.btn.small', { onclick: () => setSeed(dailySeed()) }, "Today's challenge"),
          h('button.btn.small', { onclick: () => setSeed(1 + Math.floor(Math.random() * 99999)) }, 'Random'))),
        h('div.setup-row', h('span.setup-label', 'Difficulty'), h('div.setup-controls', diffRow)),
        summary, reveal, best,
        h('p.help', 'Scoring: landing safely at an airport with a long enough runway is the core of it. A gentle touchdown, stopping on the runway, an undamaged airframe and a quick decision add to the score; crashing scores nothing and costs a repair bill. The same seed always plays the same way.'),
        h('div.detail-actions', h('button.btn.primary', { onclick: () => onStart({ mode: 'emergency', seed, difficulty: difficulty || null }) }, 'Start scenario'))),
    ),
  );
  el.refresh = () => { bar.refresh(); paint(); };
  el.setSeed = setSeed;
  return el;
}
