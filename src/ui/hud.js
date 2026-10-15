import { h } from './dom.js';

// Always-available overlay: the FPS counter (toggle in settings). Scale and opacity apply to
// the whole HUD layer via CSS variables.
export function createHud() {
  const fps = h('div.fps', { hidden: true }, '-- fps');
  const el = h('div.hud', fps);
  el.setFps = (value, scale = null) => { fps.textContent = `${Math.round(value)} fps${scale != null && scale < 0.995 ? ` · ${Math.round(scale * 100)}% res` : ''}`; };
  el.setFpsVisible = (visible) => { fps.hidden = !visible; };
  el.setScale = (scale) => el.style.setProperty('--hud-scale', scale);
  el.setOpacity = (opacity) => el.style.setProperty('--hud-opacity', opacity);
  return el;
}
