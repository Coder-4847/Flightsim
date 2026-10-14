import { clamp } from '../flight/units.js';

// Gamepad API source. Buttons use the standard mapping and are exposed by name so
// they can be bound like keys; sticks and triggers are analog flight inputs.
export const PAD_BUTTONS = [
  'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3',
  'DPadUp', 'DPadDown', 'DPadLeft', 'DPadRight',
];

const TRIGGER_THRESHOLD = 0.5;

export class GamepadSource {
  constructor(settings) {
    this.settings = settings;
    this.connected = false;
    this.id = '';
    this.pressed = new Set(); // button names currently down
    this.axes = { leftX: 0, leftY: 0, rightX: 0, rightY: 0, lt: 0, rt: 0 };
    this.active = false; // true while any stick is outside the dead zone
    window.addEventListener('gamepadconnected', (e) => { this.id = e.gamepad.id; });
    window.addEventListener('gamepaddisconnected', () => { this.connected = false; this.pressed.clear(); });
  }

  /** Radial dead zone with an expo curve: small deflections are softened, full deflection stays 1. */
  shape(x, y) {
    const dz = this.settings.get('padDeadzone');
    const expo = this.settings.get('padCurve');
    const mag = Math.hypot(x, y);
    if (mag <= dz) return [0, 0];
    const scaled = clamp((mag - dz) / (1 - dz), 0, 1);
    const curved = (1 - expo) * scaled + expo * scaled ** 3;
    return [(x / mag) * curved, (y / mag) * curved];
  }

  /**
   * Read the first connected pad. Returns the list of button names that changed
   * as {name, down} so callers can emit press/release events.
   */
  poll() {
    const changes = [];
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.connected);
    if (!pad) {
      this.connected = false;
      for (const name of this.pressed) changes.push({ name, down: false });
      this.pressed.clear();
      this.active = false;
      return changes;
    }
    this.connected = true;
    this.id = pad.id;

    const down = new Set();
    pad.buttons.forEach((b, i) => {
      const name = PAD_BUTTONS[i];
      if (!name) return;
      const isDown = b.pressed || ((name === 'LT' || name === 'RT') && b.value > TRIGGER_THRESHOLD);
      if (isDown) down.add(name);
    });
    for (const name of down) if (!this.pressed.has(name)) changes.push({ name, down: true });
    for (const name of this.pressed) if (!down.has(name)) changes.push({ name, down: false });
    this.pressed = down;

    const [lx, ly] = this.shape(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
    const [rx, ry] = this.shape(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
    this.axes.leftX = lx;
    this.axes.leftY = ly;
    this.axes.rightX = rx;
    this.axes.rightY = ry;
    this.axes.lt = pad.buttons[6]?.value ?? 0;
    this.axes.rt = pad.buttons[7]?.value ?? 0;
    this.active = lx !== 0 || ly !== 0 || rx !== 0 || ry !== 0;
    return changes;
  }
}
