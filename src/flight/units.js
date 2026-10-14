// Unit helpers. The simulation runs in SI (metres, kilograms, seconds, newtons);
// aircraft data files are written in aviation units and converted with these.
export const G = 9.80665;
export const RHO0 = 1.225; // sea-level ISA density, kg/m^3
export const KT = 0.514444; // 1 knot in m/s
export const FT = 0.3048; // 1 foot in m
export const FPM = FT / 60; // 1 ft/min in m/s
export const NM = 1852;
export const LB = 0.45359237;
export const HP = 745.7; // watts
export const LBF = 4.4482216; // newtons
export const DEG = Math.PI / 180;

export const toKt = (ms) => ms / KT;
export const toFt = (m) => m / FT;
export const toFpm = (ms) => ms / FPM;
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// Move `value` toward `target` by at most `maxStep`.
export const approach = (value, target, maxStep) =>
  value < target ? Math.min(target, value + maxStep) : Math.max(target, value - maxStep);
