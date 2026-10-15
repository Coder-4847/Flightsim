// Ground support equipment placed around a parked aircraft, derived from the aircraft's own dimensions so
// that nothing intersects the airframe: GPU at the nose, belt loader and baggage train at the forward hold,
// fuel truck at the wing, catering at the rear door, stairs or jet bridge at the front door, cones and chocks.

const AIRLINER = new Set(['narrowbody', 'regional', 'widebody', 'jumbo', 'turboprop72']);
const BIZ = new Set(['bizjet', 'citation', 'kingair']);

/** vf: VehicleField, st: stand (layout.stands entry), spec: aircraft data, id: traffic id. */
export function equipStand(vf, st, spec, id, rng) {
  const ax = st.frameAxis; const au = ax.u; const av = ax.v;
  const right = { u: -av, v: au }; const left = { u: av, v: -au };
  const nose = spec.gear?.nose?.x ?? spec.geometry.length * 0.3;
  const L = spec.geometry.length;
  const span = spec.wing?.span ?? L * 0.9;
  const cg = { u: st.S.u - au * nose, v: st.S.v - av * nose };
  const P = (x, z) => ({ u: cg.u + au * x + right.u * z, v: cg.v + av * x + right.v * z });
  const kind = AIRLINER.has(id) ? 'airliner' : BIZ.has(id) ? 'biz' : 'ga';
  const big = id === 'widebody' || id === 'jumbo';
  const main = spec.gear?.mainLeft ?? { x: -1.4, z: -3.8 };
  const mz = Math.abs(main.z ?? 3.8);

  // chocks at the nose wheel and main wheels, cones at the nose, wing tips and tail
  const chock = (x, z, fwd) => { const p = P(x, z); vf.add('chock', p.u, p.v, au * fwd, av * fwd); };
  chock(nose + 0.7, 0.35, -1); chock(nose - 0.7, 0.35, 1);
  for (const sd of [-1, 1]) { chock(main.x + 0.9, sd * mz, -1); chock(main.x - 0.9, sd * mz, 1); }
  const cone = (x, z) => { const p = P(x, z); vf.add('cone', p.u, p.v, 1, 0); };
  if (kind !== 'ga') {
    cone(L / 2 + 1.5, 2.5); cone(L / 2 + 1.5, -2.5);
    for (const sd of [-1, 1]) { cone(-1 - span * 0.1, sd * (span / 2 + 3.5)); cone(-L / 2 - 2, sd * 3.5); }
  } else {
    for (const sd of [-1, 1]) cone(0.5, sd * (span / 2 + 2.5));
    cone(-L / 2 - 2, 0);
  }

  if (kind === 'airliner') {
    const bridged = st.bridge;
    if (rng.chance(0.85)) { const p = P(nose + 3.2, -3.6); vf.add('gpu', p.u, p.v, right.u, right.v); }
    if (!bridged) {
      const p = P(nose + 2.4, -4.2); vf.add('stairs', p.u, p.v, right.u, right.v);
      if (rng.chance(0.55)) { const b = P(nose - 8, -12); vf.add('bus', b.u, b.v, au, av, { color: BUS_COLOR }); }
    }
    if (rng.chance(0.7)) { const p = P(nose - 3.4, 5.8); vf.add('beltloader', p.u, p.v, left.u, left.v); }
    if (rng.chance(0.65)) {
      const z0 = big ? 10.5 : 9.5;
      const t = P(nose - 1.5, z0); vf.add('tug', t.u, t.v, -au, -av);
      for (let k = 0; k < 3; k++) { const c = P(nose - 5.6 - k * 3.6, z0); vf.add('cart', c.u, c.v, -au, -av); }
    }
    if (rng.chance(0.55)) { const f = P(-2.5 - (big ? 6 : 0), span * 0.30); vf.add('fuel', f.u, f.v, au, av); }
    if (rng.chance(0.55)) { const c = P(-L * 0.27, -4.8); vf.add('caterer', c.u, c.v, right.u, right.v); }
    if (rng.chance(0.3)) { const t = P(nose + 5.5, 0); vf.add('pushback', t.u, t.v, au, av); }
  } else if (kind === 'biz') {
    if (rng.chance(0.7)) { const p = P(nose + 2.5, -2.6); vf.add('gpu', p.u, p.v, right.u, right.v); }
    if (rng.chance(0.45)) { const f = P(-1.5, span * 0.5 + 6); vf.add('fuel', f.u, f.v, au, av); }
    if (rng.chance(0.5)) { const c = P(nose - 3, -span * 0.5 - 4); vf.add('followme', c.u, c.v, au, av, { color: null }); }
  } else {
    if (rng.chance(0.25)) { const f = P(-1.5, span * 0.5 + 6.5); vf.add('fuel', f.u, f.v, au, av, { scale: 0.85 }); }
    if (rng.chance(0.35)) { const c = P(-L / 2 - 4.5, span * 0.5 + 3); vf.add('pickup', c.u, c.v, -right.u, -right.v, { color: PICKUP_COLORS[rng.int(0, PICKUP_COLORS.length - 1)] }); }
  }
}

import * as THREE from 'three';
const BUS_COLOR = new THREE.Color(0xe6e9ec);
const PICKUP_COLORS = [0xa9232a, 0x23476f, 0xdadada, 0x4a5a4e].map((h) => new THREE.Color(h));
