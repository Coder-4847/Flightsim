import { createNoise } from '../util/noise.js';
import { KT } from './units.js';

// The physics only talks to the world through this small interface, so the same
// flight model runs against the demo airfield, the Phase 3 maps and headless tests.
//   groundHeight(x, z) -> metres MSL
//   surface(x, z)      -> { rolling, friction } tyre coefficients
//   wind(pos, t, out)  -> writes wind velocity (m/s, world axes) into `out`

export const SURFACES = {
  paved: { rolling: 0.025, friction: 0.9 },
  grass: { rolling: 0.07, friction: 0.55 },
  sand: { rolling: 0.09, friction: 0.5 },
  snow: { rolling: 0.12, friction: 0.35 },
};

export const WEATHER_PRESETS = {
  calm: { speed: 0, direction: 0, gust: 0 },
  breeze: { speed: 8, direction: 0, gust: 1.5 }, // headwind down a north-south runway
  crosswind: { speed: 14, direction: 90, gust: 3 }, // from the east
  gusty: { speed: 12, direction: 20, gust: 6 },
};

// Sky conditions as the physics sees them: extra wind, turbulence (0..1), wind shear near the
// ground (0..1) and how wet the runway is (0..1).
export const SKY_PHYSICS = {
  clear: { wind: 0, gust: 0, turb: 0.03, shear: 0, wet: 0 },
  scattered: { wind: 2, gust: 2, turb: 0.2, shear: 0, wet: 0 },
  overcast: { wind: 4, gust: 3, turb: 0.14, shear: 0, wet: 0 },
  rain: { wind: 8, gust: 6, turb: 0.36, shear: 0.2, wet: 0.8 },
  storm: { wind: 17, gust: 14, turb: 0.8, shear: 1, wet: 1 },
  fog: { wind: 0, gust: 0, turb: 0.02, shear: 0, wet: 0.45 },
  snow: { wind: 6, gust: 4, turb: 0.25, shear: 0.1, wet: 0.7 },
};

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class SimWorld {
  constructor({ groundHeight, surface, weather = 'calm', sky = 'clear' } = {}) {
    this.groundHeight = groundHeight ?? (() => 0);
    this.surface = surface ?? (() => SURFACES.paved);
    this.noise = createNoise(4242);
    this.wetness = 0;
    this.turbulence = 0;
    this.sky = SKY_PHYSICS.clear;
    this.weather = WEATHER_PRESETS.calm;
    this.setWeather(weather);
    this.setSky(sky);
  }

  /** `preset`: key of WEATHER_PRESETS. Wind direction is where the wind blows FROM, in degrees. */
  setWeather(preset) {
    this.weather = WEATHER_PRESETS[preset] ?? WEATHER_PRESETS.calm;
    this.#update();
  }

  /** Sky conditions: turbulence, shear, wet runways and extra wind. */
  setSky(id) {
    this.sky = SKY_PHYSICS[id] ?? SKY_PHYSICS.clear;
    this.#update();
  }

  #update() {
    const w = this.weather;
    const s = this.sky;
    this.wetness = s.wet;
    this.turbulence = Math.min(1, s.turb + (w.gust + s.gust) / 50);
  }

  /** Wind velocity (m/s, world axes) at `pos`: power-law profile, veering and shear near the ground, gusts. */
  wind(pos, t, out) {
    const w = this.weather;
    const s = this.sky;
    const base = w.speed + s.wind;
    const gustKt = w.gust + s.gust;
    if (base === 0 && gustKt === 0) return out.set(0, 0, 0);
    const agl = Math.max(0.5, pos.y - this.groundHeight(pos.x, pos.z));
    const profile = Math.min(1.5, Math.max(0.45, (agl / 10) ** 0.14));
    // Shear: wind falls and backs as you descend (a tailwind-gain hazard on final).
    const low = 1 - smooth(0, 400, agl);
    const speedKt = base * profile * (1 - 0.55 * s.shear * low);
    const dirDeg = (w.speed > 0 ? w.direction : 270) - 28 * s.shear * low;
    const from = (dirDeg * Math.PI) / 180;
    const toX = -Math.sin(from);
    const toZ = Math.cos(from);
    const n = this.noise;
    const nx = pos.x / 900;
    const nz = pos.z / 900;
    const g = (a, b) => (n.fbm(t * 0.3 + nx + a, nz + b, 3) - 0.5) * 2;
    const fade = Math.min(1, 0.35 + agl / 120);
    const mps = speedKt * KT;
    const turb = this.turbulence * 5.5 * (1 - smooth(0, 4000, agl) * 0.6); // m/s of rougher air
    const rough = (a, b) => (n.fbm(t * 1.3 + nx * 4 + a, nz * 4 + b, 2) - 0.5) * 2;
    out.set(
      toX * mps + g(0, 1) * gustKt * KT * fade + rough(5, 2) * turb,
      g(10, 2) * gustKt * KT * 0.35 * fade + rough(15, 6) * turb * 0.7,
      toZ * mps + g(20, 3) * gustKt * KT * fade + rough(25, 9) * turb,
    );
    return out;
  }

  /** Angular acceleration from turbulence in body axes (rad/s^2): x roll, y yaw, z pitch. */
  gustAccel(pos, t, out) {
    const k = this.turbulence;
    if (k < 0.01) return out.set(0, 0, 0);
    const n = this.noise;
    const f = (a) => (n.value(t * 1.1 + a, pos.x / 700 + pos.z / 900) - 0.5) * 2;
    out.set(f(31) * 0.55 * k, f(47) * 0.15 * k, f(59) * 0.28 * k);
    return out;
  }
}
