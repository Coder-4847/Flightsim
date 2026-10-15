// Headless autopilot approach check: node scripts/apils.mjs [aircraftId]
import { AIRCRAFT } from '../src/aircraft/index.js';
import { FlightModel } from '../src/flight/flightModel.js';
import { SimWorld } from '../src/flight/world.js';
import { Autopilot } from '../src/flight/autopilot.js';
import { buildMap } from '../src/world/mapBuilder.js';
import { KT } from '../src/flight/units.js';

const only = process.argv[2];
const map = buildMap('grasslands');
const airport = map.airports.find((a) => a.cls === 'hub') ?? map.airports[0];
const rw = airport.runways.find((r) => r.ends.some((e) => e.ils)) ?? airport.runways[0];
const end = rw.ends[0];
const dt = 1 / 120;
const DEG = Math.PI / 180;
let fails = 0;

for (const spec of AIRCRAFT) {
  if (only && spec.id !== only) continue;
  const world = new SimWorld({ groundHeight: (x, z) => map.hf.height(x, z) });
  const m = new FlightModel(spec, world);
  m.assist = 'light';
  m.nav = { airports: map.airports, active: airport };
  const d = { x: Math.sin(end.heading * DEG), z: -Math.cos(end.heading * DEG) };
  const dist = 16000; const lat = 1500; // 16 km out, 1.5 km off the centreline, intercepting at 30 degrees
  const x = end.threshold.x - d.x * dist + -d.z * lat;
  const z = end.threshold.z - d.z * dist + d.x * lat;
  const speed = spec.speeds.vapp * 1.35;
  const elev = airport.elevation;
  m.reset({ mode: 'air', x, z, heading: (end.heading - 30 + 360) % 360, altitude: elev + 750, speed: speed * KT });
  m.controls.throttle.fill(0.5);
  m.controls.gearDown = false;
  const ctl = { stick: { pitch: 0, roll: 0 }, master: 0.5, setMaster(v) { this.master = v; m.controls.throttle.fill(v); } };
  const ap = new Autopilot();
  const log = [];
  ap.onEvent = (t) => log.push(t);
  m.telemetry; ap.engage(m, m.telemetry);
  ap.alt = Math.round((elev + 600) * 3.28084 / 100) * 100; ap.ias = Math.round(speed / 5) * 5; ap.at = true; ap.hdg = Math.round(end.heading - 30);
  ap.toggleApproach();
  let t = 0; let res = null;
  while (t < 900) {
    const tel = m.telemetry;
    // Manual gear and flaps as a pilot would set them.
    const gd = tel.aglFt < 2500; m.controls.gearDown = gd;
    const stages = spec.flaps.stages;
    let want = 0;
    for (let i = stages.length - 1; i > 0; i--) if (tel.iasTrue < (stages[i].vfe ?? 999) * 0.92 && (tel.aglFt < 2200 || i === 1 && tel.aglFt < 3500)) { want = i; break; }
    if (tel.aglFt < 1500) want = Math.min(stages.length - 1, Math.max(want, stages.length > 3 ? stages.length - 2 : stages.length - 1));
    m.controls.flapsStage = want;
    m.step(dt); t += dt;
    if (process.env.V && Math.abs(t % 15) < dt) { const g = (await import('../src/game/approachGuide.js')).computeApproach(m, map.airports, ap.target, tel); console.log(`  ${t.toFixed(0)} ${ap.lat}/${ap.vert} agl ${tel.aglFt.toFixed(0)} vs ${tel.vsFpm.toFixed(0)} vsT ${ap.vsT?.toFixed(0)} ias ${tel.iasTrue.toFixed(0)} thr ${ctl.master.toFixed(2)} flaps ${m.controls.flapsStage} dist ${g ? (g.distM / 1000).toFixed(1) : '-'} lat ${g ? g.lateral.toFixed(0) : '-'} gs ${g ? g.gsDots.toFixed(2) : '-'}`); }
    if (!ap.update(dt, m, ctl, null)) { res = { off: true }; break; }
    m.controls.pitch = ap.out.pitch; m.controls.roll = ap.out.roll;
    if (m.crashed) break;
  }
  const tel = m.telemetry;
  const g = m.crashed ? null : (await import('../src/game/approachGuide.js')).computeApproach(m, map.airports, null, tel);
  const ok = !m.crashed && res?.off && g && Math.abs(g.lateral) < 25 && Math.abs(g.heightFt - (12 + Math.max(0, g.distM) * Math.tan(3 * DEG)) * 3.28084) < 45 && Math.abs(tel.iasTrue - spec.speeds.vapp) < 15 && tel.vsFpm > -900;
  if (!ok) fails++;
  console.log(`${ok ? 'ok ' : 'BAD'} ${spec.id.padEnd(13)} t=${t.toFixed(0)}s agl=${tel.aglFt.toFixed(0)} lat=${g ? g.lateral.toFixed(0) : '-'}m gs=${g ? g.gsDots.toFixed(2) : '-'} ias=${tel.iasTrue.toFixed(0)}/${spec.speeds.vapp} vs=${tel.vsFpm.toFixed(0)} dist=${g ? (g.distM / 1000).toFixed(1) : '-'}km ${m.crashed ? 'CRASH ' + m.crashed.reason : ''} [${log.slice(-4).join(' | ')}]`);
}
process.exit(fails ? 1 : 0);
