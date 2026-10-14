import * as THREE from 'three';
import { AircraftView } from '../aircraft/aircraftView.js';
import { createCockpit } from '../aircraft/cockpit/index.js';
import { getAircraft } from '../aircraft/index.js';
import { buildMap, getAirport } from '../world/mapBuilder.js';
import { FlightModel } from '../flight/flightModel.js';
import { FlightControls } from '../input/flightControls.js';
import { CameraSystem } from '../scene/cameras.js';
import { FailureManager } from './failures.js';
import { REALISM_ASSIST, getSystems } from './modes.js';
import { startPoint } from './startPoints.js';

// One flight: the flight model, the pilot controls, the visible aircraft and the cameras.
// The game loop calls update() at a fixed rate and render() once per animation frame.

export class FlightSession {
  constructor(flightScene, input, settings) {
    this.flightScene = flightScene;
    this.input = input;
    this.settings = settings;
    this.model = null;
    this.view = null;
    this.controls = new FlightControls(input, settings);
    this.cameras = new CameraSystem(flightScene.camera, { towerPosition: new THREE.Vector3(0, 30, 0) });
    this.cameras.reduceMotion = settings.get('reduceMotion');
    this.startMode = 'runway';
    this.clock = 0;
    this.windAtCamera = new THREE.Vector3();
    this.onToast = null; // (text) => void
    input.on('press', (action) => {
      if (!this.model) return;
      if (action === 'camera_cycle') this.cycleCamera();
      else if (action === 'camera_reset') this.cameras.reset();
      else if (action === 'lights') {
        this.model.controls.lights = !this.model.controls.lights;
        this.onToast?.(this.model.controls.lights ? 'Lights on' : 'Lights off');
      }
    });
    this.controls.onToast = (text) => this.onToast?.(text);
    this.systems = getSystems(settings);
    settings.on('change', ({ key }) => { if (key.startsWith('sys_')) this.applySystems(); });
  }

  /** Push the current mode toggles into the controls, physics world and cameras. */
  applySystems() {
    this.systems = getSystems(this.settings);
    this.controls.setSystems(this.systems);
    this.cameras.cockpitAvailable = this.systems.cockpitCam;
    if (this.view && !this.systems.cockpitCam && this.cameras.mode === 'cockpit') this.cycleCamera();
    if (this.model) {
      this.model.damageEnabled = this.systems.damage;
      this.model.world.setRealism?.(this.systems.fullWeather ? 1 : 0.3);
    }
    this.onSystemsChanged?.(this.systems);
  }

  get aircraftId() {
    return this.model?.spec.id;
  }

  /**
   * Load the map and start a flight.
   * @param opts {aircraftId, mapId, airportCode, endId, startMode, hour, sky, onProgress}
   */
  async start(opts) {
    this.dispose();
    const { aircraftId, mapId, startMode = 'runway', onProgress = () => {} } = opts;
    const spec = getAircraft(aircraftId);
    this.options = opts;
    this.startMode = startMode;

    // The map must exist before we know where the airport is.
    const map = buildMap(mapId);
    const airport = getAirport(map, opts.airportCode);
    const endId = opts.endId ?? airport.runways[0].ends[0].id;
    this.airport = airport;
    this.endId = endId;
    const spawn = startPoint(map, airport, endId, startMode, aircraftId);

    await this.flightScene.loadMap(mapId, { x: spawn.x, y: spawn.y, z: spawn.z }, (f, label) => onProgress(f * 0.9, label));
    onProgress(0.92, `Building ${spec.name}`);
    await new Promise((r) => requestAnimationFrame(() => r()));

    const world = this.flightScene.createPhysicsWorld(this.settings.get('weather'));
    world.setSky(opts.sky ?? 'clear');
    this.flightScene.weather.setReference(airport.elevation);
    this.flightScene.weather.setSky(opts.sky ?? 'clear');
    this.model = new FlightModel(spec, world);
    this.model.nav = { airports: map.airports, active: airport };
    this.view = new AircraftView(spec, createCockpit);
    this.flightScene.scene.add(this.view.root);
    this.cameras.setAircraft(this.view);
    this.cameras.setMode('chase');
    this.cameras.applyLens();
    this.view.setCockpitActive(false);
    this.cameras.towerPosition.set(airport.towerPos.x, airport.elevation + airport.towerPos.y, airport.towerPos.z);
    if (opts.hour != null) this.flightScene.env.setHour(opts.hour);
    this.flightScene.env.timeScale = Number(this.settings.get('timeScale'));
    this.place(startMode);
  }

  place(startMode = this.startMode) {
    const map = this.flightScene.map;
    this.model.world.setWeather(this.settings.get('weather'));
    this.model.world.setSky(this.options?.sky ?? 'clear');
    const spawn = startPoint(map, this.airport, this.endId, startMode, this.model.spec.id);
    this.model.reset(spawn.reset);
    this.controls.attach(this.model);
    this.failures = new FailureManager(this.model, this.options?.seed ?? 20260101 + (this.restarts = (this.restarts ?? 0) + 1));
    this.cameras.initialised = false;
    this.cameras.reset();
    this.settings.set('flightAssist', REALISM_ASSIST[this.settings.get('sys_realism')] ?? 'light');
    this.model.assist = this.settings.get('flightAssist');
    this.applySystems();
  }

  restart() {
    if (this.model) this.place(this.startMode);
  }

  cycleCamera() {
    const mode = this.cameras.cycle();
    this.cameras.applyLens();
    this.view.setCockpitActive(mode === 'cockpit');
    this.onToast?.(`Camera: ${mode}`);
    return mode;
  }

  /** Fixed-step simulation. */
  update(dt) {
    if (!this.model) return;
    this.controls.update(dt);
    this.model.step(dt);
    this.failures?.update(dt, this.systems.failures);
  }

  /** Per-frame: animate the aircraft, move the camera, draw. */
  render(alpha, frameDt) {
    if (!this.model) return;
    this.clock += frameDt;
    this.view.update(this.model, alpha, frameDt, this.clock);
    this.view.setNight(this.flightScene.env.night);
    this.cameras.update(frameDt, this.view.root.position, this.view.root.quaternion, this.controls.look);
    this.model.world.wind(this.view.root.position, this.model.time, this.windAtCamera);
    this.flightScene.update(frameDt, this.flightScene.camera.position, this.windAtCamera, this.model.vel);
    this.flightScene.render();
  }

  /** Drain physics events (touchdown, stall, crash). */
  takeEvents() {
    if (!this.model || this.model.events.length === 0) return [];
    const events = [...this.model.events];
    this.model.events.length = 0;
    return events;
  }

  dispose() {
    if (!this.view) return;
    this.flightScene.scene.remove(this.view.root);
    this.view.root.traverse((o) => {
      o.geometry?.dispose?.();
    });
    this.view = null;
    this.model = null;
  }
}
