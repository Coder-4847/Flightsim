import { Emitter } from '../core/events.js';
import { ACTIONS } from '../storage/keybinds.js';
import { GamepadSource } from './gamepad.js';

// Keyboard + gamepad -> action layer. Gameplay code asks "is pitch_up held?"
// instead of checking key codes or buttons, so remapping works everywhere.
// Emits 'press'/'release' with the action id. Analog stick/trigger values are
// read from `pad` (see FlightControls).
export class Input extends Emitter {
  #down = new Set(); // action ids currently held
  #codeToActions = new Map();
  #padButtonToActions;

  constructor(bindings, settings) {
    super();
    this.bindings = bindings;
    this.pad = new GamepadSource(settings);
    this.#padButtonToActions = new Map();
    this.enabled = false; // only true while flying/paused
    this.suspended = false; // true while the UI is capturing a key for rebinding
    this.uiCapture = false; // true while a menu screen or the crash card owns the controller (set by the navigator)
    this.menuCapture = false; // true while the controller menu is open: buttons go to the menu, not the aircraft
    this.#rebuild();
    bindings.on('change', () => this.#rebuild());

    window.addEventListener('keydown', (e) => this.#onKey(e, true));
    window.addEventListener('keyup', (e) => this.#onKey(e, false));
    window.addEventListener('blur', () => this.releaseAll());
  }

  isDown(action) {
    return this.#down.has(action);
  }

  /** -1..1 axis from two opposing actions. */
  axis(negative, positive) {
    return (this.isDown(positive) ? 1 : 0) - (this.isDown(negative) ? 1 : 0);
  }

  /** Poll the gamepad (call once per frame while active) and emit button actions. */
  pollGamepad() {
    if (this.suspended) return; // the settings screen reads the pad directly while rebinding
    for (const { name, down } of this.pad.poll()) {
      if (!this.enabled || this.suspended) continue;
      if (this.uiCapture) continue;
      if (this.menuCapture) {
        if (down) this.emit('padbutton', name);
        continue;
      }
      for (const action of this.#padButtonToActions.get(name) ?? []) {
        if (down) {
          this.#down.add(action);
          this.emit('press', action);
        } else if (this.#down.delete(action)) {
          this.emit('release', action);
        }
      }
    }
  }

  releaseAll() {
    for (const action of [...this.#down]) {
      this.#down.delete(action);
      this.emit('release', action);
    }
  }

  #rebuild() {
    this.#codeToActions.clear();
    this.#padButtonToActions.clear();
    for (const { id } of ACTIONS) {
      for (const name of this.bindings.get(id, 'gamepad')) {
        if (!this.#padButtonToActions.has(name)) this.#padButtonToActions.set(name, []);
        this.#padButtonToActions.get(name).push(id);
      }
      for (const code of this.bindings.get(id, 'keyboard')) {
        if (!this.#codeToActions.has(code)) this.#codeToActions.set(code, []);
        this.#codeToActions.get(code).push(id);
      }
    }
  }

  #onKey(e, isDown) {
    if (!this.enabled || this.suspended) return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const actions = this.#codeToActions.get(e.code);
    if (!actions) return;
    e.preventDefault(); // stop Space scrolling, Ctrl shortcuts, etc. while flying
    if (e.repeat) return;
    for (const action of actions) {
      if (isDown) {
        this.#down.add(action);
        this.emit('press', action);
      } else if (this.#down.delete(action)) {
        this.emit('release', action);
      }
    }
  }
}
