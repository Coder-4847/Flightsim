import { h } from './dom.js';

// A small strip showing who is flying and how much money they have. Shared by the mode, shop and
// mission screens.

export const credits = (n) => `${Math.round(n).toLocaleString('en-US')} cr`;

export function createPilotBar(saves, { onClick } = {}) {
  const name = h('strong');
  const money = h('span.pilot-money');
  const meta = h('span.pilot-meta');
  const el = h('button.pilot-bar', { type: 'button', onclick: onClick, title: 'Choose or manage pilots' }, h('span.pilot-icon', '◉'), name, money, meta);
  el.refresh = () => {
    const s = saves.active;
    name.textContent = s ? s.name : 'No pilot';
    money.textContent = s ? credits(s.money) : '';
    meta.textContent = s ? `${s.aircraft.length} aircraft` : 'Quick Flight only';
    el.classList.toggle('empty', !s);
  };
  saves.on('change', el.refresh);
  saves.on('money', el.refresh);
  el.refresh();
  return el;
}
