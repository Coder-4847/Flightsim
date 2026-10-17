import * as THREE from 'three';
import { createHangarScene } from './hangarScene.js';
import { createMenuScene } from './menuScene.js';

// One WebGL canvas behind every menu. It draws either the cinematic main-menu scene or the hangar
// showroom, only while a menu is visible, at a capped frame rate with an adaptive resolution.

export function createStage({ settings, liveryFor }) {
  const canvas = document.createElement('canvas');
  canvas.id = 'stage';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.hidden = true;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const reduce = () => !!settings.get('reduceMotion');
  const quality = () => settings.get('quality');

  const menu = createMenuScene({ renderer, reduceMotion: reduce });
  const hangar = createHangarScene({ renderer, reduceMotion: reduce, liveryFor, quality });

  let mode = null; // 'menu' | 'hangar' | null
  let shift = 0; // fraction of the width the menu scene moves right (room for the menu)
  let fpsCap = 60;
  let ratio = 1;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let ema = 1 / 60;
  let cooldown = 2;
  let w = 0; let h = 0;

  function maxRatio() { return { low: 1, medium: 1.25, high: 1.75, auto: 1.5 }[quality()] ?? 1.5; }
  function applySize(force = false) {
    const cw = canvas.clientWidth || window.innerWidth;
    const ch = canvas.clientHeight || window.innerHeight;
    const r = Math.max(0.6, Math.min(window.devicePixelRatio || 1, maxRatio()) * ratio);
    if (!force && cw === w && ch === h && Math.abs(renderer.getPixelRatio() - r) < 0.01) return;
    w = cw; h = ch;
    renderer.setPixelRatio(r);
    renderer.setSize(cw, ch, false);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    if (acc < 1 / fpsCap - 0.002) return;
    const step = acc;
    acc = 0;
    // Adaptive resolution: back off when the frame time sags, creep back when there is headroom.
    ema += (Math.min(step, 0.2) - ema) * 0.06;
    cooldown -= step;
    if (cooldown <= 0) {
      if (ema > 1 / 26 && ratio > 0.6) { ratio = Math.max(0.6, ratio - 0.12); cooldown = 1.5; }
      else if (ema < 1 / 52 && ratio < 1) { ratio = Math.min(1, ratio + 0.05); cooldown = 3; }
    }
    applySize();
    const live = mode === 'hangar' ? hangar : menu;
    live.update(reduce() && mode === 'menu' ? 0 : step, w, h, shift);
    renderer.render(live.scene, live.camera);
  }

  function start() { if (!raf) { last = performance.now(); acc = 0; raf = requestAnimationFrame(frame); } }
  function stop() { cancelAnimationFrame(raf); raf = 0; }

  // Pointer: drag to orbit, wheel to zoom (hangar only; the canvas sits under the menu, so the events come from the screen).
  const api = {
    canvas, menu, hangar,
    /** 'menu', 'hangar' or null (hidden). `opts.shift` moves the menu scene right by that fraction of the width. */
    show(next, opts = {}) {
      mode = next;
      shift = opts.shift ?? 0;
      fpsCap = opts.fps ?? 60;
      canvas.hidden = !next;
      if (!next) { stop(); return; }
      applySize(true);
      // A still frame right away so the screen never shows an empty canvas while the first animation frame is pending.
      const live = next === 'hangar' ? hangar : menu;
      live.update(0.016, w, h, shift);
      renderer.render(live.scene, live.camera);
      if (reduce()) { stop(); return; }
      start();
    },
    get mode() { return mode; },
    render() { // one frame on demand (reduced motion, screenshots)
      if (!mode) return;
      applySize();
      const live = mode === 'hangar' ? hangar : menu;
      live.update(0.016, w, h, shift);
      renderer.render(live.scene, live.camera);
    },
    resize() { applySize(true); },
  };
  window.addEventListener('resize', () => { if (mode) api.resize(); });
  settings.on('change', ({ key }) => { if (key === 'reduceMotion' && mode) api.show(mode, { shift, fps: fpsCap }); });
  return api;
}
