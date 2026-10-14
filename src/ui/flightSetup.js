import { AIRCRAFT } from '../aircraft/index.js';
import { hasModel } from '../aircraft/aircraftView.js';
import { START_MODES } from '../game/startPoints.js';
import { loadJSON, saveJSON } from '../storage/store.js';
import { buildMap } from '../world/mapBuilder.js';
import { MAPS } from '../world/maps.js';
import { h } from './dom.js';

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

export function createFlightSetup({ onFly, onBack }) {
  const saved = loadJSON('flightsetup', {}) ?? {};
  const state = {
    aircraftId: saved.aircraftId ?? 'cessna172', mapId: saved.mapId ?? 'grasslands', airportCode: saved.airportCode ?? null,
    endId: saved.endId ?? null, startMode: saved.startMode ?? 'runway', hour: saved.hour ?? 12, sky: saved.sky ?? 'clear',
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

  const persist = () => saveJSON('flightsetup', state);

  function paintAircraft() {
    aircraftGrid.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === state.aircraftId));
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
    runwayInfo.textContent = `Runway ${runway.name}: ${runway.length} × ${runway.width} m ${runway.surface}, heading ${String(Math.round(end.heading)).padStart(3, '0')}°`
      + `${end.ils ? ` · ILS ${end.ils.frequency.toFixed(2)} (${end.ils.ident})` : ''} · Elevation ${Math.round(airport.elevation * 3.281)} ft`;
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
        onclick: () => { state.aircraftId = spec.id; persist(); paintAircraft(); },
        ondblclick: () => enabled && fly(),
      },
      h('span.ac-name', spec.name),
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
      startMode: state.startMode, hour: state.hour, sky: state.sky,
    });
  }

  const row = (label, ...controls) => h('div.setup-row', h('span.setup-label', label), h('div.setup-controls', ...controls));
  const el = h('section.select-screen',
    h('div.select-card.wide',
      h('header.settings-head',
        h('div.setup-title', h('h2', 'Hangar and flight setup'), mapTitle),
        h('div.head-actions', h('button.btn.small', { onclick: onBack }, 'Back'), h('button.btn.small.primary', { onclick: fly }, 'Fly')),
      ),
      h('div.setup-body',
        h('section.setup-col', h('h3', 'Aircraft'), aircraftGrid),
        h('section.setup-col',
          h('h3', 'Airport'), airportList,
          row('Runway', runwayRow), runwayInfo,
          row('Start', startRow), startHint,
          row('Time', timeRow, h('div.range', hourSlider, hourLabel)),
          row('Sky', skyRow),
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
  paintAircraft(); paintStart(); paintTime(); paintSky();
  return el;
}
