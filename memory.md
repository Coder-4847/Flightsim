# Flight Sim: memory

## Current status
- Phase: 3 (Maps, terrain, all aircraft, weather, day/night, traffic) — code complete, verified headless, Pages deploy succeeded; waiting for the user's playtest.
- Last completed: Phase 2 deployed. Phase 3 built in three commits: world (3 generated 120 km maps, LOD terrain, airports, scenery, weather, day/night), then the remaining 10 aircraft, multi-tank fuel/CG model, hangar preview, traffic.
- Next step: user playtests Phase 3 on the live URL. Do NOT start Phase 4 (modes, ATC, full HUD) until this deploy is live and the checklist below passes.
- Live playtest URL: https://coder-4847.github.io/Flightsim/

## What to test in this build (Phase 3)
1. Main menu > Start flying > map select shows three maps (Verdant Plains, Sunbaked Basin, Frostline Range) with a rendered overview each.
2. Hangar screen: 14 aircraft grouped by class; picking one turns the preview (own WebGL canvas) and shows a spec sheet. Airports are listed per map (11-13 each; hub, regional, airfield, airstrip). A warning shows when the chosen runway is shorter than the aircraft's `minRunway`.
3. Fly: choose start (runway / final approach / in flight), time (dawn/day/dusk/night or slider) and sky (clear, scattered, overcast, rain, storm, fog, snow). Loading takes a few seconds per map (about 5 s in headless software rendering).
4. All 14 aircraft should fly from the hangar: Skyhawk 172, Trekker 208, Tutor T-39, Regal 200, Cirrus 72, Zenith CJ, Stratos G6, Regional 175, Meridian 320, Atlas 300, Titan 400, Falcon F-16, Corsair F/18, Warden S-27. Cockpit camera (C) works on each; airliners have a six-screen flight deck, sidestick/yoke, a throttle per engine, flap/gear levers.
5. Titan 400 (jumbo): six fuel tanks (centre, trim, four mains), the CG moves as fuel burns (shown as CG % MAC in the HUD status line and on the fuel page of the cockpit). Fuel loads mains first; centre and trim tanks burn first.
6. Terrain and scenery: farmland patchwork, rivers/lakes and bridges, forests, towns and a big city with towers (night lights), desert dunes/mesas/canyons, snow mountains above the snow line. Fly low over each to check pop-in and frame rate (Settings > FPS counter).
7. Airports: runway markings, lights (night), PAPI, windsock, tower, terminal, jet bridges, parked aircraft on the aprons (chosen by airport size), scripted airliners/GA flying between airports (they are not collision-checked yet).
8. Weather: sky presets change clouds, light, fog and wind; rain/snow streaks; storms add turbulence and gusts; wet runways reduce braking. Wind from Settings > Game > Wind still applies on top.
9. Navigation display: the MFD map (jet cockpits) shows airports and runways within range and a bearing/distance to the starting airport.
10. Console should be clean.

## Decisions
- 2026-10-14 Plain JavaScript (ES modules), no TypeScript. Three.js WebGL2 only. Vite `base: './'`.
- 2026-10-14 Pushes go to the session branch `ccr-1a1faa50-o7g7vk`. The Pages workflow triggers on it plus main/master.
- 2026-10-14 World coordinates: +X east, +Y up, -Z north, metres. Heading 0 = north, 90 = east. Body frame: +X nose, +Y up, +Z right wing, origin at the CG. A runway end of heading h points along (sin h, -cos h); runway mesh yaw = pi - h.
- 2026-10-14 Key defaults: W = pitch down (stick forward), S = pitch up; everything remappable. Settings are a flat schema; the settings UI is generated from it.
- 2026-10-14 Physics: fixed 120 Hz with render interpolation. Stall speeds in aircraft data (KCAS at `mass.ref`) set CLmax per flap stage; `calibrateStall` solves the blend centre. Lift slope: Helmbold with Mach correction.
- 2026-10-14 Control law: `flightAssist` (off/light/full) plus fly-by-wire for fighters. Airborne starts are trimmed to equilibrium. Gear has a squat switch. Landing grades by sink rate; over `crashLanding` or an airframe strike ends the flight.
- 2026-10-14 Maps are fixed-seed 120 km squares (`MAP_HALF` = 60 km). Terrain is a quadtree of LOD tiles with skirts; normals use a fixed 48 m forward difference so LOD borders never show lighting seams. Physics ground height is the same analytic function (`Terrain.heightIn` for the mesh side).
- 2026-10-14 Biome look is one shader (`onBeforeCompile` on a standard material) driven by a zone texture (R farmland, G forest, B urban, A special) plus per-biome palettes: field patchwork and irrigation circles, street grid, desert strata, snow line. Custom shaders must `#include <common>` and the logdepth chunks, each `#include` on its own line.
- 2026-10-14 Airports: 1 hub, 2-3 regional, 4-5 airfields, 4 strips per map (11-13 airports). Sites are flat-searched, then the terrain is flattened to a pad. ILS on hub/regional main runways. Stands on aprons are in `layout.stands` and used by parked traffic.
- 2026-10-14 Weather presets (`SKY_PRESETS` visuals, `SKY_PHYSICS` forces): clear, scattered, overcast, rain, storm, fog, snow. Turbulence and wind shear act as angular kicks scaled by tas/mass. Cloud whiteout comes from visibility.
- 2026-10-14 Roster (14): 172, Caravan-class, L-39-class trainer, King Air-class, ATR-class, Citation-class, Gulfstream-class, E175-class, A320-class, 777-class, 747-class, F-16-class, F/A-18-class, Su-27-class. All names are generic ("Skyhawk 172", "Titan 400", ...); liveries are fictional.
- 2026-10-14 Heavy aircraft set `mass.ref` to a representative landing weight (stalls and gear are tuned there). `mass.fuelStart` puts typical total weight at or above ref. Airliner aileron derivatives are much larger than a light aircraft's to give a believable 10-15 deg/s roll despite huge inertia.
- 2026-10-14 Multi-tank fuel (`spec.tanks`, used by the jumbo): each tank has `capacity`, CG `arm` (fraction of MAC), burn `order` (ascending) and `feeds` (null = all engines, else engine indices). Engines draw from the lowest order first; loading fills the highest order first and shares equally within an order. CG = dry moment plus tank moments over total mass. Single-tank aircraft keep the linear empty-to-full CG.
- 2026-10-14 Aircraft models are parametric: `airliner.js` (5 transports from a config table), `highwing.js` (Caravan, ATR), `twinfighter.js`, `trainer.js`. Fuselage UVs are metric along the length. Windscreens are panels raycast onto the fuselage surface (`surfacePanel`). Cabin windows are one merged mesh with a material that glows at night.
- 2026-10-14 AI traffic uses baked models (`traffic/fleet.js`): each LOD level is merged to one mesh per material, so a plane costs about 25 draw calls close and almost none far away; beyond 160 x its length it is not drawn. Parked aircraft are added when an airport is built; airborne traffic is scripted along straight legs between airports (8 aircraft per map).
- 2026-10-14 `models.html` + `src/dev/modelViewer.js` is a developer-only model/cockpit viewer (not part of the build): `/models.html?id=jumbo&yaw=35&dist=0.5&cockpit=1&lookUp=-0.45`.

## Known bugs / limits
- Not verified on a real GPU: all browser testing uses software rendering (about 5-15 fps). A hub view is about 700 draw calls and 0.5M triangles; the frame rate on target hardware needs the user's check.
- AI traffic is decorative: no landing/takeoff circuits, no collision with the player (Phase 4 ATC will replace it).
- The simple test autopilot lands the fighters hard. A human should check approaches (F-16 at ~150 kt, AoA ~13 degrees; Corsair at ~140 kt, AoA ~8-10).
- Heavy aircraft need long runways (`minRunway`: 172 500 m up to Titan 3,300 m); only hubs have runways long enough for the jumbo.
- Free camera still not implemented. Tower view uses each airport's tower. Gamepad cannot navigate menus yet (Phase 6).
- HUD is the compact strip; the full HUD arrives in Phase 4.
- Airliner flight decks have no autopilot or FMS (Phase 4+).

## File map
- index.html, vite.config.js, models.html (dev only), .github/workflows/pages.yml
- src/main.js: boot, state machine wiring, loop, UI, pointer events
- src/core/: stateMachine, loop (fixed step), events
- src/storage/: store, settings (schema), keybinds
- src/input/: input, gamepad, flightControls
- src/flight/: units, atmosphere, aerodynamics, engine, fcs, gear, flightModel (incl. tanks/CG), world (SimWorld: wind, shear, turbulence, wetness)
- src/aircraft/data/*.js: per-aircraft data (14 files); src/aircraft/index.js: roster
- src/aircraft/models/: builders (loft/wing/fuselage/prop/fan/gear/surfacePanel), common (gear/fin/stab), airliner, highwing, twinfighter, trainer, plus the Phase 2 per-aircraft files
- src/aircraft/aircraftView.js: 3 LODs, rig animation, night windows; src/aircraft/cockpit/: instruments (canvas painters incl. nav map and fuel page), cockpit (steam, steam2, glass, fighter, airliner, trainer)
- src/world/: maps, mapBuilder (cities, airports, rivers, lakes), heightfield, noise-based terrain, terrainTiles (LOD quadtree), terrainMaterial, zones, airportLayout/airportBuilder, scenery (streaming), vegetation, buildings, roads, water, landmarks, mapWorld (physics view of the map), polyline
- src/scene/: flightScene (renderer, map load, update), environment (sun/sky/night), weather (clouds, rain, snow, fog, storms), cameras, textures
- src/traffic/: fleet (shared baked models), parked, airTraffic
- src/game/: session (one flight), startPoints (runway / final / air spawns)
- src/ui/: menus, settings, mapSelect, flightSetup (hangar), aircraftPreview, flight HUD
- src/util/: noise (Perlin), random (seeded)
- scripts/: simtest (headless flight checks), authority (pitch authority at approach), kbtest (keyboard pilot), bench-terrain, inspect-maps

## How to run, test, deploy
- Install: `npm ci` (Node 22). Dev: `npm run dev`. Build: `npm run build`. Preview: `npm run preview`.
- Physics: `node scripts/simtest.mjs [id]` (takeoff, cruise per assist level, stalls, landing, hard landing), `node scripts/kbtest.mjs [id]`, `node scripts/authority.mjs [id]`.
- Browser tests: Playwright + system Chromium with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`; `window.__flightsim` exposes state/session/settings. `startFlight({aircraftId, mapId, airportCode, endId, startMode, hour, sky})` runs a flight.
- Deploy: push to the branch; the workflow builds and publishes to Pages.

## Verification record (Phase 3)
- Headless: all 14 aircraft take off (liftoff within about 10% of the listed Vr), hold a hands-off cruise within a 40 ft altitude band (assist Light/Full), land with a sensible flare (200-450 fpm) and crash on a deliberate 2,000+ fpm arrival. Roll rates 8-20 deg/s at half stick.
- Browser (headless Chromium): every aircraft starts on a runway on the Verdant Plains and in the air/final on the other maps with no console errors; hangar, cockpit cameras and night rendering checked by screenshot.
- Numbers: map load about 5-9 s in software rendering; hub draw calls about 700 with parked traffic; build about 850 kB JS (235 kB gzip).

## Session log (newest first)
- 2026-10-14 Phase 3 finished: ten aircraft, jumbo fuel/CG model, hangar preview and spec sheet, runway-length warnings, baked AI traffic, nav-map airports, night cockpit/windows. Pushed to the branch; Pages run #10 (commit 30ebbe0) built and deployed successfully (runs #7/#8 failed only because Pages had a previous deployment still in progress; re-run or push again if that recurs).
- 2026-10-14 Phase 3 parts 1-2: maps, terrain, airports, scenery, weather.
- 2026-10-14 Phase 2 deployed and verified headless; Phase 1 deployed (Pages enabled by the user).
