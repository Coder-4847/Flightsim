import { loadJSON, saveJSON } from '../../storage/store.js';
import { h } from '../dom.js';

// Draggable HUD panels with remembered positions, plus a shared hover tooltip. Panels are plain DOM:
// everything on them is clickable and the flight keys still work while the mouse is over them.

const STORAGE_KEY = 'hudpanels';

let tooltipEl = null;
function tooltip() {
  if (!tooltipEl) {
    tooltipEl = h('div.hud-tooltip', { hidden: true });
    document.body.append(tooltipEl);
  }
  return tooltipEl;
}

/** Show `text` in a small tooltip while the pointer is over `el` (also on keyboard focus). */
export function tip(el, text) {
  if (!text) return el;
  const t = tooltip();
  const place = (x, y) => {
    t.style.left = `${Math.min(window.innerWidth - t.offsetWidth - 8, x + 14)}px`;
    t.style.top = `${Math.min(window.innerHeight - t.offsetHeight - 8, y + 16)}px`;
  };
  el.addEventListener('pointerenter', (e) => { t.textContent = typeof text === 'function' ? text() : text; t.hidden = false; place(e.clientX, e.clientY); });
  el.addEventListener('pointermove', (e) => place(e.clientX, e.clientY));
  el.addEventListener('pointerleave', () => { t.hidden = true; });
  el.addEventListener('pointerdown', () => { t.hidden = true; });
  el.setAttribute('aria-label', typeof text === 'string' ? text : el.getAttribute('aria-label') ?? '');
  return el;
}

export class PanelManager {
  constructor(root) {
    this.root = root;
    this.panels = new Map();
    this.saved = loadJSON(STORAGE_KEY, {}) ?? {};
    this.z = 10;
    this.hidden = false;
    this.onToggle = null;
    this.locks = new Map(); // panel id -> reason it is unavailable (an upgrade that has not been bought)
    this.onLocked = null;
    this.lastLockedToast = 0;
  }

  /** Make a panel unavailable (closing it) until unlock() is called. */
  lock(id, reason) {
    this.locks.set(id, reason);
    this.panels.get(id)?.close();
    this.onToggle?.(id, false);
  }

  unlock(id) { this.locks.delete(id); }

  /**
   * @param o {id, title, x, y, width, open, hint}
   * @returns {{ el, body, open(), close(), toggle(), isOpen }}
   */
  create(o) {
    const saved = this.saved[o.id] ?? {};
    const body = h('div.hpanel-body');
    const closeBtn = h('button.hpanel-close', { type: 'button', 'aria-label': `Close ${o.title}`, onclick: () => panel.close() }, '×');
    tip(closeBtn, `Close (${o.hint ?? 'toolbar'} to reopen)`);
    const titleEl = h('span.hpanel-title', o.title);
    const head = h('div.hpanel-head', titleEl, closeBtn);
    const el = h('section.hpanel', { dataset: { id: o.id }, style: `width:${o.width ?? 260}px` }, head, body);
    const panel = {
      id: o.id, el, body, titleEl,
      get isOpen() { return !el.hidden; },
      open: () => {
        if (this.locks.has(o.id)) {
          const now = performance.now();
          if (now - this.lastLockedToast > 4000) { this.lastLockedToast = now; this.onLocked?.(this.locks.get(o.id)); }
          return;
        }
        el.hidden = false; this.#raise(el); this.#save(); this.onToggle?.(o.id, true);
      },
      close: () => { el.hidden = true; this.#save(); this.onToggle?.(o.id, false); },
      toggle: () => (el.hidden ? panel.open() : panel.close()),
      setTitle: (t) => { titleEl.textContent = t; },
    };
    el.hidden = !(saved.open ?? o.open ?? false);
    this.#position(el, saved.x ?? o.x ?? 20, saved.y ?? o.y ?? 80);
    this.root.append(el);
    this.panels.set(o.id, panel);

    // Drag by the header.
    let drag = null;
    head.addEventListener('pointerdown', (e) => {
      if (e.target === closeBtn) return;
      drag = { dx: e.clientX - el.offsetLeft, dy: e.clientY - el.offsetTop };
      head.setPointerCapture(e.pointerId);
      this.#raise(el);
    });
    head.addEventListener('pointermove', (e) => { if (drag) this.#position(el, e.clientX - drag.dx, e.clientY - drag.dy); });
    const end = () => { if (drag) { drag = null; this.#save(); } };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
    el.addEventListener('pointerdown', () => this.#raise(el));
    return panel;
  }

  get(id) { return this.panels.get(id); }

  setHidden(hidden) {
    this.hidden = hidden;
    this.root.classList.toggle('hud-hidden', hidden);
  }

  #raise(el) { el.style.zIndex = String(++this.z); }

  #position(el, x, y) {
    const w = el.offsetWidth || 260;
    el.style.left = `${Math.max(0, Math.min(window.innerWidth - Math.min(w, 120), x))}px`;
    el.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, y))}px`;
  }

  #save() {
    const out = {};
    for (const [id, p] of this.panels) out[id] = { x: p.el.offsetLeft, y: p.el.offsetTop, open: !p.el.hidden };
    this.saved = out;
    saveJSON(STORAGE_KEY, out);
  }

  /** Re-clamp panels after the window shrinks. */
  clamp() {
    for (const p of this.panels.values()) this.#position(p.el, p.el.offsetLeft, p.el.offsetTop);
  }
}

// ---- small widgets ------------------------------------------------------------------------------------------
export function button(label, { onClick, tooltip: text, className = '', disabled = false } = {}) {
  const b = h(`button.hbtn${className ? `.${className}` : ''}`, { type: 'button', disabled, onclick: onClick }, label);
  b.addEventListener('mousedown', (e) => e.preventDefault()); // keep keyboard focus on the game
  return tip(b, text);
}

/**
 * Vertical slider that can be dragged with the mouse or a touch. `onInput(value 0..1)`. Returns
 * { el, set(value) }.
 */
export function vSlider({ height = 110, onInput, tooltip: text, notches = 0 }) {
  const fill = h('div.vs-fill');
  const handle = h('div.vs-handle');
  const el = h('div.vs', { style: `height:${height}px`, role: 'slider', tabIndex: 0 }, fill, handle);
  for (let i = 1; i <= notches; i++) el.append(h('div.vs-notch', { style: `bottom:${(i / (notches + 1)) * 100}%` }));
  let value = 0;
  const set = (v) => {
    value = Math.max(0, Math.min(1, v));
    fill.style.height = `${value * 100}%`;
    handle.style.bottom = `calc(${value * 100}% - 7px)`;
    el.setAttribute('aria-valuenow', String(Math.round(value * 100)));
  };
  let dragging = false;
  const fromEvent = (e) => {
    const r = el.getBoundingClientRect();
    return 1 - (e.clientY - r.top) / r.height;
  };
  el.addEventListener('pointerdown', (e) => { dragging = true; el.setPointerCapture(e.pointerId); const v = fromEvent(e); set(v); onInput?.(value); e.preventDefault(); });
  el.addEventListener('pointermove', (e) => { if (!dragging) return; set(fromEvent(e)); onInput?.(value); });
  const end = () => { dragging = false; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowUp') { set(value + 0.05); onInput?.(value); e.preventDefault(); e.stopPropagation(); }
    if (e.code === 'ArrowDown') { set(value - 0.05); onInput?.(value); e.preventDefault(); e.stopPropagation(); }
  });
  tip(el, text);
  set(0);
  return { el, set, get dragging() { return dragging; }, get value() { return value; } };
}

export function bar(label, color = 'var(--accent)') {
  const fill = h('div.bar-fill', { style: `background:${color}` });
  const value = h('span.bar-val', '--');
  const el = h('div.bar', h('span.bar-label', label), h('div.bar-track', fill), value);
  return { el, set(frac, text) { fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`; value.textContent = text ?? ''; }, fill };
}
