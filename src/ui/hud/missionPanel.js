import { h } from '../dom.js';

// The mission panel: what the current game mode wants from you (objectives, route, comfort meter,
// nearby airports for an emergency, fare estimates in Free Flight). It only draws what the mode's
// info() returns and redraws when that changes.

export function createMissionPanel(hud) {
  const panel = hud.panels.create({ id: 'mission', title: 'Mission', x: 16, y: Math.max(316, window.innerHeight - 340), width: 300, hint: 'F9' });
  const head = h('div.ms-head');
  const goals = h('ul.ms-goals');
  const rows = h('dl.ms-rows');
  const bars = h('div.ms-bars');
  const list = h('div.ms-list');
  panel.body.append(head, goals, bars, rows, list);
  let last = '';

  function render(info) {
    head.replaceChildren(h('strong', info.title), info.subtitle && h('span', info.subtitle));
    goals.replaceChildren(...(info.goals ?? []).map((g) => h('li', { className: `${g.done ? 'done' : ''}${g.failed ? ' failed' : ''}${g.bonus ? ' bonus' : ''}` },
      h('span.ms-tick', g.done ? '✓' : g.failed ? '✗' : g.bonus ? '★' : '○'), h('span', g.text))));
    bars.replaceChildren(...(info.bars ?? []).map((b) => h('div.ms-bar', { dataset: { tone: b.tone } },
      h('div.ms-bar-track', h('div.ms-bar-fill', { style: `width:${Math.max(0, Math.min(1, b.value / b.max)) * 100}%` })), h('span.ms-bar-text', b.text))));
    rows.replaceChildren(...(info.rows ?? []).flatMap(([k, v]) => [h('dt', k), h('dd', v)]));
    list.replaceChildren(...(info.list?.length ? [h('div.ms-list-title', info.listTitle ?? ''), ...info.list.map((it) => h('div.ms-item', h('b', it.text), h('span', it.detail ?? '')))] : []));
  }

  return {
    panel,
    update() {
      const info = hud.modeInfo?.();
      if (!info) return;
      if (!panel.isOpen) return;
      const sig = JSON.stringify(info);
      if (sig === last) return;
      last = sig;
      render(info);
    },
    reset() { last = ''; },
  };
}
