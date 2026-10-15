import * as THREE from 'three';
import * as TX from './textures.js';

// Materials for the airport. Pavement and ground share one detail shader: a tiled albedo texture, three
// octaves of low-frequency tone variation sampled in metres (so repetition never shows from far away),
// optional crack/smear layers, and vertex-colour shading for shoulders and patches. Paint uses the same
// metre-space noise to look worn. The frame coordinates come from the `uv` attribute (metres).

const SURFACE_VERT_DECL = 'varying vec2 vP;';
const SURFACE_FRAG_DECL = `varying vec2 vP;
uniform sampler2D uTex; uniform sampler2D uMacro; uniform sampler2D uCrack;
uniform float uTile; uniform float uCrackAmt; uniform float uToneAmt; uniform float uCrackTile;`;

const SURFACE_FRAG = `
  vec2 pp = vP;
  vec3 baseCol = texture2D(uTex, pp / uTile).rgb;
  float m1 = texture2D(uMacro, pp / 331.0).r;
  float m2 = texture2D(uMacro, pp / 67.0 + 0.37).g;
  float m3 = texture2D(uMacro, pp / 19.0 + vec2(0.71, 0.13)).b;
  float cm = smoothstep(0.50, 0.72, texture2D(uMacro, pp / 123.0 + 0.2).b);
  vec4 cr = texture2D(uCrack, pp / uCrackTile);
  float crackV = cr.r * cm * uCrackAmt;
  float tone = 1.0 + uToneAmt * ((m1 - 0.5) * 0.9 + (m2 - 0.5) * 0.45 + (m3 - 0.5) * 0.25);
  vec3 sc = baseCol * tone;
  sc *= 1.0 - 0.62 * crackV;
  sc *= 1.0 - 0.30 * cr.g * smoothstep(0.35, 0.7, m2) * uCrackAmt;
  diffuseColor.rgb *= sc;
`;

/** Pavement / ground material. kind: 'asphalt' | 'concrete' | 'grass' | 'dirt' | 'snow'. */
export function surfaceMaterial(kind, tint = 1, { roughness = 0.94 } = {}) {
  const tex = kind === 'asphalt' ? TX.asphaltTexture() : kind === 'concrete' ? TX.concreteTexture() : TX.groundTexture(kind);
  const cfg = {
    asphalt: { tile: 6, crack: 1.0, tone: 0.62 }, concrete: { tile: 15, crack: 0.35, tone: 0.40 },
    grass: { tile: 12, crack: 0, tone: 0.55 }, dirt: { tile: 12, crack: 0, tone: 0.5 }, snow: { tile: 12, crack: 0, tone: 0.18 },
  }[kind];
  const mat = new THREE.MeshStandardMaterial({ color: tint instanceof THREE.Color ? tint : new THREE.Color().setScalar(tint), roughness, metalness: 0, vertexColors: true });
  const uniforms = {
    uTex: { value: tex }, uMacro: { value: TX.macroTexture() }, uCrack: { value: TX.crackTexture() },
    uTile: { value: cfg.tile }, uCrackAmt: { value: cfg.crack }, uToneAmt: { value: cfg.tone }, uCrackTile: { value: 19 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SURFACE_VERT_DECL}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SURFACE_FRAG_DECL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${SURFACE_FRAG}`);
  };
  mat.customProgramCacheKey = () => 'airport-surface';
  return mat;
}

/** Worn road/runway paint. Optional alpha-tested glyph atlas as the map. */
export function paintMaterial(color, { glyph = false, rough = 0.78 } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: 0, vertexColors: true,
    map: glyph ? TX.glyphAtlas() : null, alphaTest: glyph ? 0.42 : 0, alphaToCoverage: glyph,
  });
  const uniforms = { uMacro: { value: TX.macroTexture() } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vW; uniform sampler2D uMacro;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float wn1 = texture2D(uMacro, vW / 5.3).b;
        float wn2 = texture2D(uMacro, vW / 1.9 + 0.3).g;
        float wear = smoothstep(0.12, 0.5, wn1 * 0.75 + wn2 * 0.55 - 0.18);
        diffuseColor.rgb *= mix(0.52, 1.0, wear);`);
  };
  mat.customProgramCacheKey = () => `airport-paint-${glyph ? 'g' : 'p'}`;
  return mat;
}

/** Decal with an alpha texture (rubber, wear streak). */
export function decalMaterial(map, color = 0x050505, { opacity = 1 } = {}) {
  return new THREE.MeshStandardMaterial({ map, color, roughness: 1, transparent: true, opacity, depthWrite: false, vertexColors: true });
}

/** Per-airport palette and tints derived from the seed. */
export function airportStyle(rng, biome) {
  const warm = rng.float();
  const wallPalette = [0xdcd8cf, 0xcfd3d6, 0xe6dfd0, 0xd5d0c4, 0xc9ced4];
  const accents = [0x1f5fae, 0xb0322c, 0x1d7a63, 0xc27a1a, 0x5b3d8f, 0x2a3440];
  return {
    asphaltTint: 0.88 + rng.float() * 0.3,
    concreteTint: [0.96 + rng.float() * 0.08, 0.96 + rng.float() * 0.08, 0.94 + rng.float() * 0.08],
    wall: wallPalette[rng.int(0, wallPalette.length - 1)],
    wall2: wallPalette[rng.int(0, wallPalette.length - 1)],
    accent: accents[rng.int(0, accents.length - 1)],
    roof: [0x6b7178, 0x575e66, 0x8a8f94, 0x4d535a][rng.int(0, 3)],
    hangar: [0x9fa6ad, 0xb7b2a2, 0x7e8c96, 0xa8523f, 0x6f7f68, 0xc9c6bb][rng.int(0, 5)],
    glass: warm,
    biome,
    wear: 0.6 + rng.float() * 0.8,
  };
}

export function disposeMaterials(list) {
  for (const m of list) m.dispose();
}
