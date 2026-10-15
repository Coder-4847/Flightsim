// Game modes: Arcade, Simulation and Custom. A mode is just a set of system toggles stored in
// the settings (`sys_*`); the presets write all of them, and changing any single toggle by hand
// switches the preset to Custom.

export const SYSTEMS = [
  { key: 'sys_perEngine', id: 'perEngine' },
  { key: 'sys_manualFlaps', id: 'manualFlaps' },
  { key: 'sys_manualGear', id: 'manualGear' },
  { key: 'sys_atc', id: 'atc' },
  { key: 'sys_fuel', id: 'fuel' },
  { key: 'sys_checklists', id: 'checklists' },
  { key: 'sys_failures', id: 'failures' },
  { key: 'sys_fullWeather', id: 'fullWeather' },
  { key: 'sys_damage', id: 'damage' },
  { key: 'sys_realism', id: 'realism' },
];

export const PRESETS = {
  arcade: {
    perEngine: false, manualFlaps: false, manualGear: false, atc: false, fuel: false, checklists: false,
    failures: false, fullWeather: false, damage: true, cockpitCam: true, realism: 'arcade',
  },
  simulation: {
    perEngine: true, manualFlaps: true, manualGear: true, atc: true, fuel: true, checklists: true,
    failures: true, fullWeather: true, damage: true, cockpitCam: true, realism: 'full',
  },
};

/** The flight assist each realism level starts a flight with. */
export const REALISM_ASSIST = { arcade: 'full', standard: 'light', full: 'off' };
/** How much of the sky's turbulence and shear the flight model applies. */
export const WEATHER_REALISM = { off: 0.2, on: 1 };

/** Snapshot of the system toggles as a plain object. */
export function getSystems(settings) {
  const out = {};
  for (const { key, id } of SYSTEMS) out[id] = settings.get(key);
  return out;
}

export function applyPreset(settings, presetId) {
  const preset = PRESETS[presetId];
  if (!preset) return;
  applying = true;
  try {
    for (const { key, id } of SYSTEMS) settings.set(key, preset[id]);
  } finally {
    applying = false;
  }
}

let applying = false;

/** Keep the preset and the individual toggles consistent. Call once at start-up. */
export function watchModes(settings) {
  settings.on('change', ({ key, value }) => {
    if (applying) return;
    if (key === 'preset') {
      if (value !== 'custom') applyPreset(settings, value);
    } else if (key.startsWith('sys_') && settings.get('preset') !== 'custom') {
      settings.set('preset', 'custom');
    }
  });
  // First run: make sure the stored preset and toggles agree.
  const current = settings.get('preset');
  if (current !== 'custom') {
    const preset = PRESETS[current];
    const same = SYSTEMS.every(({ key, id }) => settings.get(key) === preset[id]);
    if (!same) applyPreset(settings, current);
  }
}
