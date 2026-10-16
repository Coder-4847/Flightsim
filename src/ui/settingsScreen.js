import { h } from './dom.js';
import { SETTINGS_SCHEMA } from '../storage/settings.js';
import { ACTIONS, CATEGORIES, labelFor, prettyKey } from '../storage/keybinds.js';
import { clearAll } from '../storage/store.js';

const SLOTS = 2; // primary + secondary keyboard binding per action

export function createSettingsScreen({ settings, bindings, input, onBack, onPilots }) {
  // ---- generated controls ---------------------------------------------------
  function controlFor(key, spec) {
    if (spec.type === 'bool') {
      const box = h('input', {
        type: 'checkbox', checked: settings.get(key),
        onchange: () => settings.set(key, box.checked),
      });
      return h('label.switch', box, h('span.switch-track'));
    }
    if (spec.type === 'options') {
      const group = h('div.segmented', { role: 'group' });
      const paint = () => group.querySelectorAll('button').forEach((b) =>
        b.classList.toggle('on', b.dataset.value === settings.get(key)));
      for (const [id, text] of spec.options) {
        group.append(h('button', {
          type: 'button', dataset: { value: id },
          onclick: () => { settings.set(key, id); paint(); },
        }, text));
      }
      paint();
      return group;
    }
    // range
    const readout = h('span.range-value', spec.format(settings.get(key)));
    const slider = h('input', {
      type: 'range', min: spec.min, max: spec.max, step: spec.step, value: settings.get(key),
      oninput: () => {
        settings.set(key, Number(slider.value));
        readout.textContent = spec.format(settings.get(key));
      },
    });
    return h('div.range', slider, readout);
  }

  const TABS = [
    { id: 'gameplay', label: 'Gameplay', sections: ['Game', 'Game systems'] },
    { id: 'display', label: 'Display', sections: ['Display'] },
    { id: 'audio', label: 'Audio', sections: ['Audio'] },
    { id: 'controls', label: 'Controls', sections: ['Touch controls', 'Controller'] },
    { id: 'access', label: 'Accessibility', sections: ['Accessibility'] },
    { id: 'data', label: 'Data', sections: [] },
  ];
  const sectionRows = new Map();
  for (const [key, spec] of Object.entries(SETTINGS_SCHEMA)) {
    if (!sectionRows.has(spec.section)) sectionRows.set(spec.section, []);
    sectionRows.get(spec.section).push(
      h('div.row', { dataset: { setting: key } },
        h('div.row-label', h('span', spec.label), spec.hint && h('small', spec.hint)),
        controlFor(key, spec),
      ),
    );
  }
  const sectionEl = (title) => h('section.group', h('h3', title), sectionRows.get(title));

  // ---- key bindings -------------------------------------------------------
  const notice = h('p.notice', { role: 'status' });
  const bindingTable = h('div.bindings');
  const filter = h('input', { type: 'search', placeholder: 'Filter actions…', 'aria-label': 'Filter key bindings', oninput: () => renderBindings() });
  let capturing = null; // { actionId, slot, device } while waiting for a key or pad button
  let padLoop = 0;

  function stopCapture() {
    capturing = null;
    input.suspended = false;
    window.removeEventListener('keydown', onCaptureKey, true);
    cancelAnimationFrame(padLoop);
  }

  function finishCapture(message) {
    notice.textContent = message;
    stopCapture();
    renderBindings();
  }

  function assign(code, pretty) {
    const { actionId, slot, device } = capturing;
    const taken = bindings.bind(actionId, device, slot, code);
    finishCapture(taken.length
      ? `${pretty} was used by ${taken.map(labelFor).join(', ')}; reassigned to ${labelFor(actionId)}.`
      : `${labelFor(actionId)} set to ${pretty}.`);
  }

  function onCaptureKey(e) {
    e.preventDefault();
    e.stopPropagation();
    const { actionId, slot, device } = capturing;
    if (e.code === 'Escape') {
      stopCapture();
      renderBindings();
      return;
    }
    if (e.code === 'Backspace' || e.code === 'Delete') {
      bindings.unbind(actionId, device, slot);
      finishCapture(`Cleared ${labelFor(actionId)}.`);
    } else if (device === 'keyboard') {
      assign(e.code, prettyKey(e.code));
    }
  }

  // Controller buttons are read straight from the gamepad while capturing.
  function pollPadCapture() {
    if (!capturing || capturing.device !== 'gamepad') return;
    for (const { name, down } of input.pad.poll()) {
      if (down) { assign(name, name); return; }
    }
    padLoop = requestAnimationFrame(pollPadCapture);
  }

  function startCapture(actionId, slot, device) {
    if (capturing) stopCapture();
    capturing = { actionId, slot, device };
    input.suspended = true;
    window.addEventListener('keydown', onCaptureKey, true);
    renderBindings();
    if (device === 'gamepad') {
      input.pad.poll(); // establish the current state so held buttons are ignored
      notice.textContent = input.pad.connected
        ? 'Press a controller button\u2026 (Esc cancels, Backspace clears)'
        : 'No controller detected. Connect one and press any button to wake it, then try again (Esc cancels).';
      padLoop = requestAnimationFrame(pollPadCapture);
    } else {
      notice.textContent = 'Press a key\u2026 (Esc cancels, Backspace clears)';
    }
  }

  function renderBindings() {
    bindingTable.replaceChildren();
    bindingTable.append(h('div.bind-row.bind-head', h('span', 'Action'), h('span.bind-keys', 'Keyboard'), h('span.bind-keys', 'Controller')));
    const q = (filter?.value ?? '').trim().toLowerCase();
    for (const category of CATEGORIES) {
      const list = ACTIONS.filter((x) => x.category === category && (!q || x.label.toLowerCase().includes(q) || category.toLowerCase().includes(q)));
      if (!list.length) continue;
      bindingTable.append(h('h4', category));
      for (const act of list) {
        const cells = (device, format) => Array.from({ length: SLOTS }, (_, slot) => {
          const list = bindings.get(act.id, device);
          const waiting = capturing && capturing.actionId === act.id && capturing.slot === slot && capturing.device === device;
          return h('button', {
            type: 'button',
            className: `key${device === 'gamepad' ? ' pad' : ''}${waiting ? ' waiting' : ''}`,
            onclick: () => startCapture(act.id, slot, device),
            title: device === 'gamepad' ? 'Click, then press a controller button' : 'Click, then press a key',
          }, waiting ? '\u2026' : list[slot] ? format(list[slot]) : '\u2014');
        });
        bindingTable.append(h('div.bind-row',
          h('span.bind-label', act.label),
          h('div.bind-keys', cells('keyboard', prettyKey)),
          h('div.bind-keys', cells('gamepad', (name) => name),
            h('button.key.reset', { type: 'button', title: `Reset ${act.label} to its defaults`, 'aria-label': `Reset ${act.label}`, onclick: () => { bindings.resetAction(act.id); notice.textContent = `${act.label} reset to its defaults.`; } }, '\u21ba')),
        ));
      }
    }
  }
  bindings.on('change', () => { if (!capturing) renderBindings(); });

  const fileInput = h('input', {
    type: 'file', accept: 'application/json', hidden: true,
    onchange: async () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      notice.textContent = bindings.importJSON(await file.text())
        ? 'Key bindings imported.'
        : 'That file is not a valid Flight Sim bindings file.';
    },
  });

  const exportBindings = () => {
    const url = URL.createObjectURL(new Blob([bindings.exportJSON()], { type: 'application/json' }));
    const a = h('a', { href: url, download: 'flightsim-keybinds.json' });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const controls = h('section.group',
    h('h3', 'Key and button bindings'),
    h('p.help', 'Two keyboard keys and two controller buttons per action (keyboard left, controller right). Reassigning a key or button that is already in use takes it from the other action. Sticks and triggers are fixed: left stick pitch/roll, right stick X rudder, right stick Y camera, triggers throttle. In menus the D-pad or left stick moves, A selects and B goes back.'),
    filter,
    notice,
    bindingTable,
    h('div.button-row',
      h('button.btn.small', { onclick: () => { bindings.resetAll(); notice.textContent = 'Key bindings reset to defaults.'; } }, 'Reset all to defaults'),
      h('button.btn.small', { onclick: exportBindings }, 'Export'),
      h('button.btn.small', { onclick: () => fileInput.click() }, 'Import'),
      fileInput,
    ),
  );

  const dataNotice = h('p.notice', { role: 'status' });
  let armed = false;
  const wipe = h('button.btn.small.danger', { onclick: () => {
    if (!armed) { armed = true; wipe.textContent = 'Really erase everything?'; return; }
    clearAll();
    location.reload();
  } }, 'Erase all game data');
  const dataGroup = h('section.group', h('h3', 'Data'),
    h('p.help', 'Pilots, money and progress live in this browser. Export a pilot from Pilots and saves to keep a backup or move it to another device.'),
    h('div.button-row', h('button.btn.small', { onclick: () => onPilots?.() }, 'Pilots and saves'),
      h('button.btn.small', { onclick: () => { settings.resetAll(); dataNotice.textContent = 'Settings reset to their defaults.'; } }, 'Reset settings'),
      wipe),
    dataNotice);

  const body = h('div.settings-body', { tabIndex: -1 });
  const tabBar = h('nav.settings-tabs', { role: 'tablist', 'aria-label': 'Settings sections' });
  let current = 'gameplay';
  function showTab(id) {
    if (capturing) stopCapture();
    current = id;
    tabBar.querySelectorAll('button').forEach((b) => { const on = b.dataset.tab === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    const tab = TABS.find((t) => t.id === id);
    const content = tab.sections.map(sectionEl);
    if (id === 'controls') content.push(controls);
    if (id === 'data') content.push(dataGroup);
    body.replaceChildren(...content);
    body.scrollTop = 0;
    if (id === 'controls') renderBindings();
  }
  for (const t of TABS) tabBar.append(h('button', { type: 'button', role: 'tab', dataset: { tab: t.id }, onclick: () => showTab(t.id) }, t.label));

  const back = () => { if (capturing) stopCapture(); armed = false; wipe.textContent = 'Erase all game data'; onBack(); };
  const el = h('section.settings-screen',
    h('div.settings-card',
      h('header.settings-head',
        h('h2', 'Settings'),
        h('button.btn.small', { onclick: back }, 'Back'),
      ),
      h('div.settings-layout', tabBar, body),
    ),
  );
  showTab('gameplay');
  el.showTab = showTab;
  // Esc closes settings. Listens on window (not the panel) because re-rendering
  // the binding table drops focus. Registered after Input's own listener, so on
  // the pause screen Input sees Esc first (ignored: current screen is 'settings').
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && el.classList.contains('active') && !capturing) back();
  });
  el.tabIndex = -1;
  el.focusPanel = () => el.focus();
  return el;
}
