// Dynamic resolution: when the frame rate sags the render resolution is lowered a step at a time,
// and raised again when there is headroom. Only active with Graphics quality set to Auto.

const MIN_SCALE = 0.55;
const LOW_FPS = 44;
const HIGH_FPS = 57;

export class AdaptiveQuality {
  constructor(scene) {
    this.scene = scene;
    this.enabled = false;
    this.scale = 1;
    this.ema = 1 / 60;
    this.cooldown = 3;
    this.settle = 0;
  }

  setEnabled(on) {
    this.enabled = on;
    this.scale = 1;
    this.ema = 1 / 60;
    this.cooldown = 3;
    this.scene.setRenderScale(1);
  }

  /** Forget the recent frame times (after loading or resuming, when frames are not representative). */
  reset() {
    this.ema = 1 / 60;
    this.cooldown = 3;
    this.settle = 0;
  }

  /** Call once per rendered frame while flying, with the frame time in seconds. */
  frame(dt) {
    if (!this.enabled || dt <= 0) return;
    this.ema += (Math.min(dt, 0.5) - this.ema) * 0.08;
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    const fps = 1 / this.ema;
    if (fps < LOW_FPS && this.scale > MIN_SCALE) {
      this.scale = Math.max(MIN_SCALE, this.scale - (fps < 25 ? 0.15 : 0.08));
      this.cooldown = 2;
      this.settle = 0;
      this.scene.setRenderScale(this.scale);
    } else if (fps > HIGH_FPS && this.scale < 1) {
      this.settle += 1;
      // Raise slowly and only after a stretch of comfortable frames.
      if (this.settle > 90) {
        this.scale = Math.min(1, this.scale + 0.05);
        this.cooldown = 4;
        this.settle = 0;
        this.scene.setRenderScale(this.scale);
      }
    } else this.settle = 0;
  }
}
