// Menu navigation without a mouse. Arrow keys and the controller (D-pad or left stick) move the
// focus to the nearest control in that direction; Enter/Space or A activates; B (or Escape) goes
// back. Works on every screen, on the debrief and on the crash card. Left/Right on a slider
// changes its value.

const FOCUSABLE = 'button:not(:disabled), input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
const REPEAT_FIRST = 420;
const REPEAT_NEXT = 130;
const STICK = 0.6;
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const PAD_DIR = { 12: 'up', 13: 'down', 14: 'left', 15: 'right' };

const visible = (el) => {
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.hidden) return false;
    const cs = getComputedStyle(n);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
  }
  return true;
};

export function createNavigator({ ui, screens, input, settings, audio }) {
  const hint = document.createElement('div');
  hint.className = 'nav-hint';
  hint.hidden = true;
  hint.textContent = 'D-pad move · A select · B back';
  ui.append(hint);
  let held = null; // { dir, at, next }
  let padDown = new Set();
  let active = false;
  let usingPad = false; // true once the player has used the keyboard or controller to navigate (cleared by the mouse)
  let lastCtx = null;

  /** The element that currently owns navigation: the active screen, or the crash card while flying. */
  function context() {
    const err = ui.querySelector('.error-overlay:not([hidden])');
    if (err) return err;
    if (screens.current) {
      const el = ui.querySelector(`.screen.active`);
      if (el) return el;
    }
    const crash = ui.querySelector('.crash-card:not([hidden])');
    return crash && visible(crash) ? crash : null;
  }

  const candidates = (ctx) => [...ctx.querySelectorAll(FOCUSABLE)].filter(visible);

  function mark(el) {
    ui.querySelectorAll('.nav-focus').forEach((n) => n.classList.remove('nav-focus'));
    el?.classList.add('nav-focus');
  }

  function focusEl(el) {
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    mark(el);
  }

  function defaultTarget(ctx) {
    const list = candidates(ctx);
    return list.find((e) => e.matches('[autofocus]')) ?? list.find((e) => e.matches('.on, .btn.primary'))
      ?? list.find((e) => !e.closest('header, nav.settings-tabs, .pilot-bar')) ?? list[0] ?? null;
  }

  function move(dir) {
    const ctx = context();
    if (!ctx) return false;
    let cur = document.activeElement;
    if (!cur || !ctx.contains(cur) || !cur.matches(FOCUSABLE)) {
      focusEl(defaultTarget(ctx));
      return true;
    }
    if (cur.type === 'range' && (dir === 'left' || dir === 'right')) {
      const step = Number(cur.step) || 1;
      cur.value = String(Number(cur.value) + (dir === 'right' ? step : -step));
      cur.dispatchEvent(new Event('input', { bubbles: true }));
      audio?.click?.();
      return true;
    }
    const [dx, dy] = DIRS[dir];
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best = null;
    for (const el of candidates(ctx)) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2;
      const by = b.top + b.height / 2;
      const along = (bx - ax) * dx + (by - ay) * dy;
      // Must lie in the direction of travel (compare edges so wide controls still count).
      const edge = dx ? (dx > 0 ? b.left - a.right : a.left - b.right) : (dy > 0 ? b.top - a.bottom : a.top - b.bottom);
      if (along <= 1 && edge < -2) continue;
      if (along <= 1) continue;
      const across = Math.abs(dx ? by - ay : bx - ax);
      const score = Math.max(along, 1) + across * 2.2;
      if (!best || score < best.score) best = { el, score };
    }
    if (best) { focusEl(best.el); audio?.click?.(); return true; }
    // Nothing further: let a scrolling list or panel move.
    for (let n = cur.parentElement; n && n !== ui; n = n.parentElement) {
      if (n.scrollHeight > n.clientHeight + 4 && dy) { n.scrollTop += dy * 120; return true; }
    }
    return true;
  }

  function activate() {
    const cur = document.activeElement;
    const ctx = context();
    if (!ctx) return;
    if (!cur || !ctx.contains(cur) || !cur.matches(FOCUSABLE)) { focusEl(defaultTarget(ctx)); return; }
    if (cur.matches('input[type=checkbox]')) cur.click();
    else if (cur.matches('input[type=text], input[type=search], input[type=number], textarea')) cur.focus();
    else if (cur.matches('input[type=range]')) { /* adjust with left/right */ } else cur.click();
    audio?.click?.();
  }

  function back() {
    const ctx = context();
    if (!ctx) return false;
    if (ctx.matches('.crash-card')) return false;
    if (ctx.matches('.error-overlay')) { ctx.querySelector('button:last-child')?.click(); return true; }
    const btn = [...ctx.querySelectorAll('button')].find((b) => visible(b) && /^(back|close|resume)$/i.test(b.textContent.trim()));
    if (btn) { btn.click(); audio?.click?.(); return true; }
    return false;
  }

  function start() {
    const ctx = context();
    if (!ctx) return;
    const btn = ctx.querySelector('.btn.primary:not(:disabled)');
    if (btn && visible(btn)) btn.click();
  }

  // ---- keyboard ----------------------------------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (input.suspended || e.altKey || e.ctrlKey || e.metaKey) return;
    const ctx = context();
    if (!ctx) return;
    if (e.code === 'Tab' || e.code === 'Enter' || e.code === 'Space') usingPad = true;
    const t = e.target;
    const typing = t instanceof HTMLElement && t.matches('input[type=text], input[type=search], input[type=number], textarea, select');
    const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.code];
    if (dir && !typing) {
      usingPad = true;
      if (move(dir)) e.preventDefault();
    } else if (e.code === 'Escape' && !typing && !e.defaultPrevented && !ctx.matches('.pause-screen, .debrief-screen, .loading-screen, .crash-card')) {
      if (back()) e.preventDefault();
    }
  });
  ui.addEventListener('pointerdown', () => { mark(null); usingPad = false; }, true);

  // ---- controller ------------------------------------------------------------------------------------------
  function readPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.connected);
    return pad ?? null;
  }

  function frame() {
    const now = performance.now();
    const ctx = context();
    const on = !!ctx && !input.suspended;
    if (ctx !== lastCtx) {
      lastCtx = ctx;
      // A new screen appeared while navigating without the mouse: start on its natural control.
      if (ctx && usingPad) setTimeout(() => { if (context() === ctx) focusEl(defaultTarget(ctx)); }, 60);
    }
    if (on !== active) {
      active = on;
      input.uiCapture = on; // controller buttons belong to the menu, not the aircraft
      if (!on) { mark(null); held = null; }
    }
    const pad = readPad();
    hint.hidden = !(on && pad && usingPad);
    if (!pad || !on) { padDown = new Set(); held = null; return; }

    const down = new Set();
    pad.buttons.forEach((b, i) => { if (b.pressed) down.add(i); });
    const edge = (i) => down.has(i) && !padDown.has(i);
    let dir = null;
    for (const [i, d] of Object.entries(PAD_DIR)) if (down.has(Number(i))) dir = d;
    const lx = pad.axes[0] ?? 0;
    const ly = pad.axes[1] ?? 0;
    if (!dir && Math.hypot(lx, ly) > STICK) dir = Math.abs(lx) > Math.abs(ly) ? (lx > 0 ? 'right' : 'left') : (ly > 0 ? 'down' : 'up');
    if (dir) {
      usingPad = true;
      if (!held || held.dir !== dir) { held = { dir, next: now + REPEAT_FIRST }; move(dir); } else if (now >= held.next) { held.next = now + REPEAT_NEXT; move(dir); }
    } else held = null;
    if (edge(0)) { usingPad = true; activate(); }
    if (edge(1)) { usingPad = true; back(); }
    if (edge(9)) { usingPad = true; start(); }
    padDown = down;
  }
  // Polled on a timer, not per animation frame, so menus stay responsive even when the 3D view is slow.
  setInterval(frame, 33);
  void settings;
  return { move, activate, back };
}
