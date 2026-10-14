# Flight Sim

A browser-based 3D flight simulator built with Three.js and Vite. It runs as a static site with no backend. Everything (aircraft, terrain, textures, instruments) is generated in code.

Live build: https://coder-4847.github.io/Flightsim/

Project status, decisions and the file map live in [`memory.md`](memory.md).

```
npm ci
npm run dev                     # local dev server
npm run build                   # static bundle in dist/
node scripts/simtest.mjs        # headless flight-model checks
```
