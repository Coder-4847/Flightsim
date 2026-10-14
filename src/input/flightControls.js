import { approach, clamp } from '../flight/units.js';

// Turns input actions (keyboard, gamepad) into flight-model controls every frame.
// Keyboard keys act like a stick that ramps toward full deflection and springs
// back to centre; gamepad sticks are analog and win whenever they are deflected.

const KEY_RATE = { pitch: 2.4, roll: 2.8, yaw: 3.2 }; // stick units per second while a key is held
const KEY_RETURN = 5; // per second back to centre when released
const THROTTLE_RATE = 0.35; // per second
const TRIM_RATE = 0.12; // per second

export class FlightControls {
  constructor(input, settings) {
    this.input = input;
    this.settings = settings;
    this.model = null;
    this.stick = { pitch: 0, roll: 0, yaw: 0 };
    this.master = 0; // master throttle 0..1
    this.look = { x: 0, y: 0 }; // analog look (right stick in cockpit view)
    this.onToast = null; // (text) => void
    input.on('press', (action) => this.#onPress(action));
  }

  attach(model) {
    this.model = model;
    this.stick.pitch = this.stick.roll = this.stick.yaw = 0;
    this.master = Math.max(...model.controls.throttle);
  }

  #toast(text) {
    this.onToast?.(text);
  }

  #onPress(action) {
    const m = this.model;
    if (!m || m.crashed) return;
    const c = m.controls;
    switch (action) {
      case 'gear':
        if (!m.spec.gear.retractable) return this.#toast('Fixed landing gear');
        if (m.gear.weightOnWheels && c.gearDown) return this.#toast('Gear locked down: weight on wheels');
        c.gearDown = !c.gearDown;
        this.#toast(c.gearDown ? 'Gear down' : 'Gear up');
        break;
      case 'flaps_down': {
        const max = m.spec.flaps.stages.length - 1;
        c.flapsStage = Math.min(max, c.flapsStage + 1);
        this.#toast(`Flaps ${m.spec.flaps.stages[c.flapsStage].deg}°`);
        break;
      }
      case 'flaps_up':
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
      case 'throttle_idle': this.master = 0; break;
      case 'throttle_full': this.master = 1; break;
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
      const target = keyAxis[axis];
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
    this.master = clamp(this.master + throttleDelta, 0, 1);
    c.throttle.fill(this.master);

    // Trim.
    const trim = input.axis('trim_down', 'trim_up');
    if (trim !== 0) c.trim = clamp(c.trim + trim * TRIM_RATE * dt, -1, 1);

    // Brakes, with differential braking from the rudder pedals when the toe brakes are used.
    const both = input.isDown('brakes');
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
