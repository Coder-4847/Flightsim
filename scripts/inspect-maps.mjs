import { buildMap } from '../src/world/mapBuilder.js';
import { MAPS } from '../src/world/maps.js';
for (const id of Object.keys(MAPS)) {
  const t0 = performance.now();
  const m = buildMap(id);
  const ms = performance.now() - t0;
  console.log(`\n== ${m.cfg.name} (${ms.toFixed(0)} ms) rivers ${m.riverLines.length} lakes ${m.lakes.length} cities ${m.cities.length} airports ${m.airports.length} navaids ${m.navaids.length} waypoints ${m.waypoints.length} roads ${m.roads.length}`);
  for (const a of m.airports) console.log(`  ${a.code} ${a.name.padEnd(26)} ${a.cls.padEnd(8)} elev ${a.elevation.toFixed(0).padStart(4)} m  (${(a.x/1000).toFixed(1)}, ${(a.z/1000).toFixed(1)}) km  rwy ${a.runways.map((r) => `${r.name}/${r.length}`).join(' ')}${a.runways.some((r) => r.ends.some((e) => e.ils)) ? ' ILS' : ''}`);
  for (const c of m.cities.filter((c) => c.kind !== 'village')) console.log(`  city ${c.name.padEnd(12)} ${c.kind.padEnd(6)} R ${c.radius.toFixed(0)} (${(c.x/1000).toFixed(1)}, ${(c.z/1000).toFixed(1)}) h ${m.hf.carved(c.x, c.z).toFixed(0)}`);
}
