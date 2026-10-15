import { h } from '../dom.js';
import { button } from './panels.js';

// Radio / ATC panel: the current frequency, the menu of standard phrases (1-9 on the keyboard) and
// the transcript. The menu only ever contains valid requests for the current phase.

export function createRadioPanel(hud) {
  const panel = hud.panels.create({ id: 'radio', title: 'Radio', x: 12, y: 64, width: 330, hint: 'R' });
  const freq = h('div.radio-freq', 'No frequency');
  const status = h('div.radio-status');
  const menu = h('div.radio-menu');
  const transcript = h('div.radio-log', { 'aria-live': 'polite' });
  panel.body.append(freq, status, menu, transcript);
  let atc = null;
  let unsub = [];

  function renderMenu() {
    menu.replaceChildren();
    if (!atc) return;
    if (!atc.enabled) {
      menu.append(h('p.help', 'ATC is off. Turn it on in the game mode settings (Simulation or Custom).'));
      freq.textContent = 'ATC off';
      return;
    }
    freq.textContent = atc.stationLabel;
    const items = atc.menu;
    status.textContent = phaseLabel(atc.phase);
    items.forEach((it, i) => {
      const key = i < 9 ? String(i + 1) : '';
      menu.append(h('button.radio-item', {
        type: 'button', dataset: { id: it.id },
        onmousedown: (e) => e.preventDefault(),
        onclick: () => { hud.audio?.click(); atc.request(it.id, it.arg); },
        title: it.hint ?? '',
      }, h('span.radio-key', key), h('span.radio-text', it.label + (it.children ? ' …' : ''))));
    });
    if (atc.inSubmenu) menu.append(h('button.radio-item.back', { type: 'button', onmousedown: (e) => e.preventDefault(), onclick: () => atc.back() }, h('span.radio-key', '⌫'), h('span.radio-text', 'Back')));
    if (!items.length) menu.append(h('p.help', 'Nothing to say right now.'));
  }

  function addLine(msg) {
    const line = h(`div.radio-line.${msg.who === 'ATC' ? 'atc' : 'pilot'}`,
      h('span.radio-who', msg.who === 'ATC' ? (msg.station ?? 'ATC') : 'You'), h('span.radio-msg', msg.text));
    transcript.append(line);
    while (transcript.children.length > 60) transcript.firstChild.remove();
    transcript.scrollTop = transcript.scrollHeight;
    if (msg.who !== 'ATC') hud.audio?.radioKey();
    if (msg.who === 'ATC') {
      hud.audio?.radio(msg);
      hud.showSubtitle?.(msg);
      if (!panel.isOpen && hud.autoOpenRadio) panel.open();
    }
  }

  function bind(newAtc) {
    unsub.forEach((u) => u());
    unsub = [];
    atc = newAtc;
    transcript.replaceChildren();
    if (!atc) return;
    for (const msg of atc.transcript) addLine(msg);
    unsub.push(atc.on('menu', renderMenu), atc.on('message', addLine));
    renderMenu();
  }

  // Number keys choose entries while the panel is open (captured before the flight keys).
  window.addEventListener('keydown', (e) => {
    if (!panel.isOpen || !atc?.enabled || !hud.flying()) return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (/^Digit[1-9]$/.test(e.code)) {
      const items = atc.menu;
      const it = items[Number(e.code.slice(5)) - 1];
      if (it) { atc.request(it.id, it.arg); hud.audio?.click(); }
      e.preventDefault();
      e.stopImmediatePropagation();
    } else if (e.code === 'Backspace' && atc.inSubmenu) {
      atc.back();
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  void button;
  return { panel, bind, refresh: renderMenu };
}

function phaseLabel(phase) {
  return {
    parked: 'On the ground, parked', taxi: 'Taxiing', hold: 'Holding short of the runway', lineup: 'Lined up on the runway', rolling: 'Takeoff roll',
    departure: 'Departure', enroute: 'En route', approach: 'Approach', final: 'Final approach', landing: 'Landing', rollout: 'Landing roll', taxi_in: 'Taxiing to parking',
  }[phase] ?? phase;
}
