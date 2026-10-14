import { h } from './dom.js';

// Phase 1 HUD: FPS counter and a control hint. The full flight HUD is Phase 4.
export function createHud() {
  const fps = h('div.fps', { hidden: true }, '-- fps');
  const hint = h('div.hint', 'Drag to look around · scroll to zoom · Esc to pause');
  const el = h('div.hud', fps, hint);
  el.setFps = (value) => { fps.textContent = `${Math.round(value)} fps`; };
  el.setFpsVisible = (visible) => { fps.hidden = !visible; };
  el.setScale = (scale) => el.style.setProperty('--hud-scale', scale);
  el.setOpacity = (opacity) => el.style.setProperty('--hud-opacity', opacity);
  return el;
}
