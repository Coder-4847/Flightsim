import { h } from './dom.js';

export function createMainMenu({ onStart, onSettings }) {
  return h('section.menu-screen',
    h('div.menu-card',
      h('div.brand',
        h('span.brand-mark', '▲'),
        h('h1', 'FLIGHT SIM'),
        h('p.tagline', 'Browser flight simulator'),
      ),
      h('nav.menu-list',
        h('button.btn.primary', { onclick: onStart }, 'Start flying'),
        h('button.btn', { onclick: onSettings }, 'Settings'),
      ),
      h('p.build-note', 'Phase 1 build · foundation'),
    ),
  );
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

export function createPauseMenu({ onResume, onSettings, onQuit }) {
  return h('section.pause-screen',
    h('div.menu-card.compact',
      h('h2', 'Paused'),
      h('nav.menu-list',
        h('button.btn.primary', { onclick: onResume }, 'Resume'),
        h('button.btn', { onclick: onSettings }, 'Settings'),
        h('button.btn.danger', { onclick: onQuit }, 'Quit to menu'),
      ),
    ),
  );
}
