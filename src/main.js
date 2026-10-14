import './style.css';
import { GameLoop } from './core/loop.js';
import { GameState, StateMachine } from './core/stateMachine.js';
import { Input } from './input/input.js';
import { FlightScene } from './scene/flightScene.js';
import { Keybinds } from './storage/keybinds.js';
import { Settings } from './storage/settings.js';
import { h } from './ui/dom.js';
import { createHud } from './ui/hud.js';
import { createLoadingScreen, createMainMenu, createPauseMenu } from './ui/mainMenu.js';
import { ScreenManager } from './ui/screens.js';
import { createSettingsScreen } from './ui/settingsScreen.js';

const uiRoot = document.getElementById('ui');
const canvas = document.getElementById('view');

function webglAvailable() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

if (!webglAvailable()) {
  uiRoot.append(h('div.screen.active', h('div.fatal', h('h2', 'WebGL 2 is required'),
    h('p', 'Your browser or device could not start WebGL 2. Try a current version of Chrome, Edge, Firefox or Safari with hardware acceleration enabled.'))));
} else {
  boot();
}

function boot() {
  // ---- core services -----------------------------------------------------
  const settings = new Settings();
  const bindings = new Keybinds();
  const input = new Input(bindings);
  const state = new StateMachine(GameState.MENU);
  const flightScene = new FlightScene(canvas);

  // ---- UI ----------------------------------------------------------------
  const screens = new ScreenManager(uiRoot);
  const hud = createHud();
  uiRoot.append(hud);
  const loadingScreen = createLoadingScreen();
  let settingsReturn = 'main';

  const openSettings = (from) => {
    settingsReturn = from;
    settingsScreen.classList.toggle('opaque', from === 'main');
    screens.show('settings');
    settingsScreen.focusPanel();
  };

  const settingsScreen = createSettingsScreen({
    settings, bindings, input, onBack: () => screens.show(settingsReturn),
  });
  screens.register('main', createMainMenu({
    onStart: () => state.go(GameState.LOADING),
    onSettings: () => openSettings('main'),
  }));
  screens.register('loading', loadingScreen);
  screens.register('pause', createPauseMenu({
    onResume: () => state.go(GameState.FLYING),
    onSettings: () => openSettings('pause'),
    onQuit: () => state.go(GameState.MENU),
  }));
  screens.register('settings', settingsScreen);
  screens.show('main');

  // ---- settings -> live effects -----------------------------------------
  const applySetting = (key) => {
    const value = settings.get(key);
    switch (key) {
      case 'quality': flightScene.setQuality(value); break;
      case 'showFps': hud.setFpsVisible(value); break;
      case 'hudScale': hud.setScale(value); break;
      case 'hudOpacity': hud.setOpacity(value); break;
      case 'reduceMotion':
        document.body.classList.toggle('reduce-motion', value);
        flightScene.reduceMotion = value;
        break;
      default: break; // masterVolume / preset are consumed by later phases
    }
  };
  ['quality', 'showFps', 'hudScale', 'hudOpacity', 'reduceMotion'].forEach(applySetting);
  settings.on('change', ({ key }) => applySetting(key));

  // ---- game loop -----------------------------------------------------------
  let fpsFrames = 0;
  let fpsTime = 0;
  const loop = new GameLoop({
    update: (dt) => {
      if (state.is(GameState.FLYING)) flightScene.update(dt);
    },
    render: () => {
      if (state.is(GameState.FLYING, GameState.PAUSED) && flightScene.built) flightScene.render();
    },
    onFrame: (frameDt) => {
      fpsFrames++;
      fpsTime += frameDt;
      if (fpsTime >= 0.5) {
        hud.setFps(fpsFrames / fpsTime);
        fpsFrames = 0;
        fpsTime = 0;
      }
    },
  });

  // ---- state transitions ---------------------------------------------------
  state.on('change', async ({ to }) => {
    input.enabled = to === GameState.FLYING || to === GameState.PAUSED;
    hud.classList.toggle('active', to === GameState.FLYING || to === GameState.PAUSED);
    if (to !== GameState.FLYING) input.releaseAll();

    switch (to) {
      case GameState.MENU:
        screens.show('main');
        break;
      case GameState.LOADING:
        screens.show('loading');
        loadingScreen.setProgress(0, 'Starting…');
        try {
          await flightScene.build((fraction, label) => loadingScreen.setProgress(fraction, label));
        } catch (err) {
          console.error('Failed to build the flight scene', err);
          loadingScreen.setProgress(0, 'Loading failed. Returning to menu…');
          await new Promise((r) => setTimeout(r, 1500));
          if (state.is(GameState.LOADING)) state.go(GameState.MENU);
          break;
        }
        if (state.is(GameState.LOADING)) state.go(GameState.FLYING);
        break;
      case GameState.FLYING:
        screens.show(null);
        loop.resetClock();
        break;
      case GameState.PAUSED:
        screens.show('pause');
        break;
      default: break;
    }
  });

  input.on('press', (action) => {
    if (action !== 'pause') return;
    if (state.is(GameState.FLYING)) state.go(GameState.PAUSED);
    else if (state.is(GameState.PAUSED) && screens.current === 'pause') state.go(GameState.FLYING);
  });

  // Auto-pause when the tab loses focus mid-flight.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.is(GameState.FLYING)) state.go(GameState.PAUSED);
  });

  // ---- pointer + window events --------------------------------------------
  let dragging = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (!state.is(GameState.FLYING)) return;
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) flightScene.dragCamera(e.movementX, e.movementY);
  });
  const endDrag = () => { dragging = false; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    if (!state.is(GameState.FLYING)) return;
    e.preventDefault();
    flightScene.zoomCamera(e.deltaY);
  }, { passive: false });
  window.addEventListener('resize', () => flightScene.resize());

  loop.start();

  // Handle for debugging and automated playtests.
  window.__flightsim = { state, settings, bindings, input, scene: flightScene };
}
