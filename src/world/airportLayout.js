// Geometry of an airport as plain data: oriented rectangles for runways, taxiways and aprons
// (used by the physics for surface friction and by the builder for meshes), plus building and
// light positions. Coordinates are world metres.

const DEG = Math.PI / 180;

const dirOf = (h) => ({ x: Math.sin(h * DEG), z: -Math.cos(h * DEG) });

/** Oriented rectangle: centre, half-length along (ux, uz), half-width across. */
function rect(cx, cz, hl, hw, heading, kind, surface = 'paved') {
  const d = dirOf(heading);
  return { cx, cz, hl, hw, ux: d.x, uz: d.z, heading, kind, surface };
}

/** Position from an origin: `along` metres along heading, `perp` metres to the right. */
function at(origin, heading, along, perp) {
  const d = dirOf(heading);
  return { x: origin.x + d.x * along + -d.z * perp, z: origin.z + d.z * along + d.x * perp };
}

export function layoutAirport(a) {
  if (a.layout) return a.layout;
  const main = a.runways[0];
  const h = main.heading;
  const spec = a.spec;
  const origin = { x: a.x, z: a.z };
  const rects = [];
  const buildings = [];
  const taxiLights = [];

  a.runways.forEach((rw) => {
    const shoulder = rw.surface === 'grass' ? 3 : 6;
    rects.push({ ...rect(rw.cx, rw.cz, rw.length / 2 + 15, rw.width / 2 + shoulder, rw.heading, 'runway', rw.surface === 'grass' ? 'grass' : 'paved'), runway: rw.name });
  });

  const hasPair = a.runways.some((r) => r.ends[0].id.endsWith('L') || r.ends[0].id.endsWith('R'));
  const [apronLen, apronDepth] = spec.apron;
  let apronCenter;
  let taxiPerp; // perpendicular offset of the parallel taxiway(s) from the airport centre
  let terminalSide = 1;

  if (hasPair) {
    // International: terminals and apron sit between the two parallel runways.
    apronCenter = { x: a.x, z: a.z };
    taxiPerp = [-130, 130];
  } else {
    const perp = main.width / 2 + 95;
    taxiPerp = [terminalSide * perp];
    apronCenter = at(origin, h, 0, terminalSide * (perp + 12 + apronDepth / 2));
  }
  let taxiLen = 0;
  if (spec.paved) {
    // Parallel taxiways with connectors to the runway(s).
    taxiLen = main.length * (hasPair ? 0.5 : 0.35);
    taxiPerp.forEach((perp) => {
      const c = at(origin, h, 0, perp);
      rects.push(rect(c.x, c.z, taxiLen, 11.5, h, 'taxiway'));
      const connectorAlong = hasPair ? [-taxiLen * 0.95, 0, taxiLen * 0.95] : [-taxiLen * 0.95, taxiLen * 0.95];
      connectorAlong.forEach((al) => {
        // Connector from the taxiway to the nearest runway edge.
        const rwPerp = hasPair ? (perp < 0 ? -240 : 240) : 0;
        const len = Math.abs(perp - rwPerp) / 2;
        const mid = at(origin, h, al, (perp + rwPerp) / 2);
        const dh = (h + 90) % 360;
        rects.push(rect(mid.x, mid.z, len, 11.5, dh, 'taxiway'));
      });
    });
    // Apron plus a link from the taxiway across to it.
    rects.push(rect(apronCenter.x, apronCenter.z, apronLen / 2, apronDepth / 2, h, 'apron'));
    if (!hasPair) {
      const p0 = at(origin, h, 0, terminalSide * (main.width / 2 + 95));
      rects.push(rect(p0.x, p0.z, 11.5, 11.5, h, 'taxiway'));
    }
  } else {
    // Grass strip: a small gravel apron and nothing else.
    rects.push({ ...rect(apronCenter.x, apronCenter.z, apronLen / 2, apronDepth / 2, h, 'apron', 'grass') });
  }

  // Buildings along the apron's far edge (relative to the runway).
  const farPerp = (hasPair ? 0 : terminalSide * (main.width / 2 + 95 + 12 + apronDepth)) + terminalSide * (hasPair ? 0 : 28);
  if (spec.terminal) {
    const size = { large: [300, 34, 24], medium: [110, 26, 13], small: [34, 12, 6] }[spec.terminal];
    const c = hasPair ? at(origin, h, 0, 0) : at(origin, h, 0, farPerp);
    buildings.push({ type: 'terminal', x: c.x, z: c.z, heading: h, w: size[0], d: size[1], h: size[2], size: spec.terminal });
  }
  if (spec.tower) {
    const c = hasPair ? at(origin, h, 215, 0) : at(origin, h, apronLen * 0.5 + 30, terminalSide * (main.width / 2 + 95 + 12 + apronDepth * 0.55));
    buildings.push({ type: 'tower', x: c.x, z: c.z, heading: h, h: a.cls === 'hub' ? 44 : 28 });
    a.towerPos = { x: c.x, z: c.z, y: (a.cls === 'hub' ? 44 : 28) + 4 };
  } else {
    a.towerPos = { x: a.x, z: a.z, y: 8 };
  }
  for (let i = 0; i < spec.hangars; i++) {
    const along = -apronLen / 2 - 60 - i * 52;
    const perp = hasPair ? -20 : terminalSide * (main.width / 2 + 95 + 12 + apronDepth + 24);
    const c = at(origin, h, along, hasPair ? 0 : perp);
    buildings.push({ type: 'hangar', x: c.x, z: c.z, heading: h, w: spec.paved ? 40 : 18, d: spec.paved ? 34 : 16, h: spec.paved ? 12 : 6 });
  }
  if (a.cls === 'hub') {
    // Fuel tanks and a cargo shed.
    const c = at(origin, h, -700, 330);
    buildings.push({ type: 'tanks', x: c.x, z: c.z, heading: h });
    const s = at(origin, h, 560, -330);
    buildings.push({ type: 'hangar', x: s.x, z: s.z, heading: h, w: 120, d: 60, h: 16 });
  }

  // Stand positions on the apron for parked traffic (centre points and the heading to park on).
  const stands = [];
  const standCount = { hub: 14, regional: 6, small: 3, strip: 1 }[a.cls];
  for (let i = 0; i < standCount; i++) {
    const frac = standCount === 1 ? 0 : i / (standCount - 1) - 0.5;
    const along = frac * (apronLen * 0.8);
    const perp = hasPair ? (i % 2 ? 55 : -55) : terminalSide * (main.width / 2 + 95 + 12 + apronDepth * 0.4);
    const p = at(origin, h, along, perp);
    stands.push({ x: p.x, z: p.z, heading: (h + (hasPair ? (i % 2 ? 90 : 270) : terminalSide > 0 ? 270 : 90)) % 360 });
  }

  const taxi = spec.paved ? { perp: taxiPerp, len: taxiLen, hasPair, terminalSide } : null;
  a.layout = { rects, buildings, stands, taxiLights, heading: h, hasPair, apronCenter, taxi };
  return a.layout;
}

const SURFACES_BY_KIND = { runway: null, taxiway: 'paved', apron: 'paved' };

/** Which surface lies at (x, z) within `airport`, or null if off every airport rectangle. */
export function airportSurfaceAt(airport, x, z) {
  const layout = layoutAirport(airport);
  if (Math.hypot(x - airport.x, z - airport.z) > airport.flatRadius * 1.3) return null;
  for (const r of layout.rects) {
    const dx = x - r.cx;
    const dz = z - r.cz;
    const along = dx * r.ux + dz * r.uz;
    if (Math.abs(along) > r.hl) continue;
    const perp = -dx * r.uz + dz * r.ux;
    if (Math.abs(perp) <= r.hw) return r.surface ?? SURFACES_BY_KIND[r.kind];
  }
  return null;
}
