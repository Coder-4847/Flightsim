// International Standard Atmosphere up to 20 km (troposphere + isothermal layer).
const T0 = 288.15;
const P0 = 101325;
const G0 = 9.80665;
const R = 287.053;
const LAPSE = 0.0065;
const T11 = 216.65;
const P11 = P0 * Math.pow(T11 / T0, G0 / (R * LAPSE));

export function isa(altitudeM) {
  const h = Math.min(20000, Math.max(-500, altitudeM));
  let T;
  let p;
  if (h <= 11000) {
    T = T0 - LAPSE * h;
    p = P0 * Math.pow(T / T0, G0 / (R * LAPSE));
  } else {
    T = T11;
    p = P11 * Math.exp((-G0 * (h - 11000)) / (R * T11));
  }
  const rho = p / (R * T);
  return { T, p, rho, sigma: rho / 1.225, speedOfSound: Math.sqrt(1.4 * R * T) };
}
