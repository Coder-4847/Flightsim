# Flight Sim

A browser-based 3D flight simulator built with Three.js and Vite. It runs as a static site with no backend. Everything (aircraft, terrain, textures, instruments) is generated in code.

Live build: https://coder-4847.github.io/Flightsim/

Project status, decisions and the file map live in [`memory.md`](memory.md).

Release candidate 1.0.0-rc.3. Highlights: three generated 60 km maps (grasslands, desert, snow) with 11-13 airports each, 14 flyable aircraft (chase, cinematic and tower cameras), an autopilot with approach mode, time compression up to 16x, a full-screen chart with waypoints, crash sequences, weather and day/night, arcade / simulation / custom modes, ATC with AI airport traffic, failures and checklists, a full mouse- and controller-operable HUD, and the game modes: Quick Flight, Free Flight, a 37-mission Career, seeded Emergency Landing scenarios and VIP Escort, with an economy (one aircraft of every category unlocked from the start, the rest bought; liveries, pilot perks and per-aircraft upgrades (6 tracks x 5 levels for each of the 14 aircraft: engine, drag, weight, controls, gear and brakes, fuel economy); a short hop in the starter plane pays about 3,000 cr, big aircraft on long flights 15,000+), three save slots and JSON export/import. Full keyboard, mouse, controller and touch (phone and tablet) control (menus included), complete remapping, synthesized audio, accessibility options (text size, high contrast, colour-blind colours, subtitles, reduced motion) and adaptive resolution.

```
npm ci
npm run dev                     # local dev server
npm run build                   # static bundle in dist/
node scripts/simtest.mjs        # headless flight-model checks (all aircraft, or pass an id)
node scripts/kbtest.mjs         # keyboard-pilot takeoff check
node scripts/modetest.mjs       # economy, saves, aircraft upgrades, missions, VIP, seeded emergencies and full mode flows
node scripts/tuningtest.mjs     # every aircraft stock vs fully upgraded (take-off, climb, top speed, roll, brakes)
```

Developer tools: `npm run dev`, then open `/models.html?id=jumbo&yaw=35` to inspect an aircraft model.
