import { h } from './dom.js';

// A last line of defence: if something throws while the game is running, or the graphics context
// is lost, say so plainly instead of leaving a frozen screen, and offer a way out. The error is
// also left in the console for bug reports.

export function installErrorHandling({ root, canvas, onError, onMenu }) {
  const title = h('h2');
  const detail = h('p.error-detail');
  const card = h('div.error-card', { role: 'alertdialog', 'aria-labelledby': 'error-title' },
    title, detail,
    h('div.error-actions',
      h('button.btn.primary', { onclick: () => location.reload() }, 'Reload the game'),
      h('button.btn', { onclick: () => { hide(); onMenu?.(); } }, 'Back to the menu'),
      h('button.btn', { onclick: () => hide() }, 'Dismiss')));
  title.id = 'error-title';
  const overlay = h('section.error-overlay', { hidden: true }, card);
  root.append(overlay);
  let lastKey = '';
  let lastAt = 0;
  let count = 0;

  function hide() { overlay.hidden = true; }

  function show(heading, message) {
    const key = `${heading}|${message}`;
    const now = performance.now();
    if (key === lastKey && now - lastAt < 8000) return;
    lastKey = key;
    lastAt = now;
    count += 1;
    title.textContent = heading;
    detail.textContent = message;
    overlay.hidden = false;
    onError?.();
  }

  const noise = /ResizeObserver|Script error\.?$|extension/i;
  window.addEventListener('error', (e) => {
    if (noise.test(e.message ?? '')) return;
    show('Something went wrong', `${e.message || 'Unknown error'}. Your pilot is saved. You can dismiss this and carry on, go back to the menu, or reload.`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason?.message ?? String(e.reason ?? 'Unknown error');
    if (noise.test(msg)) return;
    show('Something went wrong', `${msg}. Your pilot is saved.`);
  });
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    show('Graphics context lost', 'The browser stopped the 3D view (often a driver reset or too many tabs). Reload the game to continue; your pilot is saved.');
  });
  return { show, get count() { return count; } };
}
