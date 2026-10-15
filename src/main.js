import './style.css';
import { GameLoop } from './core/loop.js';
import { GameState, StateMachine } from './core/stateMachine.js';
import { watchModes } from './game/modes.js';
import { FlightSession } from './game/session.js';
import { setColorBlind } from './aircraft/cockpit/instruments.js';
import { Input } from './input/input.js';
import { FlightScene } from './scene/flightScene.js';
import { Keybinds } from './storage/keybinds.js';
import { AdaptiveQuality } from './scene/adaptiveQuality.js';
import { Settings } from './storage/settings.js';
import { h } from './ui/dom.js';
import { getAudio } from './audio/audioBus.js';
import { EngineSound } from './audio/engineSound.js';
import { ModeRunner } from './modes/runner.js';
import { SaveManager } from './progress/saves.js';
import { createContractScreen } from './ui/contractScreen.js';
import { createDebrief } from './ui/debrief.js';
import { createEmergencyScreen } from './ui/emergencyScreen.js';
import { installErrorHandling } from './ui/errorOverlay.js';
import { createFlightHud } from './ui/flightHud.js';
import { createFlightSetup } from './ui/flightSetup.js';
import { createAboutScreen } from './ui/aboutScreen.js';
import { createIntro } from './ui/intro.js';
import { createMapSelect } from './ui/mapSelect.js';
import { createMenuBackground } from './ui/menuBackground.js';
import { createNavigator } from './ui/navigation.js';
import { createModeSelect } from './ui/modeSelect.js';
import { createSavesScreen } from './ui/savesScreen.js';
import { createShopScreen } from './ui/shopScreen.js';
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
  watchModes(settings);
  const bindings = new Keybinds();
  const input = new Input(bindings, settings);
  const state = new StateMachine(GameState.MENU);
  const flightScene = new FlightScene(canvas);
  const session = new FlightSession(flightScene, input, settings);
  const saves = new SaveManager();
  const runner = new ModeRunner({ session, saves, settings });
  const adaptive = new AdaptiveQuality(flightScene);
  const audio = getAudio(settings);
  const engineSound = new EngineSound(audio);
  let selection = null;
  let menuScreen = 'main'; // which menu screen to land on when a flight ends
  let pendingDebrief = false;

  // ---- UI ----------------------------------------------------------------
  const screens = new ScreenManager(uiRoot);
  const hud = createHud();
  const flightHud = createFlightHud({
    settings, input,
    onRestart: () => restartFlight(),
    onSelect: () => leaveToMenu(runner.active ? modeScreenFor() : 'setup'),
    onMenu: () => leaveToMenu(),
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

  const screenEls = {};
  const openScreen = (name) => {
    screenEls[name]?.refresh?.();
    screens.show(name);
  };

  /** Begin a flight: a Quick Flight choice from the setup screen, or a game-mode plan. */
  const launch = (plan) => {
    if (!plan.mode || plan.mode === 'quick') {
      runner.clear();
      selection = plan;
    } else {
      selection = runner.prepare(plan);
    }
    state.go(GameState.LOADING);
  };
  const startFlight = (choice) => launch(choice.mode === 'free' ? { ...choice, mode: 'free' } : { ...choice, mode: 'quick' });
  const modeScreenFor = () => ({ free: 'setup', career: 'career', vip: 'vip', emergency: 'emergency' })[runner.kind] ?? 'main';
  const leaveToMenu = (screen) => {
    menuScreen = screen ?? (runner.active ? modeScreenFor() : 'main');
    state.go(GameState.MENU);
  };
  const restartFlight = () => {
    session.restart();
    engineSound.attach(session.model);
    if (runner.active) runner.attach();
    flightHud.setCrash(null);
    flightHud.bind(session);
    announceStart();
    if (state.is(GameState.PAUSED)) state.go(GameState.FLYING);
  };
  const announceStart = () => {
    const sim = session.systems.atc;
    const keys = `W/S pitch · A/D roll · Q/E rudder · Shift/Ctrl throttle · Space brakes · B parking brake · G gear · F/V flaps · C camera${sim ? ' · R radio · K checklist' : ''} · H hide HUD`;
    const info = runner.active ? runner.info() : null;
    flightHud.showHint(info ? `${info.title} · F9 shows your objectives · ${keys}` : keys);
  };

  const settingsScreen = createSettingsScreen({
    settings, bindings, input, onBack: () => screens.show(settingsReturn), onPilots: () => openSaves('settings'),
  });
  const mapScreen = createMapSelect({
    onSelect: (mapId) => { setupScreen.setMap(mapId); openScreen('setup'); },
    onBack: () => openScreen('modes'),
  });
  const setupScreen = createFlightSetup({ settings, saves, onFly: startFlight, onBack: () => { mapScreen.refresh(); screens.show('maps'); }, onShop: () => openScreen('shop') });

  // Pilots and saves can be opened from anywhere; `afterPilot` continues what the player was doing.
  let savesReturn = 'modes';
  let afterPilot = null;
  const openSaves = (from, next = null) => { savesReturn = from; afterPilot = next; openScreen('saves'); };
  const needPilot = (from, next) => { if (saves.active) next(); else openSaves(from, next); };

  const pick = (id) => {
    if (id === 'quick') { setupScreen.setKind('quick'); mapScreen.refresh(); screens.show('maps'); }
    else if (id === 'free') needPilot('modes', () => { setupScreen.setKind('free'); mapScreen.refresh(); screens.show('maps'); });
    else if (id === 'career') needPilot('modes', () => openScreen('career'));
    else if (id === 'vip') needPilot('modes', () => openScreen('vip'));
    else if (id === 'emergency') needPilot('modes', () => openScreen('emergency'));
  };
  const begin = (plan) => needPilot('modes', () => launch(plan));

  screenEls.main = screens.register('main', createMainMenu({
    saves,
    onStart: () => openScreen('modes'),
    onContinue: () => openScreen('modes'),
    onSettings: () => openSettings('main'),
    onControls: () => { openSettings('main'); settingsScreen.showTab('controls'); },
    onAbout: () => openScreen('about'),
    onFullscreen: () => {
      try {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.();
      } catch { /* fullscreen is optional */ }
    },
  }));
  screenEls.about = screens.register('about', createAboutScreen({ onBack: () => openScreen('main') }));
  screenEls.modes = screens.register('modes', createModeSelect({
    saves, onPick: pick, onShop: () => openScreen('shop'), onPilots: () => openSaves('modes'), onBack: () => openScreen('main'),
  }));
  screenEls.saves = screens.register('saves', createSavesScreen({
    saves,
    onBack: () => { afterPilot = null; openScreen(savesReturn); },
    onPicked: () => { const next = afterPilot; afterPilot = null; if (next && saves.active) next(); },
  }));
  screenEls.shop = screens.register('shop', createShopScreen({ saves, onBack: () => openScreen('modes'), onPilots: () => openSaves('shop') }));
  screenEls.career = screens.register('career', createContractScreen({ kind: 'career', saves, onStart: begin, onBack: () => openScreen('modes'), onPilots: () => openSaves('career') }));
  screenEls.vip = screens.register('vip', createContractScreen({ kind: 'vip', saves, onStart: begin, onBack: () => openScreen('modes'), onPilots: () => openSaves('vip') }));
  screenEls.emergency = screens.register('emergency', createEmergencyScreen({ saves, onStart: begin, onBack: () => openScreen('modes'), onPilots: () => openSaves('emergency') }));
  screenEls.maps = screens.register('maps', mapScreen);
  screenEls.setup = screens.register('setup', setupScreen);
  screens.register('loading', loadingScreen);
  const debrief = createDebrief();
  screens.register('debrief', debrief);
  const pauseMenu = createPauseMenu({
    onResume: () => state.go(GameState.FLYING),
    onRestart: restartFlight,
    onSettings: () => openSettings('pause'),
    onQuit: () => leaveToMenu(),
  });
  screens.register('pause', pauseMenu);
  screens.register('settings', settingsScreen);
  // Animated backdrop behind the menus: moving on the main menu, a still frame behind the others.
  const menuBg = createMenuBackground({ settings });
  document.getElementById('app').insertBefore(menuBg.canvas, uiRoot);
  const BACKDROP = new Set(['main', 'about', 'modes', 'saves', 'shop', 'career', 'vip', 'emergency', 'maps', 'setup']);
  screens.onShow = (name) => {
    const menuState = state.is(GameState.MENU);
    menuBg.show(menuState && BACKDROP.has(name), name === 'main');
  };
  const intro = createIntro({ settings, onDone: () => screens.show('main') });
  uiRoot.append(intro);
  screens.show('main');
  intro.start();
  createNavigator({ ui: uiRoot, screens, input, settings, audio });

  session.onToast = (text) => flightHud.showToast(text);
  session.onSystemsChanged = () => flightHud.refreshSystems();

  // ---- settings -> live effects -----------------------------------------
  const applySetting = (key) => {
    const value = settings.get(key);
    switch (key) {
      case 'quality': flightScene.setQuality(value); adaptive.setEnabled(value === 'auto'); break;
      case 'showFps': hud.setFpsVisible(value); break;
      case 'hudScale': case 'textSize': {
        const text = Number(settings.get('textSize'));
        const scale = settings.get('hudScale') * text;
        hud.setScale(scale);
        flightHud.style.setProperty('--hud-scale', scale);
        document.documentElement.style.setProperty('--ui-zoom', String(text));
        break;
      }
      case 'highContrast': document.body.classList.toggle('high-contrast', value); break;
      case 'colorblind':
        document.body.classList.toggle('colorblind', value);
        setColorBlind(value);
        break;
      case 'hudOpacity': hud.setOpacity(value); flightHud.style.setProperty('--hud-opacity', value); break;
      case 'reduceMotion':
        document.body.classList.toggle('reduce-motion', value);
        session.cameras.reduceMotion = value;
        break;
      default: break; // masterVolume / preset are consumed by later phases
    }
  };
  ['quality', 'showFps', 'hudScale', 'textSize', 'hudOpacity', 'reduceMotion', 'highContrast', 'colorblind'].forEach(applySetting);
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
        runner.update(dt);
      }
    },
    render: (alpha, frameDt) => {
      if (!state.is(GameState.FLYING, GameState.PAUSED) || !flightScene.built) return;
      session.render(state.is(GameState.PAUSED) ? 1 : alpha, frameDt);
      if (++hudCounter % 3 === 0 && session.model) updateHud();
    },
    onFrame: (frameDt) => {
      loop.timeScale = state.is(GameState.FLYING) && session.model ? session.controls.time.scale : 1;
      if (state.is(GameState.FLYING)) adaptive.frame(frameDt);
      if (state.is(GameState.FLYING, GameState.PAUSED)) input.pollGamepad();
      fpsFrames++;
      fpsTime += frameDt;
      if (fpsTime >= 0.5) {
        hud.setFps(fpsFrames / fpsTime, adaptive.enabled ? adaptive.scale : null);
        fpsFrames = 0;
        fpsTime = 0;
      }
    },
  });

  const WIND_TEXT = { calm: '', breeze: 'WIND 8 kt headwind', crosswind: 'WIND 14 kt crosswind', gusty: 'WIND 12 kt gusting 18' };
  function updateHud() {
    const m = session.model;
    const tel = m.telemetry;
    engineSound.update(0.05, tel, session.cameras.mode === 'cockpit');
    flightHud.update(tel, {
      fixedGear: !m.spec.gear.retractable,
      assist: settings.get('flightAssist'),
      gearSpeed: m.spec.speeds.vapp * 1.4,
      windText: WIND_TEXT[settings.get('weather')],
      cameraLabel: `${session.cameras.mode} camera`,
      cameraMode: session.cameras.mode,
    });
  }
  function handleEvents() {
    const events = session.takeEvents();
    if (!events.length) return;
    runner.handleEvents(events);
    for (const e of events) {
      if (e.type === 'touchdown') { flightHud.showTouchdown(e); audio.touchdown(e.sink ?? 0); }
      else if (e.type === 'strike') flightHud.showToast('Airframe strike! Check your pitch attitude');
      else if (e.type === 'crash') { flightHud.setCrash(e.reason); input.releaseAll(); audio.crash(); }
      else if (e.type === 'failure') flightHud.onFailure(e);
    }
  }

  // ---- game-mode results -----------------------------------------------------
  const showDebrief = (res) => {
    const buttons = [];
    const again = () => { pendingDebrief = false; restartFlight(); };
    if (res.mode === 'free') {
      buttons.push({ label: 'Continue flying', primary: true, run: () => { runner.result = null; state.go(GameState.FLYING); } });
      buttons.push({ label: 'Back to menu', run: () => leaveToMenu('modes') });
    } else if (res.mode === 'emergency') {
      buttons.push({ label: 'Fly this seed again', primary: !res.success, run: again });
      buttons.push({ label: 'New scenario', primary: res.success, run: () => { screenEls.emergency.setSeed(1 + Math.floor(Math.random() * 99999)); leaveToMenu('emergency'); } });
      buttons.push({ label: 'Back to menu', run: () => leaveToMenu('modes') });
    } else {
      if (res.success && res.nextUnlocked) buttons.push({ label: 'Next mission', primary: true, run: () => { leaveToMenu(res.mode); screenEls[res.mode].select(res.nextId); } });
      buttons.push({ label: res.success ? 'Fly it again' : 'Retry', primary: !(res.success && res.nextUnlocked), run: again });
      buttons.push({ label: res.mode === 'vip' ? 'Escort list' : 'Mission list', run: () => { leaveToMenu(res.mode); if (res.missionId) screenEls[res.mode].select(res.missionId); } });
    }
    debrief.show(res, buttons, saves.active ? `Progress saved · ${saves.active.name} · ${Math.round(saves.active.money).toLocaleString('en-US')} cr` : '');
    input.releaseAll();
    pendingDebrief = true;
    state.go(GameState.PAUSED);
  };
  runner.on('result', (res) => {
    if (res.crash) {
      const money = res.total < 0 ? `Repair bill ${Math.abs(res.total).toLocaleString('en-US')} cr.` : '';
      flightHud.setCrash(res.subtitle, money);
      input.releaseAll();
      return;
    }
    // Let the touchdown report and the last toast be seen before the debrief takes over.
    setTimeout(() => { if (state.is(GameState.FLYING) && runner.result === res) showDebrief(res); }, res.success ? 1500 : 900);
  });
  window.addEventListener('pagehide', () => saves.autosave('close'));
  let warnedStorage = false;
  saves.on('saved', ({ ok }) => {
    if (ok || warnedStorage) return;
    warnedStorage = true;
    flightHud.showToast('Could not save: browser storage is unavailable. Export your pilot from Pilots and saves to keep it.');
  });

  // ---- state transitions ---------------------------------------------------
  state.on('change', async ({ to }) => {
    input.enabled = to === GameState.FLYING || to === GameState.PAUSED;
    const inFlight = to === GameState.FLYING || to === GameState.PAUSED;
    hud.classList.toggle('active', inFlight || to === GameState.MENU);
    flightHud.setVisible(inFlight);
    flightHud.setPaused(to === GameState.PAUSED);
    session.paused = to === GameState.PAUSED;
    audio.setFlying(to === GameState.FLYING);
    if (to === GameState.MENU || to === GameState.LOADING) engineSound.stopAll();
    if (to !== GameState.FLYING) input.releaseAll();
    if (to !== GameState.FLYING && document.pointerLockElement) document.exitPointerLock();

    switch (to) {
      case GameState.MENU:
        saves.autosave('menu');
        runner.clear();
        flightHud.setMode(null);
        pauseMenu.setContext();
        flightHud.setCrash(null);
        session.dispose();
        openScreen(menuScreen);
        menuScreen = 'main';
        break;
      case GameState.LOADING:
        screens.show('loading');
        loadingScreen.setProgress(0, 'Starting…');
        try {
          await session.start({ ...selection, onProgress: (fraction, label) => loadingScreen.setProgress(fraction, label) });
          loadingScreen.setProgress(1, 'Ready');
        } catch (err) {
          console.error('Failed to start the flight', err);
          loadingScreen.setProgress(0, 'Loading failed. Returning to menu…');
          await new Promise((r) => setTimeout(r, 1500));
          if (state.is(GameState.LOADING)) state.go(GameState.MENU);
          break;
        }
        flightHud.setCrash(null);
        engineSound.attach(session.model);
        if (runner.active) {
          runner.attach();
          flightHud.setMode({
            info: () => runner.info(), perks: saves.active?.upgrades ?? [],
            retryLabel: runner.kind === 'free' ? 'Restart flight' : 'Retry', selectLabel: runner.kind === 'free' ? 'Choose aircraft' : 'Mode menu',
          });
          const info = runner.info();
          pauseMenu.setContext(`${info.title}${info.subtitle ? ` · ${info.subtitle}` : ''}`, runner.kind === 'free' ? 'Restart flight' : 'Retry', 'Quit to mode menu');
        } else {
          flightHud.setMode(null);
          pauseMenu.setContext();
        }
        flightHud.bind(session);
        announceStart();
        if (state.is(GameState.LOADING)) state.go(GameState.FLYING);
        break;
      case GameState.FLYING:
        pendingDebrief = false;
        adaptive.reset();
        screens.show(null);
        loop.resetClock();
        break;
      case GameState.PAUSED:
        if (pendingDebrief) screens.show('debrief');
        else { saves.autosave('pause'); screens.show('pause'); }
        break;
      default: break;
    }
  });

  input.on('press', (action) => {
    if (state.is(GameState.FLYING)) flightHud.handleAction(action);
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

  installErrorHandling({
    root: uiRoot, canvas,
    onError: () => { saves.autosave('error'); if (state.is(GameState.FLYING)) state.go(GameState.PAUSED); },
    onMenu: () => { if (!state.is(GameState.MENU)) state.go(GameState.MENU); },
  });
  loop.start();

  // Handle for debugging and automated playtests.
  window.__flightsim = { state, settings, bindings, input, scene: flightScene, session, setupScreen, startFlight, hud: flightHud, saves, runner, launch, screens, openScreen, showDebrief, audio, engineSound };
}
