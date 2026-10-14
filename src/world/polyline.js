// A set of polylines with a spatial hash for "nearest point" queries (rivers, roads).
// Each point may carry extra per-vertex values (y, width); they are interpolated along the segment.

export class PolylineSet {
  constructor(lines, cell = 2500, keys = ['y', 'w']) {
    this.lines = lines;
    this.cell = cell;
    this.keys = keys;
    this.grid = new Map();
    lines.forEach((line, li) => {
      for (let i = 0; i < line.points.length - 1; i++) {
        const a = line.points[i];
        const b = line.points[i + 1];
        const x0 = Math.floor(Math.min(a.x, b.x) / cell) - 1;
        const x1 = Math.floor(Math.max(a.x, b.x) / cell) + 1;
        const z0 = Math.floor(Math.min(a.z, b.z) / cell) - 1;
        const z1 = Math.floor(Math.max(a.z, b.z) / cell) + 1;
        for (let cx = x0; cx <= x1; cx++) {
          for (let cz = z0; cz <= z1; cz++) {
            const key = cx * 100003 + cz;
            let list = this.grid.get(key);
            if (!list) { list = []; this.grid.set(key, list); }
            list.push(li * 65536 + i);
          }
        }
      }
    });
    this.result = { dist: Infinity, line: -1, seg: -1, t: 0, y: 0, w: 0, px: 0, pz: 0 };
  }

  /** Nearest point on any line. Returns a shared result object (dist = Infinity if none close). */
  nearest(x, z) {
    const r = this.result;
    r.dist = Infinity;
    const list = this.grid.get(Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell));
    if (!list) return r;
    for (const code of list) {
      const li = code >> 16;
      const si = code & 65535;
      const pts = this.lines[li].points;
      const a = pts[si];
      const b = pts[si + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz || 1;
      let t = ((x - a.x) * dx + (z - a.z) * dz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < r.dist) {
        r.dist = d; r.line = li; r.seg = si; r.t = t; r.px = px; r.pz = pz;
        r.y = (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * t;
        r.w = (a.w ?? 0) + ((b.w ?? 0) - (a.w ?? 0)) * t;
      }
    }
    return r;
  }
}
