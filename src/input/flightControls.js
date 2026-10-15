import { Engine } from '../flight/engine.js';
import { approach, clamp } from '../flight/units.js';

// Turns input actions (keyboard, gamepad) into flight-model controls every frame.
// Keyboard keys act like a stick that ramps toward full deflection and springs
// back to centre; gamepad sticks are analog and win whenever they are deflected.

const KEY_RATE = { pitch: 2.2, roll: 3.4, yaw: 2.6 }; // stick units per second while a key is held
const KEY_LIMIT = { pitch: 0.85, roll: 1, yaw: 1 }; // keys never give full deflection; use a pad or assist for that
const KEY_RETURN = 6; // per second back to centre when released
const THROTTLE_RATE = 0.35; // per second
const TRIM_RATE = 0.12; // per second

export class FlightControls {
  constructor(input, settings) {
    this.input = input;
    this.settings = settings;
    this.model = null;
    this.stick = { pitch: 0, roll: 0, yaw: 0 };
    this.master = 0; // master throttle 0..1
    this.levers = []; // per-engine levers (used when the per-engine system is on)
    this.uiBrake = false; // wheel brakes held from the dashboard pedal
    this.selected = null; // engine index the throttle keys act on, or null for all
    this.systems = { perEngine: false, manualFlaps: true, manualGear: true };
    this.autoGearState = true;
    this.look = { x: 0, y: 0 }; // analog look (right stick in cockpit view)
    this.onToast = null; // (text) => void
    input.on('press', (action) => this.#onPress(action));
    this.onFailureAction = null;
  }

  attach(model) {
    this.model = model;
    this.stick.pitch = this.stick.roll = this.stick.yaw = 0;
    this.master = Math.max(...model.controls.throttle);
    this.levers = model.controls.throttle.map(() => this.master);
    this.selected = null;
    this.landedLatch = false;
  }

  setSystems(systems) {
    const wasPer = this.systems.perEngine;
    this.systems = systems;
    if (wasPer && !systems.perEngine && this.levers.length) this.master = Math.max(...this.levers);
    if (!wasPer && systems.perEngine) this.levers.fill(this.master);
    if (!systems.perEngine) this.selected = null;
  }

  /** Set one engine's lever directly (the HUD levers use this). */
  setEngine(index, value) {
    this.levers[index] = clamp(value, 0, 1);
    if (!this.systems.perEngine) this.master = this.levers[index];
  }

  setMaster(value) {
    this.master = clamp(value, 0, 1);
    this.levers.fill(this.master);
  }

  /** Engine the system actions apply to: the selected one, or the only engine. */
  #engineTarget(m) {
    if (this.selected != null) return Math.min(this.selected, m.engines.length - 1);
    return m.engines.length === 1 ? 0 : null;
  }

  #selectedList() {
    const n = this.levers.length;
    return this.selected == null ? [...Array(n).keys()] : [Math.min(this.selected, n - 1)];
  }

  #toast(text) {
    this.onToast?.(text);
  }

  /** Run an action as if its key had been pressed (the HUD buttons use this). */
  perform(action) {
    // Through the input layer, so actions handled elsewhere (lights, camera) work from the HUD too.
    this.input.emit('press', action);
  }

  /** Set a flap detent directly (the HUD flap lever uses this). */
  setFlaps(stage) {
    const m = this.model;
    if (!m || m.crashed) return;
    if (!this.systems.manualFlaps) return this.#toast('Flaps are automatic (turn on Manual flaps in Settings)');
    m.controls.flapsStage = clamp(stage, 0, m.spec.flaps.stages.length - 1);
    this.#toast(`Flaps ${m.spec.flaps.stages[m.controls.flapsStage].deg}°`);
  }

  #onPress(action) {
    const m = this.model;
    if (!m || m.crashed) return;
    const c = m.controls;
    switch (action) {
      case 'gear':
        if (!m.spec.gear.retractable) return this.#toast('Fixed landing gear');
        if (!this.systems.manualGear) return this.#toast('Gear is automatic (turn on Manual landing gear in Settings)');
        if (m.gear.weightOnWheels && c.gearDown) return this.#toast('Gear locked down: weight on wheels');
        c.gearDown = !c.gearDown;
        this.#toast(c.gearDown ? 'Gear down' : 'Gear up');
        break;
      case 'flaps_down': {
        if (!this.systems.manualFlaps) return this.#toast('Flaps are automatic (turn on Manual flaps in Settings)');
        const max = m.spec.flaps.stages.length - 1;
        c.flapsStage = Math.min(max, c.flapsStage + 1);
        this.#toast(`Flaps ${m.spec.flaps.stages[c.flapsStage].deg}°`);
        break;
      }
      case 'flaps_up':
        if (!this.systems.manualFlaps) return this.#toast('Flaps are automatic (turn on Manual flaps in Settings)');
        c.flapsStage = Math.max(0, c.flapsStage - 1);
        this.#toast(`Flaps ${m.spec.flaps.stages[c.flapsStage].deg}°`);
        break;
      case 'parking_brake':
        c.parkingBrake = !c.parkingBrake;
        this.#toast(c.parkingBrake ? 'Parking brake set' : 'Parking brake released');
        break;
      case 'speedbrake':
        c.speedbrake = !c.speedbrake;
        this.#toast(c.speedbrake ? 'Speedbrake out' : 'Speedbrake in');
        break;
      case 'throttle_idle': this.#setSelected(0); break;
      case 'throttle_full': this.#setSelected(1); break;
      case 'engine_cycle': {
        if (!this.systems.perEngine || m.engines.length < 2) return;
        const n = m.engines.length;
        this.selected = this.selected == null ? 0 : this.selected + 1 >= n ? null : this.selected + 1;
        this.#toast(this.selected == null ? 'Throttle: all engines' : `Throttle: engine ${this.selected + 1}`);
        break;
      }
      case 'engine_all':
        this.selected = null;
        if (this.systems.perEngine) this.#toast('Throttle: all engines');
        break;
      case 'apu_toggle':
        if (!this.systems.fuel) return this.#toast('APU control needs Fuel management and APU (Settings)');
        this.#toast(m.sys.toggleApu() ? 'APU starting' : 'APU off');
        break;
      case 'pitot_heat':
        this.#toast(m.sys.togglePitotHeat() ? 'Pitot heat on' : 'Pitot heat off');
        break;
      case 'engine_shutdown': {
        const i = this.#engineTarget(m);
        if (i == null) return this.#toast('Select an engine first ( [ ] )');
        m.sys.shutdownEngine(m, i);
        this.#toast(`Engine ${i + 1} shut down`);
        break;
      }
      case 'engine_restart': {
        const i = this.#engineTarget(m);
        if (i == null) return this.#toast('Select an engine first ( [ ] )');
        this.#toast(m.sys.restartEngine(m, i) ? `Engine ${i + 1} restart` : `Engine ${i + 1} cannot be restarted`);
        break;
      }
      case 'fire_extinguish': {
        let i = m.sys.fire.findIndex(Boolean);
        if (i < 0) i = this.#engineTarget(m) ?? -1;
        if (i < 0) return this.#toast('No engine fire');
        const result = m.sys.extinguish(m, i);
        this.#toast(result === 'out' ? `Engine ${i + 1} fire is out` : result === 'empty' ? 'Fire bottle empty' : `Engine ${i + 1} still running: shut it down first`);
        break;
      }
      case 'gear_emergency':
        if (!m.spec.gear.retractable) return this.#toast('Fixed landing gear');
        m.sys.emergencyGear();
        this.#toast('Emergency gear extension');
        break;
      case 'fuel_dump':
        if (!this.systems.fuel) return this.#toast('Fuel dump needs Fuel management and APU (Settings)');
        if (!m.sys.dumpRate) return this.#toast('This aircraft cannot dump fuel');
        this.#toast(m.sys.toggleDump(m) ? 'Fuel dump on' : 'Fuel dump off');
        break;
      case 'crossfeed':
        if (!this.systems.fuel) return this.#toast('Crossfeed needs Fuel management and APU (Settings)');
        m.crossfeed = !m.crossfeed;
        this.#toast(m.crossfeed ? 'Fuel crossfeed open' : 'Fuel crossfeed closed');
        break;
      case 'assist_cycle': {
        const order = ['off', 'light', 'full'];
        const next = order[(order.indexOf(this.settings.get('flightAssist')) + 1) % order.length];
        this.settings.set('flightAssist', next);
        this.#toast(`Flight assist: ${next}`);
        break;
      }
      default: break;
    }
  }

  #setSelected(value) {
    if (!this.systems.perEngine) return this.setMaster(value);
    for (const i of this.#selectedList()) this.levers[i] = value;
    this.master = Math.max(...this.levers);
  }

  /** Flaps follow airspeed: out as the aircraft slows on approach, in as it speeds up after takeoff. */
  #autoFlaps(m, tel, dt) {
    const stages = m.spec.flaps.stages;
    const c = m.controls;
    const sp = m.spec.speeds;
    if (tel.onGround) {
      // Rolling for takeoff: takeoff setting. After a landing, clean up once slow.
      if (m.gear.touchdown) this.landedLatch = true;
      if (this.landedLatch && tel.groundSpeed < 50) c.flapsStage = 0;
      this.approachLatch = false;
      return;
    }
    this.landedLatch = false;
    const landing = m.spec.flaps.landingStage;
    const takeoff = m.spec.flaps.takeoffStage ?? 0;
    // Landing flaps are allowed once the aircraft has started down toward a runway, and stay allowed
    // until it climbs away again (so a level, slow base leg does not flap back and forth).
    if (tel.vsFpm < -250 && tel.aglFt < 4000) this.approachLatch = true;
    else if (tel.vsFpm > 500) this.approachLatch = false;
    const cap = this.approachLatch ? landing : takeoff;
    this.flapTimer = (this.flapTimer ?? 0) + dt;
    let best = 0;
    for (let i = 1; i < stages.length; i++) {
      const limit = Math.min(stages[i].vs * 1.6, sp.vfe) + (c.flapsStage >= i ? 6 : 0); // hysteresis
      if (tel.ias <= limit) best = i;
    }
    const target = Math.min(best, cap);
    // Move one stage at a time, at most every few seconds, like a flap lever being worked.
    if (target !== c.flapsStage && this.flapTimer > 3) {
      c.flapsStage += Math.sign(target - c.flapsStage);
      this.flapTimer = 0;
    }
  }

  /** Gear up after takeoff, down on approach. */
  #autoGear(m, tel) {
    if (!m.spec.gear.retractable) return;
    const c = m.controls;
    if (tel.onGround) { c.gearDown = true; return; }
    const descending = tel.vsFpm < -300 || (this.approachLatch && tel.vsFpm < 100);
    if (c.gearDown && tel.aglFt > 80 && tel.vsFpm > 200 && tel.ias > m.spec.speeds.vr) c.gearDown = false;
    else if (!c.gearDown && ((descending && tel.aglFt < 2000) || (tel.aglFt < 250 && tel.vsFpm < 100 && tel.ias < m.spec.speeds.vapp * 1.4))) c.gearDown = true;
  }

  /** Call once per fixed physics step, before model.step(). */
  update(dt) {
    const m = this.model;
    if (!m) return;
    const { input } = this;
    const pad = input.pad;
    const padOn = pad.connected && input.enabled;
    const c = m.controls;
    m.assist = this.settings.get('flightAssist');

    // Keyboard stick: ramp toward the held direction, spring back otherwise.
    const keyAxis = {
      pitch: input.axis('pitch_down', 'pitch_up'),
      roll: input.axis('roll_left', 'roll_right'),
      yaw: input.axis('yaw_left', 'yaw_right'),
    };
    for (const axis of ['pitch', 'roll', 'yaw']) {
      const target = keyAxis[axis] * KEY_LIMIT[axis];
      const rate = target === 0 ? KEY_RETURN : KEY_RATE[axis];
      this.stick[axis] = approach(this.stick[axis], target, rate * dt);
    }

    let pitch = this.stick.pitch;
    let roll = this.stick.roll;
    let yaw = this.stick.yaw;
    if (padOn && pad.active) {
      const invert = this.settings.get('padInvertPitch') ? -1 : 1;
      // Stick pulled back (axis +Y) = pull up; right stick X = rudder.
      if (pad.axes.leftY !== 0) pitch = clamp(pad.axes.leftY * invert, -1, 1);
      if (pad.axes.leftX !== 0) roll = pad.axes.leftX;
      if (pad.axes.rightX !== 0) yaw = pad.axes.rightX;
    }
    c.pitch = clamp(pitch, -1, 1);
    c.roll = clamp(roll, -1, 1);
    c.yaw = clamp(yaw, -1, 1);
    c.steer = c.yaw;

    // Throttle: keys and triggers adjust the master lever.
    let throttleDelta = input.axis('throttle_down', 'throttle_up') * THROTTLE_RATE * dt;
    if (padOn) throttleDelta += (pad.axes.rt - pad.axes.lt) * THROTTLE_RATE * 1.4 * dt;
    if (this.systems.perEngine) {
      if (throttleDelta !== 0) for (const i of this.#selectedList()) this.levers[i] = clamp(this.levers[i] + throttleDelta, 0, 1);
      for (let i = 0; i < c.throttle.length; i++) c.throttle[i] = this.levers[i] ?? this.master;
      this.master = Math.max(...this.levers);
    } else {
      this.master = clamp(this.master + throttleDelta, 0, 1);
      this.levers.fill(this.master);
      c.throttle.fill(this.master);
    }

    // Mixture and propeller levers: manual with the systems on, automatic otherwise.
    if (this.systems.fuel) {
      c.mixture = clamp(c.mixture + input.axis('mixture_lean', 'mixture_rich') * 0.4 * dt, 0, 1);
      c.prop = clamp(c.prop + input.axis('prop_down', 'prop_up') * 0.4 * dt, 0, 1);
    } else {
      c.mixture = Math.min(1, Engine.bestMixture(m.air.sigma) + 0.04);
      c.prop = 1;
    }
    const tel = m.telemetry;
    tel.ias = tel.iasTrue; // automation uses the real airspeed even when the display is wrong
    if (!this.systems.manualFlaps) this.#autoFlaps(m, tel, dt);
    if (!this.systems.manualGear) this.#autoGear(m, tel);

    // Trim.
    const trim = input.axis('trim_down', 'trim_up');
    if (trim !== 0) c.trim = clamp(c.trim + trim * TRIM_RATE * dt, -1, 1);

    // Brakes, with differential braking from the rudder pedals when the toe brakes are used.
    const both = input.isDown('brakes') || this.uiBrake;
    let left = both || input.isDown('brake_left') ? 1 : 0;
    let right = both || input.isDown('brake_right') ? 1 : 0;
    if (both && Math.abs(c.yaw) > 0.3) {
      if (c.yaw < 0) right = 1 - Math.min(1, (Math.abs(c.yaw) - 0.3) / 0.5);
      else left = 1 - Math.min(1, (Math.abs(c.yaw) - 0.3) / 0.5);
    }
    c.brakeLeft = left;
    c.brakeRight = right;

    // Analog look for the cockpit camera.
    const lookInvert = this.settings.get('padInvertLook') ? -1 : 1;
    // Right stick X is the rudder, so the stick only looks up/down. Mouse drag handles looking around.
    this.look.x = 0;
    this.look.y = padOn ? pad.axes.rightY * lookInvert : 0;
  }
}
