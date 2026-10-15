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
    this.timeScale = 1; // simulated seconds per real second (time compression)
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

    this.accumulator += frame * this.timeScale;
    const started = performance.now();
    while (this.accumulator >= this.step) {
      this.update(this.step);
      this.accumulator -= this.step;
      // A slow machine at high compression would never catch up: shed the backlog and run slower instead.
      if (this.timeScale > 1 && performance.now() - started > 45) { this.accumulator = 0; break; }
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
