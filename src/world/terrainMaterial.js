import * as THREE from 'three';
import { MAP_HALF } from './maps.js';
import { applyAtmosphere } from '../scene/atmosphere.js';
import { FIELD_GLSL } from './fields.js';
import { getNoiseTexture } from './noiseTexture.js';

// Biome terrain shading. The geometry carries only positions and normals; colour comes from world
// position, height, slope and two land-use zone textures (see zones.js), plus procedural detail at
// many scales sampled from one tileable noise texture, so nothing repeats visibly. The shader also
// bump-lights the ground (grass tufts, soil, ripples, rock) from the noise gradients, fading the
// detail out with the pixel footprint so distant ground neither shimmers nor goes flat.

const BIOME_INDEX = { grass: 0, desert: 1, snow: 2 };

const HELPERS = /* glsl */ `
uniform sampler2D uZone;
uniform sampler2D uZone2;
uniform sampler2D uNoise;
uniform float uMapHalf;
uniform int uBiome;
uniform float uSnowLine;
uniform float uNight;
uniform float uWet;
uniform float uSnowCover;
uniform sampler2D uCloudShade;
uniform vec4 uCloudBox;
varying vec3 vWPos;
varying vec3 vWN;
${FIELD_GLSL}

float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec4 tx(vec2 p, float P){ return texture2D(uNoise, mod(p, P) / P); }
float nv(vec2 p, float P){ return clamp((tx(p, P).r - 0.5) * 1.9 + 0.5, 0.0, 1.0); }
float nw(vec2 p, float P){ return clamp((tx(p, P).g - 0.5) * 1.9 + 0.5, 0.0, 1.0); }
vec2 ngrad(vec2 p, float P){ return (tx(p, P).ba - 0.5) * 0.102 * (512.0 / P); }

// Anti-aliased 0..1 stripe wave of period w along x (fades to 0.5 when finer than a pixel).
float stripe(float x, float w, float pix){
  float a = abs(fract(x / w) - 0.5) * 2.0;
  return mix(smoothstep(0.3, 0.7, a), 0.5, clamp(pix / w * 2.0, 0.0, 1.0));
}

// ---- surface outputs ----------------------------------------------------------------------------
vec3 gCol;
float gRough;
vec3 gBump;     // amplitudes of the bump layers (about 2.6 m, 14 m, 75 m)
float gAO;
float gEmit;    // night emission (lit windows / street lights)
float gSpec;

// Distance in metres to the nearest street centre line of the 88 m city grid; arterials every 4th.
vec2 streetInfo(vec2 p) {
  vec2 q = p / 88.0;
  vec2 f = fract(q);
  vec2 d = min(f, 1.0 - f) * 88.0;
  vec2 ci = floor(q + 0.5);
  float artX = (mod(ci.x, 4.0) < 0.5) ? 1.0 : 0.0;
  float artZ = (mod(ci.y, 4.0) < 0.5) ? 1.0 : 0.0;
  float wx = d.x - (3.4 + 3.2 * artX);
  float wz = d.y - (3.4 + 3.2 * artZ);
  return vec2(min(wx, wz), max(artX * step(wx, wz), artZ * step(wz, wx)));
}

void urbanSurface(vec2 p, float dens, float pix, inout vec3 col, inout float rough) {
  vec2 si = streetInfo(p);
  float street = 1.0 - smoothstep(-pix * 0.5, pix * 0.8 + 0.4, si.x);
  float vis = clamp(14.0 / pix, 0.0, 1.0);
  vec2 blk = floor(p / 88.0);
  float bh = hash21(blk);
  vec2 lotp = fract(p / 88.0) * vec2(4.0, 3.0);
  vec2 lot = floor(lotp);
  float lh = hash21(blk * 7.3 + lot);
  float kind = hash21(blk + 17.0);
  vec3 roof;
  if (dens > 0.75) { // commercial / mid-rise: grey and glass roofs
    roof = mix(vec3(0.40, 0.40, 0.42), vec3(0.58, 0.57, 0.55), lh);
    roof = mix(roof, vec3(0.27, 0.32, 0.38), step(0.82, lh) * 0.8);
  } else if (kind > 0.86) { // industrial: big pale roofs
    roof = mix(vec3(0.58, 0.58, 0.56), vec3(0.70, 0.70, 0.68), lh);
  } else if (kind > 0.80) { // park
    roof = mix(vec3(0.20, 0.36, 0.13), vec3(0.30, 0.46, 0.17), lh);
  } else { // residential: terracotta, slate, brown and cream roofs among gardens
    vec3 r1 = vec3(0.55, 0.27, 0.20); vec3 r2 = vec3(0.34, 0.34, 0.37); vec3 r3 = vec3(0.45, 0.33, 0.24); vec3 r4 = vec3(0.64, 0.58, 0.48);
    roof = lh < 0.3 ? r1 : lh < 0.55 ? r2 : lh < 0.8 ? r3 : r4;
    vec3 garden = mix(vec3(0.24, 0.38, 0.15), vec3(0.34, 0.44, 0.19), hash21(blk + lot * 3.1));
    float built = step(hash21(blk * 3.7 + lot + 9.0), 0.35 + 0.5 * dens);
    vec2 inLot = fract(lotp);
    float house = built * step(0.18, inLot.x) * step(inLot.x, 0.82) * step(0.22, inLot.y) * step(inLot.y, 0.78);
    roof = mix(garden, roof, mix(house, 0.65 * built, 1.0 - vis));
  }
  vec3 c = roof * (0.88 + 0.24 * nv(p, 38.0));
  col = mix(col, mix(c, vec3(0.20, 0.20, 0.21), street * vis), 1.0);
  col = mix(col, vec3(0.21, 0.21, 0.22), street * (1.0 - vis) * 0.5);
  rough = mix(rough, 0.92, 0.8);
}

// ---- grass -----------------------------------------------------------------------------------------
vec3 cropSurface(Field F, vec2 p, float pix, out float rough, out float bumpAmp) {
  float h2 = fract(F.h * 13.7);
  float h3 = fract(F.h * 71.3 + 0.37);
  float rc = h2 > 0.5 ? F.q.x : F.q.y;
  vec3 c;
  rough = 0.95; bumpAmp = 1.0;
  int k = F.crop;
  if (k == 0) { c = mix(vec3(0.27, 0.45, 0.14), vec3(0.35, 0.52, 0.17), h3); c *= 0.93 + 0.14 * stripe(rc, 9.0 + 6.0 * h3, pix); }
  else if (k == 1) { c = mix(vec3(0.62, 0.53, 0.25), vec3(0.72, 0.62, 0.31), h3); c *= 0.94 + 0.1 * stripe(rc, 20.0, pix) + 0.05 * stripe(rc, 2.2, pix); }
  else if (k == 2) { c = mix(vec3(0.70, 0.63, 0.34), vec3(0.78, 0.70, 0.42), h3); c *= 0.95 + 0.08 * stripe(rc, 18.0, pix); }
  else if (k == 3) { c = mix(vec3(0.16, 0.34, 0.09), vec3(0.22, 0.40, 0.11), h3); c *= 0.8 + 0.3 * stripe(rc, 0.76, pix) + 0.06 * stripe(rc, 24.0, pix); }
  else if (k == 4) { c = mix(vec3(0.80, 0.70, 0.10), vec3(0.88, 0.78, 0.18), h3); c *= 0.95 + 0.06 * stripe(rc, 24.0, pix); }
  else if (k == 5) { c = mix(vec3(0.33, 0.23, 0.15), vec3(0.42, 0.30, 0.19), h3); c *= 0.8 + 0.4 * stripe(rc, 0.9, pix); bumpAmp = 2.4; rough = 1.0; }
  else if (k == 6) { c = mix(vec3(0.42, 0.47, 0.22), vec3(0.50, 0.50, 0.27), h3); c *= 0.85 + 0.3 * nv(p, 28.0); }
  else if (k == 7) { c = mix(vec3(0.20, 0.36, 0.11), vec3(0.28, 0.44, 0.14), h3); c = mix(c, vec3(0.44, 0.33, 0.22), 0.5 * stripe(rc, 0.9, pix)); }
  else if (k == 8) {
    c = mix(vec3(0.30, 0.46, 0.17), vec3(0.37, 0.50, 0.20), h3);
    vec2 g = fract(F.q / vec2(6.5, 5.0)) - 0.5;
    float tree = 1.0 - smoothstep(0.26, 0.4, length(g * vec2(6.5, 5.0)) / 1.9);
    c = mix(c, vec3(0.11, 0.25, 0.08), tree * (1.0 - clamp(pix / 5.0, 0.0, 1.0)) * 0.9 + clamp(pix / 5.0, 0.0, 1.0) * 0.3);
  } else if (k == 9) {
    c = mix(vec3(0.43, 0.35, 0.23), vec3(0.38, 0.32, 0.22), h3);
    float row = stripe(rc, 2.2, pix);
    c = mix(c, vec3(0.17, 0.30, 0.10), (1.0 - row) * 0.8);
  } else { c = mix(vec3(0.44, 0.54, 0.21), vec3(0.54, 0.56, 0.26), h3); c *= 0.94 + 0.1 * stripe(rc, 12.0, pix); }
  c *= 0.92 + 0.16 * fract(F.h * 311.7);
  c *= 0.9 + 0.2 * nv(p, 140.0);
  return c;
}

void grassSurface(vec2 p, vec3 N0, vec4 zone, vec4 z2, float h, float slope, float pix, float dCam) {
  float mA = nv(p, 23000.0); float mB = nw(p, 9100.0); float mC = nv(p, 3300.0); float mD = nw(p, 780.0);
  float wet = z2.b;
  float conv = (z2.a - 0.5) * 2.0;
  vec3 lush = vec3(0.19, 0.33, 0.09); vec3 mid = vec3(0.33, 0.46, 0.15); vec3 dry = vec3(0.50, 0.49, 0.24);
  float moist = clamp(mB * 0.55 + mC * 0.35 - conv * 0.25 + wet * 0.4, 0.0, 1.0);
  vec3 col = mix(dry, mix(mid, lush, smoothstep(0.45, 0.8, moist)), smoothstep(0.2, 0.55, moist));
  col = mix(col, vec3(0.43, 0.46, 0.20), smoothstep(0.55, 0.9, mA) * 0.35);
  float speck = nv(p, 5.0);
  col *= 0.86 + 0.26 * mix(speck, 0.5, clamp(pix / 2.0, 0.0, 1.0)) + 0.12 * (mD - 0.5);
  col = mix(col, vec3(0.42, 0.40, 0.26), smoothstep(380.0, 900.0, h) * 0.55);
  float rough = 0.96;
  gBump = vec3(0.55, 0.9, 1.2);
  // Wetland: darker, reedy, glossy.
  float wm = smoothstep(0.55, 0.85, wet + (mD - 0.5) * 0.3);
  col = mix(col, vec3(0.20, 0.30, 0.13), wm * 0.8);
  rough = mix(rough, 0.55, wm * 0.5);

  // Farmland.
  float fm = smoothstep(0.34, 0.6, zone.r + (mD - 0.5) * 0.4);
  if (fm > 0.01) {
    Field F = fieldAt(p);
    float fr; float fb;
    vec3 fc = cropSurface(F, p, pix, fr, fb);
    float hw = F.hedge > 0.75 ? 1.7 : 1.1;
    float vis = clamp(hw * 2.0 / pix, 0.0, 1.0);
    float line = (1.0 - smoothstep(hw - 0.4 * pix, hw + 0.4 * pix + 0.1, F.edge)) * step(0.01, F.hedge);
    vec3 hedgeCol = F.hedge > 0.75 ? vec3(0.08, 0.16, 0.06) * (0.8 + 0.5 * nv(p, 9.0)) : vec3(0.52, 0.45, 0.32);
    fc = mix(fc, hedgeCol, line * vis);
    fc *= 1.0 - 0.07 * step(0.01, F.hedge) * (1.0 - vis) * (1.0 - smoothstep(0.0, 6.0, F.edge));
    // Farm tracks along the region borders.
    float tw = 2.2;
    float tl = 1.0 - smoothstep(tw - 0.3 * pix, tw + 0.4 * pix, F.region);
    fc = mix(fc, vec3(0.56, 0.50, 0.38), tl * clamp(tw * 2.0 / pix, 0.0, 1.0));
    col = mix(col, fc, fm);
    rough = mix(rough, fr, fm);
    gBump.x *= mix(1.0, fb, fm);
    gBump.y *= mix(1.0, 0.6, fm);
  }
  // Mown grass around airports: lush, with wide mowing stripes.
  float mown = smoothstep(0.1, 0.55, z2.g);
  if (mown > 0.01) {
    vec3 mc = mix(vec3(0.24, 0.42, 0.13), vec3(0.30, 0.48, 0.16), nv(p, 600.0)) * (0.94 + 0.12 * stripe(p.x * 0.866 + p.y * 0.5, 14.0, pix));
    col = mix(col, mc, mown);
    gBump.x *= 1.0 - 0.5 * mown;
  }
  // Woodland floor and canopy texture.
  float fo = smoothstep(0.3, 0.55, zone.g + (nv(p, 38.0) - 0.5) * 0.55);
  if (fo > 0.01) {
    float sp = nw(p, 36.0);
    vec3 wood = mix(vec3(0.08, 0.19, 0.06), vec3(0.15, 0.27, 0.08), sp);
    wood = mix(wood, vec3(0.07, 0.17, 0.09), smoothstep(0.5, 0.7, mC) * 0.6);
    wood *= 0.65 + 0.7 * mix(nw(p, 4.3), 0.5, clamp(pix / 4.0, 0.0, 1.0));
    col = mix(col, wood, fo);
    gBump = mix(gBump, vec3(1.4, 1.2, 0.8), fo);
  }
  // Rock outcrops and steep faces.
  float rk = smoothstep(0.26, 0.46, slope + (nv(p, 55.0) - 0.5) * 0.14 + z2.r * 0.04);
  if (rk > 0.01) {
    float band = sin(h * 0.45 + nv(p, 210.0) * 5.0) * 0.5 + 0.5;
    vec3 rock = mix(vec3(0.40, 0.37, 0.31), vec3(0.58, 0.54, 0.46), band * 0.7 + 0.3 * nv(p, 16.0));
    rock = mix(rock, vec3(0.30, 0.38, 0.20), smoothstep(0.6, 0.85, nw(p, 25.0)) * 0.5 * (1.0 - smoothstep(0.4, 0.6, slope)));
    col = mix(col, rock, rk);
    rough = mix(rough, 0.92, rk);
    gBump = mix(gBump, vec3(0.8, 2.2, 3.0), rk);
  }
  // Quarry: pale crushed rock and spoil.
  if (zone.a > 0.04) {
    float bn2 = h * 0.5 + nv(p, 90.0) * 3.0;
    vec3 qc = mix(vec3(0.62, 0.58, 0.50), vec3(0.78, 0.74, 0.66), sin(bn2) * 0.5 + 0.5) * (0.88 + 0.24 * nw(p, 5.0));
    col = mix(col, qc, smoothstep(0.04, 0.5, zone.a));
    rough = mix(rough, 0.95, zone.a);
    gBump = mix(gBump, vec3(1.2, 1.8, 1.2), zone.a);
  }
  // Snow on the high ground (only maps with a snow line).
  float snow = smoothstep(uSnowLine - 150.0, uSnowLine + 200.0, h + (mD - 0.5) * 200.0) * (1.0 - smoothstep(0.5, 0.8, slope));
  col = mix(col, vec3(0.92, 0.94, 0.98), snow);
  // Hollows are a little darker and damper, ridges a little drier.
  gAO = 1.0 + 0.3 * min(conv, 0.0);
  col *= 1.0 + 0.06 * max(conv, 0.0);
  float urb = zone.b;
  if (urb > 0.03) urbanSurface(p, urb, pix, col, rough);
  gCol = col; gRough = rough; gEmit = 0.0; gSpec = 0.3;
}

// ---- desert ------------------------------------------------------------------------------------------
vec2 crackCell(vec2 p) { // distance to the nearest cell border of a jittered grid (0 at a crack)
  vec2 ip = floor(p); vec2 fp = fract(p);
  float d1 = 8.0; float d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = vec2(hash21(ip + g), hash21(ip + g + 19.7));
    float d = length(g + o - fp);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return vec2(d2 - d1, d1);
}

void desertSurface(vec2 p, vec3 N0, vec4 zone, vec4 z2, float h, float slope, float pix, float dCam) {
  float mA = nv(p, 23000.0); float mB = nw(p, 9100.0); float mC = nv(p, 3300.0); float mD = nw(p, 780.0);
  float conv = (z2.a - 0.5) * 2.0;
  float dune = z2.g; float wadi = z2.r; float scrub = z2.b;
  vec3 sandA = vec3(0.72, 0.54, 0.31); vec3 sandB = vec3(0.86, 0.70, 0.45); vec3 red = vec3(0.66, 0.40, 0.24); vec3 pale = vec3(0.86, 0.78, 0.60);
  vec3 col = mix(sandA, sandB, smoothstep(0.3, 0.7, mC * 0.6 + mB * 0.4));
  col = mix(col, red, smoothstep(0.55, 0.85, mA) * 0.5);
  col = mix(col, pale, smoothstep(0.65, 0.9, mD) * 0.35);
  // Gravel plains (hamada) between the dunes: darker and speckled.
  float gravel = (1.0 - dune) * smoothstep(0.25, 0.55, nv(p, 4200.0) + 0.2 * (nw(p, 600.0) - 0.5));
  vec3 gcol = mix(vec3(0.50, 0.40, 0.30), vec3(0.62, 0.51, 0.38), nv(p, 3.7)) * (0.85 + 0.3 * nw(p, 1.3));
  col = mix(col, gcol, gravel * 0.7 * (1.0 - clamp(pix / 3.0, 0.0, 1.0) * 0.4));
  float rough = 0.97;
  gBump = vec3(0.7, 0.8, 0.9);
  // Wind ripples on the sand (crests across the 340 degree wind), warped by noise.
  vec2 wd = vec2(0.342, 0.940);
  float wr = dot(p, wd) + 3.0 * (nv(p, 31.0) - 0.5) + 14.0 * (nw(p, 190.0) - 0.5);
  float rip = sin(wr * 6.283 / 0.95);
  float ripVis = (1.0 - clamp(pix / 0.5, 0.0, 1.0)) * (1.0 - gravel) * (0.4 + 0.6 * dune);
  col *= 1.0 + 0.07 * rip * ripVis;
  vec2 ripG = wd * cos(wr * 6.283 / 0.95) * (6.283 / 0.95) * 0.012;
  // Dune crest highlight and slip-face shade come from the lighting; add colour contrast on dunes.
  col = mix(col, col * vec3(1.06, 1.0, 0.9) + 0.02, dune * 0.4);
  // Dry watercourses: pale braided gravel, scrub on the banks.
  if (wadi > 0.02) {
    float braid = smoothstep(0.55, 0.75, nv(vec2(p.x * 0.35 + p.y * 0.12, p.y * 0.9 - p.x * 0.2), 160.0));
    vec3 wc = mix(vec3(0.72, 0.65, 0.53), vec3(0.58, 0.50, 0.40), braid) * (0.9 + 0.2 * nv(p, 6.0));
    col = mix(col, wc, smoothstep(0.1, 0.5, wadi));
    rough = mix(rough, 0.9, wadi);
  }
  // Scrub: dark grey-green bushes on a sparse random pattern.
  float sc = smoothstep(0.55 - 0.3 * scrub, 0.7 - 0.3 * scrub, nw(p, 9.0));
  float scrubVis = clamp(scrub * 1.5, 0.0, 1.0) * (1.0 - clamp(pix / 9.0, 0.0, 1.0));
  col = mix(col, vec3(0.28, 0.30, 0.15) * (0.7 + 0.6 * nv(p, 2.1)), sc * scrubVis * 0.85);
  col = mix(col, col * vec3(0.86, 0.88, 0.76), scrub * 0.35 * (1.0 - scrubVis));
  // Rock strata on steep faces.
  float rk = smoothstep(0.22, 0.46, slope + (nv(p, 70.0) - 0.5) * 0.12);
  if (rk > 0.01) {
    float bn = h * 0.26 + nv(p, 400.0) * 3.5 + nw(p, 40.0) * 0.8;
    float b1 = sin(bn) * 0.5 + 0.5;
    float b2 = smoothstep(0.55, 0.9, sin(bn * 0.43 + 1.0) * 0.5 + 0.5);
    vec3 rock = mix(vec3(0.52, 0.27, 0.17), vec3(0.74, 0.43, 0.23), b1);
    rock = mix(rock, vec3(0.86, 0.72, 0.52), b2);
    rock = mix(rock, vec3(0.40, 0.23, 0.17), smoothstep(0.7, 0.95, nw(vec2(dot(p, normalize(N0.xz + 1e-3)) / 5.0, dot(p, vec2(-N0.z, N0.x)) / 2.0), 60.0)) * 0.5);
    col = mix(col, rock, rk);
    rough = mix(rough, 0.93, rk);
    gBump = mix(gBump, vec3(0.9, 2.4, 3.2), rk);
  }
  // Salt flat / dry lakebed: pale clay polygons with brighter crust.
  if (zone.a > 0.04) {
    vec2 cr = crackCell(p / 3.6);
    float crack = smoothstep(0.0, 0.06 + pix / 3.6, cr.x);
    vec3 clay = mix(vec3(0.86, 0.80, 0.68), vec3(0.95, 0.93, 0.86), nv(p, 520.0));
    clay *= mix(0.78, 1.0, crack) * (0.94 + 0.1 * nw(p, 11.0));
    clay = mix(clay, vec3(0.62, 0.52, 0.40), smoothstep(0.7, 0.85, nw(p, 800.0)) * 0.4);
    float vis = 1.0 - clamp(pix / 2.5, 0.0, 1.0);
    clay = mix(clay * mix(0.78, 1.0, crack), clay * 0.93, 1.0 - vis);
    col = mix(col, clay, smoothstep(0.04, 0.4, zone.a));
    gBump = mix(gBump, vec3(0.3, 0.2, 0.2), zone.a);
    rough = mix(rough, 0.7, zone.a);
  }
  // Irrigated fields and circular pivots around the oasis towns, then palm groves.
  float fm = smoothstep(0.3, 0.6, zone.r + (mD - 0.5) * 0.3);
  if (fm > 0.01) {
    vec2 qc = p / 520.0; vec2 cc = floor(qc);
    vec2 centre = (cc + 0.5 + (vec2(hash21(cc + 1.7), hash21(cc + 9.3)) - 0.5) * 0.2) * 520.0;
    float d = length(p - centre);
    float disc = 1.0 - smoothstep(228.0 - pix, 232.0 + pix, d);
    vec3 fc = mix(vec3(0.46, 0.38, 0.24), vec3(0.50, 0.42, 0.28), hash21(cc));
    vec3 cropc = mix(vec3(0.17, 0.38, 0.11), vec3(0.45, 0.52, 0.20), hash21(cc + 5.0));
    fc = mix(fc, cropc * (0.93 + 0.07 * sin(d * 0.28)), disc);
    col = mix(col, fc, fm);
    rough = mix(rough, 0.95, fm);
  }
  float fo = smoothstep(0.3, 0.6, zone.g + (nv(p, 30.0) - 0.5) * 0.4);
  col = mix(col, mix(vec3(0.14, 0.30, 0.10), vec3(0.24, 0.38, 0.14), nw(p, 14.0)) * (0.7 + 0.5 * nv(p, 6.0)), fo);
  gAO = 1.0 + 0.3 * min(conv, 0.0);
  float urb = zone.b;
  if (urb > 0.03) urbanSurface(p, urb, pix, col, rough);
  gBump.xy += abs(ripG) * 40.0 * ripVis;
  gCol = col; gRough = rough; gEmit = 0.0; gSpec = 0.35;
  gSpec += 0.0 * ripG.x;
}

// ---- snow -------------------------------------------------------------------------------------------------
void snowSurface(vec2 p, vec3 N0, vec4 zone, vec4 z2, float h, float slope, float pix, float dCam) {
  float mA = nv(p, 23000.0); float mB = nw(p, 9100.0); float mC = nv(p, 3300.0); float mD = nw(p, 780.0);
  float conv = (z2.a - 0.5) * 2.0;
  float glacier = z2.r; float field = z2.g; float scar = z2.b;
  vec2 sd = normalize(N0.xz + vec2(1e-4, 0.0));
  vec2 sp = vec2(-sd.y, sd.x);
  // Ground below the snow: alpine meadow, tundra and bare soil.
  vec3 meadow = mix(vec3(0.27, 0.34, 0.18), vec3(0.36, 0.38, 0.22), mC);
  vec3 tundra = mix(vec3(0.31, 0.29, 0.23), vec3(0.40, 0.37, 0.30), mD);
  vec3 col = mix(meadow, tundra, smoothstep(1000.0, 1500.0, h + (mC - 0.5) * 220.0));
  col *= 0.85 + 0.3 * nv(p, 6.0);
  float rough = 0.95;
  gBump = vec3(0.6, 1.0, 1.4);
  // Rock faces with strata, and scree below them.
  float rk = smoothstep(0.24, 0.5, slope + (nv(p, 60.0) - 0.5) * 0.14);
  float bn = h * 0.2 + nv(p, 320.0) * 4.0;
  vec3 rock = mix(vec3(0.30, 0.30, 0.32), vec3(0.50, 0.47, 0.44), sin(bn) * 0.5 + 0.5);
  rock = mix(rock, vec3(0.42, 0.34, 0.28), smoothstep(0.7, 0.95, nw(p, 90.0)) * 0.5);
  rock *= 0.82 + 0.36 * nv(vec2(dot(p, sp) / 5.0, dot(p, sd) / 22.0), 70.0);
  vec3 scree = mix(vec3(0.46, 0.45, 0.44), vec3(0.56, 0.54, 0.51), nv(p, 3.1));
  float screeAmt = smoothstep(0.16, 0.3, slope) * (1.0 - rk) * smoothstep(0.3, -0.2, conv + 0.2) * smoothstep(900.0, 1500.0, h);
  col = mix(col, scree, screeAmt * 0.8);
  col = mix(col, rock, rk);
  rough = mix(rough, 0.92, max(rk, screeAmt));
  gBump = mix(gBump, vec3(0.8, 2.2, 3.0), rk);
  // Conifer forest.
  float fo = smoothstep(0.3, 0.55, zone.g + (nv(p, 34.0) - 0.5) * 0.5);
  if (fo > 0.01) {
    vec3 wood = mix(vec3(0.05, 0.13, 0.08), vec3(0.09, 0.19, 0.10), nw(p, 30.0));
    wood *= 0.6 + 0.8 * mix(nw(p, 4.0), 0.5, clamp(pix / 4.0, 0.0, 1.0));
    col = mix(col, wood, fo);
  }
  // Snow cover: the snow line, patchy winter cover in the valleys, sheds off steep faces.
  float snowAmt = smoothstep(uSnowLine - 450.0, uSnowLine + 150.0, h + (mC - 0.5) * 300.0 - slope * 350.0);
  float patchy = smoothstep(0.35, 0.65, nw(p, 600.0) + (nv(p, 90.0) - 0.5) * 0.3);
  snowAmt = max(snowAmt, (0.88 - slope * 1.6) * mix(0.3, 1.0, patchy));
  snowAmt = max(snowAmt, field * smoothstep(0.35, 0.1, slope));
  snowAmt *= 1.0 - smoothstep(0.5, 0.85, slope + (nv(p, 38.0) - 0.5) * 0.2);
  snowAmt *= 1.0 - fo * 0.55 * (0.5 + 0.5 * nw(p, 7.0));
  // Avalanche scars: dark streaks running down the slope.
  float streak = smoothstep(0.55, 0.8, nv(vec2(dot(p, sp) / 7.0, dot(p, sd) / 90.0), 600.0));
  snowAmt *= 1.0 - scar * streak * 0.8;
  vec3 snowCol = vec3(0.90, 0.94, 1.0);
  float sastrugi = nv(vec2(dot(p, vec2(0.64, 0.77)) / 2.0, dot(p, vec2(-0.77, 0.64)) / 0.35), 36.0);
  snowCol *= 0.93 + 0.1 * mix(sastrugi, 0.5, clamp(pix / 1.2, 0.0, 1.0)) + 0.05 * (nv(p, 210.0) - 0.5);
  snowCol = mix(snowCol, vec3(0.78, 0.84, 0.93), smoothstep(0.1, 0.9, -conv) * 0.4);
  col = mix(col, snowCol, clamp(snowAmt, 0.0, 1.0));
  rough = mix(rough, 0.82, snowAmt);
  gBump = mix(gBump, vec3(0.5, 1.3, 1.6), snowAmt * (1.0 - rk));
  // Glaciers: blue ice with crevasses across the flow and dirty margins.
  if (glacier > 0.04) {
    float cr = smoothstep(0.66, 0.74, nv(vec2(dot(p, sp) / 9.0, dot(p, sd) / 110.0), 300.0));
    float cr2 = smoothstep(0.72, 0.8, nw(vec2(dot(p, sp) / 28.0, dot(p, sd) / 12.0), 410.0));
    vec3 ice = mix(vec3(0.74, 0.86, 0.95), vec3(0.88, 0.94, 0.99), nv(p, 140.0));
    ice = mix(ice, vec3(0.22, 0.42, 0.62), max(cr, cr2) * 0.8 * (1.0 - clamp(pix / 20.0, 0.0, 1.0)));
    ice = mix(ice, vec3(0.45, 0.45, 0.46), smoothstep(0.55, 0.85, nv(p, 60.0)) * 0.25);
    col = mix(col, ice, smoothstep(0.1, 0.5, glacier));
    rough = mix(rough, 0.3, glacier);
  }
  gAO = 1.0 + 0.25 * min(conv, 0.0);
  float urb = zone.b;
  if (urb > 0.03) { vec3 uc = col; float ur = rough; urbanSurface(p, urb, pix, uc, ur); col = mix(uc, vec3(0.86, 0.89, 0.93), 0.3); rough = ur; }
  gCol = col; gRough = rough; gEmit = 0.0; gSpec = 0.4;
}

void terrainSurface(vec3 wp, vec3 N0) {
  vec2 p = wp.xz;
  vec2 zuv = (p + uMapHalf) / (2.0 * uMapHalf);
  vec4 zone = texture2D(uZone, zuv);
  vec4 z2 = texture2D(uZone2, zuv);
  vec2 dp = fwidth(p);
  float pix = max(max(dp.x, dp.y), 0.02);
  float dCam = length(wp - cameraPosition);
  float slope = 1.0 - clamp(N0.y, 0.0, 1.0);
  if (uBiome == 0) grassSurface(p, N0, zone, z2, wp.y, slope, pix, dCam);
  else if (uBiome == 1) desertSurface(p, N0, zone, z2, wp.y, slope, pix, dCam);
  else snowSurface(p, N0, zone, z2, wp.y, slope, pix, dCam);
  // Weather: wet ground is darker and glossy; snowfall whitens the open ground.
  gCol *= 1.0 - 0.28 * uWet;
  gRough = mix(gRough, min(gRough, 0.42), uWet * 0.8);
  float cover = uSnowCover * (1.0 - smoothstep(0.45, 0.8, slope)) * (0.75 + 0.25 * nv(p, 120.0));
  gCol = mix(gCol, vec3(0.9, 0.93, 0.98), clamp(cover, 0.0, 1.0));
  gRough = mix(gRough, 0.85, clamp(cover, 0.0, 1.0));
  // Night: city streets and lit windows.
  float uz = zone.b;
  if (uz > 0.04 && uNight > 0.01) {
    vec2 si = streetInfo(p);
    vec2 blk = floor(p / 88.0);
    vec2 lot = floor(fract(p / 88.0) * vec2(4.0, 3.0));
    float street = (1.0 - smoothstep(-0.5, 2.5, si.x)) * (0.6 + 0.4 * si.y);
    float win = step(0.5, hash21(blk * 5.1 + lot)) * uz;
    float lamps = mix(0.3, 1.0, step(0.78, fract((p.x + p.y) / 27.0)));
    gEmit = uz * (street * 0.55 * lamps + 0.22 * win) * (1.0 - clamp(pix / 60.0, 0.0, 0.6));
  }
}
`;

const FRAGMENT_COLOR = /* glsl */ `
#include <color_fragment>
  vec3 tN0 = normalize(vWN);
  terrainSurface(vWPos, tN0);
  diffuseColor.rgb = gCol;
  // Bump lighting from the noise gradients, faded out with distance.
  float tPix = max(max(fwidth(vWPos.x), fwidth(vWPos.z)), 0.02);
  vec2 tg = vec2(0.0);
  tg += ngrad(vWPos.xz, 2.6) * gBump.x * 0.010 * (1.0 - smoothstep(0.1, 0.6, tPix));
  tg += ngrad(vWPos.xz, 14.0) * gBump.y * 0.040 * (1.0 - smoothstep(0.4, 3.0, tPix));
  tg += ngrad(vWPos.xz, 75.0) * gBump.z * 0.14 * (1.0 - smoothstep(2.0, 14.0, tPix));
  tg += ngrad(vWPos.xz, 410.0) * 0.5 * (1.0 - smoothstep(8.0, 60.0, tPix));
  vec3 tNW = normalize(tN0 + vec3(-tg.x, 0.0, -tg.y));
`;

export function createTerrainMaterial(zones, biome, snowLine = 99999) {
  const noise = getNoiseTexture();
  const cloudShade = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  cloudShade.needsUpdate = true;
  const uniforms = {
    uZone: { value: zones.zone },
    uZone2: { value: zones.zone2 },
    uNoise: { value: noise },
    uMapHalf: { value: MAP_HALF },
    uBiome: { value: BIOME_INDEX[biome] },
    uSnowLine: { value: snowLine },
    uNight: { value: 0 },
    uWet: { value: 0 },
    uSnowCover: { value: 0 },
    uCloudShade: { value: cloudShade },
    uCloudBox: { value: new THREE.Vector4(0, 0, 1, 1) },
  };
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, vertexColors: false });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${HELPERS}\nvec3 tNW;`)
      .replace('#include <color_fragment>', FRAGMENT_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(tNW, 0.0)).xyz);')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.indirectDiffuse *= gAO;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.76, 0.40) * gEmit * uNight * 0.9;`);
    applyAtmosphere(shader);
  };
  material.userData.uniforms = uniforms;
  material.userData.dispose = () => { cloudShade.dispose(); };
  return material;
}
