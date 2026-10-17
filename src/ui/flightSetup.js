import { AIRCRAFT } from '../aircraft/index.js';
import { START_MODES } from '../game/startPoints.js';
import { loadJSON, saveJSON } from '../storage/store.js';
import { buildMap } from '../world/mapBuilder.js';
import { MAPS } from '../world/maps.js';
import { icon } from './icons.js';
import { h } from './dom.js';
import { SETTINGS_SCHEMA } from '../storage/settings.js';
import { ECONOMY, liveriesFor, specWithLivery } from '../progress/catalog.js';
import { createPilotBar, credits } from './pilotBar.js';

// The hangar and flight setup screen: aircraft, airport and runway, start position, time of
// day and sky. The last choices are remembered between visits.

export const TIME_PRESETS = [
  { id: 'dawn', label: 'Dawn', hour: 6.4 },
  { id: 'day', label: 'Day', hour: 12 },
  { id: 'dusk', label: 'Dusk', hour: 18.2 },
  { id: 'night', label: 'Night', hour: 23 },
];

export const SKY_OPTIONS = [
  { id: 'clear', label: 'Clear' },
  { id: 'scattered', label: 'Scattered' },
  { id: 'overcast', label: 'Overcast' },
  { id: 'rain', label: 'Rain' },
  { id: 'storm', label: 'Storm' },
  { id: 'fog', label: 'Fog' },
  { id: 'snow', label: 'Snow' },
];

const formatHour = (hour) => `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')}`;


const CLASS_TINT = { 'Light prop': '#7ee0a8', Turboprop: '#7ee0a8', 'Jet trainer': '#ffcf6b', 'Business jet': '#8fb6ff', Airliner: '#3cc0ff', Fighter: '#ff7a8a' };
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Five comparable ratings (0..1 bars plus a display value) derived from the aircraft data. */
export function aircraftStats(spec) {
  const mtow = spec.mass.empty + spec.mass.payload + spec.mass.fuelCapacity;
  const e = spec.engines.spec;
  const n = spec.engines.positions.length;
  const thrust = e.thrust ? e.thrust * n : ((e.power * (e.propEfficiency ?? 0.8)) / 55) * n;
  const twr = thrust / (mtow * 9.81);
  const v = spec.speeds.cruise * 0.5144;
  const a = spec.aero;
  const roll = spec.fcs?.rollRate ?? (((a.clDa * spec.controls.aileron * (Math.PI / 180)) / -a.clp) * (2 * v)) / spec.wing.span * (180 / Math.PI);
  return [
    { label: 'Top speed', v: clamp01((spec.limits.vne / 750) ** 0.8), text: `${spec.limits.vne} kt` },
    { label: 'Power', v: clamp01(twr / 1.15), text: `${twr.toFixed(2)} T/W` },
    { label: 'Agility', v: clamp01((roll / 350) ** 0.8), text: `${Math.round(roll)}°/s` },
    { label: 'Capacity', v: clamp01(Math.log(spec.cockpit.seats + 1) / Math.log(401)), text: `${spec.cockpit.seats} seat${spec.cockpit.seats === 1 ? '' : 's'}` },
    { label: 'Short field', v: clamp01(1 - (spec.minRunway - 400) / 3200), text: `${fmtInt(spec.minRunway)} m` },
  ];
}
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');

export function createFlightSetup({ settings, saves, stage, onFly, onBack, onShop }) {
  let kind = 'quick'; // 'quick' (sandbox, everything unlocked) or 'free' (owned aircraft, earns money)
  let step = 'hangar'; // 'hangar' (3D aircraft choice) or 'options' (airport, start, time, sky, mode)
  const saved = loadJSON('flightsetup', {}) ?? {};
  const state = {
    aircraftId: saved.aircraftId ?? 'cessna172', mapId: saved.mapId ?? 'grasslands', airportCode: saved.airportCode ?? null,
    endId: saved.endId ?? null, startMode: saved.startMode ?? 'runway', hour: saved.hour ?? 12, sky: saved.sky ?? 'clear',
    quickLiveries: saved.quickLiveries ?? {},
  };
  const persist = () => saveJSON('flightsetup', state);
  const fmt = fmtInt;
  const indexOf = (id) => Math.max(0, AIRCRAFT.findIndex((a) => a.id === id));

  // ---- shared bits ----
  const pilot = createPilotBar(saves);
  const shopBtn = h('button.btn.small', { type: 'button', onclick: () => onShop?.() }, icon('cart', 16), 'Shop');
  const mapTitle = h('span.setup-map');
  const title = h('h2');

  // ================= step 1: the hangar =================
  const owns = (id) => kind !== 'free' || !saves.active || saves.ownsAircraft(id);
  const currentLivery = () => liveryOf(state.aircraftId);
  const liveryOf = (id) => (kind === 'free' && saves.active ? saves.equippedLivery(id) : state.quickLiveries[id] ?? 'factory');

  const chip = h('span.hg-chip');
  const nameEl = h('h3.hg-name');
  const makerEl = h('p.hg-maker');
  const blurbEl = h('p.hg-blurb');
  const statsEl = h('div.hg-stats');
  const specEl = h('dl.hg-spec');
  const card = h('div.hg-card', chip, nameEl, makerEl, blurbEl, statsEl, specEl);

  const paintRow = h('div.hg-paints', { role: 'group', 'aria-label': 'Paint scheme' });
  const paintName = h('p.hg-paint-name');
  const ownEl = h('div.hg-own');
  const pickBtn = h('button.btn.primary.hg-cta', { type: 'button', onclick: () => goOptions() }, 'Select aircraft', icon('arrowR', 18));
  const shopBtn2 = h('button.btn.small', { type: 'button', onclick: () => onShop?.() }, icon('cart', 15), 'Open shop');
  const side = h('div.hg-side', h('div.hg-label', 'Paint scheme'), paintRow, paintName, ownEl, shopBtn2, pickBtn);

  const prev = h('button.hg-arrow.prev', { type: 'button', 'aria-label': 'Previous aircraft', onclick: () => stepBy(-1) }, icon('chevL', 26));
  const next = h('button.hg-arrow.next', { type: 'button', 'aria-label': 'Next aircraft', onclick: () => stepBy(1) }, icon('chevR', 26));
  const loadingEl = h('div.hg-loading', 'Rolling out the aircraft…');

  const rail = h('div.hg-rail', { role: 'listbox', 'aria-label': 'Aircraft' });
  const tabs = AIRCRAFT.map((spec, i) => {
    const tint = CLASS_TINT[spec.class] ?? '#52d2ff';
    const lockIco = h('span.tab-lock', { hidden: true }, icon('lock', 11));
    const tab = h('button.hg-tab', { type: 'button', role: 'option', dataset: { id: spec.id }, style: `--tint:${tint}`,
      onclick: () => selectIndex(i), onfocus: () => { if (step === 'hangar' && i !== stage?.hangar.index) selectIndex(i); }, ondblclick: () => goOptions() },
    h('span.hg-tab-name', spec.name), h('span.hg-tab-class', spec.class, lockIco));
    tab.lock = lockIco;
    rail.append(tab);
    return tab;
  });
  const hint = h('p.hg-hint', 'Drag to look around · ', h('kbd', '←'), ' ', h('kbd', '→'), ' or the scroll wheel to browse · ', h('kbd', 'Enter'), ' to select');

  const hangarLayer = h('div.hg-layer.browse',
    h('header.hg-top',
      h('button.btn.small', { type: 'button', onclick: () => onBack() }, icon('arrowL', 16), 'Back'),
      h('div.hg-title', h('span.hg-kicker', 'Hangar'), title, mapTitle),
      pilot, shopBtn),
    h('div.hg-mid', card, prev, next, loadingEl, side),
    h('div.hg-bottom', rail, hint));

  function paintStats(spec) {
    const tint = CLASS_TINT[spec.class] ?? '#52d2ff';
    card.style.setProperty('--tint', tint);
    chip.style.setProperty('--tint', tint);
    side.style.setProperty('--tint', tint);
    chip.textContent = spec.class;
    nameEl.textContent = spec.name;
    makerEl.textContent = spec.maker;
    blurbEl.textContent = spec.blurb;
    statsEl.replaceChildren(...aircraftStats(spec).map((s) => {
      const fill = h('div.hg-stat-fill');
      requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${Math.round(s.v * 100)}%`; }));
      return h('div.hg-stat', h('span.hg-stat-label', s.label), h('div.hg-stat-track', fill), h('span.hg-stat-val', s.text));
    }));
    const mtow = spec.mass.empty + spec.mass.payload + spec.mass.fuelCapacity;
    specEl.replaceChildren(...[
      ['Engines', `${spec.engines.positions.length} × ${spec.engines.spec.type}`],
      ['Max weight', `${fmt(mtow)} kg`],
      ['Wingspan', `${spec.wing.span.toFixed(1)} m`],
      ['Length', `${spec.geometry.length.toFixed(1)} m`],
      ['Cruise', `${spec.speeds.cruise} kt`],
      ['Stall (landing)', `${spec.flaps.stages.at(-1).vs} kt`],
    ].flatMap(([k, v]) => [h('dt', k), h('dd', v)]));
  }

  function paintLivery() {
    const list = liveriesFor(state.aircraftId);
    paintRow.replaceChildren(...list.map((l) => {
      const have = kind !== 'free' || !saves.active || saves.ownsLivery(state.aircraftId, l.id);
      const spec = specWithLivery(state.aircraftId, l.id);
      const b = h('button.hg-paint', {
        type: 'button', dataset: { id: l.id }, disabled: !have, title: have ? l.name : `${l.name}: ${credits(l.price)} in the shop`, 'aria-label': l.name,
        style: `--c1:${cssColor(spec.livery.base)};--c2:${cssColor(spec.livery.stripe ?? spec.livery.belly ?? spec.livery.base)}`,
        onclick: () => {
          if (kind === 'free' && saves.active) saves.equipLivery(state.aircraftId, l.id); else { state.quickLiveries[state.aircraftId] = l.id; persist(); }
          paintLivery();
          stage?.hangar.setLivery(state.aircraftId);
        },
      });
      b.classList.toggle('on', currentLivery() === l.id);
      return b;
    }));
    const cur = list.find((l) => l.id === currentLivery()) ?? list[0];
    paintName.textContent = cur.id === 'factory' ? 'Factory livery' : cur.name;
  }

  function paintOwnership() {
    const free = kind === 'free';
    pilot.hidden = !free;
    shopBtn.hidden = !free;
    tabs.forEach((tab, i) => { tab.lock.hidden = !(free && saves.active && !saves.ownsAircraft(AIRCRAFT[i].id)); });
    const locked = !owns(state.aircraftId);
    const price = ECONOMY[state.aircraftId]?.price;
    pickBtn.disabled = locked || (free && !saves.active);
    shopBtn2.hidden = !(free && locked);
    ownEl.className = 'hg-own';
    ownEl.replaceChildren();
    if (!free) { ownEl.append(icon('check', 16), 'Quick Flight: every aircraft is unlocked'); ownEl.classList.add('ok'); }
    else if (!saves.active) { ownEl.append(icon('user', 16), 'Choose a pilot to fly Free Flight'); }
    else if (locked) { ownEl.append(icon('lock', 16), `Not owned yet · ${price ? credits(price) : 'free'} in the shop`); ownEl.classList.add('lock'); }
    else { ownEl.append(icon('check', 16), 'In your hangar'); ownEl.classList.add('ok'); }
  }

  function paintAircraft() {
    const stock = AIRCRAFT[indexOf(state.aircraftId)];
    paintStats(stock);
    paintLivery();
    paintOwnership();
    tabs.forEach((t) => {
      const on = t.dataset.id === state.aircraftId;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const i = indexOf(state.aircraftId);
    prev.disabled = i <= 0;
    next.disabled = i >= AIRCRAFT.length - 1;
    tabs[i]?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
    loadingEl.classList.toggle('on', !!stage && !stage.hangar.ready && step === 'hangar');
    paintOptionsHeader();
  }

  function selectIndex(i) {
    const idx = Math.max(0, Math.min(AIRCRAFT.length - 1, i));
    state.aircraftId = AIRCRAFT[idx].id;
    persist();
    stage?.hangar.select(idx);
    paintAircraft();
    paintRunways();
  }
  function stepBy(n) { selectIndex(indexOf(state.aircraftId) + n); }
  stage?.hangar.onLoad(() => { loadingEl.classList.toggle('on', !stage.hangar.ready && step === 'hangar'); });

  // Drag to orbit, wheel to browse.
  let drag = null;
  hangarLayer.addEventListener('pointerdown', (e) => {
    if (step !== 'hangar' || e.target.closest('.hg-card, .hg-side, .hg-arrow, .hg-rail, .hg-top, .hg-hint, button')) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    hangarLayer.setPointerCapture?.(e.pointerId);
    stage?.hangar.setDragging(true);
  });
  hangarLayer.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    stage?.hangar.orbit(e.clientX - drag.x, e.clientY - drag.y);
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const endDrag = (e) => { if (drag && e.pointerId === drag.id) { drag = null; stage?.hangar.setDragging(false); } };
  hangarLayer.addEventListener('pointerup', endDrag);
  hangarLayer.addEventListener('pointercancel', endDrag);
  let wheelAt = 0;
  hangarLayer.addEventListener('wheel', (e) => {
    if (step !== 'hangar' || e.target.closest('.hg-card, .hg-side')) return;
    e.preventDefault();
    if (e.ctrlKey) { stage?.hangar.zoom(e.deltaY); return; }
    const now = performance.now();
    if (now - wheelAt < 320 || Math.abs(e.deltaY) + Math.abs(e.deltaX) < 4) return;
    wheelAt = now;
    stepBy((Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) > 0 ? 1 : -1);
  }, { passive: false });

  // ================= step 2: flight options =================
  const airportList = h('div.airport-list');
  const runwayRow = h('div.chip-row', { role: 'group' });
  const runwayInfo = h('p.help');
  const startRow = h('div.chip-row', { role: 'group' });
  const startHint = h('p.help');
  const timeRow = h('div.chip-row', { role: 'group' });
  const hourSlider = h('input', { type: 'range', min: 0, max: 23.9, step: 0.1, value: state.hour, 'aria-label': 'Hour of day' });
  const hourLabel = h('span.range-value', formatHour(state.hour));
  const skyRow = h('div.chip-row', { role: 'group' });
  const modeRow = h('div.segmented', { role: 'group' });
  const modeHint = h('p.help');
  const systemList = h('div.system-list');
  const optNote = h('p.help');
  const flyBtn = h('button.btn.primary', { type: 'button', onclick: () => fly() }, icon('play', 16), 'Fly');
  const optName = h('h3.hg-name');
  const optMeta = h('p.hg-maker');
  const optChip = h('span.hg-chip');
  const PRESET_HINTS = {
    arcade: 'Single throttle, automatic flaps and gear, no ATC or checklists, a simple approach guide.',
    simulation: 'Per-engine throttle, manual flaps and gear, full ATC, systems, checklists and failures.',
    custom: 'Your own mix of systems. Every toggle below is independent.',
  };
  function paintMode() {
    const preset = settings.get('preset');
    modeRow.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === preset));
    modeHint.textContent = PRESET_HINTS[preset];
    systemList.querySelectorAll('input[type=checkbox]').forEach((box) => { box.checked = settings.get(box.dataset.key); });
    systemList.querySelectorAll('button[data-key]').forEach((b) => b.classList.toggle('on', settings.get(b.dataset.key) === b.dataset.value));
  }
  for (const [id, label] of SETTINGS_SCHEMA.preset.options) {
    modeRow.append(h('button', { type: 'button', dataset: { id }, onclick: () => settings.set('preset', id) }, label));
  }
  for (const [key, spec] of Object.entries(SETTINGS_SCHEMA)) {
    if (spec.section !== 'Game systems') continue;
    if (spec.type === 'bool') {
      const box = h('input', { type: 'checkbox', dataset: { key }, onchange: () => settings.set(key, box.checked) });
      systemList.append(h('label.system-toggle', { title: spec.hint ?? '' }, box, h('span', spec.label)));
    } else {
      const group = h('div.segmented', { role: 'group' });
      for (const [value, text] of spec.options) group.append(h('button', { type: 'button', dataset: { key, value }, onclick: () => settings.set(key, value) }, text));
      systemList.append(h('div.system-select', h('span', spec.label), group));
    }
  }
  settings.on('change', ({ key }) => { if (key === 'preset' || key.startsWith('sys_')) paintMode(); });

  function paintOptionsHeader() {
    const spec = AIRCRAFT[indexOf(state.aircraftId)];
    optName.textContent = spec.name;
    optMeta.textContent = spec.maker;
    optChip.textContent = spec.class;
    optChip.style.setProperty('--tint', CLASS_TINT[spec.class] ?? '#52d2ff');
    const locked = !owns(state.aircraftId);
    flyBtn.disabled = locked || (kind === 'free' && !saves.active);
    optNote.textContent = kind === 'free'
      ? !saves.active ? 'Choose a pilot to fly Free Flight.' : locked ? `You do not own this aircraft yet: ${credits(ECONOMY[state.aircraftId].price)} in the shop.` : 'Landings at airports pay for distance, passengers or cargo, touchdown quality and sights seen.'
      : 'Quick Flight: every aircraft is available and nothing is earned.';
    optNote.classList.toggle('warn', kind === 'free' && locked);
  }

  function paintAirports() {
    airportList.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.code === state.airportCode));
  }
  function paintRunways() {
    const map = buildMap(state.mapId);
    const airport = map.airports.find((a) => a.code === state.airportCode);
    runwayRow.replaceChildren();
    if (!airport) return;
    for (const rw of airport.runways) {
      for (const end of rw.ends) {
        runwayRow.append(h('button.opt-chip', {
          type: 'button', className: `opt-chip${end.id === state.endId ? ' on' : ''}`, dataset: { id: end.id },
          onclick: () => { state.endId = end.id; persist(); paintRunways(); },
        }, `${end.id}${end.ils ? ' · ILS' : ''}`));
      }
    }
    const { runway, end } = (() => {
      for (const rw of airport.runways) for (const e of rw.ends) if (e.id === state.endId) return { runway: rw, end: e };
      return { runway: airport.runways[0], end: airport.runways[0].ends[0] };
    })();
    const spec = AIRCRAFT.find((a) => a.id === state.aircraftId);
    const tooShort = spec && runway.length < spec.minRunway;
    runwayInfo.classList.toggle('warn', !!tooShort);
    runwayInfo.dataset.warning = tooShort ? `Short for this aircraft (needs about ${spec.minRunway} m).` : '';
    runwayInfo.textContent = `Runway ${runway.name}: ${runway.length} × ${runway.width} m ${runway.surface}, heading ${String(Math.round(end.heading)).padStart(3, '0')}°`
      + `${end.ils ? ` · ILS ${end.ils.frequency.toFixed(2)} (${end.ils.ident})` : ''} · Elevation ${Math.round(airport.elevation * 3.281)} ft`
      + `${tooShort ? ` · ⚠ ${runwayInfo.dataset.warning}` : ''}`;
  }
  function paintTime() {
    timeRow.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Math.abs(TIME_PRESETS.find((t) => t.id === b.dataset.id).hour - state.hour) < 0.05));
    hourSlider.value = state.hour;
    hourLabel.textContent = formatHour(state.hour);
  }
  function paintSky() {
    skyRow.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === state.sky));
  }
  function paintStart() {
    startRow.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === state.startMode));
    startHint.textContent = START_MODES.find((m) => m.id === state.startMode).hint;
  }

  function buildAirportList() {
    const map = buildMap(state.mapId);
    airportList.replaceChildren();
    if (!map.airports.some((a) => a.code === state.airportCode)) {
      state.airportCode = map.airports[0].code;
      state.endId = null;
    }
    const order = { hub: 0, regional: 1, small: 2, strip: 3 };
    for (const a of [...map.airports].sort((p, q) => order[p.cls] - order[q.cls])) {
      airportList.append(h('button.airport-row', {
        type: 'button', dataset: { code: a.code },
        onclick: () => { state.airportCode = a.code; state.endId = null; persist(); paintAirports(); paintRunways(); },
      },
      h('span.ap-code', a.code),
      h('span.ap-name', a.name),
      h('span.ap-meta', `${a.classLabel} · ${Math.max(...a.runways.map((r) => r.length))} m`)));
    }
    paintAirports();
    paintRunways();
  }

  const SKY_ICON = { clear: 'sun', scattered: 'cloud', overcast: 'cloud', rain: 'cloud', storm: 'alert', fog: 'cloud', snow: 'cloud' };
  const TIME_ICON = { dawn: 'sun', day: 'sun', dusk: 'moon', night: 'moon' };
  for (const m of START_MODES) startRow.append(h('button.opt-chip', { type: 'button', dataset: { id: m.id }, onclick: () => { state.startMode = m.id; persist(); paintStart(); } }, m.label));
  for (const t of TIME_PRESETS) timeRow.append(h('button.opt-chip', { type: 'button', dataset: { id: t.id }, onclick: () => { state.hour = t.hour; persist(); paintTime(); } }, icon(TIME_ICON[t.id], 15), t.label));
  hourSlider.addEventListener('input', () => { state.hour = Number(hourSlider.value); persist(); paintTime(); });
  for (const s of SKY_OPTIONS) skyRow.append(h('button.opt-chip', { type: 'button', dataset: { id: s.id }, onclick: () => { state.sky = s.id; persist(); paintSky(); } }, icon(SKY_ICON[s.id], 15), s.label));

  function fly() {
    persist();
    const map = buildMap(state.mapId);
    const airport = map.airports.find((a) => a.code === state.airportCode) ?? map.airports[0];
    onFly({
      aircraftId: state.aircraftId, mapId: state.mapId, airportCode: airport.code, endId: state.endId ?? airport.runways[0].ends[0].id,
      startMode: state.startMode, hour: state.hour, sky: state.sky, mode: kind, liveryId: currentLivery(),
    });
  }

  const section = (ico, label, ...body) => h('section.opt-section', h('h3', icon(ico, 15), label), ...body);
  const optionsLayer = h('div.hg-layer.opt-layer',
    h('header.hg-top',
      h('button.btn.small', { type: 'button', onclick: () => goHangar() }, icon('arrowL', 16), 'Change aircraft'),
      h('div.hg-title', h('span.hg-kicker', 'Flight setup'), h('h2.opt-title'), h('span.setup-map.opt-map'))),
    h('div.opt-panel',
      h('div.opt-aircraft', h('div.opt-aircraft-text', optName, optMeta), optChip),
      h('div.opt-scroll',
        section('map', 'Airport', airportList, runwayRow, runwayInfo),
        section('plane', 'Start', startRow, startHint),
        section('clock', 'Time of day', h('div.opt-time', timeRow, h('div.range', hourSlider, hourLabel))),
        section('cloud', 'Sky', skyRow),
        section('settings', 'Game mode', modeRow, modeHint, h('details.system-details', h('summary', 'Customize systems'), systemList)),
      ),
      h('div.opt-foot', optNote, h('span.spacer'), flyBtn)));
  optNote.style.flex = '1';

  const el = h('section.select-screen.hangar-screen', hangarLayer, optionsLayer);
  const optTitle = optionsLayer.querySelector('.opt-title');
  const optMap = optionsLayer.querySelector('.opt-map');

  function layers() {
    hangarLayer.classList.toggle('on', step === 'hangar');
    optionsLayer.classList.toggle('on', step === 'options');
    stage?.hangar.setFraming(step === 'options' ? 'setup' : 'browse');
    hangarLayer.inert = step !== 'hangar';
    optionsLayer.inert = step !== 'options';
  }
  function goOptions() {
    if (pickBtn.disabled) return;
    step = 'options';
    layers();
    paintOptionsHeader();
    requestAnimationFrame(() => flyBtn.focus({ preventScroll: true }));
  }
  function goHangar() {
    step = 'hangar';
    layers();
    requestAnimationFrame(() => tabs[indexOf(state.aircraftId)]?.focus({ preventScroll: true }));
  }

  const mapName = () => MAPS[state.mapId].name;
  function retitle() {
    const t = kind === 'free' ? 'Free Flight' : 'Quick Flight';
    title.textContent = t;
    mapTitle.textContent = `${mapName()} · choose your aircraft`;
    optTitle.textContent = t;
    if (optMap) optMap.textContent = mapName();
  }

  el.setMap = (mapId) => {
    state.mapId = mapId;
    persist();
    retitle();
    buildAirportList();
    paintAircraft(); paintStart(); paintTime(); paintSky();
  };
  el.state = state;
  el.liveryOf = liveryOf;
  /** 'quick' for the sandbox, 'free' for Free Flight (owned aircraft, earns money). */
  el.setKind = (next) => {
    kind = next;
    if (next === 'free' && saves.active && !saves.ownsAircraft(state.aircraftId)) state.aircraftId = saves.active.aircraft[0];
    retitle();
    paintAircraft();
  };
  /** Called by the screen manager each time the screen is shown: back to the 3D hangar with the saved aircraft up front. */
  el.onShow = () => {
    step = 'hangar';
    layers();
    stage?.hangar.select(indexOf(state.aircraftId), { instant: true });
    stage?.hangar.warm();
    paintAircraft();
    requestAnimationFrame(() => tabs[indexOf(state.aircraftId)]?.focus({ preventScroll: true }));
  };
  saves.on('change', () => { if (el.classList.contains('active')) { paintAircraft(); paintLivery(); } });
  paintMode();
  retitle();
  paintAircraft(); paintStart(); paintTime(); paintSky();
  layers();
  return el;
}

/** CSS colour from a livery value (hex string or number). */
function cssColor(c) {
  if (typeof c === 'number') return `#${c.toString(16).padStart(6, '0')}`;
  return c ?? '#888';
}
