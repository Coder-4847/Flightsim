import * as THREE from 'three';
import { MAP_HALF } from './maps.js';

// Biome terrain shading. The geometry carries only positions and normals; colour comes from
// world position, height, slope and the land-use zone texture (R farm, G forest, B urban,
// A special). Procedural detail is added in the fragment shader so it never repeats visibly.

const BIOME_INDEX = { grass: 0, desert: 1, snow: 2 };

const NOISE = /* glsl */ `
float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i); float b = hash21(i + vec2(1.0, 0.0)); float c = hash21(i + vec2(0.0, 1.0)); float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm3(vec2 p){ return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03 + 11.7) + 0.125 * vnoise(p * 4.1 + 3.1); }
`;

const FRAGMENT_HELPERS = /* glsl */ `
uniform sampler2D uZone;
uniform float uMapHalf;
uniform int uBiome;
uniform float uSnowLine;
uniform float uNight;
varying vec3 vWPos;
varying vec3 vWN;
${NOISE}

vec3 farmField(vec2 p, float variety) {
  // Fields: each 2.4 km region gets its own row angle and field size; edges are warped a little.
  vec2 macro = floor(p / 2400.0);
  float rot = hash21(macro) * 1.5708 + (hash21(macro + 4.1) - 0.5) * 0.3;
  mat2 R = mat2(cos(rot), -sin(rot), sin(rot), cos(rot));
  vec2 pw = p + 60.0 * vec2(vnoise(p / 500.0), vnoise(p / 500.0 + 9.0)) - 30.0;
  vec2 pr = R * pw;
  float size = 150.0 + 190.0 * hash21(macro + 9.1);
  vec2 q = pr / vec2(size, size * (0.6 + 0.9 * hash21(macro + 2.7)));
  vec2 cell = floor(q);
  vec2 f = fract(q);
  float h = hash21(cell + macro * 13.0);
  float h2 = hash21(cell + macro * 7.0 + 7.3);
  float rows = sin(pr.y * 0.9 + h * 6.0) * 0.5 + 0.5;
  vec3 green = mix(vec3(0.27, 0.42, 0.15), vec3(0.42, 0.52, 0.20), h2);
  vec3 wheat = mix(vec3(0.58, 0.52, 0.27), vec3(0.68, 0.60, 0.32), h2);
  vec3 plow = mix(vec3(0.34, 0.26, 0.17), vec3(0.42, 0.31, 0.20), h2);
  vec3 fallow = mix(vec3(0.46, 0.52, 0.30), vec3(0.52, 0.56, 0.34), h2);
  vec3 col = h < 0.14 ? mix(plow, plow * 0.8, rows) : h < 0.46 ? mix(green, green * 0.86, rows * 0.7) : h < 0.78 ? mix(wheat, wheat * 0.9, rows * 0.6) : fallow;
  float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  col *= mix(0.8, 1.0, smoothstep(0.0, 0.03, edge));
  // Centre-pivot irrigation circles on a coarser grid.
  vec2 qc = p / 950.0;
  vec2 cc = floor(qc);
  float hc = hash21(cc + 3.1);
  if (hc < 0.4) {
    vec2 centre = (cc + 0.5 + (vec2(hash21(cc + 1.7), hash21(cc + 9.3)) - 0.5) * 0.2) * 950.0;
    float d = length(p - centre);
    if (d < 350.0) {
      float ring = 0.92 + 0.08 * sin(d * 0.3);
      float spoke = 0.94 + 0.06 * step(0.5, fract(atan(p.y - centre.y, p.x - centre.x) * 2.5));
      col = mix(vec3(0.20, 0.42, 0.14), vec3(0.40, 0.54, 0.19), hash21(cc + 5.0)) * ring * spoke;
    }
  }
  return col;
}

// Distance in metres to the nearest street centre line of the 88 m city grid.
float streetDistance(vec2 p) {
  vec2 f = fract(p / 88.0);
  vec2 d = min(f, 1.0 - f) * 88.0;
  return min(d.x, d.y);
}

vec3 urbanColor(vec2 p, float dens) {
  float dm = streetDistance(p);
  float w = fwidth(dm) * 1.2 + 0.4;
  float street = (1.0 - smoothstep(3.2 - w * 0.5, 3.2 + w, dm)) * clamp(1.6 - w / 3.0, 0.0, 1.0);
  float block = hash21(floor(p / 88.0));
  vec3 roof = mix(vec3(0.38, 0.36, 0.35), vec3(0.56, 0.50, 0.44), block);
  roof = mix(roof, vec3(0.30, 0.40, 0.22), step(0.9, hash21(floor(p / 88.0) + 5.0)) * 0.8); // park blocks
  roof *= 0.85 + 0.3 * vnoise(p / 14.0);
  vec3 col = mix(roof, vec3(0.17, 0.17, 0.18), street * 0.8);
  return mix(col, col * 0.92, 1.0 - dens);
}

vec3 terrainColor(vec3 wp, vec3 n, vec4 zone) {
  float h = wp.y;
  float slope = 1.0 - clamp(n.y, 0.0, 1.0);
  vec2 p = wp.xz;
  float nz = fbm3(p / 90.0);
  float nz2 = fbm3(p / 700.0 + 5.0);
  float far = smoothstep(2500.0, 9000.0, length(wp - cameraPosition));
  vec3 col;

  if (uBiome == 0) { // grasslands
    vec3 g1 = vec3(0.27, 0.42, 0.15);
    vec3 g2 = vec3(0.41, 0.50, 0.20);
    col = mix(g1, g2, nz2) * (0.88 + 0.24 * nz);
    col = mix(col, vec3(0.45, 0.43, 0.30), smoothstep(450.0, 1100.0, h) * 0.8);
    col = mix(col, farmField(p, zone.r), zone.r * (1.0 - far * 0.35));
    col = mix(col, vec3(0.13, 0.28, 0.10) * (0.85 + 0.3 * nz), zone.g);
    col = mix(col, vec3(0.42, 0.40, 0.36), smoothstep(0.32, 0.55, slope));
    col = mix(col, vec3(0.9, 0.92, 0.95), smoothstep(1500.0, 1900.0, h + nz * 150.0) * (1.0 - smoothstep(0.45, 0.75, slope)));
  } else if (uBiome == 1) { // desert
    vec3 sandA = vec3(0.78, 0.60, 0.36);
    vec3 sandB = vec3(0.86, 0.70, 0.44);
    float dune = fbm3(vec2(dot(p, vec2(0.87, 0.5)) / 160.0, dot(p, vec2(-0.5, 0.87)) / 900.0));
    col = mix(sandA, sandB, dune) * (0.9 + 0.2 * nz);
    // Rock strata on steep faces: bands of red, orange and cream by height.
    float band = sin(h * 0.22 + nz * 3.0) * 0.5 + 0.5;
    vec3 rock = mix(mix(vec3(0.55, 0.28, 0.17), vec3(0.72, 0.42, 0.22), band), vec3(0.82, 0.68, 0.48), smoothstep(0.55, 0.9, sin(h * 0.13) * 0.5 + 0.5));
    col = mix(col, col * 0.86, smoothstep(0.08, 0.25, slope));
    col = mix(col, rock, smoothstep(0.38, 0.62, slope));
    // Dry lakebed: pale cracked clay.
    vec2 cp = p / 28.0;
    vec2 cf = fract(cp);
    float crack = min(min(cf.x, 1.0 - cf.x), min(cf.y, 1.0 - cf.y));
    vec3 clay = vec3(0.90, 0.85, 0.74) * mix(0.82, 1.0, smoothstep(0.0, 0.05, crack)) * (0.94 + 0.1 * nz);
    col = mix(col, clay, zone.a);
    col = mix(col, vec3(0.20, 0.34, 0.12) * (0.8 + 0.4 * nz), zone.g * 0.9);
  } else { // snow
    vec3 ground = mix(vec3(0.30, 0.31, 0.26), vec3(0.40, 0.38, 0.33), nz2);
    float snowAmt = smoothstep(uSnowLine - 450.0, uSnowLine + 150.0, h + nz * 300.0 - slope * 350.0);
    // Valley floors keep a patchy winter cover: bare ground and meadows show through.
    float patchy = smoothstep(0.35, 0.65, fbm3(p / 600.0 + 40.0));
    snowAmt = max(snowAmt, (0.88 - slope * 1.6) * mix(0.35, 1.0, patchy));
    vec3 rock = mix(vec3(0.33, 0.33, 0.35), vec3(0.48, 0.46, 0.44), nz);
    col = mix(ground, rock, smoothstep(0.25, 0.55, slope));
    col = mix(col, vec3(0.10, 0.22, 0.14) * (0.8 + 0.4 * nz), zone.g);
    vec3 snow = vec3(0.92, 0.95, 1.0) * (0.92 + 0.08 * nz);
    col = mix(col, snow, clamp(snowAmt * (1.0 - zone.g * 0.55), 0.0, 1.0) * (1.0 - smoothstep(0.55, 0.85, slope)));
  }

  float u = zone.b;
  if (u > 0.04) {
    vec3 uc = urbanColor(p, u);
    if (uBiome == 2) uc = mix(uc, vec3(0.85, 0.88, 0.92), 0.35);
    col = mix(col, uc, smoothstep(0.04, 0.35, u) * (1.0 - far * 0.2));
  }
  // Distance haze toward a flat average so far terrain does not shimmer.
  return mix(col, col * 0.92 + 0.02, far * 0.5);
}
`;

export function createTerrainMaterial(zoneTexture, biome, snowLine = 99999) {
  const uniforms = {
    uZone: { value: zoneTexture },
    uMapHalf: { value: MAP_HALF },
    uBiome: { value: BIOME_INDEX[biome] },
    uSnowLine: { value: snowLine },
    uNight: { value: 0 },
  };
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, vertexColors: false });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_HELPERS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 zuv = (vWPos.xz + uMapHalf) / (2.0 * uMapHalf);
        vec4 zone = texture2D(uZone, zuv);
        vec3 tn = normalize(vWN);
        diffuseColor.rgb = terrainColor(vWPos, tn, zone);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // City lights at night: bright street grid inside urban zones.
        {
          float uz = zone.b;
          float dm = streetDistance(vWPos.xz);
          float lit = uz * (smoothstep(7.0, 1.5, dm) * 0.8 + 0.25 * hash21(floor(vWPos.xz / 40.0)));
          totalEmissiveRadiance += vec3(1.0, 0.78, 0.42) * lit * uNight * 0.9;
        }`);
  };
  material.userData.uniforms = uniforms;
  return material;
}
