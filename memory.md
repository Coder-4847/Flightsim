# Flight Sim: memory

## Current status
- Phase: 1 (Foundation) — code complete, awaiting playtest deploy confirmation
- Last completed: Vite + Three.js project, Pages workflow, state machine (menu/loading/flying/paused), fixed-step game loop, settings + keybind storage, menu shell, settings screen with key rebinding, pause menu, demo airfield scene. Verified locally in headless Chromium with zero console errors.
- Next step: confirm the Pages deploy is live and loads with no console errors; user playtests Phase 1. Then Phase 2 (flight model, controls, first four aircraft, chase + cockpit cameras).
- Live playtest URL: https://coder-4847.github.io/Flightsim/ (requires Settings > Pages > Source = "GitHub Actions" to be enabled once on the repo)

## What to test in this build (Phase 1)
- Main menu loads; "Start flying" shows a loading bar, then the demo airfield (runway 18/36, apron, hangars, tower, windsock, rolling hills).
- Drag with the mouse to orbit the camera, scroll to zoom. Camera auto-orbits slowly after ~4 s idle (disabled by "Reduce motion").
- Esc or P pauses (also auto-pauses when the tab is hidden). Pause menu: Resume, Settings, Quit to menu.
- Settings (from main menu or pause): game mode preset, graphics quality, FPS counter (live), HUD scale/opacity, master volume, reduce motion. All persist across reloads.
- Keyboard controls: click a key slot, press a new key (Esc cancels, Backspace clears). Conflicts are reassigned with a notice. Reset / Export / Import work. Persists across reloads.
- Browser console should be clean.

## Decisions
- 2026-10-14 Plain JavaScript (ES modules), no TypeScript: keeps the build simple and fast; JSDoc comments where types matter.
- 2026-10-14 Three.js WebGL2 only; WebGPU skipped (not needed to ship).
- 2026-10-14 Vite `base: './'` so the bundle works from any Pages project path.
- 2026-10-14 Pushes go to the session's designated branch `ccr-1a1faa50-o7g7vk` (the repo was empty, so it is the first/default branch). The Pages workflow triggers on it plus main/master. If the default branch is renamed to `main`, no workflow change is needed.
- 2026-10-14 World coordinates: +X east, +Y up, -Z north, metres. Heading 0 = north (-Z), 90 = east.
- 2026-10-14 Key defaults: W = pitch down (stick forward), S = pitch up; arrow keys are secondary bindings. Everything is remappable.
- 2026-10-14 Settings are a flat schema (`SETTINGS_SCHEMA` in `src/storage/settings.js`); the settings UI is generated from it. Customizable-mode toggles (Phase 4) will extend it.
- 2026-10-14 Keybind storage already holds keyboard/mouse/gamepad lists per action; only keyboard is editable in the UI until controller support lands in Phase 2.
- 2026-10-14 Textures are canvas-generated and seeded (no `Math.random`) so every load is identical. Runway texture is capped at 4096 px on its long axis for mobile GPUs.
- 2026-10-14 `window.__flightsim` exposes state/settings/bindings/scene for debugging and automated playtests.

## Known bugs
- None known. Scene is intentionally bare (no aircraft yet, no shadows).

## File map
- index.html: page shell (canvas `#view`, UI root `#ui`, inline SVG favicon so no favicon 404)
- vite.config.js: Vite config (relative base)
- .github/workflows/pages.yml: build + deploy to GitHub Pages on push
- src/main.js: boot, wiring of services/UI/state/loop/pointer events, settings -> live effects
- src/core/stateMachine.js: GameState (menu/loading/flying/paused) with validated transitions
- src/core/loop.js: fixed-timestep update + per-frame render loop
- src/core/events.js: tiny event emitter
- src/storage/store.js: guarded localStorage helpers
- src/storage/settings.js: settings schema, validation, persistence
- src/storage/keybinds.js: action table, default bindings, conflict handling, import/export
- src/input/input.js: keyboard -> action layer (press/release events, isDown, axis)
- src/scene/flightScene.js: renderer, sky dome, terrain, runway, airfield, demo orbit camera
- src/scene/textures.js: canvas-generated textures (ground, runway, apron)
- src/util/noise.js: seeded value noise / fBm (reused by terrain in Phase 3)
- src/ui/*.js: DOM helper (`h`), screen manager, main/loading/pause screens, settings screen, HUD
- src/style.css: all styling (dark palette, single cyan accent)

## How to run, test, deploy
- Install: `npm ci` (Node 22). Dev server: `npm run dev`. Production build: `npm run build` (output `dist/`). Preview: `npm run preview`.
- Test: no unit tests yet. Playtest flow is exercised with Playwright against `npm run preview` (headless Chromium needs `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`). Software rendering is slow (~6 fps), so FPS numbers there are meaningless.
- Deploy: push to the branch; the workflow builds and publishes to Pages. One-time repo setting: Settings > Pages > Build and deployment > Source = GitHub Actions.

## Session log (newest first)
- 2026-10-14 Phase 1 implemented and verified locally (menu -> loading -> flying -> pause -> settings -> quit, persistence, zero console errors).
