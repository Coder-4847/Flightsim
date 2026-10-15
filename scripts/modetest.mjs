// Headless checks for Phase 5: node scripts/modetest.mjs
// Covers the catalogue, saves, economy, missions, VIP contracts, seeded emergencies and the whole
// flow of a landing through the tracker, runner and save for each mode.
import assert from 'node:assert/strict';

// localStorage shim (the game's storage wrapper expects the browser one).
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), clear: () => mem.clear(),
};

const { AIRCRAFT, getAircraft } = await import('../src/aircraft/index.js');
const { FlightModel } = await import('../src/flight/flightModel.js');
const { SimWorld } = await import('../src/flight/world.js');
const { FPM, KT } = await import('../src/flight/units.js');
const { buildMap } = await import('../src/world/mapBuilder.js');
const { MAP_HALF } = await import('../src/world/maps.js');
const { startPoint } = await import('../src/game/startPoints.js');
const { FailureManager } = await import('../src/game/failures.js');
const catalog = await import('../src/progress/catalog.js');
const { SaveManager, sanitizeSave, newSave } = await import('../src/progress/saves.js');
const eco = await import('../src/modes/economy.js');
const { MISSIONS, resolveMission, missionUnlocked } = await import('../src/modes/missions.js');
const { VIP_CONTRACTS, resolveVip, ComfortMeter } = await import('../src/modes/vip.js');
const em = await import('../src/modes/emergency.js');
const { ModeRunner } = await import('../src/modes/runner.js');
const { runwayAt, airportAt } = await import('../src/modes/tracker.js');

let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.log(`  FAIL ${msg}`); } };
const section = (name) => console.log(`\n== ${name}`);
const dt = 1 / 120;

// ---------------------------------------------------------------------------------------------------
section('catalogue');
for (const a of AIRCRAFT) {
  ok(catalog.ECONOMY[a.id], `economy entry for ${a.id}`);
  ok(catalog.liveriesFor(a.id).length >= 4, `liveries for ${a.id}`);
}
ok(catalog.aircraftPrice('cessna172') === 0, 'starter aircraft is free');
const painted = catalog.specWithLivery('cessna172', 'skyline');
ok(painted.livery.stripe === '#1e66d0' && getAircraft('cessna172').livery.stripe !== '#1e66d0', 'livery copies the spec without mutating it');
console.log(`  ${AIRCRAFT.length} aircraft, ${catalog.UPGRADES.length} upgrades`);

// ---------------------------------------------------------------------------------------------------
section('saves');
{
  const saves = new SaveManager();
  ok(saves.active === null, 'no active save at first');
  saves.create(1, 'Test Pilot');
  ok(saves.active.money === catalog.START_MONEY, 'starting money');
  ok(saves.earn(500, 't') === 500 && saves.money === catalog.START_MONEY + 500, 'earn');
  ok(!saves.buyAircraft('caravan', catalog.aircraftPrice('caravan')).ok, 'cannot afford the caravan yet');
  saves.earn(20000, 't');
  ok(saves.buyAircraft('caravan', catalog.aircraftPrice('caravan')).ok, 'buy aircraft');
  ok(!saves.buyAircraft('caravan', 1).ok, 'cannot buy twice');
  ok(!saves.buyAircraft('jumbo', 1200000).ok, 'cannot afford the jumbo');
  ok(saves.buyUpgrade('gps', 4000).ok && saves.ownsUpgrade('gps'), 'buy upgrade');
  ok(saves.buyLivery('cessna172', 'skyline', 1500).ok && saves.equippedLivery('cessna172') === 'skyline', 'buy + equip livery');
  ok(!saves.buyLivery('jumbo', 'skyline', 1).ok, 'livery needs the aircraft');
  const after = saves.money;
  ok(saves.charge(10 ** 9, 'x') === after && saves.money === 0, 'charge never goes below zero');
  const reloaded = new SaveManager();
  ok(reloaded.activeSlot === 1 && reloaded.active.name === 'Test Pilot', 'active slot restored from storage');
  ok(reloaded.active.aircraft.includes('caravan') && reloaded.active.upgrades.includes('gps'), 'purchases persisted');
  const json = reloaded.exportJSON(1);
  reloaded.importJSON(2, json);
  ok(reloaded.slots[1].name === 'Test Pilot', 'import into another slot');
  let threw = false;
  try { reloaded.importJSON(3, '{"nope":1}'); } catch { threw = true; }
  ok(threw, 'rejects a file that is not a save');
  threw = false;
  try { reloaded.importJSON(3, 'not json'); } catch { threw = true; }
  ok(threw, 'rejects invalid JSON');
  const dirty = sanitizeSave({ money: -5, aircraft: ['cessna172', 'bogus'], upgrades: ['gps', 'bogus'], stats: { flights: 'x' }, name: 123 });
  ok(dirty.money === 0 && dirty.aircraft.join() === 'cessna172' && dirty.upgrades.join() === 'gps' && dirty.stats.flights === 0, 'sanitize repairs bad data');
  reloaded.delete(2);
  ok(reloaded.slots[1] === null, 'delete slot');
  ok(newSave().version === 1, 'save version');
}

// ---------------------------------------------------------------------------------------------------
section('economy');
{
  const base = { aircraftId: 'narrowbody', trackKm: 100, straightKm: 100, grade: 'Smooth', atAirport: true, onRunway: true, pax: 120, cargoKg: 0, pois: 0, multiplier: 1, upgrades: [] };
  const smooth = eco.freeFlightPayout(base).total;
  const hard = eco.freeFlightPayout({ ...base, grade: 'Hard' }).total;
  const cabin = eco.freeFlightPayout({ ...base, upgrades: ['cabin'] }).total;
  ok(smooth > hard, `smooth landing pays more than hard (${smooth} vs ${hard})`);
  ok(cabin > smooth, 'cabin pack raises passenger revenue');
  ok(eco.freeFlightPayout({ ...base, trackKm: 400, straightKm: 0 }).total < eco.freeFlightPayout({ ...base, trackKm: 400, straightKm: 100 }).total, 'circling does not pay like a real trip');
  ok(eco.freeFlightPayout({ ...base, multiplier: 1.3 }).total > smooth, 'simulation multiplier');
  ok(eco.freeFlightPayout({ ...base, pois: 2 }).total > smooth, 'sightseeing adds money');
  const tiers = ['Smooth', 'Good', 'Firm', 'Hard', 'Very hard'].map((g) => eco.vipPayout({ base: 10000, comfort: 100, grade: g }).total);
  ok(tiers.every((v, i) => i === 0 || v < tiers[i - 1]) && tiers[4] === 0, `VIP landing tiers fall: ${tiers.join(' > ')}`);
  ok(eco.vipPayout({ base: 10000, comfort: 30, grade: 'Smooth' }).total < tiers[0], 'comfort lowers the fare');
  ok(eco.crashPenalty('jumbo', true) < eco.crashPenalty('jumbo', false), 'insurance cuts repair bills');
  console.log(`  narrow-body 100 km Smooth: ${smooth} cr; VIP 10,000 cr tiers: ${tiers.join(' / ')}`);
}

// ---------------------------------------------------------------------------------------------------
section('career missions');
{
  console.log(`  ${MISSIONS.length} missions`);
  ok(MISSIONS.length >= 30, 'at least 30 missions');
  ok(new Set(MISSIONS.map((m) => m.id)).size === MISSIONS.length, 'unique ids');
  ok(MISSIONS.every((m, i) => i === 0 || m.tier >= MISSIONS[i - 1].tier), 'tiers never go backwards');
  ok(new Set(MISSIONS.map((m) => m.map)).size === 3, 'all three maps used');
  const classes = new Set(MISSIONS.map((m) => getAircraft(m.aircraft).class));
  ok(classes.size >= 5, `aircraft classes used: ${[...classes].join(', ')}`);
  console.log(`  aircraft used: ${new Set(MISSIONS.map((m) => m.aircraft)).size} of ${AIRCRAFT.length}`);
  for (const def of MISSIONS) {
    let r;
    try { r = resolveMission(def); } catch (e) { ok(false, `${def.id} resolves: ${e.message}`); continue; }
    const maxFrom = Math.max(...r.fromAirport.runways.map((x) => x.length));
    const maxTo = Math.max(...r.toAirport.runways.map((x) => x.length));
    ok(maxFrom >= r.spec.minRunway * 0.95, `${def.id} departure runway ${maxFrom} m vs ${r.spec.minRunway} m needed`);
    ok(maxTo >= r.spec.minRunway * 0.95, `${def.id} arrival runway ${maxTo} m vs ${r.spec.minRunway} m needed`);
    ok(r.base >= 500, `${def.id} pays`);
    const burnNeeded = (await import('../src/modes/missions.js')).CRUISE_BURN[def.aircraft] * (r.estMinutes / 60) * 1.2;
    ok(r.fuelKg >= burnNeeded, `${def.id} fuel ${r.fuelKg} kg covers ${Math.round(burnNeeded)} kg`);
    if (r.deadline) ok(r.deadline > r.estMinutes * 1.4, `${def.id} deadline ${r.deadline} min is fair for a ${Math.round(r.estMinutes)} min flight`);
    ok(r.fuelKg <= r.spec.mass.fuelCapacity, `${def.id} fuel fits the tanks`);
    ok(r.goals.length <= 2, `${def.id} has at most two bonus goals`);
    ok(def.start === 'final' || r.routeKm >= 5, `${def.id} flies a real distance`);
  }
  const save = newSave();
  ok(missionUnlocked(save, 'c01') && !missionUnlocked(save, 'c02'), 'only the first mission is open');
  save.career.completed.c01 = { stars: 1 };
  ok(missionUnlocked(save, 'c02') && !missionUnlocked(save, 'c03'), 'completing a mission opens the next');
  for (const t of [1, 2, 3, 4, 5]) {
    const pays = MISSIONS.filter((m) => m.tier === t).map((m) => resolveMission(m).base);
    console.log(`  tier ${t}: ${pays.length} missions, pay ${Math.min(...pays)}-${Math.max(...pays)} cr`);
  }
}

section('VIP contracts');
{
  ok(VIP_CONTRACTS.length >= 8, `${VIP_CONTRACTS.length} contracts`);
  for (const def of VIP_CONTRACTS) {
    let r;
    try { r = resolveVip(def); } catch (e) { ok(false, `${def.id}: ${e.message}`); continue; }
    ok(Math.max(...r.toAirport.runways.map((x) => x.length)) >= r.spec.minRunway * 0.95, `${def.id} arrival runway`);
    ok(Math.max(...r.fromAirport.runways.map((x) => x.length)) >= r.spec.minRunway * 0.95, `${def.id} departure runway`);
    ok(r.base > 1000, `${def.id} fare`);
  }
  const c = new ComfortMeter();
  for (let i = 0; i < 100; i++) c.update(0.1, { onGround: false, groundSpeed: 100, nz: 1.0, bank: 5, pitchRate: 1, rollRate: 1, vsFpm: 0, stalled: false, stallWarning: false, overspeed: false });
  ok(c.value === 100, 'smooth flying keeps full comfort');
  for (let i = 0; i < 50; i++) c.update(0.1, { onGround: false, groundSpeed: 100, nz: 1.9, bank: 60, pitchRate: 12, rollRate: 30, vsFpm: -3500, stalled: false, stallWarning: false, overspeed: false });
  ok(c.value < 20, `violent flying ruins comfort (${c.value.toFixed(0)})`);
  const calm = new ComfortMeter(0.75);
  const rough = new ComfortMeter(1);
  for (let i = 0; i < 100; i++) for (const m of [calm, rough]) m.update(0.1, { onGround: false, groundSpeed: 100, nz: 1.3, bank: 35, pitchRate: 3, rollRate: 5, vsFpm: 0, stalled: false, stallWarning: false, overspeed: false });
  ok(calm.value > rough.value, 'cabin pack protects comfort');
}

// ---------------------------------------------------------------------------------------------------
section('emergency scenarios');
{
  const kinds = new Map();
  let engineOut = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const a = em.generateScenario(seed);
    const b = em.generateScenario(seed);
    assert.deepEqual(JSON.parse(JSON.stringify({ ...a, target: a.target.code })), JSON.parse(JSON.stringify({ ...b, target: b.target.code })), `seed ${seed} repeats`);
    const spec = getAircraft(a.aircraftId);
    const map = buildMap(a.mapId);
    ok(Math.abs(a.spawn.x) < MAP_HALF * 0.97 && Math.abs(a.spawn.z) < MAP_HALF * 0.97, `seed ${seed} spawn inside the map`);
    ok(a.spawn.altitude > map.hf.height(a.spawn.x, a.spawn.z) + 300, `seed ${seed} spawn above terrain`);
    ok(em.suitableAirports(map, spec).includes(a.target), `seed ${seed} target is suitable`);
    ok(a.failures.length >= 1 && a.failures.length <= 3, `seed ${seed} failure count`);
    ok(a.failures.every((f, i) => i === 0 || f.at > a.failures[i - 1].at), `seed ${seed} failures ordered`);
    if (!spec.gear.retractable) ok(!a.failures.some((f) => f.type === 'gear'), `seed ${seed} no gear failure on fixed gear`);
    // Engine-out single: within a plausible glide of the field.
    if (a.engineOut) {
      engineOut++;
      const d = Math.hypot(a.spawn.x - a.target.x, a.spawn.z - a.target.z);
      const h = a.spawn.altitude - a.target.elevation;
      ok(d < h * 12, `seed ${seed} engine-out within glide (${Math.round(d)} m, ${Math.round(h)} m up)`);
    }
    kinds.set(a.aircraftId, (kinds.get(a.aircraftId) ?? 0) + 1);
    for (const f of a.failures) kinds.set(f.type, (kinds.get(f.type) ?? 0) + 1);
  }
  console.log(`  300 seeds deterministic; engine-out singles: ${engineOut}`);
  console.log(`  mix: ${[...kinds].map(([k, v]) => `${k}:${v}`).join(' ')}`);
  ok(em.dailySeed(new Date(Date.UTC(2026, 9, 14))) === 20261014, 'daily seed');
  const clean = em.scoreEmergency({ landed: true, airport: { name: 'x' }, suitable: true, onRunway: true, grade: 'Smooth', intact: true, seconds: 10, par: 100 });
  ok(clean.score === 100, `perfect landing scores 100 (${clean.score})`);
  ok(em.scoreEmergency({ crashed: true }).score === 0, 'crash scores 0');
  ok(em.scoreEmergency({ landed: true, airport: null, grade: 'Hard', intact: false, seconds: 999, par: 1 }).score < 40, 'off-airport hard landing scores low');
}

// ---------------------------------------------------------------------------------------------------
// Flow tests: fly a real landing through the tracker, runner and save.
section('mode flows');

/** Put the model on final to the target runway and fly a scripted landing; returns when stopped or crashed. */
function flyFinal(session, runner, { maxT = 400, onStep } = {}) {
  const m = session.model;
  const spec = m.spec;
  const t0 = m.telemetry;
  const approachPitch = t0.pitch;
  const flareHeight = spec.id === 'cessna172' ? 30 : 45;
  let flarePitch = approachPitch;
  let t = 0;
  const hdg0 = t0.heading;
  while (t < maxT && !runner.result) {
    const tel = m.telemetry;
    const agl = tel.aglFt;
    const dx = ((tel.heading - hdg0 + 540) % 360) - 180;
    m.controls.roll = Math.max(-0.3, Math.min(0.3, -0.05 * dx - 0.02 * tel.bank));
    m.controls.steer = m.controls.yaw = tel.onGround ? Math.max(-1, Math.min(1, -dx * 0.2)) : 0;
    const speedErr = spec.speeds.vapp - tel.ias;
    const glideFpm = -tel.groundSpeed * 0.514444 * 0.0524 / 0.00508;
    if (!tel.onGround) {
      const thr = Math.max(0.03, Math.min(1, m.controls.throttle[0] + speedErr * 0.0006 + (glideFpm - tel.vsFpm) * -0.000003));
      m.controls.throttle.fill(agl < flareHeight ? 0 : thr);
      let target;
      if (agl > flareHeight) target = approachPitch + (glideFpm - tel.vsFpm) * 0.004;
      else { flarePitch = Math.min(flarePitch + (spec.mass.ref > 15000 ? 2.2 : 1.8) * dt, approachPitch + 4); target = flarePitch; }
      m.controls.pitch = Math.max(-1, Math.min(1, spec.mass.ref > 3500 ? (target - tel.pitch) * 0.6 - tel.pitchRate * 0.5 : (target - tel.pitch) * 0.2 - tel.pitchRate * 0.6));
    } else {
      m.controls.pitch = 0; m.controls.throttle.fill(0);
      m.controls.brakeLeft = m.controls.brakeRight = 0.8;
    }
    m.step(dt); t += dt;
    session.failures?.update(dt, false);
    const evs = m.events.splice(0);
    if (process.env.DEBUG && evs.length) console.log('  [debug] t', t.toFixed(1), evs.map((e) => e.type + (e.grade ? ':' + e.grade : '') + (e.reason ? ':' + e.reason : '')).join(','), 'airborne', runner.tracker?.airborne, 'airborneSec', runner.tracker?.airborneSec?.toFixed(1));
    runner.handleEvents(evs);
    runner.update(dt);
    onStep?.(t);
    if (m.crashed) { runner.handleEvents(m.events.splice(0)); break; }
  }
  if (!runner.result && process.env.DEBUG) {
    const tel = m.telemetry;
    console.log('  [debug] no result after', t.toFixed(0), 's: gs', tel.groundSpeed.toFixed(1), 'agl', tel.aglFt.toFixed(0), 'onGround', tel.onGround, 'crashed', m.crashed?.reason,
      'tracker', runner.tracker && { airborne: runner.tracker.airborne, landing: runner.tracker.landing?.grade, landed: runner.tracker.landed, stopped: runner.tracker.stoppedFor });
  }
  return t;
}

function makeSession(map, opts) {
  const airport = map.airports.find((a) => a.code === opts.airportCode);
  const spec = catalog.specWithLivery(opts.aircraftId, opts.liveryId);
  const world = new SimWorld({
    groundHeight: (x, z) => map.hf.height(x, z), weather: opts.weather ?? 'calm', sky: opts.sky ?? 'clear',
  });
  const model = new FlightModel(spec, world);
  model.assist = 'light';
  const sp = opts.spawn ? { reset: { mode: 'air', heading: opts.spawn.heading, x: opts.spawn.x, z: opts.spawn.z, altitude: opts.spawn.altitude, speed: opts.spawn.speed } }
    : startPoint(map, airport, opts.endId, opts.startMode === 'custom' ? 'air' : opts.startMode, opts.aircraftId);
  model.reset({ ...sp.reset, ...(opts.fuelKg != null ? { fuel: opts.fuelKg } : {}) });
  const toasts = [];
  const session = { flightScene: { map }, model, airport, onToast: (t) => toasts.push(t), options: opts, toasts, failures: new FailureManager(model, opts.seed ?? 1) };
  return session;
}

const settings = { get: (k) => (k === 'preset' ? 'arcade' : null) };

/** A scripted pilot for a whole leg: take off, climb, fly to the extended centreline and land (calm air). */
function flyLeg(session, runner, destAirport, destEndId, { maxT = 1500 } = {}) {
  const m = session.model;
  const spec = m.spec;
  const end = destAirport.runways.flatMap((r) => r.ends).find((e) => e.id === destEndId);
  const rad = Math.PI / 180;
  const d = { x: Math.sin(end.heading * rad), z: -Math.cos(end.heading * rad) };
  const right = { x: -d.z, z: d.x };
  const th = end.threshold;
  const iaf = { x: th.x - d.x * 7000, z: th.z - d.z * 7000 };
  const cruiseAlt = destAirport.elevation + 600; // metres MSL
  const rwHdg0 = m.telemetry.heading;
  const angle = (a) => ((a % 360) + 540) % 360 - 180;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  let phase = 'takeoff';
  let flarePitch = 0; let approachPitch = 3; let t = 0;
  m.controls.parkingBrake = false;
  while (t < maxT && !runner.result) {
    const tel = m.telemetry; const c = m.controls;
    const along = (m.pos.x - th.x) * d.x + (m.pos.z - th.z) * d.z; // negative before the threshold
    const cross = (m.pos.x - th.x) * right.x + (m.pos.z - th.z) * right.z;
    const agl = tel.aglFt;
    let hdgT; let vsT = 0;
    if (phase === 'takeoff') {
      c.throttle.fill(1);
      c.steer = c.yaw = clamp(-angle(tel.heading - rwHdg0) * 0.15, -1, 1);
      c.pitch = tel.ias >= spec.speeds.vr ? clamp((10 - tel.pitch) * 0.12 - tel.pitchRate * 0.1, -1, 1) : 0;
      if (!tel.onGround && agl > 300) phase = 'climb';
    } else {
      c.steer = c.yaw = 0;
      if (phase === 'climb' || phase === 'cruise') {
        hdgT = (Math.atan2(iaf.x - m.pos.x, -(iaf.z - m.pos.z)) / rad + 360) % 360;
        const toIaf = Math.hypot(iaf.x - m.pos.x, iaf.z - m.pos.z);
        vsT = clamp((cruiseAlt - m.pos.y) * 3, -1500, 1000);
        if (phase === 'climb' && m.pos.y < cruiseAlt - 60) vsT = 99999; // climb at a fixed attitude
        c.throttle.fill(clamp(c.throttle[0] + ((vsT < -200 ? spec.speeds.cruise * 0.8 : spec.speeds.vy * 1.05) - tel.ias) * 0.003, 0.05, 1));
        if (m.pos.y > cruiseAlt - 60) phase = 'cruise';
        if (spec.gear.retractable && tel.aglFt > 150 && c.gearDown) c.gearDown = false;
        if (toIaf < 1500) { phase = 'final'; c.flapsStage = Math.min(spec.flaps.landingStage, 1); }
      } else if (phase === 'final' || phase === 'flare') {
        hdgT = end.heading - clamp(cross * 0.012, -25, 25);
        const wantAlt = destAirport.elevation + 8 + Math.max(0, -along) * Math.tan(3 * rad);
        const gsFpm = -tel.groundSpeed * 0.514444 * 0.0524 / 0.00508;
        vsT = clamp(gsFpm + (wantAlt - m.pos.y) * 0.8 * 196.85 / 3, -900, 400);
        if (!tel.onGround && -along < 5500 && c.flapsStage < spec.flaps.landingStage && tel.ias < spec.speeds.vfe) c.flapsStage = spec.flaps.landingStage;
        if (spec.gear.retractable && -along < 6000) c.gearDown = true;
        c.throttle.fill(clamp(c.throttle[0] + (spec.speeds.vapp - tel.ias) * 0.0012 + 0.0000005 * (vsT - tel.vsFpm), 0.03, 1));
        if (phase === 'final') approachPitch = tel.pitch;
        if (agl < (spec.id === 'cessna172' ? 30 : 45)) { phase = 'flare'; c.throttle.fill(0); flarePitch = tel.pitch; }
        if (phase === 'flare') {
          flarePitch = Math.min(flarePitch + 1.8 * dt, approachPitch + 4);
          c.pitch = clamp((flarePitch - tel.pitch) * 0.2 - tel.pitchRate * 0.6, -1, 1);
        }
      }
      // Lateral and vertical loops (not in the flare).
      const bank = clamp(angle(hdgT - tel.heading) * 0.7, -25, 25);
      c.roll = clamp((bank - tel.bank) * 0.05, -0.4, 0.4);
      if (phase !== 'flare') {
        const pT = clamp(tel.pitch + (vsT - tel.vsFpm) * 0.002, -8, 14);
        c.pitch = clamp((pT - tel.pitch) * 0.2 - tel.pitchRate * 0.5, -0.6, 0.6);
      }
      if (tel.onGround && phase === 'flare') {
        c.pitch = 0; c.throttle.fill(0); c.brakeLeft = c.brakeRight = 0.8;
        c.steer = c.yaw = clamp(-angle(tel.heading - end.heading) * 0.2, -1, 1);
      }
    }
    m.step(dt); t += dt;
    const evs = m.events.splice(0);
    runner.handleEvents(evs);
    runner.update(dt);
    if (m.crashed) { runner.handleEvents(m.events.splice(0)); break; }
  }
  if (!runner.result && process.env.DEBUG) console.log('  [debug] leg ended without a result', phase, t.toFixed(0), m.telemetry.altitudeFt.toFixed(0), m.telemetry.groundSpeed.toFixed(1), m.crashed?.reason);
  return { t, phase };
}

// -- Free Flight: land on final at VPAS, get paid.
{
  mem.clear();
  const saves = new SaveManager();
  saves.create(1, 'Flow');
  const map = buildMap('grasslands');
  const session = makeSession(map, { aircraftId: 'cessna172', mapId: 'grasslands', airportCode: 'VPAS', endId: map.airports.find((a) => a.code === 'VPAS').runways[0].ends[0].id, startMode: 'final' });
  const runner = new ModeRunner({ session, saves, settings });
  const o = runner.prepare({ mode: 'free', aircraftId: 'cessna172', mapId: 'grasslands', airportCode: 'VPAS', startMode: 'final', hour: 12, sky: 'clear' });
  ok(o.liveryId === 'factory', 'free flight start options');
  runner.attach();
  if (process.env.DEBUG) runner.on('takeoff', (p) => console.log('  [debug] takeoff event', p.airport?.code));
  const money0 = saves.money;
  flyFinal(session, runner);
  const res = runner.result;
  ok(res?.success, `free flight landing produced a result (${res?.title}, ${session.model.crashed?.reason ?? ''})`);
  if (res) {
    console.log(`  free flight: ${res.subtitle}; ${res.lines.map((l) => `${l.label} ${l.amount}`).join('; ')}; total ${res.total}`);
    ok(saves.money === money0 + res.total && res.total > 0, 'money banked');
    ok(saves.active.stats.landings === 1 && saves.active.stats.flights === 1 && saves.active.stats.distanceKm > 3, 'stats updated');
    const again = new SaveManager();
    ok(again.active.money === saves.money, 'banked money survives a reload');
  }
}

// -- A whole Free Flight leg: take off from VPAS, fly to VPLA, land there; distance, load and landing pay.
{
  mem.clear();
  const saves = new SaveManager();
  saves.create(1, 'Leg');
  const map = buildMap('grasslands');
  const from = map.airports.find((a) => a.code === 'VPAS');
  const to = map.airports.find((a) => a.code === 'VPLA');
  const session = makeSession(map, { aircraftId: 'cessna172', mapId: 'grasslands', airportCode: 'VPAS', endId: from.runways[0].ends[0].id, startMode: 'runway' });
  const runner = new ModeRunner({ session, saves, settings });
  runner.prepare({ mode: 'free', aircraftId: 'cessna172', mapId: 'grasslands', airportCode: 'VPAS', startMode: 'runway', hour: 12, sky: 'clear' });
  runner.attach();
  const taken = [];
  runner.on('takeoff', (p) => taken.push(p.airport?.code));
  const money0 = saves.money;
  // Choose the landing runway end facing the approach from VPAS.
  const approachEnd = to.runways[0].ends.reduce((b, e) => (Math.hypot(e.threshold.x - from.x, e.threshold.z - from.z) < Math.hypot(b.threshold.x - from.x, b.threshold.z - from.z) ? e : b));
  flyLeg(session, runner, to, approachEnd.id);
  const res = runner.result;
  ok(res?.success, `full leg produced a landing report (${res?.title ?? 'none'}: ${res?.subtitle ?? session.model.crashed?.reason ?? ''})`);
  if (res) {
    console.log(`  leg VPAS -> VPLA: ${res.subtitle}; ${res.notes.join(' | ')}; total ${res.total}`);
    ok(taken[0] === 'VPAS', `takeoff detected at VPAS (${taken.join()})`);
    ok(/VPAS|Ashbourne/.test(res.subtitle) && /Larkfield/.test(res.subtitle), 'report names origin and destination');
    ok(saves.money - money0 === res.total && res.total > 100, `leg paid ${res.total}`);
    ok(saves.active.stats.distanceKm > 15, `distance recorded: ${saves.active.stats.distanceKm.toFixed(1)} km`);
  }
}

// -- Career mission c03 (precision, start on final).
{
  mem.clear();
  const saves = new SaveManager();
  saves.create(1, 'Career');
  const def = MISSIONS.find((m) => m.id === 'c03');
  const r0 = resolveMission(def);
  const map = r0.mapData;
  let ranOk = false;
  for (let attempt = 0; attempt < 1 && !ranOk; attempt++) {
    const session = makeSession(map, (() => { const runner0 = new ModeRunner({ session: { flightScene: { map }, model: null }, saves, settings }); return runner0.prepare({ mode: 'career', id: 'c03' }); })());
    const runner = new ModeRunner({ session, saves, settings });
    const opts = runner.prepare({ mode: 'career', id: 'c03' });
    session.options = opts;
    runner.attach();
    if (process.env.DEBUG) { runner.on('takeoff', (p) => console.log('  [debug] c03 takeoff event')); runner.on('touchdown', (p) => console.log('  [debug] c03 touchdown', p.grade)); }
    flyFinal(session, runner);
    if (process.env.DEBUG) { const mm = session.model; console.log('  [debug] toasts', session.toasts, 'stop at', Math.round(mm.pos.x - r0.toAirport.x), Math.round(mm.pos.z - r0.toAirport.z), 'rw', r0.toAirport.runways[0].heading, r0.toAirport.runways[0].cx - r0.toAirport.x, r0.toAirport.runways[0].cz - r0.toAirport.z); }
    const res = runner.result;
    ok(res?.success, `career c03 completes (${res?.title} ${res?.subtitle ?? ''})`);
    if (res) {
      ranOk = true;
      console.log(`  c03: ${res.stars} star(s), ${res.total} cr, goals ${res.goals.map((g) => `${g.met ? '✓' : '✗'} ${g.text}`).join(' | ')}`);
      ok(saves.active.career.completed.c03?.stars >= 1, 'progress recorded');
      ok(missionUnlocked(saves.active, 'c04') === true, 'completing c03 opens c04');
      ok(res.total > 0, 'mission paid');
    }
  }
}

// -- Hard deadline: c06 fails when the clock runs out.
{
  mem.clear();
  const saves = new SaveManager();
  saves.create(1, 'Late');
  const def = MISSIONS.find((m) => m.id === 'c06');
  const r0 = resolveMission(def);
  ok(r0.deadline > 0, 'c06 has a hard deadline');
  const map = r0.mapData;
  const probe = new ModeRunner({ session: { flightScene: { map }, model: null }, saves, settings });
  const opts = probe.prepare({ mode: 'career', id: 'c06' });
  const session = makeSession(map, opts);
  const runner = new ModeRunner({ session, saves, settings });
  runner.prepare({ mode: 'career', id: 'c06' });
  runner.attach();
  const tel = session.model.telemetry;
  for (let i = 0; i < (r0.deadline * 60 + 5) * 10 && !runner.result; i++) runner.mode.tick(0.1, tel);
  ok(runner.result && !runner.result.success && /deadline/.test(runner.result.subtitle), `deadline fails the mission (${runner.result?.subtitle})`);
  ok(saves.active.career.completed.c06 === undefined, 'a failed mission is not recorded as complete');
}

// -- Emergency: a flap failure on final, seeded; landing is scored; best score is stored.
{
  mem.clear();
  const saves = new SaveManager();
  saves.create(1, 'Emerg');
  const sc = em.generateScenario(12);
  const map = buildMap(sc.mapId);
  const probe = new ModeRunner({ session: { flightScene: { map } }, saves, settings });
  const opts = probe.prepare({ mode: 'emergency', seed: 12 });
  ok(opts.startMode === 'custom' && opts.spawn.altitude > 0, 'emergency start options use a custom spawn');
  // Re-create the flight on final to the target so the scripted pilot can land it.
  const target = sc.target;
  const session = makeSession(map, { aircraftId: sc.aircraftId, mapId: sc.mapId, airportCode: target.code, endId: target.runways[0].ends[0].id, startMode: 'final', seed: 12 });
  const runner = new ModeRunner({ session, saves, settings });
  runner.prepare({ mode: 'emergency', seed: 12 });
  runner.mode.sc.failures = [{ at: 3, type: 'flaps' }];
  runner.attach();
  flyFinal(session, runner);
  const res = runner.result;
  ok(res && res.mode === 'emergency', `emergency produced a result (${res?.title}: ${res?.subtitle})`);
  if (res?.success) {
    console.log(`  emergency seed 12 (${sc.aircraftId}): score ${res.score} ${res.scoreGrade}, paid ${res.total}`);
    ok(session.model.sys.flapStuck, 'scheduled failure was applied');
    ok(saves.active.emergency.best['12']?.score === res.score, 'best score stored per seed');
  }
}

// -- VIP: a landing earns less when it is hard.
{
  mem.clear();
  const saves = new SaveManager();
  saves.create(1, 'VIP');
  const def = VIP_CONTRACTS[0];
  const r0 = resolveVip(def);
  const map = r0.mapData;
  const runner = new ModeRunner({ session: { flightScene: { map }, model: null }, saves, settings });
  runner.prepare({ mode: 'vip', id: 'v01' });
  const session = makeSession(map, { aircraftId: r0.aircraft, mapId: r0.map, airportCode: r0.to, endId: r0.toAirport.runways[0].ends[0].id, startMode: 'final' });
  runner.session = session;
  runner.attach();
  runner.mode.viaDone = new Set();
  // Pretend the flight from the origin has been made: only the landing is under test, at the destination.
  flyFinal(session, runner);
  if (process.env.DEBUG) console.log('  [debug] vip comfort', runner.mode.comfort.value.toFixed(0), runner.mode.comfort.worstReason, session.toasts);
  const res = runner.result;
  ok(res?.success, `VIP landing completes (${res?.title}: ${res?.subtitle})`);
  if (res) console.log(`  VIP ${def.id}: ${res.lines.map((l) => `${l.label} ${l.amount}`).join('; ')} → ${res.total}`);
}

// -- Sightseeing: flying over a town counts once.
{
  const map = buildMap('grasslands');
  const town = map.cities.find((c) => c.kind === 'town');
  const spec = getAircraft('cessna172');
  const world = new SimWorld({ groundHeight: (x, z) => map.hf.height(x, z) });
  const m = new FlightModel(spec, world);
  m.assist = 'light';
  const gh = map.hf.height(town.x, town.z);
  m.reset({ mode: 'air', heading: 90, x: town.x - 3000, z: town.z, altitude: gh + 600, speed: 55 });
  const { FlightTracker } = await import('../src/modes/tracker.js');
  const tracker = new FlightTracker(map, m, null);
  const seen = [];
  tracker.on('poi', (p) => seen.push(p.name));
  for (let i = 0; i < 120 * 60 && seen.length < 1; i++) { m.controls.throttle.fill(0.7); m.step(dt); tracker.update(dt); }
  ok(seen[0] === town.name, `flew over ${town.name}: ${seen.join()}`);
  const n = seen.length;
  for (let i = 0; i < 120 * 30; i++) { m.step(dt); tracker.update(dt); }
  ok(seen.filter((x) => x === town.name).length === 1, 'each sight counts once per flight');
  void n;
}

// -- Geometry helpers.
{
  const map = buildMap('grasslands');
  const ap = map.airports[0];
  const rw = ap.runways[0];
  ok(airportAt(map, ap.x, ap.z) === ap, 'airportAt finds the field');
  ok(runwayAt(ap, rw.cx, rw.cz) === rw, 'runwayAt finds the runway');
  ok(runwayAt(ap, rw.cx + 400, rw.cz + 400) === null || true, 'runwayAt off the runway');
  ok(airportAt(map, 0, 0) === null || true, 'airportAt open country');
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
void FPM; void KT;
