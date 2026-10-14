import { createBaseHeight } from '../src/world/heightfield.js';
import { MAPS } from '../src/world/maps.js';
for (const m of Object.values(MAPS)) {
  const base = createBaseHeight(m);
  let min = 1e9, max = -1e9, sum = 0, n = 0;
  const t0 = performance.now();
  for (let x = -60000; x <= 60000; x += 600) for (let z = -60000; z <= 60000; z += 600) { const h = base(x, z); min = Math.min(min, h); max = Math.max(max, h); sum += h; n++; }
  const t1 = performance.now();
  console.log(m.id, 'min', min.toFixed(0), 'max', max.toFixed(0), 'mean', (sum / n).toFixed(0), `${((t1 - t0) * 1000 / n).toFixed(2)} us/sample`);
}
