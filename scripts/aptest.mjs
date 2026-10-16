// Headless autopilot check: node scripts/aptest.mjs [aircraftId]
import { AIRCRAFT } from '../src/aircraft/index.js';
import { MAX_LEVEL, TRACKS, specWithTuning } from '../src/progress/tuning.js';
// TUNED=1 runs the same checks on every aircraft with all upgrades fitted (see scripts/tuningtest.mjs).
const maxed = Object.fromEntries(TRACKS.filter((t) => !process.env.ONLY_TRACK || t.id === process.env.ONLY_TRACK).map((t) => [t.id, MAX_LEVEL]));
import { FlightModel } from '../src/flight/flightModel.js';
import { SimWorld } from '../src/flight/world.js';
import { Autopilot } from '../src/flight/autopilot.js';
import { KT } from '../src/flight/units.js';

const only = process.argv[2];
const dt = 1 / 120;
const angle = (a) => ((a % 360) + 540) % 360 - 180;

function run(spec, scenario) {
  const m = new FlightModel(spec, new SimWorld());
  m.assist = 'light';
  const startAlt = scenario.alt0 ?? 4000;
  m.reset({ mode: 'air', altitude: startAlt * 0.3048, heading: 0, speed: (scenario.speed ?? spec.speeds.cruise * 0.8) * KT, x: 0, z: 0 });
  m.controls.throttle.fill(0.6);
  const ctl = { stick: { pitch: 0, roll: 0 }, master: 0.6, setMaster(v) { this.master = v; m.controls.throttle.fill(v); } };
  const ap = new Autopilot();
  ap.onEvent = (t) => { if (process.env.V) console.log('   ', t); };
  ap.engage(m, m.telemetry);
  scenario.setup(ap, m);
  let t = 0; const log = [];
  let maxBank = 0; let overshoot = 0;
  while (t < scenario.dur) {
    m.step(dt); t += dt;
    if (!ap.update(dt, m, ctl, null)) { ap.on = false; break; }
    m.controls.pitch = ap.out.pitch; m.controls.roll = ap.out.roll;
    const tel = m.telemetry;
    maxBank = Math.max(maxBank, Math.abs(tel.bank));
    if (process.env.TRACE && Math.abs(t % 10) < dt) console.log('    t', Math.round(t), tel.altitudeFt.toFixed(0), tel.vsFpm.toFixed(0), tel.iasTrue.toFixed(0), ctl.master.toFixed(2), ap.vert);
    if (m.crashed) break;
  }
  const tel = m.telemetry;
  return { ap, tel, t, maxBank, crashed: m.crashed?.reason };
}

const scenarios = [
  { name: 'alt +1500', dur: 260, setup: (ap, m) => { ap.alt += 1500; ap.at = true; }, check: (r, ap) => Math.abs(r.tel.altitudeFt - ap.alt) < 100 && Math.abs(r.tel.vsFpm) < 250 },
  { name: 'alt -1500', dur: 260, setup: (ap, m) => { ap.alt -= 1500; ap.at = true; }, check: (r, ap) => Math.abs(r.tel.altitudeFt - ap.alt) < 100 && Math.abs(r.tel.vsFpm) < 250 },
  { name: 'hdg 90', dur: 90, setup: (ap) => { ap.hdg = 90; ap.at = true; }, check: (r, ap) => Math.abs(angle(r.tel.heading - 90)) < 3 && Math.abs(r.tel.bank) < 4 },
  { name: 'hdg -120', dur: 260, setup: (ap) => { ap.hdg = 240; ap.at = true; }, check: (r, ap) => Math.abs(angle(r.tel.heading - 240)) < 3 && Math.abs(r.tel.bank) < 4 },
  { name: 'vs +800 to +1000', dur: 260, setup: (ap, m) => { ap.vert = 'VS'; ap.vs = 800; ap.alt += 1000; ap.at = true; }, check: (r, ap) => Math.abs(r.tel.altitudeFt - ap.alt) < 100 },
];

let fails = 0;
for (const stock of AIRCRAFT) {
  const spec = process.env.TUNED ? specWithTuning(stock, maxed) : stock;
  if (only && spec.id !== only) continue;
  const row = [];
  for (const sc of scenarios) {
    const r = run(spec, sc);
    const ok = !r.crashed && sc.check(r, r.ap);
    if (!ok) fails++;
    row.push(`${ok ? 'ok ' : 'BAD'} ${sc.name}: alt ${r.tel.altitudeFt.toFixed(0)}/${r.ap.alt} vs ${r.tel.vsFpm.toFixed(0)} hdg ${r.tel.heading.toFixed(0)} bank ${r.tel.bank.toFixed(0)} ias ${r.tel.iasTrue.toFixed(0)}${r.ap.on ? '' : ' [AP OFF]'}${r.crashed ? ' CRASH ' + r.crashed : ''}`);
  }
  console.log(spec.id + '\n  ' + row.join('\n  '));
}
console.log(fails ? `${fails} scenario(s) failed` : 'all passed');
process.exit(fails ? 1 : 0);
