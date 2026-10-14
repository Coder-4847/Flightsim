// Static definitions of the three maps. The builders (mapBuilder.js) turn these into worlds.
// Every map is a 120 km x 120 km square centred on the origin, generated from a fixed seed.

export const MAP_HALF = 60000; // metres from the centre to each edge

export const MAPS = {
  grasslands: {
    id: 'grasslands',
    name: 'Verdant Plains',
    biome: 'grass',
    seed: 1137,
    blurb: 'Rolling farmland, rivers and lakes, with a major city on the plain and mountains on the horizon.',
    surfaceDefault: 'grass',
    palette: { sky: 'clear' },
    rivers: { count: 2, width: [70, 150], depth: 9 },
    lakes: { count: 4, radius: [700, 2200] },
    cities: { major: 1, towns: 5, villages: 9 },
    airports: { hub: 1, regional: 3, small: 5, strip: 4 },
    prevailingWind: 270,
    snowLine: 99999,
    cityNames: ['Meridian', 'Harrowgate', 'Ashbourne', 'Stonebridge', 'Larkfield', 'Wexcombe', 'Fairhaven', 'Oakridge', 'Kingsmere',
      'Thornby', 'Elmhurst', 'Brookvale', 'Haldane', 'Marlow', 'Pennington'],
    airportNames: ['Meridian International', 'Harrowgate Regional', 'Stonebridge Regional', 'Fairhaven Regional', 'Ashbourne Field',
      'Larkfield Municipal', 'Wexcombe Field', 'Oakridge Airpark', 'Kingsmere Municipal', 'Thornby Strip', 'Elmhurst Strip',
      'Brookvale Strip', 'Haldane Strip'],
    codePrefix: 'VP',
  },
  desert: {
    id: 'desert',
    name: 'Sunbaked Basin',
    biome: 'desert',
    seed: 4471,
    blurb: 'Dunes, mesas and deep canyons around dry lakebeds, with oasis towns and a sprawling desert metropolis.',
    surfaceDefault: 'sand',
    palette: { sky: 'clear' },
    rivers: { count: 0 },
    lakes: { count: 3, radius: [350, 700] },
    cities: { major: 1, towns: 4, villages: 6 },
    airports: { hub: 1, regional: 3, small: 4, strip: 4 },
    prevailingWind: 340,
    snowLine: 99999,
    cityNames: ['Al Sahra', 'Qasr Noor', 'Ramla', 'Wadi Haven', 'Sidi Khalid', 'Tarfa', 'Zahrat', 'Mirage Wells', 'Dar Amal', 'Jebel Rum',
      'Nakhla', 'Safra', 'Hamra', 'Bayt Sand', 'Oasis Nine'],
    airportNames: ['Al Sahra International', 'Qasr Noor Regional', 'Wadi Haven Regional', 'Tarfa Regional', 'Ramla Field',
      'Sidi Khalid Municipal', 'Zahrat Airpark', 'Mirage Wells Field', 'Dar Amal Strip', 'Jebel Rum Strip', 'Nakhla Strip',
      'Safra Strip'],
    codePrefix: 'DS',
  },
  snow: {
    id: 'snow',
    name: 'Frostline Range',
    biome: 'snow',
    seed: 9013,
    blurb: 'Jagged mountain ranges, deep valleys, frozen lakes and ski towns, with a northern metropolis.',
    surfaceDefault: 'snow',
    palette: { sky: 'clear' },
    rivers: { count: 1, width: [50, 90], depth: 7 },
    lakes: { count: 5, radius: [800, 2000] },
    cities: { major: 1, towns: 4, villages: 6 },
    airports: { hub: 1, regional: 2, small: 4, strip: 4 },
    prevailingWind: 220,
    snowLine: 1500,
    cityNames: ['Northgard', 'Skyvik', 'Frostholm', 'Alpenrose', 'Valdis', 'Hvitfjell', 'Kaldur', 'Isbjorn', 'Rimeford', 'Glacier Pass',
      'Torvik', 'Nordhavn', 'Silverpeak', 'Eisbach', 'Winterhalde'],
    airportNames: ['Northgard International', 'Skyvik Regional', 'Frostholm Regional', 'Alpenrose Field', 'Valdis Municipal',
      'Hvitfjell Airpark', 'Kaldur Field', 'Isbjorn Strip', 'Rimeford Strip', 'Torvik Strip', 'Silverpeak Strip'],
    codePrefix: 'FR',
  },
};

export const MAP_LIST = Object.values(MAPS);

// Airport size classes. Runway lengths are metres; `ils` marks instrument approaches.
export const AIRPORT_CLASSES = {
  hub: {
    label: 'International',
    runways: [{ length: 3600, width: 60 }, { length: 3100, width: 60, parallel: true }],
    ils: true, terminal: 'large', tower: true, approachLights: true, papi: true, hangars: 4, apron: [420, 170], paved: true, flatRadius: 2300,
  },
  regional: {
    label: 'Regional',
    runways: [{ length: 2400, width: 45 }, { length: 1500, width: 30, cross: true }],
    ils: true, terminal: 'medium', tower: true, approachLights: true, papi: true, hangars: 3, apron: [240, 110], paved: true, flatRadius: 1700,
  },
  small: {
    label: 'Airfield',
    runways: [{ length: 1300, width: 25 }],
    ils: false, terminal: 'small', tower: false, approachLights: false, papi: true, hangars: 2, apron: [110, 60], paved: true, flatRadius: 1000,
  },
  strip: {
    label: 'Airstrip',
    runways: [{ length: 760, width: 20, grass: true }],
    ils: false, terminal: null, tower: false, approachLights: false, papi: false, hangars: 1, apron: [50, 30], paved: false, flatRadius: 700,
  },
};
