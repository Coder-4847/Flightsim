import { h } from './dom.js';

export const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

export function createMainMenu({ saves, onStart, onContinue, onSettings, onControls, onAbout, onFullscreen }) {
  const cont = h('button.btn', { onclick: onContinue, hidden: true });
  const el = h('section.menu-screen',
    h('div.menu-card',
      h('div.brand',
        h('span.brand-mark', '\u25b2'),
        h('h1', 'FLIGHT SIM'),
        h('p.tagline', 'Browser flight simulator'),
      ),
      h('nav.menu-list', { 'aria-label': 'Main menu' },
        h('button.btn.primary', { onclick: onStart, autofocus: true }, 'Fly'),
        cont,
        h('button.btn', { onclick: onSettings }, 'Settings'),
        h('button.btn', { onclick: onControls }, 'Controls'),
        h('button.btn', { onclick: onAbout }, 'How to play and about'),
      ),
      h('div.menu-foot',
        h('button.btn.small.ghost', { onclick: onFullscreen }, 'Fullscreen'),
        h('span.build-note', `Release candidate ${VERSION}`)),
    ),
  );
  el.refresh = () => {
    const s = saves.active;
    cont.hidden = !s;
    if (s) cont.textContent = `Continue as ${s.name} \u00b7 ${Math.round(s.money).toLocaleString('en-US')} cr`;
  };
  saves.on('change', el.refresh);
  saves.on('money', el.refresh);
  el.refresh();
  return el;
}

export function createLoadingScreen() {
  const bar = h('div.progress-fill');
  const label = h('p.loading-label', 'Loading…');
  const el = h('section.loading-screen',
    h('div.loading-card', h('h2', 'Preparing flight'), h('div.progress', bar), label),
  );
  el.setProgress = (fraction, text) => {
    bar.style.width = `${Math.round(fraction * 100)}%`;
    label.textContent = text;
  };
  return el;
}

export function createPauseMenu({ onResume, onRestart, onSettings, onQuit }) {
  const context = h('p.pause-context');
  const restart = h('button.btn', { onclick: onRestart }, 'Restart flight');
  const quit = h('button.btn.danger', { onclick: onQuit }, 'Quit to menu');
  const el = h('section.pause-screen',
    h('div.menu-card.compact',
      h('h2', 'Paused'),
      context,
      h('nav.menu-list',
        h('button.btn.primary', { onclick: onResume }, 'Resume'),
        restart,
        h('button.btn', { onclick: onSettings }, 'Settings'),
        quit,
      ),
    ),
  );
  /** Describe the game mode in progress (or clear it with no arguments). */
  el.setContext = (text = '', restartLabel = 'Restart flight', quitLabel = 'Quit to menu') => {
    context.textContent = text;
    context.hidden = !text;
    restart.textContent = restartLabel;
    quit.textContent = quitLabel;
  };
  el.setContext();
  return el;
}
