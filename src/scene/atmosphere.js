import * as THREE from 'three';

// Shared atmosphere model: one set of uniforms drives the sky dome, the aerial-perspective fog of
// every standard material (patched in through Material.prototype.onBeforeCompile), the water
// reflections and the PMREM environment. The fog is exponential with a height falloff and its
// colour is the sky colour in the view direction (including the sun's forward-scattering glow), so
// distant terrain melts into the sky instead of into a flat colour band.

export const atmosphere = {
  uniforms: {
    uAtmoSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uAtmoZenith: { value: new THREE.Color('#2a5ca8') },
    uAtmoHorizon: { value: new THREE.Color('#bfd6e8') },
    uAtmoSunCol: { value: new THREE.Color('#fff4de') },
    // x: extinction per metre at the reference altitude, y: scale height, z: reference altitude (MSL), w: sun glow gain
    uAtmoFog: { value: new THREE.Vector4(2.2 / 60000, 2800, 0, 1) },
  },
};

/** GLSL declared before everything else in a fragment shader that uses the atmosphere. */
export const ATMO_GLSL = /* glsl */ `
uniform vec3 uAtmoSunDir;
uniform vec3 uAtmoZenith;
uniform vec3 uAtmoHorizon;
uniform vec3 uAtmoSunCol;
uniform vec4 uAtmoFog;

// Sky radiance in direction d (unit, world space), without the sun disc.
vec3 atmoSky(vec3 d) {
  float h = max(d.y, 0.0);
  float s = max(dot(d, uAtmoSunDir), 0.0);
  vec3 col = mix(uAtmoHorizon, uAtmoZenith, pow(h, 0.42));
  // Thicker, brighter haze right at the horizon.
  col = mix(col, uAtmoHorizon * 1.06 + 0.012, (1.0 - smoothstep(0.0, 0.22, h)) * 0.35);
  // Aerosol forward scattering around the sun, strongest low in the sky.
  float glow = pow(s, 6.0) * 0.30 + pow(s, 40.0) * 0.9;
  col += uAtmoSunCol * glow * uAtmoFog.w * (0.35 + 0.65 * (1.0 - h));
  return col;
}

// Aerial perspective for a surface point seen from the camera.
vec3 atmoApply(vec3 col, float dist, vec3 dir, float y0, float y1) {
  float H = uAtmoFog.y;
  float ref = uAtmoFog.z;
  float a0 = exp(-max(y0 - ref, 0.0) / H);
  float a1 = exp(-max(y1 - ref, 0.0) / H);
  float dy = y1 - y0;
  float meanD = abs(dy) < 2.0 ? a0 : (a0 - a1) * H / dy;
  float tau = uAtmoFog.x * dist * max(meanD, 0.0);
  float f = 1.0 - exp(-tau);
  vec3 haze = atmoSky(normalize(vec3(dir.x, max(dir.y, 0.035), dir.z)));
  return mix(col, haze, f);
}
`;

export const ATMO_FRAGMENT_PARS = `${ATMO_GLSL}\nvarying vec3 vFogWPos;`;
const VERT_PARS = 'varying vec3 vFogWPos;';
const VERT_FOG = `#include <fog_vertex>
#ifdef USE_FOG
  vFogWPos = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;
#endif`;
const FRAG_FOG = `
#ifdef USE_FOG
  {
    vec3 fogOff = vFogWPos - cameraPosition;
    float fogDist = length(fogOff);
    gl_FragColor.rgb = atmoApply(gl_FragColor.rgb, fogDist, fogOff / max(fogDist, 0.001), cameraPosition.y, vFogWPos.y);
  }
#endif
`;

/** Patch a compiled shader (the argument of onBeforeCompile) to use the atmosphere fog. */
export function applyAtmosphere(shader) {
  if (!shader.fragmentShader.includes('#include <fog_fragment>') || shader.fragmentShader.includes('atmoApply')) return;
  Object.assign(shader.uniforms, atmosphere.uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
    .replace('#include <fog_vertex>', VERT_FOG);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${ATMO_FRAGMENT_PARS}`)
    .replace('#include <fog_fragment>', FRAG_FOG);
}

let patched = false;
/** Install the atmosphere fog on every material that does not define its own onBeforeCompile. */
export function installAtmosphere() {
  if (patched) return;
  patched = true;
  THREE.Material.prototype.onBeforeCompile = function atmosphereCompile(shader) {
    applyAtmosphere(shader);
  };
}
