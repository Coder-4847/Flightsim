// Pitch authority check: at approach speed in landing configuration, pull full back and report
// the peak AoA / stall margin, plus the trim state. node scripts/authority.mjs [id]
import { AIRCRAFT } from '../src/aircraft/index.js';
import { FlightModel } from '../src/flight/flightModel.js';
import { SimWorld } from '../src/flight/world.js';
import { KT } from '../src/flight/units.js';

const only = process.argv[2];
for (const spec of AIRCRAFT) {
  if (only && spec.id !== only) continue;
  const m = new FlightModel(spec, new SimWorld());
  m.assist = 'light';
  m.reset({ mode: 'final', altitude: 600, heading: 0, x: 0, z: 4000, speed: spec.speeds.vapp * KT, pathAngle: -3 });
  const trim = m.telemetry;
  let peak = 0; let stalledAt = null; let t = 0;
  m.controls.pitch = 1; m.controls.throttle.fill(0.3);
  while (t < 20) {
    m.step(1 / 120); t += 1 / 120;
    peak = Math.max(peak, m.telemetry.alpha);
    if (m.stalled && stalledAt === null) stalledAt = t;
    if (m.crashed) break;
  }
  console.log(spec.id.padEnd(13), `trim a=${trim.alpha.toFixed(1)} pitch=${trim.pitch.toFixed(1)} | pull: peak a=${peak.toFixed(1)} stalled=${stalledAt?.toFixed(1)} alphaStall=${(m.air.alphaStall * 180 / Math.PI).toFixed(1)} ias=${m.telemetry.ias.toFixed(0)}`);
}
void KT;
