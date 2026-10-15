import { h } from './dom.js';
import { credits } from './pilotBar.js';
import { SLOT_COUNT } from '../progress/saves.js';

// Pilots and saves: three slots, each can be created, selected, renamed, exported to a JSON file,
// imported from one, or deleted.

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function createSavesScreen({ saves, onBack, onPicked }) {
  const list = h('div.slot-list');
  const notice = h('p.notice');
  const storageWarn = h('p.help.warn', { hidden: true }, 'This browser is not letting the game store data (private window or blocked site data). Pilots work for this session only: use Export to keep one.');
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  let importSlot = 0;
  let confirmDelete = 0;
  let editing = 0;

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      saves.importJSON(importSlot, await file.text());
      notice.textContent = `Imported into slot ${importSlot}.`;
    } catch (err) {
      notice.textContent = err.message;
    }
    paint();
  });

  function slotCard(info) {
    const { slot, save, active } = info;
    if (!save) {
      const name = h('input', { type: 'text', maxLength: 24, placeholder: `Pilot ${slot}`, 'aria-label': `Name for pilot ${slot}` });
      return h('div.slot-card.empty', { dataset: { slot } },
        h('div.slot-head', h('strong', `Slot ${slot}`), h('span.muted', 'Empty')),
        h('div.slot-actions', name,
          h('button.btn.small.primary', { onclick: () => { saves.create(slot, name.value.trim() || `Pilot ${slot}`); notice.textContent = ''; paint(); onPicked?.(); } }, 'New pilot'),
          h('button.btn.small', { onclick: () => { importSlot = slot; fileInput.click(); } }, 'Import…')));
    }
    const done = Object.keys(save.career.completed).length;
    const stats = [
      credits(save.money), `${save.aircraft.length} aircraft`, `${done} career missions`, `${save.stats.flights} flights`,
      `${save.stats.distanceKm.toFixed(0)} km`, `${save.stats.airborneHours.toFixed(1)} h airborne`,
    ];
    const rename = editing === slot
      ? h('input', { type: 'text', value: save.name, maxLength: 24, 'aria-label': 'Pilot name', onkeydown: (e) => { if (e.key === 'Enter') { saves.rename(slot, e.target.value); editing = 0; paint(); } } })
      : h('strong', save.name);
    return h('div.slot-card' + (active ? '.active' : ''), { dataset: { slot } },
      h('div.slot-head', h('span.slot-no', `Slot ${slot}`), rename, active && h('span.slot-flag', 'In use')),
      h('div.slot-stats', stats.map((s) => h('span', s))),
      h('div.slot-actions',
        h('button.btn.small' + (active ? '' : '.primary'), { onclick: () => { saves.activate(slot); notice.textContent = ''; paint(); onPicked?.(); } }, active ? 'Continue' : 'Use this pilot'),
        h('button.btn.small', { onclick: () => { if (editing === slot) { const input = list.querySelector(`[data-slot="${slot}"] input`); saves.rename(slot, input.value); editing = 0; } else editing = slot; paint(); } }, editing === slot ? 'Save name' : 'Rename'),
        h('button.btn.small', { onclick: () => { download(`flightsim-${save.name.replace(/\W+/g, '-').toLowerCase() || 'pilot'}-slot${slot}.json`, saves.exportJSON(slot)); notice.textContent = 'Save exported.'; } }, 'Export'),
        h('button.btn.small', { onclick: () => { importSlot = slot; fileInput.click(); } }, 'Import…'),
        h('button.btn.small.danger' + (confirmDelete === slot ? '.armed' : ''), { onclick: () => { if (confirmDelete === slot) { saves.delete(slot); confirmDelete = 0; notice.textContent = 'Pilot deleted.'; } else { confirmDelete = slot; } paint(); } },
          confirmDelete === slot ? 'Really delete?' : 'Delete')));
  }

  function paint() {
    storageWarn.hidden = !saves.storageFailed;
    list.replaceChildren(...saves.list().map(slotCard));
  }

  const el = h('section.select-screen',
    h('div.select-card',
      h('header.settings-head', h('h2', 'Pilots and saves'), h('div.head-actions', h('button.btn.small', { onclick: onBack }, 'Back'))),
      h('div.select-body',
        h('p.help', `${SLOT_COUNT} pilots are stored in this browser. The game saves after every landing and mission, when you pause, and when you buy something. Export a file to keep a backup or move to another device.`),
        storageWarn, list, notice, fileInput),
    ),
  );
  el.refresh = () => { confirmDelete = 0; editing = 0; notice.textContent = ''; paint(); };
  saves.on('change', paint);
  paint();
  return el;
}
