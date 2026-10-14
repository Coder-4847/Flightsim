import { getAircraft } from '../aircraft/index.js';
import { describeGoal, MISSIONS, missionUnlocked, resolveMission, TIERS } from '../modes/missions.js';
import { VIP_CONTRACTS, resolveVip } from '../modes/vip.js';
import { VIP_TIERS } from '../modes/economy.js';
import { MAPS } from '../world/maps.js';
import { h } from './dom.js';
import { createPilotBar, credits } from './pilotBar.js';

// Mission picker for Career and VIP Escort: the list of contracts (locked until the one before is
// done), and a briefing for the selected one.

const SKY_TEXT = { clear: 'clear', scattered: 'scattered cloud', overcast: 'overcast', rain: 'rain', storm: 'storm', fog: 'fog', snow: 'snow' };
const WEATHER_TEXT = { calm: 'calm', breeze: 'light breeze', crosswind: 'strong crosswind', gusty: 'gusty wind' };
const hourText = (hr) => `${String(Math.floor(hr)).padStart(2, '0')}:${String(Math.round((hr % 1) * 60)).padStart(2, '0')}`;

export function createContractScreen({ kind, saves, onStart, onBack, onPilots }) {
  const isVip = kind === 'vip';
  const list = isVip ? VIP_CONTRACTS : MISSIONS;
  const book = () => saves.active?.[isVip ? 'vip' : 'career'].completed ?? {};
  const unlocked = (id) => (isVip ? list.findIndex((m) => m.id === id) === 0 || !!book()[list[list.findIndex((m) => m.id === id) - 1]?.id] : missionUnlocked(saves.active, id));
  let selected = null;
  let gate = false;
  const bar = createPilotBar(saves, { onClick: onPilots });
  const listEl = h('div.contract-list');
  const detail = h('div.contract-detail');
  const el = h('section.select-screen',
    h('div.select-card.wide',
      h('header.settings-head',
        h('div.setup-title', h('h2', isVip ? 'VIP Escort' : 'Career'), h('span.setup-map', isVip ? 'Comfort and a gentle touchdown decide the fare.' : 'Complete a contract to unlock the next.')),
        h('div.head-actions', bar, h('button.btn.small', { onclick: onBack }, 'Back'))),
      h('div.contract-body', listEl, detail),
    ),
  );

  function stars(n) { return '★'.repeat(n) + '☆'.repeat(3 - n); }

  function paintList() {
    const done = book();
    const rows = [];
    let lastTier = 0;
    list.forEach((m, i) => {
      if (m.tier !== lastTier) {
        lastTier = m.tier;
        const t = isVip ? { name: ['Starter charters', 'Executive', 'Demanding clients', 'State occasions'][m.tier - 1] } : TIERS[m.tier - 1];
        rows.push(h('h4.tier-head', t.name));
      }
      const open = unlocked(m.id);
      const rec = done[m.id];
      const spec = getAircraft(m.aircraft);
      rows.push(h('button.contract-row' + (m.id === selected ? '.on' : '') + (open ? '' : '.locked'), {
        type: 'button', dataset: { id: m.id }, disabled: !open, onclick: () => { selected = m.id; paintList(); paintDetail(); },
      },
      h('span.cr-no', String(i + 1).padStart(2, '0')), h('span.cr-title', m.title), h('span.cr-meta', `${spec.name} · ${m.from === m.to ? m.from : `${m.from} → ${m.to}`}`),
      h('span.cr-stars', open ? (rec ? stars(rec.stars) : '') : '🔒')));
    });
    listEl.replaceChildren(...rows);
  }

  function paintDetail() {
    const def = list.find((m) => m.id === selected);
    if (!def) {
      detail.replaceChildren(h('p.help', 'Choose a contract from the list.'));
      return;
    }
    const r = isVip ? resolveVip(def) : resolveMission(def);
    const rec = book()[def.id];
    const rows = [
      ['Aircraft', `${r.spec.name} (${r.spec.class}) · loaned`],
      ['Route', `${r.fromAirport.name} (${r.from}) → ${r.toAirport.name} (${r.to})`],
      ...(r.via.length ? [['Via', r.via.map((v) => v.name).join(', ')]] : []),
      ['Distance', `${r.routeKm.toFixed(0)} km · about ${Math.round(r.estMinutes)} min`],
      ['Map', MAPS[r.map].name],
      ['Conditions', `${hourText(r.hour)} · ${SKY_TEXT[r.sky]} · ${WEATHER_TEXT[r.weatherPreset]}`],
      ['Start', r.startMode === 'final' ? 'On final approach' : 'On the runway (or at the gate)'],
      ['Fuel', `${r.fuelKg} kg loaded${def.tightFuel ? ' (tight: no big reserve)' : ''}`],
      ...(r.deadline ? [['Deadline', `Down within ${r.deadline} min or the mission fails`]] : []),
      isVip ? ['Passenger', `${def.vip} + ${def.pax} on board`] : r.pax ? ['Passengers', String(r.pax)] : r.cargoKg ? ['Cargo', `${r.cargoKg} kg`] : ['Payload', 'None'],
      [isVip ? 'Fare' : 'Contract', `${credits(r.base)}${rec ? ` (best ${credits(rec.payout)})` : ''}`],
    ];
    const extras = [];
    if (isVip) {
      extras.push(h('h4', 'Comfort and landing'),
        h('p.help', 'Passengers feel turbulence, steep banks, abrupt pitch changes and hard pulls. Keep the meter high, then land softly: the touchdown sets the final share of the fare.'),
        h('table.tier-table', VIP_TIERS.map((t) => h('tr', h('td', t.grade), h('td', t.text)))));
      if (r.arriveBy) extras.push(h('p.help', `Be on the ground within ${r.arriveBy} minutes or the fare drops 15%.`));
    } else if (r.goals.length) {
      extras.push(h('h4', 'Bonus objectives'), h('ul.bonus-list', r.goals.map((g) => h('li', `★ ${describeGoal(g)}`))), h('p.help', 'Each bonus adds a star and 15% to the pay. Replays pay half.'));
    }
    const gateRow = r.startMode === 'runway'
      ? h('label.system-toggle', h('input', { type: 'checkbox', checked: gate, onchange: (e) => { gate = e.target.checked; } }), h('span', 'Start at the gate for a full ATC flight (taxi, takeoff clearance)'))
      : null;
    detail.replaceChildren(
      h('div.detail-head', h('h3', def.title), rec && h('span.cr-stars', stars(rec.stars))),
      h('p.briefing', def.brief),
      h('dl.spec-sheet.wide', rows.flatMap(([k, v]) => [h('dt', k), h('dd', v)])),
      ...extras, gateRow,
      h('div.detail-actions', h('button.btn.primary', { onclick: () => onStart({ mode: isVip ? 'vip' : 'career', id: def.id, startMode: gate ? 'gate' : undefined }) }, rec ? 'Fly it again' : 'Start')),
    );
  }

  el.refresh = () => {
    bar.refresh();
    if (!saves.active) { detail.replaceChildren(h('p.help', 'Choose a pilot first.')); listEl.replaceChildren(); return; }
    if (!selected || !unlocked(selected)) selected = list.find((m) => unlocked(m.id) && !book()[m.id])?.id ?? list[0].id;
    paintList();
    paintDetail();
    listEl.querySelector('.contract-row.on')?.scrollIntoView({ block: 'nearest' });
  };
  el.select = (id) => { selected = id; el.refresh(); };
  return el;
}
