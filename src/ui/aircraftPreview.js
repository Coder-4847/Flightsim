import * as THREE from 'three';
import { AircraftView } from '../aircraft/aircraftView.js';
import { createCockpit } from '../aircraft/cockpit/index.js';
import { h } from './dom.js';

// A small turntable of the selected aircraft for the hangar screen. It has its own WebGL context
// and only renders while its screen is visible.

export function createAircraftPreview() {
  const canvas = h('canvas.ac-preview');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, logarithmicDepthBuffer: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xfff1d8, 2.6);
  sun.position.set(-30, 50, 40);
  scene.add(sun, new THREE.HemisphereLight(0xcfe3ff, 0x39404a, 1.2));
  const pad = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0x0c121a, transparent: true, opacity: 0.55 }));
  pad.rotation.x = -Math.PI / 2;
  scene.add(pad);
  const camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.5, 4000);

  let view = null;
  let spec = null;
  let angle = 0.6;
  let last = 0;
  let running = false;

  function dispose() {
    if (!view) return;
    scene.remove(view.root);
    view.root.traverse((o) => { o.geometry?.dispose?.(); });
    view = null;
  }

  function set(next) {
    if (spec === next) return;
    spec = next;
    dispose();
    view = new AircraftView(spec, createCockpit);
    // Park it: gear down at the contact height, flat.
    view.root.position.set(0, -spec.gear.mainLeft.y, 0);
    scene.add(view.root);
    const radius = spec.geometry.length * 0.62 + spec.wing.span * 0.15;
    pad.scale.setScalar(Math.max(spec.wing.span, spec.geometry.length) * 0.62);
    pad.position.y = 0.02;
    camera.userData.distance = spec.geometry.length * 0.95 + spec.wing.span * 0.45;
    camera.userData.target = new THREE.Vector3(0, radius * 0.1, 0);
  }

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const visible = canvas.isConnected && canvas.closest('.screen.active') && canvas.clientWidth > 0;
    if (!visible || !view) { last = now; return; }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    angle += dt * 0.35;
    const w = canvas.clientWidth; const hh = canvas.clientHeight;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio())) renderer.setSize(w, hh, false);
    camera.aspect = w / hh;
    camera.updateProjectionMatrix();
    const d = camera.userData.distance;
    const t = camera.userData.target;
    camera.position.set(t.x + Math.cos(angle) * d, t.y + d * 0.28, t.z + Math.sin(angle) * d);
    camera.lookAt(t);
    renderer.render(scene, camera);
  }

  return {
    canvas,
    set,
    start() { if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); } },
    stop() { running = false; },
  };
}
