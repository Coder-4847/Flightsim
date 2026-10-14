// Prioritised cockpit warnings. `evaluate` turns the current state into a list; the HUD adds hold
// times and audio so the same condition does not spam.

const LEVEL_ORDER = { red: 0, amber: 1, info: 2 };

/** Lowest ground clearance along the flight path in the next few seconds, in metres (negative = impact). */
function terrainClearance(model, seconds) {
  let worst = Infinity;
  const v = model.vel;
  const speed = Math.hypot(v.x, v.z, v.y);
  if (speed < 20) return worst;
  for (const k of [0.3, 0.55, 0.8, 1]) {
    const px = model.pos.x + v.x * seconds * k;
    const pz = model.pos.z + v.z * seconds * k;
    const py = model.pos.y + Math.min(v.y, 0) * seconds * k * 0.8;
    worst = Math.min(worst, py - model.world.groundHeight(px, pz));
  }
  return worst;
}

/** @returns [{ id, level, text, sound }] sorted most urgent first. */
export function evaluate(t, model, extra = {}) {
  const w = [];
  const add = (id, level, text, sound) => w.push({ id, level, text, sound });
  const air = !t.onGround;
  if (t.stallWarning || t.stalled) add('stall', 'red', 'STALL', 'stall');
  if (t.overspeed) add('overspeed', 'red', 'OVERSPEED', 'master');
  if (air && t.aglFt < 2500 && extra.gpws !== false) {
    const clear = terrainClearance(model, 12);
    if (clear < 40 && t.vsFpm < 300 && t.iasTrue > 70) add('terrain', 'red', 'TERRAIN — PULL UP', 'gpws:pull up');
    else if (t.aglFt < 1000 && t.vsFpm < -2400) add('sink', 'amber', 'SINK RATE', 'gpws:sink rate');
  }
  if (air && Math.abs(t.bank) > 55 && t.aglFt > 150) add('bank', 'amber', 'BANK ANGLE', 'caution');
  if (air && model.spec.gear.retractable && t.gear < 0.98 && t.aglFt < 700 && t.vsFpm < -100 && t.iasTrue < model.spec.speeds.vapp * 1.45) add('gear', 'amber', 'TOO LOW — GEAR', 'gpws:too low gear');
  if (t.fuel <= 0) add('nofuel', 'red', 'FUEL EXHAUSTED', 'master');
  else if (t.fuel < t.fuelCapacity * 0.08) add('lowfuel', 'amber', 'LOW FUEL', 'caution');
  for (const f of t.failures) add(f.id, f.level === 'info' ? 'info' : f.level, f.text, f.level === 'red' ? 'master' : f.level === 'amber' ? 'caution' : null);
  if (t.speedbrake > 0.5) add('speedbrake', 'info', 'SPEEDBRAKE');
  if (t.afterburner > 0.5) add('afterburner', 'info', 'AFTERBURNER');
  if (t.parkingBrake && t.groundSpeed > 8) add('park', 'amber', 'PARKING BRAKE', 'caution');
  if (t.apuSpool > 0.95) add('apu', 'info', 'APU RUNNING');
  if (extra.runwayIncursion) add('incursion', 'red', 'RUNWAY INCURSION', 'master');
  return w.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

export { LEVEL_ORDER };
