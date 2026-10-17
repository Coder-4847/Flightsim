// Hands-off and knife-edge checks for every aircraft: node scripts/handsoff.mjs [aircraftId]
// An aircraft with the stick centred must not wander on its own, and a 90-degree bank with a held pitch key must stay controlled.
import { AIRCRAFT } from '../src/aircraft/index.js';
import { FlightModel } from '../src/flight/flightModel.js';
import { SimWorld } from '../src/flight/world.js';
import { KT } from '../src/flight/units.js';

const only = process.argv[2];
const dt = 1 / 120;
const f = (x, d = 1) => Number(x).toFixed(d);

function airborne(spec, assist, opts = {}) {
  const m = new FlightModel(spec, new SimWorld());
  m.assist = assist;
  m.reset({ mode: 'air', altitude: opts.alt ?? 3000, heading: 0, speed: (opts.speed ?? spec.speeds.cruise) * KT });
  return m;
}

// 1. Stick centred, throttle changed: pitch/vs/bank must not run away.
function handsOff(spec, assist, throttleStep) {
  const m = airborne(spec, assist);
  const out = [];
  let t = 0; let maxPitch = -99; let minPitch = 99; let maxBank = 0; let maxAlpha = 0;
  while (t < 40) {
    if (t > 5 && throttleStep != null) m.controls.throttle.fill(throttleStep);
    m.step(dt); t += dt;
    const tel = m.telemetry;
    maxPitch = Math.max(maxPitch, tel.pitch); minPitch = Math.min(minPitch, tel.pitch);
    maxBank = Math.max(maxBank, Math.abs(tel.bank)); maxAlpha = Math.max(maxAlpha, Math.abs(tel.alpha));
    if (m.crashed) break;
  }
  const tel = m.telemetry;
  return `pitch ${f(minPitch)}..${f(maxPitch)} end ${f(tel.pitch)} vs ${f(tel.vsFpm, 0)} bank<=${f(maxBank)} alpha<=${f(maxAlpha)} ias ${f(tel.ias, 0)} alt ${f(tel.altitudeFt, 0)}${m.crashed ? ' CRASH ' + m.crashed.reason : ''}`;
}

// 2. Hands-off from the runway with full power: the aircraft must stay on the ground and track straight until the pilot rotates.
function groundHandsOff(spec) {
  const m = new FlightModel(spec, new SimWorld());
  m.assist = 'light';
  m.controls.throttle.fill(1); m.controls.parkingBrake = false;
  let t = 0; let lift = null; let maxPitch = 0;
  while (t < 60) {
    m.step(dt); t += dt;
    const tel = m.telemetry;
    maxPitch = Math.max(maxPitch, tel.pitch);
    if (!tel.onGround && lift === null && t > 1) lift = { t, ias: tel.ias };
    if (m.crashed) break;
  }
  const tel = m.telemetry;
  return `liftoff ${lift ? `${f(lift.t)}s @${f(lift.ias, 0)}kt (vr ${spec.speeds.vr})` : 'none'} maxPitch ${f(maxPitch)} end pitch ${f(tel.pitch)} vs ${f(tel.vsFpm, 0)} ias ${f(tel.ias, 0)} hdg ${f(tel.heading)}${m.crashed ? ' CRASH ' + m.crashed.reason : ''}`;
}

// 3. Knife edge: roll to 90 degrees and settle, release the roll stick, then hold a pitch key (and optionally rudder) for 6 s.
// Reports the peak body rates plus how many times each control surface flipped sign (a jittering aircraft flips constantly).
function knife(spec, assist, pitchIn, yawIn = 0, bankTo = 90) {
  const m = airborne(spec, assist, { alt: 4000 });
  let t = 0;
  while (t < 12) { // PD roll controller onto the target bank
    const tel = m.telemetry;
    m.controls.roll = Math.max(-1, Math.min(1, (bankTo - tel.bank) * 0.04 - tel.rollRate * 0.02));
    m.step(dt); t += dt;
    if (t > 3 && Math.abs(bankTo - tel.bank) < 1.5 && Math.abs(tel.rollRate) < 3) break;
  }
  m.controls.roll = 0;
  const t0 = t; const hdg0 = m.telemetry.heading; const pitch0 = m.telemetry.pitch;
  let maxQ = 0; let maxR = 0; let maxP = 0; let maxAlpha = 0; let maxBeta = 0; let bankDev = 0; let minAlt = 1e9; let maxAlt = -1e9;
  let flips = { elev: 0, ail: 0, rud: 0 }; let last = { elev: 0, ail: 0, rud: 0 };
  while (t < t0 + 6) {
    m.controls.pitch = pitchIn; m.controls.yaw = yawIn;
    m.step(dt); t += dt;
    const tel = m.telemetry;
    maxQ = Math.max(maxQ, Math.abs(tel.pitchRate)); maxP = Math.max(maxP, Math.abs(tel.rollRate)); maxR = Math.max(maxR, Math.abs(m.w.y) * 57.3);
    maxAlpha = Math.max(maxAlpha, Math.abs(tel.alpha)); maxBeta = Math.max(maxBeta, Math.abs(tel.beta));
    bankDev = Math.max(bankDev, Math.abs(tel.bank - bankTo));
    minAlt = Math.min(minAlt, tel.altitudeFt); maxAlt = Math.max(maxAlt, tel.altitudeFt);
    for (const [k, v] of [['elev', m.surfaces.elevator], ['ail', m.surfaces.aileron], ['rud', m.surfaces.rudder]]) {
      if (Math.abs(v) > 0.02 && Math.sign(v) !== Math.sign(last[k]) && last[k] !== 0) flips[k]++;
      if (Math.abs(v) > 0.02) last[k] = v;
    }
    if (m.crashed) break;
  }
  const tel = m.telemetry;
  let dh = tel.heading - hdg0; if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
  return `bank ${bankTo} pitchIn ${pitchIn} yawIn ${yawIn}: q<=${f(maxQ)} r<=${f(maxR)} p<=${f(maxP)}°/s alpha<=${f(maxAlpha)} beta<=${f(maxBeta)} bankDev ${f(bankDev)} dHdg ${f(dh)} dPitch ${f(tel.pitch - pitch0)} alt ${f(minAlt, 0)}..${f(maxAlt, 0)} flips e${flips.elev} a${flips.ail} r${flips.rud}${m.crashed ? ' CRASH ' + m.crashed.reason : ''}`;
}

for (const spec of AIRCRAFT) {
  if (only && spec.id !== only) continue;
  console.log(`\n=== ${spec.name} (${spec.id}) ===`);
  console.log('ground hands-off      ', groundHandsOff(spec));
  for (const assist of ['off', 'light', 'full']) {
    console.log(`air hands-off [${assist}]`.padEnd(22), handsOff(spec, assist, null));
    console.log(`  throttle 100% [${assist}]`.padEnd(22), handsOff(spec, assist, 1));
    console.log(`  throttle 0%   [${assist}]`.padEnd(22), handsOff(spec, assist, 0));
  }
  for (const assist of ['off', 'light', 'full']) {
    console.log(`knife [${assist}]`);
    for (const p of [0, 0.85, -0.85]) console.log('   ', knife(spec, assist, p));
    console.log('   ', knife(spec, assist, 0.85, 1));
    console.log('   ', knife(spec, assist, 0.85, 0, 80));
    console.log('   ', knife(spec, assist, -0.85, 0, -90));
  }
}
