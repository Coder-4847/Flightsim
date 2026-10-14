import { Emitter } from '../core/events.js';
import { ACTIONS } from '../storage/keybinds.js';

// Keyboard -> action layer. Gameplay code asks "is pitch_up held?" instead of
// checking key codes, so remapping works everywhere. Emits 'press'/'release'
// with the action id. Mouse and gamepad sources are added in Phase 2 and feed
// the same action layer.
export class Input extends Emitter {
  #down = new Set(); // action ids currently held
  #codeToActions = new Map();

  constructor(bindings) {
    super();
    this.bindings = bindings;
    this.enabled = false; // only true while flying/paused
    this.suspended = false; // true while the UI is capturing a key for rebinding
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

  releaseAll() {
    for (const action of [...this.#down]) {
      this.#down.delete(action);
      this.emit('release', action);
    }
  }

  #rebuild() {
    this.#codeToActions.clear();
    for (const { id } of ACTIONS) {
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
