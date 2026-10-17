import { h } from './dom.js';
import { logoMark } from './icons.js';

// The opening title: the mark and name fade in over the animated sky, then hand over to the main
// menu. Any key, click or controller button skips it. With "Reduce motion" it never appears.

export function createIntro({ settings, onDone }) {
  const el = h('section.intro-screen', { 'aria-label': 'Flight Sim' },
    h('div.intro-card',
      logoMark(72),
      h('h1', 'FLIGHT', h('span', ' SIM')),
      h('p.intro-tag', 'Three maps · fourteen aircraft · one sky'),
      h('p.intro-skip', 'Press any key to begin')));
  let finished = false;
  let timer = 0;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    el.classList.add('leaving');
    window.removeEventListener('keydown', finish, true);
    setTimeout(() => { el.remove(); onDone(); }, settings.get('reduceMotion') ? 0 : 450);
  };
  el.start = () => {
    if (settings.get('reduceMotion')) { finish(); return; }
    el.classList.add('playing');
    timer = setTimeout(finish, 3400);
    window.addEventListener('keydown', finish, true);
    el.addEventListener('pointerdown', finish);
    const pad = setInterval(() => {
      if (finished) { clearInterval(pad); return; }
      const p = [...(navigator.getGamepads?.() ?? [])].find((x) => x && x.connected);
      if (p?.buttons.some((b) => b.pressed)) finish();
    }, 100);
  };
  return el;
}
