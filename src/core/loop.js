// Fixed-timestep simulation with a variable-rate render.
// `update(dt)` always receives the same dt (physics determinism for the flight
// model in Phase 2); `render(alpha, frameDt)` runs once per animation frame.
const STEP = 1 / 120;
const MAX_FRAME = 0.25; // clamp so a background tab doesn't cause a spiral of death

export class GameLoop {
  constructor({ update, render, onFrame }) {
    this.update = update;
    this.render = render;
    this.onFrame = onFrame;
    this.step = STEP;
    this.accumulator = 0;
    this.last = 0;
    this.running = false;
  }

  #tick = (now) => {
    if (!this.running) return;
    requestAnimationFrame(this.#tick);
    const frame = Math.min((now - this.last) / 1000, MAX_FRAME);
    this.last = now;
    this.onFrame?.(frame);

    this.accumulator += frame;
    while (this.accumulator >= this.step) {
      this.update(this.step);
      this.accumulator -= this.step;
    }
    this.render(this.accumulator / this.step, frame);
  };

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.#tick);
  }

  stop() {
    this.running = false;
  }

  // Drop accumulated time (e.g. after resuming from pause).
  resetClock() {
    this.accumulator = 0;
    this.last = performance.now();
  }
}
