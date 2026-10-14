import { AIRCRAFT } from '../aircraft/index.js';
import { hasModel } from '../aircraft/aircraftView.js';
import { ECONOMY, UPGRADES, liveriesFor, specWithLivery } from '../progress/catalog.js';
import { createAircraftPreview } from './aircraftPreview.js';
import { h } from './dom.js';
import { createPilotBar, credits } from './pilotBar.js';

// The shop: aircraft, paint schemes and upgrades, bought with money earned in the game modes.

export function createShopScreen({ saves, onBack, onPilots }) {
  let tab = 'aircraft';
  let selected = 'cessna172';
  let preview = null;
  const bar = createPilotBar(saves, { onClick: onPilots });
  const tabs = h('div.segmented', { role: 'tablist' });
  const body = h('div.shop-body');
  const notice = h('p.notice');
  const TABS = [['aircraft', 'Aircraft'], ['liveries', 'Liveries'], ['upgrades', 'Upgrades']];
  for (const [id, label] of TABS) tabs.append(h('button', { type: 'button', role: 'tab', dataset: { id }, onclick: () => { tab = id; notice.textContent = ''; paint(); } }, label));

  const say = (text) => { notice.textContent = text; };
  const needPilot = () => h('p.help', 'Create or choose a pilot first (Pilots and saves) to buy things.');

  function previewBlock(spec) {
    if (!preview) preview = createAircraftPreview();
    if (hasModel(spec.id)) preview.set(spec);
    preview.start();
    return preview.canvas;
  }

  function aircraftTab() {
    const s = saves.active;
    const cur = AIRCRAFT.find((a) => a.id === selected) ?? AIRCRAFT[0];
    const rows = AIRCRAFT.map((a) => {
      const price = ECONOMY[a.id].price;
      const owned = s?.aircraft.includes(a.id);
      return h('button.shop-row' + (a.id === selected ? '.on' : ''), { type: 'button', dataset: { id: a.id }, onclick: () => { selected = a.id; paint(); } },
        h('span.shop-name', a.name), h('span.shop-class', a.class), h('span.shop-price' + (owned ? '.owned' : ''), owned ? 'Owned' : price ? credits(price) : 'Free'));
    });
    const eco = ECONOMY[cur.id];
    const owned = s?.aircraft.includes(cur.id);
    const earns = eco.role === 'pax' ? `${eco.pax} passengers at ${eco.paxRate} cr per passenger-km` : eco.role === 'cargo' ? `${eco.cargoKg} kg cargo at ${eco.cargoRate} cr per kg-km` : 'no payload';
    const buy = h('button.btn.primary', { disabled: !s || owned || s.money < eco.price, onclick: () => {
      const r = saves.buyAircraft(cur.id, eco.price);
      say(r.ok ? `${cur.name} is yours.` : r.reason);
      paint();
    } }, owned ? 'Owned' : `Buy for ${credits(eco.price)}`);
    return h('div.shop-split',
      h('div.shop-list', rows),
      h('div.shop-detail',
        previewBlock(specWithLivery(cur.id, s ? saves.equippedLivery(cur.id) : 'factory')),
        h('h3', cur.name), h('p.help', cur.blurb),
        h('dl.spec-sheet',
          h('dt', 'Class'), h('dd', cur.class), h('dt', 'Cruise'), h('dd', `${cur.speeds.cruise} kt`), h('dt', 'Runway needed'), h('dd', `${cur.minRunway} m`),
          h('dt', 'Earns'), h('dd', `${eco.rate} cr per km, ${earns}`), h('dt', 'Landing fee'), h('dd', `${eco.landing} cr (smooth)`)),
        s ? buy : needPilot()));
  }

  function liveriesTab() {
    const s = saves.active;
    const owned = AIRCRAFT.filter((a) => !s || s.aircraft.includes(a.id));
    if (!owned.some((a) => a.id === selected)) selected = owned[0]?.id ?? 'cessna172';
    const cur = AIRCRAFT.find((a) => a.id === selected);
    const picker = h('div.shop-list', owned.map((a) => h('button.shop-row' + (a.id === selected ? '.on' : ''), { type: 'button', dataset: { id: a.id }, onclick: () => { selected = a.id; paint(); } },
      h('span.shop-name', a.name), h('span.shop-class', a.class), h('span.shop-price.owned', s ? saves.equippedLivery(a.id) : ''))));
    const equipped = s ? saves.equippedLivery(cur.id) : 'factory';
    const items = liveriesFor(cur.id).map((l) => {
      const have = !s || saves.ownsLivery(cur.id, l.id);
      const sw = l.paint ? [l.paint.base, l.paint.stripe ?? l.paint.belly, l.paint.stripe2 ?? l.paint.wing] : ['#f2f4f6', '#1f5fa8', '#c8362f'];
      const action = !s ? null : have
        ? h('button.btn.small' + (equipped === l.id ? '' : '.primary'), { disabled: equipped === l.id, onclick: () => { saves.equipLivery(cur.id, l.id); say(`${l.name} applied to the ${cur.name}.`); paint(); } }, equipped === l.id ? 'Applied' : 'Apply')
        : h('button.btn.small.primary', { disabled: s.money < l.price, onclick: () => { const r = saves.buyLivery(cur.id, l.id, l.price); say(r.ok ? `${l.name} bought and applied.` : r.reason); paint(); } }, `Buy ${credits(l.price)}`);
      return h('div.livery-row', { dataset: { id: l.id } },
        h('span.swatches', sw.map((c) => h('i', { style: `background:${c}` }))), h('span.livery-name', l.id === 'factory' ? 'Factory scheme' : l.name),
        h('span.muted', !s || have ? (equipped === l.id ? 'In use' : 'Owned') : ''), action);
    });
    return h('div.shop-split', picker, h('div.shop-detail', previewBlock(specWithLivery(cur.id, equipped)), h('h3', cur.name), h('div.livery-list', items), s ? null : needPilot()));
  }

  function upgradesTab() {
    const s = saves.active;
    return h('div.upgrade-list', UPGRADES.map((u) => {
      const have = saves.ownsUpgrade(u.id);
      return h('div.upgrade-row', { dataset: { id: u.id } },
        h('div.upgrade-text', h('strong', u.name), h('span.help', u.blurb)),
        have ? h('span.shop-price.owned', 'Installed')
          : h('button.btn.small.primary', { disabled: !s || s.money < u.price, onclick: () => { const r = saves.buyUpgrade(u.id, u.price); say(r.ok ? `${u.name} installed.` : r.reason); paint(); } }, `Buy ${credits(u.price)}`));
    }), s ? null : needPilot(), h('p.help', 'Upgrades belong to the pilot and apply in Free Flight, Career, Emergency Landing and VIP Escort. Quick Flight always has everything.'));
  }

  function paint() {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === tab));
    bar.refresh();
    body.replaceChildren(tab === 'aircraft' ? aircraftTab() : tab === 'liveries' ? liveriesTab() : upgradesTab());
  }

  const el = h('section.select-screen',
    h('div.select-card.wide',
      h('header.settings-head', h('div.setup-title', h('h2', 'Shop'), h('span.setup-map', 'Spend what you earn.')), h('div.head-actions', bar, h('button.btn.small', { onclick: onBack }, 'Back'))),
      h('div.select-body', tabs, body, notice),
    ),
  );
  el.refresh = () => { notice.textContent = ''; paint(); };
  saves.on('change', () => { if (el.classList.contains('active')) paint(); });
  return el;
}
