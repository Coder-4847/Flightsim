import { h } from './dom.js';
import { credits } from './pilotBar.js';

// The report shown after a landing, a finished mission or a failed one: what happened and exactly
// where the money came from.

export function createDebrief() {
  const title = h('h2');
  const subtitle = h('p.debrief-sub');
  const badge = h('div.debrief-badge');
  const goals = h('ul.debrief-goals');
  const lines = h('table.debrief-lines');
  const notes = h('ul.debrief-notes');
  const saved = h('p.debrief-saved');
  const actions = h('div.debrief-actions');
  const el = h('section.debrief-screen', h('div.debrief-card', title, subtitle, badge, goals, lines, notes, saved, actions));

  /** @param result from ModeRunner; @param buttons [{label, primary?, run}] */
  el.show = (result, buttons, savedText = '') => {
    const good = result.success;
    el.dataset.tone = good ? 'good' : 'bad';
    title.textContent = result.title;
    subtitle.textContent = result.subtitle ?? '';
    const parts = [];
    if (result.stars != null) parts.push(h('span.stars', '★'.repeat(result.stars) + '☆'.repeat(3 - result.stars)));
    if (result.scoreGrade) parts.push(h('span.score-grade', { dataset: { grade: result.scoreGrade } }, result.scoreGrade), h('span.score-num', `${result.score}/100`));
    badge.replaceChildren(...parts);
    badge.hidden = !parts.length;
    goals.replaceChildren(...(result.goals ?? []).map((g) => h('li' + (g.met ? '.met' : '.missed'), h('span', g.met ? '★' : '☆'), h('span', g.text))));
    goals.hidden = !(result.goals?.length);
    const rows = (result.lines ?? []).map((l) => h('tr' + (l.kind === 'score' ? '.score-row' : ''), h('td', l.label), h('td.amt', l.kind === 'score' ? `+${l.amount}` : l.amount === 0 ? '' : `${l.amount > 0 ? '+' : '−'}${Math.abs(l.amount).toLocaleString('en-US')}`)));
    rows.push(h('tr.total', h('td', result.total >= 0 ? 'Paid' : 'Charged'), h('td.amt', credits(Math.abs(result.total)))));
    lines.replaceChildren(...rows);
    notes.replaceChildren(...(result.notes ?? []).map((n) => h('li', n)));
    saved.textContent = savedText;
    actions.replaceChildren(...buttons.map((b) => h('button.btn' + (b.primary ? '.primary' : ''), { onclick: b.run }, b.label)));
    actions.querySelector('button')?.focus?.();
  };
  return el;
}
