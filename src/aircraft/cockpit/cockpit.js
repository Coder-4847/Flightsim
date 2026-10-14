import * as THREE from 'three';
import {
  COLORS, airspeedDial, altimeterDial, annunciator, attitudeDial, engineDisplay, headingDial, hud as drawHud,
  led, mfdMap, pfd, simpleGauge, turnCoordinator, vsiDial,
} from './instruments.js';

// Cockpit interiors. Built lazily the first time the cockpit camera is used. Every cockpit is a
// group in the aircraft body frame (+X forward, +Y up, +Z right) with live canvas instruments,
// an animated yoke/stick and throttle levers. `update(model, telemetry, dt)` refreshes them.

const REDRAW_INTERVAL = 1 / 20;

const interior = {
  dark: new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.85, metalness: 0.1 }),
  panel: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.8, metalness: 0.15 }),
  liner: new THREE.MeshStandardMaterial({ color: 0xaeb2b8, roughness: 0.9, metalness: 0 }),
  carpet: new THREE.MeshStandardMaterial({ color: 0x33363b, roughness: 1, metalness: 0 }),
  seat: new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.9, metalness: 0 }),
  leather: new THREE.MeshStandardMaterial({ color: 0x3b2f27, roughness: 0.7, metalness: 0 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.85 }),
  red: new THREE.MeshStandardMaterial({ color: 0xc23a30, roughness: 0.6 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x2b5fb8, roughness: 0.6 }),
  black: new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.5, metalness: 0.2 }),
};

// Interior surfaces face away from the sun and sky, so give them a soft self-illumination
// and add a cabin light in each cockpit.
for (const mat of Object.values(interior)) {
  mat.emissive = mat.color.clone();
  mat.emissiveIntensity = mat === interior.black ? 0.05 : 0.32;
}
function cabinLight(x, y, z) {
  const light = new THREE.PointLight(0xfff1dc, 1.4, 5, 1.6);
  light.position.set(x, y, z);
  return light;
}

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}
const bx = (w, h, d, mat, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);

/** A canvas-textured plane facing the pilot (-X), leaning back by `tilt` radians. */
function screen({ w, h, px, py, x, y, z, tilt = 0.25, basic = true, transparent = false, additive = false }, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = py;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const material = basic
    ? new THREE.MeshBasicMaterial({ map: texture, transparent, depthWrite: !transparent, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending })
    : new THREE.MeshStandardMaterial({ map: texture });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  plane.rotation.y = -Math.PI / 2;
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.z = tilt;
  group.add(plane);
  return { group, draw: (t, model) => { draw(ctx, px, py, t, model); texture.needsUpdate = true; } };
}

// ---- hardware: yoke / stick / throttle levers --------------------------------------------------
function makeYoke(x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.5, 10), interior.metal).rotateZ(Math.PI / 2));
  const wheel = new THREE.Group();
  wheel.position.x = -0.26;
  const rim = mesh(new THREE.TorusGeometry(0.13, 0.016, 8, 24, Math.PI * 1.55), interior.black);
  rim.rotation.y = Math.PI / 2;
  rim.rotation.x = -Math.PI * 0.275 - Math.PI / 2 + Math.PI / 2;
  wheel.add(rim);
  wheel.add(bx(0.03, 0.03, 0.26, interior.black, 0, 0.08, 0));
  const hub = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 12), interior.black).rotateZ(Math.PI / 2);
  wheel.add(hub);
  g.add(wheel);
  return { group: g, wheel, baseX: x };
}

function makeStick(x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const stick = new THREE.Group();
  stick.add(mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.26, 10), interior.black, 0, 0.13, 0));
  stick.add(mesh(new THREE.CapsuleGeometry(0.03, 0.08, 4, 10), interior.black, 0, 0.3, 0));
  stick.add(bx(0.03, 0.02, 0.03, interior.red, 0.02, 0.33, 0));
  g.add(stick);
  g.add(bx(0.18, 0.06, 0.14, interior.dark, 0, -0.03, 0));
  return { group: g, stick };
}

function makeLever(color, length = 0.17) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, length, 6), interior.metal, 0, length / 2, 0));
  g.add(mesh(new THREE.SphereGeometry(0.022, 10, 8), color, 0, length, 0));
  return g;
}

function seat(x, y, z, mat = interior.seat) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.add(bx(0.5, 0.1, 0.46, mat, 0, 0, 0));
  g.add(bx(0.1, 0.56, 0.46, mat, -0.25, 0.3, 0).rotateZ(-0.12));
  g.add(bx(0.08, 0.14, 0.26, mat, -0.3, 0.64, 0));
  return g;
}

// ---- piston / turboprop cockpits ------------------------------------------------------------------
function buildPropCockpit(spec, kind) {
  const group = new THREE.Group();
  const eye = spec.cockpit.eye;
  const king = kind === 'steam2';
  const f = eye.x; // body-frame x of the pilot's eye

  // Cabin shell: floor, headliner, side walls with window openings, pillars and glare shield.
  const half = king ? 0.74 : 0.56;
  const roof = king ? eye.y + 0.36 : 0.66;
  const floor = king ? -0.55 : -0.42;
  const sill = king ? eye.y + 0.02 : 0.28;
  const xBack = f - (king ? 3.6 : 2.4);
  const xFront = f + 0.95;
  group.add(bx(xFront - xBack, 0.03, half * 2, interior.carpet, (xFront + xBack) / 2, floor, 0));
  group.add(bx(xFront - xBack, 0.035, half * 2, interior.liner, (xFront + xBack) / 2, roof, 0));
  for (const s of [-1, 1]) {
    group.add(bx(xFront - xBack, sill - floor, 0.03, interior.liner, (xFront + xBack) / 2, (sill + floor) / 2, s * half));
    for (const px of [f + 0.9, f - 0.55, xBack + 0.2]) group.add(bx(0.07, roof - sill, 0.05, interior.liner, px, (roof + sill) / 2, s * half));
    group.add(bx(xFront - xBack, 0.05, 0.05, interior.liner, (xFront + xBack) / 2, roof - 0.02, s * half));
    group.add(bx(0.03, 0.4, 0.35, interior.dark, f + 0.1, sill - 0.2, s * (half - 0.03))); // door pocket
  }
  group.add(bx(0.06, 0.05, half * 2, interior.liner, f + 0.78, roof - 0.01, 0)); // windshield header
  group.add(bx(0.05, roof - sill + 0.15, 0.05, interior.liner, f + 0.82, (roof + sill - 0.15) / 2, 0)); // centre post
  // Glare shield and the panel behind it.
  const panelH = 0.38;
  group.add(bx(0.4, 0.05, half * 1.9, interior.black, f + 0.75, eye.y - 0.16 + panelH + 0.02, 0));
  group.add(bx(0.55, 0.5, half * 1.9, interior.black, f + 1.0, eye.y - 0.5, 0));
  // Cowl hood sloping down ahead of the screen (what you see over the panel).
  group.add(bx(1.4, 0.04, half * 1.7, interior.panel, f + 1.7, eye.y - 0.34, 0).rotateZ(-0.15));

  // Seats.
  group.add(seat(f - 0.25, eye.y - 0.5, eye.z));
  group.add(seat(f - 0.25, eye.y - 0.5, -eye.z));
  if (spec.cockpit.seats > 2) {
    group.add(seat(f - 1.5, eye.y - 0.52, -half * 0.5)); group.add(seat(f - 1.5, eye.y - 0.52, half * 0.5));
    group.add(bx(0.5, 0.1, half * 1.5, interior.seat, f - 2.5, eye.y - 0.52, 0));
  }

  group.add(cabinLight(f - 0.3, roof - 0.15, 0));
  // Instrument panel (canvas).
  const panelW = half * 1.85;
  const panel = screen({
    w: panelW, h: panelH, px: 1024, py: Math.round((1024 * panelH) / panelW), x: f + 0.71, y: eye.y - 0.16 + panelH / 2 - 0.02 - 0.02, z: 0, tilt: 0.28,
  }, (ctx, w, h, t, model) => {
    ctx.fillStyle = '#16191e'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#0d0f12'; ctx.fillRect(0, h - 4, w, 4);
    if (king) drawKingAirPanel(ctx, w, h, t, spec);
    else drawCessnaPanel(ctx, w, h, t, spec);
  });
  group.add(panel.group);

  // Yokes (both seats), animated by pitch and roll.
  const yokes = [makeYoke(f + 0.62, eye.y - 0.3, eye.z), makeYoke(f + 0.62, eye.y - 0.3, -eye.z)];
  yokes.forEach((y) => group.add(y.group));

  // Pedestal with power / prop / mixture levers.
  const levers = [];
  const engines = spec.engines.positions.length;
  const pedestal = new THREE.Group();
  pedestal.position.set(f + 0.52, eye.y - 0.5, 0);
  pedestal.add(bx(0.4, 0.12, 0.22, interior.dark, 0, 0, 0));
  const colors = king ? [interior.black, interior.blue, interior.red] : [interior.black, interior.red];
  colors.forEach((c, row) => {
    for (let e = 0; e < engines; e++) {
      const lever = makeLever(c, 0.16);
      const lx = king ? (e === 0 ? -0.07 : 0.07) + (row - 1) * 0.0 : 0;
      lever.position.set(0.12 - row * 0.1, 0.06, king ? lx * 1.0 : (row - 0.5) * 0.06);
      pedestal.add(lever);
      levers.push({ lever, row, e });
    }
  });
  group.add(pedestal);
  const flapLever = makeLever(interior.black, 0.12);
  flapLever.position.set(f + 0.35, eye.y - 0.52, 0.2);
  group.add(flapLever);

  let timer = 0;
  return {
    group,
    update(model, t, dt) {
      const c = model.controls;
      yokes.forEach((y) => {
        y.group.position.x = y.baseX - c.pitch * 0.07;
        y.wheel.rotation.x = c.roll * 1.0;
      });
      for (const { lever, row, e } of levers) {
        const thr = c.throttle[Math.min(e, c.throttle.length - 1)];
        const amount = row === 0 ? thr : 0.9;
        lever.rotation.z = (amount - 0.5) * -1.0; // leaning forward (-Z rotation) = more power
      }
      const flapMax = model.spec.flaps.stages.length - 1;
      flapLever.rotation.z = -0.4 + (c.flapsStage / Math.max(1, flapMax)) * 0.8;
      timer += dt;
      if (timer >= REDRAW_INTERVAL) { timer = 0; panel.draw(t, model); }
    },
  };
}

function drawCessnaPanel(ctx, w, h, t, spec) {
  const r = 66;
  const cols = [120, 275, 430]; const rows = [h * 0.31, h * 0.74];
  airspeedDial(ctx, cols[0], rows[0], r, t, spec);
  attitudeDial(ctx, cols[1], rows[0], r, t);
  altimeterDial(ctx, cols[2], rows[0], r, t);
  turnCoordinator(ctx, cols[0], rows[1], r, t);
  headingDial(ctx, cols[1], rows[1], r, t);
  vsiDial(ctx, cols[2], rows[1], r, t);
  const e = t.engines[0];
  simpleGauge(ctx, 600, h * 0.31, 66, { label: 'RPM', unit: 'x100', value: e.rpm / 100, min: 0, max: 30, major: 5, bands: [{ from: 0, to: 22, color: COLORS.green }, { from: 22, to: 27, color: COLORS.yellow }, { from: 27, to: 30, color: COLORS.red }] });
  simpleGauge(ctx, 740, h * 0.2, 42, { label: 'FUEL', unit: 'kg', value: t.fuel, min: 0, max: t.fuelCapacity, major: t.fuelCapacity / 4, format: (v) => Math.round(v) });
  simpleGauge(ctx, 740, h * 0.58, 42, { label: 'OIL PSI', unit: '', value: 30 + e.rpm / 40, min: 0, max: 100, major: 25, bands: [{ from: 60, to: 90, color: COLORS.green }] });
  simpleGauge(ctx, 840, h * 0.2, 42, { label: 'FLOW', unit: 'kg/h', value: e.fuelFlow * 3600, min: 0, max: 40, major: 10 });
  simpleGauge(ctx, 840, h * 0.58, 42, { label: 'OIL °C', unit: '', value: 60 + e.n1 * 0.4, min: 0, max: 130, major: 30, bands: [{ from: 70, to: 110, color: COLORS.green }] });
  led(ctx, 910, h * 0.1, 98, 30, `${Math.round(t.ias)} KT`, COLORS.cyan);
  led(ctx, 910, h * 0.3, 98, 30, `FL ${String(Math.round(t.altitudeFt / 100)).padStart(3, '0')}`, COLORS.cyan);
  led(ctx, 910, h * 0.5, 98, 30, `FLAPS ${Math.round(t.flaps)}`, COLORS.amber);
  annunciator(ctx, 910, h * 0.7, 98, 26, 'LOW FUEL', t.fuel < t.fuelCapacity * 0.08, COLORS.amber);
  annunciator(ctx, 910, h * 0.85, 98, 26, t.parkingBrake ? 'PARK BRAKE' : 'STALL', t.parkingBrake || t.stallWarning, COLORS.red);
}

function drawKingAirPanel(ctx, w, h, t, spec) {
  const r = 58;
  const cols = [90, 215, 340]; const rows = [h * 0.3, h * 0.74];
  airspeedDial(ctx, cols[0], rows[0], r, t, spec);
  attitudeDial(ctx, cols[1], rows[0], r, t);
  altimeterDial(ctx, cols[2], rows[0], r, t);
  turnCoordinator(ctx, cols[0], rows[1], r, t);
  headingDial(ctx, cols[1], rows[1], r, t);
  vsiDial(ctx, cols[2], rows[1], r, t);
  // Engine cluster: left engine column, right engine column.
  t.engines.forEach((e, i) => {
    const x0 = 520 + i * 160;
    simpleGauge(ctx, x0, h * 0.2, 36, { label: i ? 'TRQ R' : 'TRQ L', unit: '%', value: e.n1 * 1.05, min: 0, max: 120, major: 40, bands: [{ from: 0, to: 100, color: COLORS.green }, { from: 100, to: 120, color: COLORS.red }] });
    simpleGauge(ctx, x0 + 80, h * 0.2, 36, { label: i ? 'ITT R' : 'ITT L', unit: '°C', value: 350 + e.n1 * 5, min: 300, max: 1000, major: 200, bands: [{ from: 300, to: 800, color: COLORS.green }, { from: 800, to: 1000, color: COLORS.red }] });
    simpleGauge(ctx, x0, h * 0.5, 36, { label: i ? 'NG R' : 'NG L', unit: '%', value: e.n1, min: 0, max: 110, major: 20, bands: [{ from: 60, to: 101, color: COLORS.green }] });
    simpleGauge(ctx, x0 + 80, h * 0.5, 36, { label: i ? 'FF R' : 'FF L', unit: 'kg/h', value: e.fuelFlow * 3600, min: 0, max: 300, major: 100 });
    simpleGauge(ctx, x0, h * 0.8, 36, { label: i ? 'PROP R' : 'PROP L', unit: 'rpm', value: 1000 + e.n1 * 8, min: 0, max: 2000, major: 500, format: (v) => v / 100 });
  });
  simpleGauge(ctx, 860, h * 0.3, 52, { label: 'FUEL', unit: 'kg', value: t.fuel, min: 0, max: t.fuelCapacity, major: t.fuelCapacity / 4, format: (v) => Math.round(v) });
  led(ctx, 790, h * 0.62, 100, 30, `${Math.round(t.ias)} KT`, COLORS.cyan);
  led(ctx, 900, h * 0.62, 100, 30, `FL ${String(Math.round(t.altitudeFt / 100)).padStart(3, '0')}`, COLORS.cyan);
  annunciator(ctx, 830, h * 0.78, 80, 24, 'GEAR', t.gear > 0.02 && t.gear < 0.98, COLORS.red);
  annunciator(ctx, 920, h * 0.78, 80, 24, 'STALL', t.stallWarning, COLORS.red);
  annunciator(ctx, 830, h * 0.9, 80, 22, 'L FUEL', t.fuel < t.fuelCapacity * 0.08, COLORS.amber);
  annunciator(ctx, 920, h * 0.9, 80, 22, 'PARK', t.parkingBrake, COLORS.amber);
}

// ---- Citation (glass cockpit) -----------------------------------------------------------------------
function buildJetCockpit(spec) {
  const group = new THREE.Group();
  const eye = spec.cockpit.eye;
  const f = eye.x;
  const half = 0.74;
  const roof = eye.y + 0.36; const floor = -0.55; const sill = eye.y + 0.04;
  const xBack = f - 3.0; const xFront = f + 1.0;
  group.add(bx(xFront - xBack, 0.03, half * 2, interior.carpet, (xFront + xBack) / 2, floor, 0));
  group.add(bx(xFront - xBack, 0.035, half * 2, interior.liner, (xFront + xBack) / 2, roof, 0));
  for (const s of [-1, 1]) {
    group.add(bx(xFront - xBack, sill - floor, 0.03, interior.liner, (xFront + xBack) / 2, (sill + floor) / 2, s * half));
    for (const px of [f + 0.95, f - 0.4, xBack + 0.2]) group.add(bx(0.07, roof - sill, 0.05, interior.liner, px, (roof + sill) / 2, s * half));
    group.add(bx(xFront - xBack, 0.05, 0.05, interior.liner, (xFront + xBack) / 2, roof - 0.02, s * half));
  }
  group.add(bx(0.07, 0.06, half * 2, interior.liner, f + 0.8, roof - 0.01, 0));
  group.add(bx(0.05, roof - sill + 0.1, 0.05, interior.liner, f + 0.85, (roof + sill - 0.1) / 2, 0));
  group.add(bx(0.4, 0.05, half * 1.9, interior.black, f + 0.68, eye.y - 0.37, 0));
  group.add(bx(0.6, 0.55, half * 1.9, interior.black, f + 1.0, eye.y - 0.55, 0));
  group.add(cabinLight(f - 0.3, roof - 0.15, 0));
  group.add(bx(1.5, 0.04, half * 1.7, interior.panel, f + 1.8, eye.y - 0.3, 0).rotateZ(-0.12));
  group.add(seat(f - 0.3, eye.y - 0.5, eye.z, interior.leather));
  group.add(seat(f - 0.3, eye.y - 0.5, -eye.z, interior.leather));
  for (const z of [-0.5, 0.5]) group.add(seat(f - 1.9, eye.y - 0.5, z, interior.leather));

  const screens = [
    screen({ w: 0.36, h: 0.36, px: 512, py: 512, x: f + 0.68, y: eye.y - 0.17, z: eye.z, tilt: 0.25 }, (ctx, w, h, t) => pfd(ctx, w, h, t, spec)),
    screen({ w: 0.36, h: 0.36, px: 512, py: 512, x: f + 0.68, y: eye.y - 0.17, z: 0.0, tilt: 0.25 }, (ctx, w, h, t, model) => mfdMap(ctx, w, h, t, model)),
    screen({ w: 0.28, h: 0.36, px: 400, py: 512, x: f + 0.68, y: eye.y - 0.17, z: 0.4, tilt: 0.25 }, (ctx, w, h, t) => engineDisplay(ctx, w, h, t, spec)),
  ];
  screens.forEach((s) => group.add(s.group));
  // Standby instrument cluster between screens and glare shield.
  const standby = screen({ w: 0.2, h: 0.1, px: 512, py: 256, x: f + 0.68, y: eye.y + 0.07, z: 0.2, tilt: 0.25 }, (ctx, w, h, t) => {
    ctx.fillStyle = '#0b0d10'; ctx.fillRect(0, 0, w, h);
    led(ctx, 12, 12, 230, 70, `${Math.round(t.ias)} KT`, COLORS.cyan);
    led(ctx, 270, 12, 230, 70, `${Math.round(t.altitudeFt)} FT`, COLORS.cyan);
    annunciator(ctx, 12, 120, 110, 50, 'GEAR', t.gear > 0.02 && t.gear < 0.98, COLORS.red);
    annunciator(ctx, 134, 120, 110, 50, 'FLAPS', t.flaps > 0.5, COLORS.amber);
    annunciator(ctx, 256, 120, 110, 50, 'PARK', t.parkingBrake, COLORS.amber);
    annunciator(ctx, 378, 120, 120, 50, 'STALL', t.stallWarning, COLORS.red);
    ctx.fillStyle = COLORS.dim; ctx.font = '22px Arial'; ctx.textAlign = 'left'; ctx.fillText(`TRIM ${(t.trim * 100).toFixed(0)}   FLAP ${Math.round(t.flaps)}°`, 14, 210);
  });
  group.add(standby.group);

  const yokes = [makeYoke(f + 0.6, eye.y - 0.32, eye.z), makeYoke(f + 0.6, eye.y - 0.32, -eye.z)];
  yokes.forEach((y) => group.add(y.group));
  const pedestal = new THREE.Group();
  pedestal.position.set(f + 0.5, eye.y - 0.5, 0);
  pedestal.add(bx(0.4, 0.12, 0.22, interior.dark, 0, 0, 0));
  const levers = [-0.045, 0.045].map((z) => { const l = makeLever(interior.black, 0.15); l.position.set(0.1, 0.06, z); pedestal.add(l); return l; });
  group.add(pedestal);

  let timer = 0;
  return {
    group,
    update(model, t, dt) {
      const c = model.controls;
      yokes.forEach((y) => { y.group.position.x = y.baseX - c.pitch * 0.07; y.wheel.rotation.x = c.roll * 1.0; });
      levers.forEach((l, i) => { l.rotation.z = (c.throttle[i] - 0.5) * -1.0; });
      timer += dt;
      if (timer >= REDRAW_INTERVAL) { timer = 0; screens.forEach((s) => s.draw(t, model)); standby.draw(t, model); }
    },
  };
}

// ---- fighter cockpit ----------------------------------------------------------------------------------
function buildFighterCockpit(spec) {
  const group = new THREE.Group();
  const eye = spec.cockpit.eye;
  const f = eye.x;
  // Canopy bow and rails, side consoles, seat headrest, glare shield.
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.6, metalness: 0.4 });
  for (const s of [-1, 1]) {
    group.add(bx(2.6, 0.06, 0.06, canopyMat, f + 0.2, eye.y - 0.2, s * 0.5));
    group.add(bx(2.0, 0.05, 0.12, interior.panel, f - 0.2, eye.y - 0.35, s * 0.42)); // side console
    group.add(bx(0.9, 0.3, 0.02, interior.dark, f - 0.3, eye.y - 0.4, s * 0.38));
  }
  const bow = mesh(new THREE.TorusGeometry(0.62, 0.025, 8, 24, Math.PI), canopyMat, f - 0.9, eye.y - 0.2, 0);
  bow.rotation.y = Math.PI / 2;
  group.add(bow);
  const bow2 = mesh(new THREE.TorusGeometry(0.58, 0.025, 8, 24, Math.PI), canopyMat, f + 1.35, eye.y - 0.2, 0);
  bow2.rotation.y = Math.PI / 2;
  group.add(bow2);
  group.add(bx(0.5, 0.7, 0.5, interior.seat, f - 0.55, eye.y - 0.28, 0).rotateZ(-0.15)); // seat back
  group.add(bx(0.2, 0.2, 0.34, interior.seat, f - 0.62, eye.y + 0.12, 0)); // headrest
  group.add(bx(0.7, 0.25, 0.7, interior.panel, f + 0.9, eye.y - 0.5, 0)); // front console
  group.add(bx(0.55, 0.06, 0.82, interior.black, f + 0.95, eye.y - 0.25, 0)); // glare shield
  group.add(cabinLight(f - 0.2, eye.y + 0.35, 0));
  // HUD combiner glass and its projected canvas.
  const combiner = mesh(new THREE.PlaneGeometry(0.3, 0.22), new THREE.MeshBasicMaterial({ color: 0x66ffcc, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false }), f + 0.62, eye.y + 0.03, 0);
  combiner.rotation.y = -Math.PI / 2;
  combiner.rotation.z = 0;
  group.add(combiner);
  const hudScreen = screen({ w: 0.3, h: 0.22, px: 768, py: 560, x: f + 0.621, y: eye.y + 0.03, z: 0, tilt: 0, transparent: true, additive: true }, (ctx, w, h, t) => drawHud(ctx, w, h, t));
  group.add(hudScreen.group);
  group.add(bx(0.1, 0.06, 0.34, interior.black, f + 0.58, eye.y - 0.12, 0)); // HUD projector

  const mfds = [-0.14, 0.14].map((z) => screen({ w: 0.21, h: 0.21, px: 512, py: 512, x: f + 0.74, y: eye.y - 0.34, z, tilt: 0.7 }, (ctx, w, h, t, model) => {
    if (z < 0) { pfd(ctx, w, h, t, spec); } else { mfdMap(ctx, w, h, t, model); }
  }));
  mfds.forEach((m) => group.add(m.group));
  const engine = screen({ w: 0.14, h: 0.18, px: 300, py: 400, x: f + 0.72, y: eye.y - 0.38, z: -0.34, tilt: 0.7 }, (ctx, w, h, t) => engineDisplay(ctx, w, h, t, spec));
  group.add(engine.group);

  const stick = makeStick(f + 0.15, eye.y - 0.5, 0.0);
  group.add(stick.group);
  stick.group.position.set(f + 0.18, eye.y - 0.52, 0.0);
  const throttle = new THREE.Group();
  throttle.position.set(f - 0.1, eye.y - 0.38, -0.42);
  throttle.add(bx(0.5, 0.06, 0.1, interior.dark, 0, -0.03, 0));
  const lever = new THREE.Group();
  lever.add(mesh(new THREE.BoxGeometry(0.18, 0.04, 0.05), interior.black, 0.06, 0.04, 0));
  lever.add(mesh(new THREE.SphereGeometry(0.03, 8, 6), interior.black, 0.16, 0.05, 0));
  throttle.add(lever);
  group.add(throttle);

  let timer = 0;
  return {
    group,
    update(model, t, dt) {
      const c = model.controls;
      stick.stick.rotation.z = c.pitch * 0.18;
      stick.stick.rotation.x = c.roll * 0.25;
      lever.position.x = -0.15 + c.throttle[0] * 0.3;
      timer += dt;
      if (timer >= REDRAW_INTERVAL) { timer = 0; hudScreen.draw(t, model); mfds.forEach((m) => m.draw(t, model)); engine.draw(t, model); }
    },
  };
}

export function createCockpit(spec) {
  switch (spec.cockpit.panel) {
    case 'steam': return buildPropCockpit(spec, 'steam');
    case 'steam2': return buildPropCockpit(spec, 'steam2');
    case 'glass': return buildJetCockpit(spec);
    case 'fighter': return buildFighterCockpit(spec);
    default: return buildPropCockpit(spec, 'steam');
  }
}

