# Flight Sim: memory

## Current status
- Phase: 2 (Flight model and first aircraft) — code complete, verification + playtest deploy in progress (see Session log)
- Last completed: Phase 1 deployed (Pages enabled by user, workflow green). Phase 2 built: 6-DOF flight model, 4 aircraft (models + cockpits + data), keyboard/mouse/gamepad controls, chase/cockpit/cinematic/tower cameras, flight HUD, aircraft select, crash/touchdown reporting.
- Next step: user playtests Phase 2 on the live URL. Then Phase 3 (maps, terrain generator, remaining aircraft, weather/day-night, traffic). Do NOT start Phase 3 until Phase 2's deploy is live and passes.
- Live playtest URL: https://coder-4847.github.io/Flightsim/

## What to test in this build (Phase 2)
1. Main menu > Start flying > pick an aircraft and a start (On the runway / Final approach / In flight) > Fly.
2. Takeoff (Skyhawk): the parking brake starts released (B toggles it); hold Shift for full throttle, keep it straight with Q/E, at ~55 kt pull S gently (keys act like a stick: tap/hold), climb out. Flaps F/V, gear G (retractable aircraft), trim PageUp/PageDown.
3. Stalls: throttle idle, pull back. The HUD shows STALL; the nose drops and a wing may drop with assist Off/Light. Assist Full has stall protection. Cycle assist with J.
4. Landing: use "Final approach". Touchdown report shows sink rate and grade (Smooth/Good/Firm/Hard/Very hard). Very hard or over the structural sink rate crashes (overlay offers Restart/Choose aircraft/Menu; Enter restarts).
5. Cameras: C cycles chase > cockpit > cinematic > tower. Chase: drag to orbit, scroll to zoom. Cockpit: drag to look (snaps back), click to capture the mouse for persistent look, Esc releases. Cockpit instruments are live canvases.
6. Controller: plug in a pad (standard mapping). Left stick pitch/roll, right stick X rudder / Y look, RT/LT throttle, Y gear, X brakes, D-pad down/up flaps, RB camera, Start pause. Dead zone/curve/invert are in Settings > Controller; buttons are rebindable in Settings > Controls.
7. Wind (Settings > Game > Wind) applies to the next flight: try Crosswind on final approach.
8. F-16 style fighter: fly-by-wire (stick commands g and roll rate). Throttle past ~85% lights the afterburner. It lands fast (~150 kt); tail strikes above ~14 degrees pitch.
9. Console should be clean.

## Decisions
- 2026-10-14 Plain JavaScript (ES modules), no TypeScript.
- 2026-10-14 Three.js WebGL2 only.
- 2026-10-14 Vite `base: './'` so the bundle works from any Pages project path.
- 2026-10-14 Pushes go to the session's designated branch `ccr-1a1faa50-o7g7vk` (the repo's only/default branch). The Pages workflow triggers on it plus main/master.
- 2026-10-14 World coordinates: +X east, +Y up, -Z north, metres. Heading 0 = north (-Z), 90 = east. Body frame: +X nose, +Y up, +Z right wing, origin at the CG. Runway 18/36 lies along Z at the origin (36 = south threshold z=+1200, flying north).
- 2026-10-14 Key defaults: W = pitch down (stick forward), S = pitch up; arrows are secondary. Everything is remappable (keyboard and gamepad buttons).
- 2026-10-14 Settings are a flat schema (`SETTINGS_SCHEMA`); the settings UI is generated from it.
- 2026-10-14 Physics runs at a fixed 120 Hz with render interpolation (`FlightModel.samplePose`).
- 2026-10-14 Stall speeds in the aircraft data (KCAS at `mass.ref`) calibrate CLmax per flap stage; the lift-curve blend centre is solved so the CL peak equals CLmax (`calibrateStall`). Lift slope comes from Helmbold with a Mach correction.
- 2026-10-14 Control law: `flightAssist` setting (off/light/full), separate from the Phase 4 arcade/sim presets which will fold it in. Fighters use fly-by-wire regardless (neutral stick holds flight path; protections disabled when assist is Off).
- 2026-10-14 Prop aircraft get slipstream over the tail (`aero.propwash`) so rudder/elevator work at low speed with power. Small prop torque/yaw effects (`propTorque`, `propYaw`) are scaled down so hands-off flight does not spiral.
- 2026-10-14 Airborne starts are solved to equilibrium (throttle bisection and elevator trim, including engine thrust-line moment and tail slipstream).
- 2026-10-14 Landing grades by sink rate: <150 fpm Smooth, <300 Good, <500 Firm, then Hard up to the aircraft's `hardLanding`, Very hard above. `crashLanding` or airframe strike at speed ends the flight. Overspeed (accumulating past Vne) and over-g (>1.45x limit) cause structural failure.
- 2026-10-14 Gear cannot be raised with weight on wheels (squat switch). Gear/ground uses spring-damper struts sized from mass; airframe strike points (tail, wingtips, belly, props) collide with the ground.
- 2026-10-14 Terrain physics uses the same analytic height function as the mesh but the mesh is a 100 m grid, so they can differ slightly in hills (flat near the airfield). Phase 3 replaces both.
- 2026-10-14 Cockpits are built lazily on first use and hide the exterior fuselage skin and glass while active. Instruments are canvas textures redrawn at 20 Hz.
- 2026-10-14 Right stick X is both rudder and (mouse-less) look would conflict, so the pad's right stick Y is camera look; horizontal head look uses the mouse.
- 2026-10-14 Phase 2 "basic cockpit for each" is delivered as full instrument panels (steam gauges, glass PFD/MFD/engine display, HUD) plus animated yokes/sticks and throttle levers. Detail passes can come in Phase 6.

## Known bugs
- Not verified on a real GPU: all browser testing here uses software rendering (about 5-15 fps). Frame rate on target hardware needs the user's check (Settings > FPS counter).
- Free camera not yet implemented (planned with Phase 3). Tower view uses the demo tower position.
- Gamepad cannot navigate the menus yet (Phase 6 controller UX); start the flight with the mouse, then fly with the pad.
- Fighter landings are demanding: the test autopilot used here sank too fast; a human should check the approach feels right (AoA ~13 degrees at ~150 kt).
- HUD is the compact Phase 2 strip; the full HUD arrives in Phase 4.

## File map
- index.html, vite.config.js, .github/workflows/pages.yml: shell, build config, Pages deploy
- src/main.js: boot, state machine wiring, loop, UI, pointer events
- src/core/: stateMachine, loop (fixed step), events
- src/storage/: store (guarded localStorage), settings (schema), keybinds (actions, defaults, import/export)
- src/input/: input (keyboard + pad -> actions), gamepad (Gamepad API, deadzone/curve), flightControls (actions -> flight controls)
- src/flight/: units, atmosphere (ISA), aerodynamics (lift/drag/stall/ground effect), engine (piston/turboprop/turbofan+AB), fcs (assist and fly-by-wire), gear (struts, brakes, strike points), flightModel (6-DOF integrator, trim, damage), world (ground/surface/wind interface)
- src/aircraft/data/*.js: per-aircraft data (mass, aero, flaps, gear, engines, limits, livery, cockpit eye)
- src/aircraft/index.js: roster
- src/aircraft/models/: builders (loft/wing/fuselage/prop/gear kit), common (gear/fin/stab assemblies), one file per aircraft
- src/aircraft/aircraftView.js: LOD x3, rig animation (surfaces, gear, props, fans, afterburner, lights), cockpit toggle
- src/aircraft/cockpit/: instruments (canvas painters), cockpit (4 cockpit builders)
- src/scene/: flightScene (sky/terrain/airfield/world), cameras (chase/cockpit/cinematic/tower), textures
- src/game/session.js: one flight (model + controls + view + cameras), start modes
- src/ui/: menus, settings (incl. key + pad rebinding), aircraft select, flight HUD, fps HUD
- scripts/simtest.mjs: headless flight-model checks (`node scripts/simtest.mjs [aircraftId]`)

## How to run, test, deploy
- Install: `npm ci` (Node 22). Dev: `npm run dev`. Build: `npm run build`. Preview: `npm run preview`.
- Physics tests: `node scripts/simtest.mjs` (takeoff, hands-off cruise per assist level, stalls, landing, hard landing, per aircraft).
- Browser tests: Playwright + system Chromium with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`; `window.__flightsim` exposes state/session/settings for scripts.
- Deploy: push to the branch; the workflow builds and publishes to Pages (Pages source is set to GitHub Actions).

## Session log (newest first)
- 2026-10-14 Phase 2 implemented. Headless flight tests pass for all four aircraft; browser flows verified in headless Chromium (no console errors). See commit history.
- 2026-10-14 Phase 1 deployed: Pages enabled by the user, workflow run succeeded (build, configure-pages, upload, deploy). Live page could not be loaded from the agent sandbox (github.io blocked), user to confirm.
