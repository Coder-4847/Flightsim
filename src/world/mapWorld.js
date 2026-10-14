import { SURFACES, SimWorld } from '../flight/world.js';
import { airportSurfaceAt } from './airportLayout.js';

// Physics world for a loaded map: terrain height, surface friction (airport pavement, then the
// biome's natural ground) and weather. The flight model only ever sees the SimWorld interface.

const DEFAULT_SURFACE = { grass: SURFACES.grass, sand: SURFACES.sand, snow: SURFACES.snow };

export function createMapWorld(map, weather = 'calm') {
  const natural = DEFAULT_SURFACE[map.cfg.surfaceDefault] ?? SURFACES.grass;
  const airports = map.airports;
  let last = null; // the airport the aircraft was last near, to avoid scanning all of them

  const world = new SimWorld({
    groundHeight: (x, z) => map.hf.height(x, z),
    surface: (x, z) => {
      if (last && Math.hypot(x - last.x, z - last.z) < last.flatRadius * 1.3) {
        const s = airportSurfaceAt(last, x, z);
        if (s) return s === 'paved' ? paved(world) : SURFACES[s] ?? natural;
        return natural;
      }
      last = null;
      for (let i = 0; i < airports.length; i++) {
        const a = airports[i];
        if (Math.hypot(x - a.x, z - a.z) < a.flatRadius * 1.3) { last = a; return world.surface(x, z); }
      }
      return natural;
    },
    weather,
  });
  world.map = map;
  return world;
}

// Pavement friction drops when wet or snowy (set by the weather system through world.wetness).
function paved(world) {
  const w = world.wetness ?? 0;
  if (w <= 0) return SURFACES.paved;
  return { rolling: SURFACES.paved.rolling + 0.012 * w, friction: SURFACES.paved.friction * (1 - 0.45 * w) };
}
