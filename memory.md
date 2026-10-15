# Flight Sim: memory

## Current status
- Phase: 6 (Polish and publish) — release candidate 1.0.0-rc.1, code complete, verified headless and in the browser, Pages deploy succeeded; waiting for the user's playtest.
- Last completed: Phase 5 deployed (live). Phase 6 adds the intro and animated main menu, tabbed settings with accessibility options, keyboard and controller menu navigation, synthesized engine/wind/radio audio, adaptive resolution, an error overlay and a bug sweep.
- Next step: user playtests the release candidate on the live URL. If it passes, the project is done (Definition of done, section 13 of the master prompt); otherwise fix what the playtest finds.
- Live playtest / release URL: https://coder-4847.github.io/Flightsim/

## What to test in this build (Phase 6, release candidate)
Everything from Phases 1-5 still applies (see git history for the earlier checklists). New:
1. Intro: the title plays for about 3 s on every page load; any key, click or controller button skips it. Then the animated main menu (sunset sky, drifting clouds, four mountain layers, an airliner with a contrail now and then). Buttons: Fly, Continue as <pilot> (when a pilot exists), Settings, Controls (opens the bindings), How to play and about, Fullscreen.
2. Settings is now tabbed: Gameplay, Display, Audio, Controls, Accessibility, Data. Controls has the controller sliders and a filterable binding table with a reset button per action. Data has Pilots and saves, Reset settings and Erase all game data (asks twice).
3. Accessibility: Text and menu size (Normal, Large, Extra large; scales menus and the HUD), High contrast, Colour-blind friendly colours (blue/yellow/orange instead of red/green; also the instruments), Radio subtitles on/off, Reduce motion (also stops the menu animation, blinking warnings and transitions; it defaults to your operating system's setting).
4. Menus without a mouse: arrow keys or D-pad/left stick move to the nearest control, Enter/Space or A selects, Esc or B goes back, Start presses the primary button (Resume on the pause screen), Left/Right on a slider changes it. Works on every screen, the debrief and the crash card. A small hint bar appears when a controller is in use.
5. Audio (click once first; browsers need a gesture): engines per aircraft type (piston, turboprop, turbofan, afterburner), airflow that grows with speed, tyre rumble, flap/gear motors, stall buffet, touchdown chirp and crash. Cockpit camera muffles everything. Radio blips and squelch on ATC messages. Volumes in Settings > Audio: master, engines and wind, radio and call-outs, warnings, menu clicks. Pausing silences the engines.
6. Graphics quality Auto (default) lowers the render resolution when the frame rate drops below about 44 fps and raises it again; the FPS counter shows the current resolution percentage. Low/Medium/High are fixed.
7. If anything throws, an overlay offers Reload, Back to the menu or Dismiss (the flight pauses first). If the browser blocks storage, pilots work for the session and the game says so.
8. Console should be clean.

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

- 2026-10-14 Modes: a mode is a set of `sys_*` settings (`game/modes.js`). Presets write all of them; changing one by hand sets the preset to Custom. `sys_realism` picks the flight assist at flight start (arcade full, standard light, full sim off). `damage` off disables overspeed, over-g, hard-landing and scrape destruction but not terrain impact. `fullWeather` off scales turbulence, shear and wetness down (`SimWorld.setRealism`).
- 2026-10-14 FlightControls owns throttle levers (master or per engine), automatic flaps (speed schedule with a latch so a level base leg does not flap) and automatic gear (up after takeoff, down on approach). The HUD levers and buttons call `setEngine`, `setMaster`, `setFlaps` and `perform(action)`.
- 2026-10-14 Systems (`flight/systems.js`): generators, APU, battery, hydraulics, pitot ice, control jam, fuel leak, fire timers. Failures come from `game/failures.js` (seeded random scheduler or `trigger`). Hydraulic loss: heavy controls, no gear or flap movement, weak brakes, no nosewheel steering; emergency gear extension still works. Telemetry `ias` is the displayed airspeed (affected by pitot ice); `iasTrue` is the real one and is what automation uses.
- 2026-10-14 Fuel handling: tanks have pumps; crossfeed lets any tank feed any engine; dump drains the fullest tanks down to landing weight (`spec.fuelDump`, kg/s). Piston mixture and propeller lever change power, thrust and fuel flow (`Engine.bestMixture`).
- 2026-10-14 ATC (`src/atc/`): `controller.js` is the player's state machine (phases parked, taxi, hold, lineup, rolling, departure, enroute, approach, final, rollout, taxi_in); requests come from a context menu of standard phrases, replies are built from the phraseology helpers with a short delay, and time follows model time (pausing stops it). The active runway is the best headwind end of the main runway (or the one you start on). Towered airports (hub, regional) give clearances; airfields and strips are uncontrolled (CTAF style). Approach vectors: heading to the initial approach fix, an intercept heading, "cleared approach, report established", then tower. Traffic advisories use scripted and AI aircraft. `aiTraffic.js` runs AI departures and arrivals with taxi paths from `geometry.js`, a runway occupancy check and go-arounds.
- 2026-10-14 Hub runway pairs: the main runway now sits 240 m left of the airport centre and the parallel 240 m right (it used to be centred on the terminal by mistake).
- 2026-10-14 HUD (`ui/flightHud.js`, `ui/hud/*`): draggable panels (`PanelManager`), shared tooltips, canvas panels reuse the cockpit painters. Panel hotkeys are on function keys because digits belong to the radio menu while it is open. `approachGuide.js` finds the runway you are lined up for and works without an ILS. `warnings.js` lists conditions; the HUD adds hold times, audio and the "red hides info" rule.

- 2026-10-14 Phase 5 structure: `src/progress/` (saves, catalog) and `src/modes/` (economy, tracker, missions, vip, emergency, freeflight, contract, runner). `ModeRunner` attaches a `FlightTracker` to a running session, forwards physics events and 10 Hz telemetry to the active mode, and `bank()` applies money and statistics to the active save then autosaves. Modes: `FreeFlightMode`, `ContractMode` (Career and VIP), `EmergencyMode`. UI lives in `ui/modeSelect, savesScreen, shopScreen, contractScreen, emergencyScreen, debrief, pilotBar, hud/missionPanel`.
- 2026-10-14 Quick Flight stays ungated and unsaved; gating (owned aircraft, upgrades) only applies in the save-based modes. Career, Emergency and VIP aircraft are loaned (no ownership needed). HUD gating is `PanelManager.lock(id, reason)`; the Terrain upgrade gates warnings via `evaluate(..., {gpws})`.
- 2026-10-14 Economy (credits, cr): start 10,000. Free Flight = paid km (min(track, 1.5 x straight + 15 km)) x rate + load revenue (pax x km x rate, or kg x km x rate) scaled by touchdown grade + landing fee x grade share + sights x (200 + 6 x rate), then the realism multiplier (arcade 1.0, custom 1.1, simulation 1.3). Contracts pay about twice the free-flight rate plus a tier bonus. Crash = no pay plus a repair bill (2 percent of the aircraft price, 250-25,000 cr; contracts 60 percent of that); insurance cuts it by 75 percent. Money never goes below zero.
- 2026-10-14 Landing grades (physics): Smooth under 150 ft/min, Good under 300, Firm under 500, Hard, Very hard. The tracker takes the worst touchdown within one landing (bounces count). A landing is complete when the aircraft is on the ground, under 5 kt for 2 s; a gear-up belly slide counts as a Hard landing. A flight leg starts at lift-off (or at the start if airborne).
- 2026-10-14 Missions are data in `missions.js`; airports are named by code (fixed-seed maps, validated by `modetest`). Time goal = about 1.35 x the estimated duration; hard deadline about 1.7 x; frugal goal = about 1.2 x the estimated burn (cruise burn table measured on the flight model); start fuel is the aircraft's usual load or 1.5 x the estimate plus a reserve (tight-fuel missions get 1.25 x plus 15 minutes).
- 2026-10-14 Emergency scenarios come from `generateScenario(seed)`: `Rng(seed)` picks difficulty (1-3), aircraft (mostly the tier's own pool), map, a suitable target airport (longest runway >= 1.05 x `minRunway`), failures (count 1/1-2/2-3, staggered 20-50 s) and the spawn: engine-out singles are placed within about 0.28-0.5 x glide range, others 12-38 km out; weather and time from the seed. Random failures are off in scripted flights (`options.scripted`). Failures are triggered by the mode with explicit engine/axis so the same seed repeats exactly.
- 2026-10-14 VIP comfort: loss per second from turbulence (|nz - 1| above 0.2 g), hard pulls (above 0.5 g, steeper), bank over 28 degrees, pitch rate over 5 deg/s, roll rate over 12 deg/s, descent faster than 2,200 fpm, climbs over 4,500 fpm, stall warning/stall, overspeed; recovery 0.35/s; touchdown knocks Firm 12, Hard 30, Very hard 60. Weather alone costs almost nothing (checked at 4 minutes in every sky). The cabin pack scales losses by 0.75.
- 2026-10-14 Saves: localStorage keys `flightsim:save:1..3` and `flightsim:activeSlot`, version 1, `sanitizeSave` repairs or rejects anything imported. Export files contain `{game:'flightsim', ...save}`.

- 2026-10-15 Phase 6: menu navigation is `ui/navigation.js` (spatial focus search over focusable elements inside the active screen, the crash card or the error overlay; polled on a 33 ms timer, not per frame, so it works when the 3D view is slow; while a menu owns the controller `Input.uiCapture` keeps buttons from reaching the aircraft). Audio is one shared `AudioContext` (`audio/audioBus.js`) with fx/voice/alert/ui buses driven by the volume settings; `EngineSound` rebuilds its voices per flight; everything is synthesized (oscillators, looped white/brown noise, filters). UI scale uses CSS `zoom` on `.screen` with `--ui-zoom` and `--vh = 100dvh / zoom` for heights; the HUD multiplies its own scale by the text size. Colour-blind mode swaps CSS variables (`--good`, `--warn`, `--danger`) and the canvas instrument `COLORS`.
- 2026-10-15 Menu backdrop is a 2D canvas (`ui/menuBackground.js`, 30 fps, one still frame with Reduce motion), moving only on the main menu. Adaptive resolution (`scene/adaptiveQuality.js`) scales the pixel ratio between 0.55 and 1 of its maximum in steps with cooldowns. `Terrain.update` skips the quadtree selection while nothing is pending and the camera moved under 20 m horizontally / 12 m vertically.
- 2026-10-15 Aircraft GPU resources are released when a flight ends (`aircraft/dispose.js`; textures marked `userData.shared` are kept). Checked over six start/quit cycles: texture and geometry counts stay flat.

## Known bugs / limits
- Not verified on a real GPU: all browser testing uses software rendering (about 5-15 fps). A hub view is about 700 draw calls and 0.5M triangles; the frame rate on target hardware needs the user's check.
- AI traffic is decorative: no landing/takeoff circuits, no collision with the player (Phase 4 ATC will replace it).
- The simple test autopilot lands the fighters hard. A human should check approaches (F-16 at ~150 kt, AoA ~13 degrees; Corsair at ~140 kt, AoA ~8-10).
- Heavy aircraft need long runways (`minRunway`: 172 500 m up to Titan 3,300 m); only hubs have runways long enough for the jumbo.
- Headless software rendering runs the hub scene at about 1 fps (0.5M triangles), so all automated checks drive the simulation directly instead of relying on frame timing.
- ATC taxi guidance is text only: the player picks their own taxi route, the tower detects the hold-short point. AI aircraft do not use taxiways beyond the generated path and do not give way to the player on the ground.
- Cross runways have no taxiway connectors; AI and the hold-short point fall back to a straight line there.
- No autopilot or FMS; vectors are given by heading and altitude only.
- Free camera still not implemented. Tower view uses each airport's tower.
- Audio is synthesized and tuned by reasoning, not by ear on real speakers: levels may need a nudge (Settings > Audio). The ATC voice uses the browser's speech synthesis and so depends on the installed voices.
- Frame rate on a real GPU is still unmeasured; Auto quality is the safety net. Touch screens are not supported.
- Free Flight payloads are only for pay: passengers and cargo do not change the aircraft's weight.
- Emergency scenarios are not guaranteed survivable at the highest difficulty (it is the player's job); only engine-out singles are placed within glide range.
- Locking a panel (map, approach) closes it and the closed state is remembered for later Quick Flights.

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
- src/traffic/: fleet (shared baked models, gear-up variants), parked, airTraffic
- src/atc/: controller (player ATC), aiTraffic (AI departures and arrivals), geometry (runways, taxi routes), phraseology (spoken numbers and callsigns), voice (speech synthesis)
- src/game/: session, startPoints (incl. gate), modes (presets and toggles), failures, checklists, warnings, approachGuide
- src/audio/: audioBus (shared context, buses, one-shot sounds), engineSound (engines, wind, tyres, servos), alerts (warning sounds and call-outs)
- src/progress/: saves (slots, export/import, purchases), catalog (prices, economy table, liveries, upgrades)
- src/modes/: economy (pure pay arithmetic), tracker (takeoff/touchdown/landed/sights), missions (37 career contracts), vip (contracts, comfort meter), emergency (seeded scenarios, scoring), freeflight, contract (career + VIP), runner
- src/flight/systems.js: electrics, APU, hydraulics, pitot, jam, leak, fire, dump
- src/game/: session (one flight), startPoints (runway / final / air spawns)
- src/ui/: menus (mainMenu, intro, menuBackground, aboutScreen), navigation (keyboard and controller focus), errorOverlay, settings (tabbed), mapSelect, flightSetup (hangar, paint, ownership), aircraftPreview, flightHud, hud/ (panels, radio, engines, controls, systems, checklist, instrument panels, pad menu, mission panel), modeSelect, savesScreen, shopScreen, contractScreen, emergencyScreen, debrief, pilotBar
- src/util/: noise (Perlin), random (seeded)
- scripts/: simtest (headless flight checks), authority (pitch authority at approach), kbtest (keyboard pilot), modetest (Phase 5), bench-terrain, inspect-maps

## How to run, test, deploy
- Install: `npm ci` (Node 22). Dev: `npm run dev`. Build: `npm run build`. Preview: `npm run preview`.
- Phase 6 checks are Playwright scripts kept out of the repo (menu navigation with a fake gamepad, audio level via an analyser tap `__flightsim.audio.level()`, all-aircraft console sweep, memory/leak cycle, CPU profile of update/render). `window.__flightsim` also exposes `audio` and `engineSound`.
- Phase 5: `node scripts/modetest.mjs` (catalogue, saves, economy, all 37 missions and 10 VIP contracts resolve, 300 emergency seeds repeat, scripted landings through Free Flight, Career, Emergency, VIP and a full takeoff-to-landing leg). `DEBUG=1` prints a trace.
- Physics: `node scripts/simtest.mjs [id]` (takeoff, cruise per assist level, stalls, landing, hard landing), `node scripts/kbtest.mjs [id]`, `node scripts/authority.mjs [id]`.
- Browser tests: Playwright + system Chromium with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`; `window.__flightsim` exposes state/session/settings. `startFlight({aircraftId, mapId, airportCode, endId, startMode, hour, sky})` runs a flight.
- Deploy: push to the branch; the workflow builds and publishes to Pages.

## Verification record (Phase 3)
- Headless: all 14 aircraft take off (liftoff within about 10% of the listed Vr), hold a hands-off cruise within a 40 ft altitude band (assist Light/Full), land with a sensible flare (200-450 fpm) and crash on a deliberate 2,000+ fpm arrival. Roll rates 8-20 deg/s at half stick.
- Browser (headless Chromium): every aircraft starts on a runway on the Verdant Plains and in the air/final on the other maps with no console errors; hangar, cockpit cameras and night rendering checked by screenshot.
- Numbers: map load about 5-9 s in software rendering; hub draw calls about 700 with parked traffic; build about 850 kB JS (235 kB gzip).

## Verification record (Phase 4)
- Headless: mode presets and toggles, auto flaps and gear through a takeoff and approach, failure effects for all ten failure types, a full ATC flight (gate, clearance, taxi, takeoff, departure handoff, approach vectors, landing clearance, landing, taxi to parking), mayday, radio failure, uncontrolled approach, AI departures and arrivals at a hub, regional and airfield, keyboard takeoffs in arcade and simulation.
- Browser (headless Chromium): setup screen mode controls, radio keys, dragging an engine lever, flap and gear buttons, failure warnings and emergency checklist, pad menu, H to hide, with no console errors.

## Verification record (Phase 5)
- Headless (`scripts/modetest.mjs`): catalogue/liveries, save slots (create, reload, purchases persist, export/import, repair of bad data), economy ordering (smooth beats hard, circling does not pay, VIP tiers fall 100/80/55/25/0), 37 missions resolve with valid airports, runway lengths, fuel and fair deadlines, 10 VIP contracts, 300 seeds deterministic with spawns above terrain and engine-out singles within glide, sightseeing, deadline failure, and scripted landings paid through each mode including a whole VPAS to VPLA leg with takeoff detection.
- Browser (headless Chromium, scripted pilot driving the real UI): create a pilot, Free Flight with locked aircraft, full leg and Debrief, "Continue flying", upgrade gating toast, pause autosave, Quick Flight unlocked, Career c01 (3 stars, 780 cr, next mission unlocked and preselected), crash in a mission (repair bill on the crash card), Emergency seed repeat (same failures at the same times after Retry), Emergency success debrief (grade A, best score stored), VIP comfort bar and escort payout, shop purchases (upgrade, livery), export/import, reload persistence; no console errors.

## Verification record (Phase 6)
- Browser (headless Chromium): intro and menu screenshots, tabbed settings with Extra large text + high contrast + colour-blind on, menu navigation by arrow keys and by a fake gamepad (D-pad, A, B, Start; slider adjust; pause screen; crash card), audio graph produces signal for piston/turboprop/turbofan/afterburner and is silent when paused or when the effects volume is 0, all 14 aircraft started on rotating maps, start modes, presets and skies with panels, cameras and pause exercised and no console errors, six start/quit cycles with flat GPU memory, storage-blocked browser still works, Phase 5 flows re-run (Free Flight leg, Career c01, Emergency, VIP) with no regressions.
- CPU (software GL, so pessimistic): physics 0.05 ms per 120 Hz step, world update about 3 ms, render submit 5-9 ms per frame at 300-500 draw calls.

## Session log (newest first)
- 2026-10-15 Phase 6 finished (release candidate 1.0.0-rc.1): intro, animated menu, tabbed settings, accessibility, menu navigation, audio, adaptive resolution, error overlay, GPU memory fix, HUD default layout fixes. Pushed; Pages run #19 (commit a584f62) deployed successfully. Release URL: https://coder-4847.github.io/Flightsim/
- 2026-10-14 Phase 5 finished: saves, catalogue, economy, tracker, missions, VIP, emergency, mode runner and all screens. Pushed; Pages run #17 (commit ec928a8) deployed successfully.
- 2026-10-14 Phase 4 finished: modes and toggles, systems and failures, ATC and AI traffic, HUD panels, controller menu, alerts; hub runway pair fix. Pushed; Pages run #15 (commit 39cfb54) deployed successfully.
- 2026-10-14 Phase 3 finished: ten aircraft, jumbo fuel/CG model, hangar preview and spec sheet, runway-length warnings, baked AI traffic, nav-map airports, night cockpit/windows. Pushed to the branch; Pages run #10 (commit 30ebbe0) built and deployed successfully (runs #7/#8 failed only because Pages had a previous deployment still in progress; re-run or push again if that recurs).
- 2026-10-14 Phase 3 parts 1-2: maps, terrain, airports, scenery, weather.
- 2026-10-14 Phase 2 deployed and verified headless; Phase 1 deployed (Pages enabled by the user).
