import { PolylineSet } from './polyline.js';
import { lakeD } from './lakeShape.js';

// Clearance queries shared by everything that places objects on the terrain: nothing may sit in
// water, on an airport, on a road or railway, or on top of something else already placed.

const circleDist = (x, z, c) => Math.hypot(x - c.x, z - c.z);

export function airportReach(a) {
  const half = Math.max(...a.runways.map((r) => r.length / 2 + Math.hypot(r.offsetX, r.offsetZ)));
  return Math.max(half + 240, a.cls === 'strip' ? 520 : 700);
}

export function makeClearance(map) {
  const { lakes, rivers, airports } = map;
  const linear = map.linearSet ?? null;
  const reach = airports.map((a) => airportReach(a));
  const api = {
    /** Distance from open water in metres (negative inside it); only lakes and rivers. */
    waterDist(x, z) {
      let d = Infinity;
      for (let i = 0; i < lakes.length; i++) {
        const l = lakes[i];
        if (circleDist(x, z, l) > l.radius * 3) continue;
        d = Math.min(d, (lakeD(l, x - l.x, z - l.z) - 1.06) * l.radius);
      }
      if (rivers) {
        const r = rivers.nearest(x, z);
        if (r.dist < Infinity) d = Math.min(d, r.dist - r.w * 1.25);
      }
      return d;
    },
    water: (x, z, margin = 0) => api.waterDist(x, z) < margin,
    airport(x, z, margin = 0) {
      for (let i = 0; i < airports.length; i++) {
        const a = airports[i];
        if (Math.abs(x - a.x) > reach[i] + margin + 50 || Math.abs(z - a.z) > reach[i] + margin + 50) continue;
        if (circleDist(x, z, a) < reach[i] + margin) return true;
      }
      return false;
    },
    /** Distance beyond the edge of the nearest road, railway or other linear feature. */
    linearDist(x, z) {
      if (!linear) return Infinity;
      const r = linear.nearest(x, z);
      return r.dist - r.w * 0.5;
    },
    linear: (x, z, margin = 0) => api.linearDist(x, z) < margin,
    /** True when (x, z) is free of water, airports and linear features by `margin` metres. */
    free(x, z, margin = 0) {
      return !api.water(x, z, margin) && !api.airport(x, z, margin) && !api.linear(x, z, margin);
    },
  };
  return api;
}

/** Build the spatial index of linear features (roads, rails, pipelines) with per-point widths. */
export function buildLinearSet(lines) {
  return new PolylineSet(lines.map((l) => ({ points: l.points.map((p) => ({ x: p.x, z: p.z, w: l.width ?? 8 })) })), 1200);
}
