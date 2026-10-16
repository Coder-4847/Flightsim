import { AIRCRAFT } from '../aircraft/index.js';
import { hasModel } from '../aircraft/aircraftView.js';
import { START_MODES } from '../game/startPoints.js';
import { loadJSON, saveJSON } from '../storage/store.js';
import { buildMap } from '../world/mapBuilder.js';
import { MAPS } from '../world/maps.js';
import { createAircraftPreview } from './aircraftPreview.js';
import { h } from './dom.js';
import { SETTINGS_SCHEMA } from '../storage/settings.js';
import { ECONOMY, liveriesFor, specWithLivery } from '../progress/catalog.js';
import { createPilotBar, credits } from './pilotBar.js';
import { MAX_UPGRADES, specWithTuning, totalLevels } from '../progress/tuning.js';

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

export function createFlightSetup({ settings, saves, onFly, onBack, onShop }) {
  let kind = 'quick'; // 'quick' (sandbox, everything unlocked) or 'free' (owned aircraft, earns money)
  const saved = loadJSON('flightsetup', {}) ?? {};
  const state = {
    aircraftId: saved.aircraftId ?? 'cessna172', mapId: saved.mapId ?? 'grasslands', airportCode: saved.airportCode ?? null,
    endId: saved.endId ?? null, startMode: saved.startMode ?? 'runway', hour: saved.hour ?? 12, sky: saved.sky ?? 'clear',
    quickLiveries: saved.quickLiveries ?? {},
  };

  const aircraftGrid = h('div.aircraft-grid.compact');
  const airportList = h('div.airport-list');
  const runwayRow = h('div.segmented.wrap', { role: 'group' });
  const runwayInfo = h('p.help');
  const startRow = h('div.segmented', { role: 'group' });
  const startHint = h('p.help');
  const timeRow = h('div.segmented', { role: 'group' });
  const hourSlider = h('input', { type: 'range', min: 0, max: 23.9, step: 0.1, value: state.hour, 'aria-label': 'Hour of day' });
  const hourLabel = h('span.range-value', formatHour(state.hour));
  const skyRow = h('div.segmented.wrap', { role: 'group' });
  const mapTitle = h('span.setup-map');
  const liveryRow = h('div.segmented.wrap', { role: 'group', 'aria-label': 'Paint scheme' });
  const ownNote = h('p.help');
  const pilot = createPilotBar(saves);
  const shopBtn = h('button.btn.small', { onclick: () => onShop?.() }, 'Shop');
  const flyBtn = h('button.btn.small.primary', { onclick: () => fly() }, 'Fly');
  const modeRow = h('div.segmented', { role: 'group' });
  const modeHint = h('p.help');
  const systemList = h('div.system-list');
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

  const persist = () => saveJSON('flightsetup', state);
  const preview = createAircraftPreview();
  const specSheet = h('dl.spec-sheet');
  const specName = h('div.preview-name');
  const specBlurb = h('p.help');

  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  function paintPreview() {
    const stock = AIRCRAFT.find((a) => a.id === state.aircraftId) ?? AIRCRAFT[0];
    const levels = kind === 'free' && saves.active ? saves.tuningFor(stock.id) : {};
    const spec = specWithTuning(stock, levels);
    if (hasModel(spec.id)) preview.set(specWithLivery(spec.id, currentLivery()));
    specName.replaceChildren(h('strong', spec.name), h('span', ` ${spec.maker}`));
    specBlurb.textContent = spec.blurb;
    const mtow = spec.mass.empty + spec.mass.payload + spec.mass.fuelCapacity;
    const rows = [
      ['Engines', `${spec.engines.positions.length} × ${spec.engines.spec.type}${spec.tanks ? ` · ${spec.tanks.length} fuel tanks` : ''}`],
      ['Max weight', `${fmt(mtow)} kg`],
      ['Wingspan', `${spec.wing.span.toFixed(1)} m`],
      ['Length', `${spec.geometry.length.toFixed(1)} m`],
      ['Cruise', `${spec.speeds.cruise} kt${spec.limits.mmo ? ` · Mach ${spec.limits.mmo.toFixed(2)} max` : ''}`],
      ['Stall (landing)', `${spec.flaps.stages.at(-1).vs} kt`],
      ['Runway', `${fmt(spec.minRunway)} m or more`],
      ['Seats', `${spec.cockpit.seats}`],
      ...(kind === 'free' && saves.active ? [['Upgrades', `${totalLevels(levels)} of ${MAX_UPGRADES} fitted (Shop > Upgrades)`]] : []),
    ];
    specSheet.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', k), h('dd', v)]));
  }

  const owns = (id) => kind !== 'free' || !saves.active || saves.ownsAircraft(id);
  const currentLivery = () => (kind === 'free' && saves.active ? saves.equippedLivery(state.aircraftId) : state.quickLiveries[state.aircraftId] ?? 'factory');

  function paintLivery() {
    liveryRow.replaceChildren(...liveriesFor(state.aircraftId).map((l) => {
      const have = kind !== 'free' || !saves.active || saves.ownsLivery(state.aircraftId, l.id);
      const b = h('button', {
        type: 'button', dataset: { id: l.id }, disabled: !have && kind === 'free' && !!saves.active,
        title: have ? l.name : `${l.name}: ${credits(l.price)} in the shop`,
        onclick: () => {
          if (kind === 'free' && saves.active) saves.equipLivery(state.aircraftId, l.id); else { state.quickLiveries[state.aircraftId] = l.id; persist(); }
          paintLivery(); paintPreview();
        },
      }, l.id === 'factory' ? 'Factory' : l.name);
      b.classList.toggle('on', currentLivery() === l.id);
      return b;
    }));
  }

  function paintOwnership() {
    const free = kind === 'free';
    pilot.hidden = !free;
    shopBtn.hidden = !free;
    aircraftGrid.querySelectorAll('button').forEach((b) => {
      const id = b.dataset.id;
      b.classList.toggle('locked', !owns(id));
      const price = b.querySelector('.ac-price');
      price.textContent = free && saves.active ? (owns(id) ? 'Owned' : `🔒 ${ECONOMY[id].price ? credits(ECONOMY[id].price) : 'Free'}`) : '';
    });
    const locked = !owns(state.aircraftId);
    flyBtn.disabled = locked || (free && !saves.active);
    ownNote.textContent = free
      ? !saves.active ? 'Choose a pilot to fly Free Flight.' : locked ? `You do not own this aircraft yet: ${credits(ECONOMY[state.aircraftId].price)} in the shop.` : 'Landings at airports pay for distance, passengers or cargo, touchdown quality and sights seen.'
      : 'Quick Flight: every aircraft is available and nothing is earned.';
    ownNote.classList.toggle('warn', free && locked);
  }

  function paintAircraft() {
    aircraftGrid.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === state.aircraftId));
    paintPreview();
    paintLivery();
    paintOwnership();
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
        runwayRow.append(h('button', {
          type: 'button', className: end.id === state.endId ? 'on' : '', dataset: { id: end.id },
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

  // Aircraft grouped by class.
  const classes = [...new Set(AIRCRAFT.map((a) => a.class))];
  for (const cls of classes) {
    aircraftGrid.append(h('h4.class-head', cls));
    for (const spec of AIRCRAFT.filter((a) => a.class === cls)) {
      const enabled = hasModel(spec.id);
      aircraftGrid.append(h('button.aircraft-card', {
        type: 'button', dataset: { id: spec.id }, disabled: !enabled,
        onclick: () => { state.aircraftId = spec.id; persist(); paintAircraft(); paintRunways(); },
        ondblclick: () => enabled && owns(spec.id) && fly(),
      },
      h('span.ac-name', spec.name),
      h('span.ac-price'),
      h('span.ac-blurb', spec.maker),
      h('span.ac-stats',
        h('span', `${spec.engines.positions.length} × ${spec.engines.spec.type}`),
        h('span', `Vs ${spec.flaps.stages.at(-1).vs} kt · Vne ${spec.limits.vne} kt`))));
    }
  }

  for (const m of START_MODES) startRow.append(h('button', { type: 'button', dataset: { id: m.id }, onclick: () => { state.startMode = m.id; persist(); paintStart(); } }, m.label));
  for (const t of TIME_PRESETS) timeRow.append(h('button', { type: 'button', dataset: { id: t.id }, onclick: () => { state.hour = t.hour; persist(); paintTime(); } }, t.label));
  hourSlider.addEventListener('input', () => { state.hour = Number(hourSlider.value); persist(); paintTime(); });
  for (const s of SKY_OPTIONS) skyRow.append(h('button', { type: 'button', dataset: { id: s.id }, onclick: () => { state.sky = s.id; persist(); paintSky(); } }, s.label));

  function fly() {
    persist();
    const map = buildMap(state.mapId);
    const airport = map.airports.find((a) => a.code === state.airportCode) ?? map.airports[0];
    onFly({
      aircraftId: state.aircraftId, mapId: state.mapId, airportCode: airport.code, endId: state.endId ?? airport.runways[0].ends[0].id,
      startMode: state.startMode, hour: state.hour, sky: state.sky, mode: kind, liveryId: currentLivery(),
    });
  }

  const row = (label, ...controls) => h('div.setup-row', h('span.setup-label', label), h('div.setup-controls', ...controls));
  const el = h('section.select-screen',
    h('div.select-card.wide',
      h('header.settings-head',
        h('div.setup-title', h('h2', 'Hangar and flight setup'), mapTitle),
        h('div.head-actions', pilot, shopBtn, h('button.btn.small', { onclick: onBack }, 'Back'), flyBtn),
      ),
      h('div.setup-body',
        h('section.setup-col', h('h3', 'Aircraft'), aircraftGrid),
        h('section.setup-col',
          h('div.preview-card', preview.canvas, h('div.preview-info', specName, specBlurb, specSheet)),
          row('Paint', liveryRow), ownNote,
          h('h3', 'Airport'), airportList,
          row('Runway', runwayRow), runwayInfo,
          row('Start', startRow), startHint,
          row('Time', timeRow, h('div.range', hourSlider, hourLabel)),
          row('Sky', skyRow),
          h('h3', 'Game mode'), row('Mode', modeRow), modeHint,
          h('details.system-details', h('summary', 'Customize systems'), systemList),
        ),
      ),
    ),
  );

  el.setMap = (mapId) => {
    state.mapId = mapId;
    mapTitle.textContent = MAPS[mapId].name;
    persist();
    buildAirportList();
    paintAircraft(); paintStart(); paintTime(); paintSky();
  };
  el.state = state;
  /** 'quick' for the sandbox, 'free' for Free Flight (owned aircraft, earns money). */
  el.setKind = (next) => {
    kind = next;
    el.querySelector('.setup-title h2').textContent = next === 'free' ? 'Free Flight: hangar and setup' : 'Quick Flight: hangar and setup';
    if (next === 'free' && saves.active && !saves.ownsAircraft(state.aircraftId)) state.aircraftId = saves.active.aircraft[0];
    paintAircraft();
  };
  saves.on('change', () => { if (el.classList.contains('active')) paintAircraft(); });
  paintMode();
  preview.start();
  paintAircraft(); paintStart(); paintTime(); paintSky();
  return el;
}
