import './style.css';
import { getAircraft } from './aircraft/index.js';
import { GameLoop } from './core/loop.js';
import { GameState, StateMachine } from './core/stateMachine.js';
import { FlightSession } from './game/session.js';
import { Input } from './input/input.js';
import { FlightScene } from './scene/flightScene.js';
import { Keybinds } from './storage/keybinds.js';
import { Settings } from './storage/settings.js';
import { createAircraftSelect } from './ui/aircraftSelect.js';
import { h } from './ui/dom.js';
import { createFlightHud } from './ui/flightHud.js';
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
  const input = new Input(bindings, settings);
  const state = new StateMachine(GameState.MENU);
  const flightScene = new FlightScene(canvas);
  const session = new FlightSession(flightScene, input, settings);
  let selection = { aircraftId: 'cessna172', startMode: 'runway' };

  // ---- UI ----------------------------------------------------------------
  const screens = new ScreenManager(uiRoot);
  const hud = createHud();
  const flightHud = createFlightHud({
    onRestart: () => restartFlight(),
    onSelect: () => { state.go(GameState.MENU); screens.show('select'); },
    onMenu: () => state.go(GameState.MENU),
  });
  uiRoot.append(hud, flightHud);
  const loadingScreen = createLoadingScreen();
  let settingsReturn = 'main';

  const openSettings = (from) => {
    settingsReturn = from;
    settingsScreen.classList.toggle('opaque', from === 'main');
    screens.show('settings');
    settingsScreen.focusPanel();
  };

  const startFlight = (choice) => {
    selection = choice;
    state.go(GameState.LOADING);
  };
  const restartFlight = () => {
    session.restart();
    flightHud.setCrash(null);
    announceStart();
    if (state.is(GameState.PAUSED)) state.go(GameState.FLYING);
  };
  const announceStart = () => {
    flightHud.showHint('W/S pitch · A/D roll · Q/E rudder · Shift/Ctrl throttle · Space brakes · B parking brake · G gear · F/V flaps · C camera · J assist');
  };

  const settingsScreen = createSettingsScreen({
    settings, bindings, input, onBack: () => screens.show(settingsReturn),
  });
  const selectScreen = createAircraftSelect({ onFly: startFlight, onBack: () => screens.show('main') });
  screens.register('main', createMainMenu({
    onStart: () => screens.show('select'),
    onSettings: () => openSettings('main'),
  }));
  screens.register('select', selectScreen);
  screens.register('loading', loadingScreen);
  screens.register('pause', createPauseMenu({
    onResume: () => state.go(GameState.FLYING),
    onRestart: restartFlight,
    onSettings: () => openSettings('pause'),
    onQuit: () => state.go(GameState.MENU),
  }));
  screens.register('settings', settingsScreen);
  screens.show('main');

  session.onToast = (text) => flightHud.showToast(text);

  // ---- settings -> live effects -----------------------------------------
  const applySetting = (key) => {
    const value = settings.get(key);
    switch (key) {
      case 'quality': flightScene.setQuality(value); break;
      case 'showFps': hud.setFpsVisible(value); break;
      case 'hudScale': hud.setScale(value); flightHud.style.setProperty('--hud-scale', value); break;
      case 'hudOpacity': hud.setOpacity(value); flightHud.style.setProperty('--hud-opacity', value); break;
      case 'reduceMotion':
        document.body.classList.toggle('reduce-motion', value);
        session.cameras.reduceMotion = value;
        break;
      default: break; // masterVolume / preset are consumed by later phases
    }
  };
  ['quality', 'showFps', 'hudScale', 'hudOpacity', 'reduceMotion'].forEach(applySetting);
  settings.on('change', ({ key }) => applySetting(key));

  // ---- game loop -----------------------------------------------------------
  let fpsFrames = 0;
  let fpsTime = 0;
  let hudCounter = 0;
  const loop = new GameLoop({
    update: (dt) => {
      if (state.is(GameState.FLYING)) {
        session.update(dt);
        handleEvents();
      }
    },
    render: (alpha, frameDt) => {
      if (!state.is(GameState.FLYING, GameState.PAUSED) || !flightScene.built) return;
      session.render(state.is(GameState.PAUSED) ? 1 : alpha, frameDt);
      if (++hudCounter % 3 === 0 && session.model) updateHud();
    },
    onFrame: (frameDt) => {
      if (state.is(GameState.FLYING, GameState.PAUSED)) input.pollGamepad();
      fpsFrames++;
      fpsTime += frameDt;
      if (fpsTime >= 0.5) {
        hud.setFps(fpsFrames / fpsTime);
        fpsFrames = 0;
        fpsTime = 0;
      }
    },
  });

  const WIND_TEXT = { calm: '', breeze: 'WIND 8 kt headwind', crosswind: 'WIND 14 kt crosswind', gusty: 'WIND 12 kt gusting 18' };
  function updateHud() {
    const m = session.model;
    flightHud.update(m.telemetry, {
      fixedGear: !m.spec.gear.retractable,
      assist: settings.get('flightAssist'),
      gearSpeed: m.spec.speeds.vapp * 1.4,
      windText: WIND_TEXT[settings.get('weather')],
      cameraLabel: `${session.cameras.mode} camera`,
    });
  }
  function handleEvents() {
    for (const e of session.takeEvents()) {
      if (e.type === 'touchdown') flightHud.showTouchdown(e);
      else if (e.type === 'strike') flightHud.showToast('Airframe strike! Check your pitch attitude');
      else if (e.type === 'crash') { flightHud.setCrash(e.reason); input.releaseAll(); }
    }
  }

  // ---- state transitions ---------------------------------------------------
  state.on('change', async ({ to }) => {
    input.enabled = to === GameState.FLYING || to === GameState.PAUSED;
    const inFlight = to === GameState.FLYING || to === GameState.PAUSED;
    hud.classList.toggle('active', inFlight || to === GameState.MENU);
    flightHud.setVisible(inFlight);
    if (to !== GameState.FLYING) input.releaseAll();
    if (to !== GameState.FLYING && document.pointerLockElement) document.exitPointerLock();

    switch (to) {
      case GameState.MENU:
        screens.show('main');
        flightHud.setCrash(null);
        session.dispose();
        break;
      case GameState.LOADING:
        screens.show('loading');
        loadingScreen.setProgress(0, 'Starting…');
        try {
          await flightScene.build((fraction, label) => loadingScreen.setProgress(fraction * 0.8, label));
          loadingScreen.setProgress(0.85, `Building ${getAircraft(selection.aircraftId).name}`);
          await new Promise((r) => requestAnimationFrame(() => r()));
          session.start(selection.aircraftId, selection.startMode);
          loadingScreen.setProgress(1, 'Ready');
        } catch (err) {
          console.error('Failed to start the flight', err);
          loadingScreen.setProgress(0, 'Loading failed. Returning to menu…');
          await new Promise((r) => setTimeout(r, 1500));
          if (state.is(GameState.LOADING)) state.go(GameState.MENU);
          break;
        }
        flightHud.setCrash(null);
        announceStart();
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
    if (action === 'pause') {
      if (state.is(GameState.FLYING)) state.go(GameState.PAUSED);
      else if (state.is(GameState.PAUSED) && screens.current === 'pause') state.go(GameState.FLYING);
    }
  });
  window.addEventListener('keydown', (e) => {
    // Enter restarts after a crash.
    if (e.code === 'Enter' && session.model?.crashed && state.is(GameState.FLYING)) restartFlight();
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
    session.cameras.head.dragging = true;
    canvas.setPointerCapture(e.pointerId);
    // In the cockpit a click captures the mouse so it can be used as a head-look control.
    if (session.cameras.mode === 'cockpit' && !document.pointerLockElement) canvas.requestPointerLock?.();
  });
  canvas.addEventListener('pointermove', (e) => {
    if ((dragging || document.pointerLockElement === canvas) && state.is(GameState.FLYING)) {
      session.cameras.drag(e.movementX, e.movementY);
    }
  });
  const endDrag = () => { dragging = false; session.cameras.head.dragging = false; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  document.addEventListener('pointerlockchange', () => {
    session.cameras.head.locked = document.pointerLockElement === canvas;
    if (session.cameras.head.locked) flightHud.showToast('Mouse captured · Esc to release');
  });
  canvas.addEventListener('wheel', (e) => {
    if (!state.is(GameState.FLYING)) return;
    e.preventDefault();
    session.cameras.zoom(e.deltaY);
  }, { passive: false });
  window.addEventListener('resize', () => flightScene.resize());

  loop.start();

  // Handle for debugging and automated playtests.
  window.__flightsim = { state, settings, bindings, input, scene: flightScene, session, selectScreen, startFlight };
}
