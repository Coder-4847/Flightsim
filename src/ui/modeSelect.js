import { VIP_CONTRACTS } from '../modes/vip.js';
import { MISSIONS } from '../modes/missions.js';
import { dailySeed } from '../modes/emergency.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { createPilotBar, credits } from './pilotBar.js';

// The game-mode hub: Quick Flight (the sandbox), Free Flight, Career, Emergency Landing and VIP
// Escort, plus the shop and pilot (save) management.

export function createModeSelect({ saves, onPick, onShop, onPilots, onBack }) {
  const MODES = [
    { id: 'quick', ico: 'plane', title: 'Quick Flight', blurb: 'The sandbox: any aircraft, airport, weather and time of day. Nothing is earned or lost.', status: () => 'Everything unlocked' },
    { id: 'free', ico: 'map', title: 'Free Flight', blurb: 'Fly anywhere in an aircraft you own. Distance, passengers, cargo, landings and sightseeing all pay.',
      status: (s) => (s ? `${s.aircraft.length} aircraft in your hangar` : 'Needs a pilot') },
    { id: 'career', ico: 'star', title: 'Career', blurb: `${MISSIONS.length} contracts from light props to airliners, each paying out and unlocking the next.`,
      status: (s) => (s ? `${Object.keys(s.career.completed).length} / ${MISSIONS.length} complete · ${Object.values(s.career.completed).reduce((n, m) => n + m.stars, 0)} ★` : 'Needs a pilot') },
    { id: 'emergency', ico: 'alert', title: 'Emergency Landing', blurb: 'Something fails in flight. Find a suitable airport and get the aircraft down safely. Every scenario is seeded.',
      status: (s) => (s ? `${s.emergency.played} played · today's seed ${dailySeed()}` : 'Needs a pilot') },
    { id: 'vip', ico: 'crown', title: 'VIP Escort', blurb: 'Carry an important passenger. Smooth flying keeps them comfortable; a hard landing cuts the fare.',
      status: (s) => (s ? `${Object.keys(s.vip.completed).length} / ${VIP_CONTRACTS.length} escorts done` : 'Needs a pilot') },
  ];
  const cards = MODES.map((m) => {
    const status = h('span.mode-status');
    const card = h('button.mode-card', { type: 'button', dataset: { id: m.id }, onclick: () => onPick(m.id) },
      h('span.mode-ico', icon(m.ico, 24)), h('span.mode-title', m.title), h('span.mode-blurb', m.blurb), status);
    card.paint = () => { status.textContent = m.status(saves.active); };
    return card;
  });
  const bar = createPilotBar(saves, { onClick: onPilots });
  const hint = h('p.help');
  const el = h('section.select-screen',
    h('div.select-card.wide',
      h('header.settings-head',
        h('div.setup-title', h('h2', 'Choose a mode'), h('span.setup-map', 'Free Flight, Career, Emergency and VIP need a pilot to track your money and progress.')),
        h('div.head-actions', bar, h('button.btn.small', { onclick: onBack }, 'Back')),
      ),
      h('div.select-body',
        h('div.mode-grid', cards),
        h('div.mode-extra',
          h('button.btn', { onclick: onShop }, 'Shop: aircraft, liveries, upgrades'),
          h('button.btn', { onclick: onPilots }, 'Pilots and saves'),
        ),
        hint,
      ),
    ),
  );
  el.refresh = () => {
    cards.forEach((c) => c.paint());
    bar.refresh();
    const s = saves.active;
    hint.textContent = s ? `Flying as ${s.name} · ${credits(s.money)} · ${s.stats.flights} flights, ${s.stats.landings} landings, ${s.stats.distanceKm.toFixed(0)} km` : 'No pilot selected: only Quick Flight is available. Create one in Pilots and saves.';
  };
  saves.on('change', el.refresh);
  saves.on('money', el.refresh);
  el.refresh();
  return el;
}
