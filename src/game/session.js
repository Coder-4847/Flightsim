import { AircraftView } from '../aircraft/aircraftView.js';
import { createCockpit } from '../aircraft/cockpit/index.js';
import { getAircraft } from '../aircraft/index.js';
import { FlightModel } from '../flight/flightModel.js';
import { KT } from '../flight/units.js';
import { FlightControls } from '../input/flightControls.js';
import { CameraSystem } from '../scene/cameras.js';
import { FlightScene } from '../scene/flightScene.js';

// One flight: the flight model, the pilot controls, the visible aircraft and the cameras.
// The game loop calls update() at a fixed rate and render() once per animation frame.

export const START_MODES = [
  { id: 'runway', label: 'On the runway', hint: 'Ready for takeoff at the south end of runway 36.' },
  { id: 'final', label: 'Final approach', hint: 'Four and a half kilometres out on a 3° glide path, gear and flaps set.' },
  { id: 'air', label: 'In flight', hint: 'Trimmed and cruising above the airfield.' },
];

export class FlightSession {
  constructor(flightScene, input, settings) {
    this.flightScene = flightScene;
    this.input = input;
    this.settings = settings;
    this.model = null;
    this.view = null;
    this.controls = new FlightControls(input, settings);
    this.cameras = new CameraSystem(flightScene.camera, { towerPosition: FlightScene.TOWER_POSITION });
    this.cameras.reduceMotion = settings.get('reduceMotion');
    this.startMode = 'runway';
    this.clock = 0;
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
  }

  get aircraftId() {
    return this.model?.spec.id;
  }

  /** Create (or replace) the aircraft and place it for the chosen start. */
  start(aircraftId, startMode = 'runway') {
    this.dispose();
    const spec = getAircraft(aircraftId);
    this.startMode = startMode;
    const world = FlightScene.createPhysicsWorld(this.settings.get('weather'));
    this.model = new FlightModel(spec, world);
    this.view = new AircraftView(spec, createCockpit);
    this.flightScene.scene.add(this.view.root);
    this.cameras.setAircraft(this.view);
    this.cameras.cockpitAvailable = true;
    this.cameras.setMode('chase');
    this.cameras.applyLens();
    this.view.setCockpitActive(false);
    this.place(startMode);
  }

  place(startMode = this.startMode) {
    const spec = this.model.spec;
    this.model.world.setWeather(this.settings.get('weather'));
    const threshold = 1200; // south threshold of runway 36 (z = +1200), heading north
    switch (startMode) {
      case 'final':
        this.model.reset({
          mode: 'final', heading: 0, x: 0, z: threshold + 4500,
          altitude: 4500 * Math.tan((3 * Math.PI) / 180) + 14, speed: spec.speeds.vapp * KT, pathAngle: -3,
        });
        break;
      case 'air':
        this.model.reset({ mode: 'air', heading: 0, x: 0, z: threshold, altitude: 1200, speed: spec.speeds.cruise * KT });
        break;
      default:
        this.model.reset({ mode: 'runway', heading: 0, x: 0, z: threshold - 60 });
    }
    this.controls.attach(this.model);
    this.cameras.initialised = false;
    this.cameras.reset();
    this.model.assist = this.settings.get('flightAssist');
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
  }

  /** Per-frame: animate the aircraft, move the camera, draw. */
  render(alpha, frameDt) {
    if (!this.model) return;
    this.clock += frameDt;
    this.view.update(this.model, alpha, frameDt, this.clock);
    this.cameras.update(frameDt, this.view.root.position, this.view.root.quaternion, this.controls.look);
    this.flightScene.render(this.flightScene.camera.position);
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
