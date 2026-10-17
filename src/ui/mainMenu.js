import { h } from './dom.js';
import { icon, logoMark } from './icons.js';
import { createPilotBar } from './pilotBar.js';

export const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

// The title screen. The 3D scene behind it (an aircraft above a sea of clouds at sunset) is drawn by
// the stage; this is the glass menu on top of it.

export function createMainMenu({ saves, stage, onStart, onContinue, onSettings, onControls, onAbout, onFullscreen, onPilots }) {
  const contSub = h('span.mm-sub');
  const cont = h('button.mm-item.mm-continue', { type: 'button', onclick: onContinue, hidden: true },
    icon('user', 22), h('span.mm-text', h('span.mm-label', 'Continue'), contSub), icon('chevR', 18));
  const pilot = createPilotBar(saves, { onClick: onPilots });
  const item = (ico, label, sub, onclick) => h('button.mm-item', { type: 'button', onclick },
    icon(ico, 22), h('span.mm-text', h('span.mm-label', label), sub ? h('span.mm-sub', sub) : null), icon('chevR', 18));

  const capName = h('strong.mm-cap-name');
  const capMeta = h('span.mm-cap-meta');
  const showing = h('div.mm-showing',
    h('button.mm-cap-btn', { type: 'button', 'aria-label': 'Previous aircraft', onclick: () => stage?.menu.next(-1) }, icon('chevL', 18)),
    h('div.mm-cap', h('span.mm-cap-kicker', 'Now flying'), capName, capMeta),
    h('button.mm-cap-btn', { type: 'button', 'aria-label': 'Next aircraft', onclick: () => stage?.menu.next(1) }, icon('chevR', 18)));
  stage?.menu.onCaption((c) => { capName.textContent = c.name; capMeta.textContent = c.maker; });

  const el = h('section.menu-screen',
    h('header.mm-top',
      h('div.mm-brand', logoMark(46), h('div.mm-brand-text', h('h1', 'FLIGHT', h('span', ' SIM')), h('p.tagline', 'Fly anything. Land everywhere.'))),
      pilot),
    h('div.mm-body',
      h('nav.mm-nav', { 'aria-label': 'Main menu' },
        h('button.mm-play', { type: 'button', onclick: onStart, autofocus: true },
          h('span.mm-play-ico', icon('play', 26)),
          h('span.mm-play-text', h('span.mm-play-label', 'Play'), h('span.mm-play-sub', 'Quick Flight · Career · Emergency · VIP')),
          h('span.mm-play-arrow', icon('arrowR', 24))),
        cont,
        h('div.mm-group',
          item('settings', 'Settings', 'Graphics, audio, game systems', onSettings),
          item('gamepad', 'Controls', 'Keyboard, controller and touch', onControls),
          item('book', 'How to play', 'Basics, tips and credits', onAbout)),
      ),
      h('ul.mm-facts', h('li', h('strong', '14'), ' aircraft'), h('li', h('strong', '3'), ' maps'), h('li', h('strong', '37'), ' missions'), h('li', h('strong', 'ATC'), ' & weather')),
    ),
    h('footer.mm-foot',
      h('button.mm-icon-btn', { type: 'button', onclick: onFullscreen, 'aria-label': 'Toggle fullscreen', title: 'Fullscreen' }, icon('fullscreen', 18)),
      h('span.build-note', `v${VERSION}`)),
    showing,
  );
  el.refresh = () => {
    const s = saves.active;
    cont.hidden = !s;
    if (s) contSub.textContent = `${s.name} · ${Math.round(s.money).toLocaleString('en-US')} cr`;
    pilot.hidden = !s;
  };
  saves.on('change', el.refresh);
  saves.on('money', el.refresh);
  el.refresh();
  return el;
}

const TIPS = [
  'Gear down, flaps set, 3° glide: the approach guide (F8) draws the path to the runway for you.',
  'Press J to cycle flight assist. Light keeps the aircraft calm; Off is pure stick-and-rudder.',
  'The autopilot (Backslash) flies headings, altitudes, routes and even ILS approaches.',
  'Fighters command g, not pitch angle: let go of the stick and they hold their flight path.',
  'Smooth touchdowns pay the best fares. Under 150 ft/min is a butter landing.',
  'Press M for the chart. Click to drop waypoints, then let NAV fly the route.',
  'Time compression (+ and -) makes long legs painless. It slows itself down near trouble.',
  'Every aircraft has six upgrade tracks. Spend credits in the shop on engines, brakes and more.',
];

export function createLoadingScreen() {
  const bar = h('div.progress-fill');
  const label = h('p.loading-label', 'Loading…');
  const pct = h('span.loading-pct', '0%');
  const tip = h('p.loading-tip');
  let tipTimer = 0;
  let tipIndex = Math.floor(Math.random() * TIPS.length);
  const nextTip = () => { tip.textContent = TIPS[tipIndex++ % TIPS.length]; };
  const el = h('section.loading-screen',
    h('div.loading-card',
      h('div.loading-brand', logoMark(40), h('span', 'FLIGHT SIM')),
      h('h2', 'Preparing flight'),
      h('div.progress', bar),
      h('div.loading-row', label, pct),
      h('div.loading-tipbox', h('span.tip-kicker', 'Tip'), tip)),
    h('div.loading-orbit', h('i'), h('i'), h('i')));
  nextTip();
  el.setProgress = (fraction, text) => {
    bar.style.width = `${Math.round(fraction * 100)}%`;
    pct.textContent = `${Math.round(fraction * 100)}%`;
    label.textContent = text;
    if (!tipTimer) tipTimer = setInterval(() => { if (!el.isConnected || !el.classList.contains('active')) { clearInterval(tipTimer); tipTimer = 0; return; } nextTip(); }, 4200);
  };
  return el;
}

export function createPauseMenu({ onResume, onRestart, onSettings, onQuit }) {
  const context = h('p.pause-context');
  const restart = h('button.btn', { onclick: onRestart }, 'Restart flight');
  const quit = h('button.btn.danger', { onclick: onQuit }, 'Quit to menu');
  const el = h('section.pause-screen', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Paused' },
    h('div.menu-card.compact',
      h('div.pause-title', logoMark(30), h('h2', 'Paused')),
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
