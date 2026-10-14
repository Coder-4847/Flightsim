import { DEG, KT, RHO0, G, clamp, lerp, smoothstep } from './units.js';

// Aerodynamic model shared by every aircraft. Per-aircraft numbers come from the
// data files; everything derivable (lift slope, induced drag factor, CLmax per
// flap setting) is derived here once so data files stay short and consistent.
//
// Sign conventions follow standard flight dynamics: alpha > 0 nose above the
// airflow, beta > 0 airflow from the right, roll positive = right wing down,
// pitch positive = nose up, yaw positive = nose right. Control inputs are
// "effect-signed": elevator +1 = pull (nose up), aileron +1 = roll right,
// rudder +1 = yaw right.

const STALL_WIDTH = 1.6 * DEG; // how abruptly lift breaks down past the stall angle

/** Lift-curve slope per radian (Helmbold, with Prandtl-Glauert Mach correction). */
export function liftSlope(aspectRatio, sweepRad, mach) {
  const beta2 = 1 - Math.min(mach, 0.9) ** 2;
  const k = aspectRatio * aspectRatio * (beta2 + Math.tan(sweepRad) ** 2);
  return (2 * Math.PI * aspectRatio) / (2 + Math.sqrt(4 + k));
}

/**
 * Derive static aerodynamic tables from an aircraft spec. Stall speeds in the
 * spec are calibrated at `massRef` in sea-level CAS, which fixes CLmax per flap stage.
 */
export function deriveAero(spec) {
  const { wing, aero, flaps } = spec;
  const aspectRatio = (wing.span * wing.span) / wing.area;
  const clAlpha = liftSlope(aspectRatio, wing.sweep * DEG, 0);
  const stages = flaps.stages.map((stage) => {
    const vs = stage.vs * KT;
    const clMax = (2 * spec.mass.ref * G) / (RHO0 * wing.area * vs * vs);
    return { deg: stage.deg, clMax, cd: stage.cd, cm: stage.cm ?? 0 };
  });
  const clean = stages[0];
  for (const s of stages) {
    // Flaps raise zero-lift CL and reduce the stall angle slightly.
    s.cl0 = aero.cl0 + 0.85 * (s.clMax - clean.clMax);
    s.alphaStall = (s.clMax - s.cl0) / clAlpha; // refined by calibrateStall
  }
  return {
    aspectRatio,
    clAlpha,
    inducedK: 1 / (Math.PI * aspectRatio * aero.oswald),
    stages,
  };
}

/** Interpolate the flap-stage table at a continuous flap angle (degrees). */
export function flapConfig(derived, flapDeg, out = {}) {
  const st = derived.stages;
  let i = 0;
  while (i < st.length - 2 && flapDeg > st[i + 1].deg) i++;
  const a = st[i];
  const b = st[Math.min(i + 1, st.length - 1)];
  const t = b.deg === a.deg ? 0 : clamp((flapDeg - a.deg) / (b.deg - a.deg), 0, 1);
  out.clMax = lerp(a.clMax, b.clMax, t);
  out.cl0 = lerp(a.cl0, b.cl0, t);
  out.alphaStall = lerp(a.alphaStall, b.alphaStall, t);
  out.alphaCenter = lerp(a.alphaCenter, b.alphaCenter, t);
  out.cd = lerp(a.cd, b.cd, t);
  out.cm = lerp(a.cm, b.cm, t);
  return out;
}

/**
 * Lift coefficient vs angle of attack. Attached flow is linear; past the stall
 * centre angle it blends into a flat-plate curve. Returns CL and `separation`
 * 0..1 (0 = attached, 1 = fully stalled), which also drives stall pitch break,
 * aileron loss and autorotation.
 */
export function liftCoefficient(alpha, cfg, clAlpha, out) {
  const center = alpha >= 0 ? cfg.alphaCenter : cfg.alphaCenter * 0.8; // negative stall comes earlier
  const sep = 1 / (1 + Math.exp(-(Math.abs(alpha) - center) / STALL_WIDTH));
  const linear = cfg.cl0 + clAlpha * alpha;
  const flat = 1.05 * Math.sin(2 * alpha);
  out.cl = (1 - sep) * linear + sep * flat;
  out.separation = sep;
  return out;
}

/**
 * Find the blend centre angle so the CL curve peaks exactly at the calibrated
 * CLmax (the blend rounds the peak off, so the linear curve must reach higher).
 * Stores alphaCenter and alphaStall (the angle of the peak) on `cfg`.
 */
export function calibrateStall(cfg, clAlpha) {
  const probe = {};
  const peakOf = (center) => {
    cfg.alphaCenter = center;
    let peak = 0;
    let at = 0;
    for (let a = 0; a < 45 * DEG; a += 0.2 * DEG) {
      liftCoefficient(a, cfg, clAlpha, probe);
      if (probe.cl > peak) { peak = probe.cl; at = a; }
    }
    return { peak, at };
  };
  let lo = (cfg.clMax - cfg.cl0) / clAlpha;
  let hi = lo + 14 * DEG;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (peakOf(mid).peak < cfg.clMax) lo = mid; else hi = mid;
  }
  const result = peakOf((lo + hi) / 2);
  cfg.alphaStall = result.at;
}

/** Ground effect: induced drag falls and lift slope rises close to the surface. */
export function groundEffect(heightAboveGround, span) {
  const x = (16 * Math.max(heightAboveGround, 0.05)) / span;
  const phi = (x * x) / (1 + x * x); // McCormick: induced-drag factor, 1 far from the ground
  return { inducedFactor: phi, liftFactor: 1 + 0.12 * (1 - phi) };
}

/** Wave drag rise near Mach 1; zero below the critical Mach number. */
export function waveDrag(mach, aero) {
  if (!aero.machCrit) return 0;
  const rise = smoothstep(aero.machCrit, aero.machCrit + 0.22, mach);
  const decay = 1 - 0.18 * smoothstep(1.25, 1.8, mach);
  return (aero.waveDrag ?? 0.02) * rise * decay;
}
