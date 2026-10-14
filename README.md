# Flight Sim

A browser-based 3D flight simulator built with Three.js and Vite. It runs as a static site with no backend. Everything (aircraft, terrain, textures, instruments) is generated in code.

Live build: https://coder-4847.github.io/Flightsim/

Project status, decisions and the file map live in [`memory.md`](memory.md).

Current build (Phase 5): three generated 120 km maps (grasslands, desert, snow) with 11-13 airports each, 14 flyable aircraft with cockpits, weather and day/night, arcade / simulation / custom modes, ATC with AI airport traffic, failures and checklists, a full mouse- and controller-operable HUD, and the game modes: Quick Flight, Free Flight, a 37-mission Career, seeded Emergency Landing scenarios and VIP Escort, with an economy (aircraft, liveries and upgrades), three save slots and JSON export/import.

```
npm ci
npm run dev                     # local dev server
npm run build                   # static bundle in dist/
node scripts/simtest.mjs        # headless flight-model checks (all aircraft, or pass an id)
node scripts/kbtest.mjs         # keyboard-pilot takeoff check
node scripts/modetest.mjs       # economy, saves, missions, VIP, seeded emergencies and full mode flows
```

Developer tools: `npm run dev`, then open `/models.html?id=jumbo&yaw=35&cockpit=0` to inspect an aircraft model or cockpit.
