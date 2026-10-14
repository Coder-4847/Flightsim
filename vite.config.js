import { defineConfig } from 'vite';

// Relative base so the same bundle works on GitHub Pages project sites
// (https://<user>.github.io/<repo>/) and when opened from any static host.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
});
