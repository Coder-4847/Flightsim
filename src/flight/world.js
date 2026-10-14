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
  breeze: { speed: 8, direction: 0, gust: 1.5 }, // headwind down the runway (from the north)
  crosswind: { speed: 14, direction: 90, gust: 3 }, // from the east, 90 degrees across runway 18/36
  gusty: { speed: 12, direction: 20, gust: 6 },
};

export class SimWorld {
  constructor({ groundHeight, surface, weather = 'calm' } = {}) {
    this.groundHeight = groundHeight ?? (() => 0);
    this.surface = surface ?? (() => SURFACES.paved);
    this.noise = createNoise(4242);
    this.setWeather(weather);
  }

  /** `preset`: key of WEATHER_PRESETS. Wind direction is where the wind blows FROM, in degrees. */
  setWeather(preset) {
    this.weather = WEATHER_PRESETS[preset] ?? WEATHER_PRESETS.calm;
  }

  wind(pos, t, out) {
    const { speed, direction, gust } = this.weather;
    if (speed === 0 && gust === 0) return out.set(0, 0, 0);
    const from = (direction * Math.PI) / 180;
    // Wind blowing FROM `from` heads toward from + 180 degrees. Heading 0 = -Z, 90 = +X.
    const toX = -Math.sin(from);
    const toZ = Math.cos(from);
    // Gusts: low-frequency noise on all three axes (vertical gusts are weaker).
    const n = this.noise;
    const g = (a, b) => (n.fbm(t * 0.35 + a, b, 3) - 0.5) * 2;
    const fade = Math.min(1, 0.35 + pos.y / 120); // calmer right at ground level
    const mps = speed * KT;
    out.set(
      toX * mps + g(0, 1) * gust * KT * fade,
      g(10, 2) * gust * KT * 0.35 * fade,
      toZ * mps + g(20, 3) * gust * KT * fade,
    );
    return out;
  }
}

