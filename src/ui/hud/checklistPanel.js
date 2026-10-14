import { checklistsFor, emergencyList, listForPhase } from '../../game/checklists.js';
import { h } from '../dom.js';
import { button } from './panels.js';

// Checklist panel. Items that the aircraft state can confirm tick themselves; the rest are ticked
// with a click. The list follows the flight phase and emergency lists appear when something fails.

export function createChecklistPanel(hud) {
  const panel = hud.panels.create({ id: 'checklist', title: 'Checklist', x: 12, y: Math.max(64, Math.min(window.innerHeight - 380, 430)), width: 300, hint: 'K' });
  const titleRow = h('div.cl-title');
  const list = h('div.cl-list');
  const nav = h('div.cl-nav');
  panel.body.append(titleRow, list, nav);
  let lists = [];
  let spec = null;
  let index = 0;
  let manual = new Map(); // `${listId}:${i}` -> true
  let emergency = []; // emergency lists, newest first
  let showEmergency = null;
  let followPhase = true;
  let lastPhase = null;
  let signature = '';

  function reset() {
    const m = hud.model;
    if (!m) return;
    spec = m.spec;
    lists = checklistsFor(spec);
    index = 0;
    manual = new Map();
    emergency = [];
    showEmergency = null;
    followPhase = true;
    lastPhase = null;
    signature = '';
    render(null);
  }

  function current() { return showEmergency ?? lists[index]; }

  function render(ctx) {
    const cl = current();
    if (!cl) return;
    titleRow.replaceChildren(h(`strong${showEmergency ? '.cl-emergency' : ''}`, cl.title),
      h('span.cl-prog', ctx ? `${cl.items.filter((it, i) => done(cl, it, i, ctx)).length}/${cl.items.length}` : ''));
    list.replaceChildren();
    cl.items.forEach((it, i) => {
      const isDone = ctx ? done(cl, it, i, ctx) : false;
      const auto = !!it.auto;
      const row = h(`label.cl-item${isDone ? '.done' : ''}${auto ? '.auto' : ''}`,
        h('span.cl-box', isDone ? '✓' : ''), h('span.cl-text', it.text));
      if (!auto) row.addEventListener('click', (e) => { e.preventDefault(); manual.set(`${cl.id}:${i}`, !manual.get(`${cl.id}:${i}`)); hud.audio?.click(); signature = ''; });
      else row.title = 'Checks itself';
      list.append(row);
    });
    nav.replaceChildren(
      button('◀', { onClick: () => { showEmergency = null; followPhase = false; index = (index + lists.length - 1) % lists.length; signature = ''; }, tooltip: 'Previous checklist' }),
      button('Auto', { className: followPhase ? 'on' : '', onClick: () => { followPhase = true; showEmergency = null; signature = ''; }, tooltip: 'Follow the phase of flight' }),
      button('▶', { onClick: () => { showEmergency = null; followPhase = false; index = (index + 1) % lists.length; signature = ''; }, tooltip: 'Next checklist' }),
      ...emergency.map((e) => button(e.title, { className: `emerg${showEmergency === e ? ' on' : ''}`, onClick: () => { showEmergency = e; signature = ''; }, tooltip: 'Emergency checklist' })),
    );
  }

  function done(cl, it, i, ctx) {
    if (it.auto) { try { return !!it.auto(ctx); } catch { return false; } }
    return !!manual.get(`${cl.id}:${i}`);
  }

  function onFailure(type) {
    const e = emergencyList(type, spec);
    if (!e) return;
    emergency = [e, ...emergency.filter((x) => x.id !== e.id)];
    showEmergency = e;
    if (hud.systems.checklists) panel.open();
    signature = '';
  }

  function update(t) {
    const m = hud.model;
    if (!m) return;
    if (m.spec !== spec) reset();
    const phase = hud.atc?.phase ?? (t.onGround ? 'parked' : 'enroute');
    if (followPhase && !showEmergency && phase !== lastPhase) {
      lastPhase = phase;
      index = lists.indexOf(listForPhase(lists, phase));
      signature = '';
    }
    if (!panel.isOpen) return;
    const ctx = { t, m, systems: hud.systems, atc: hud.atc };
    const cl = current();
    const sig = `${cl.id}:${cl.items.map((it, i) => (done(cl, it, i, ctx) ? 1 : 0)).join('')}:${emergency.length}:${followPhase}:${showEmergency?.id}`;
    if (sig !== signature) { signature = sig; render(ctx); }
  }

  return { panel, update, reset, onFailure };
}
