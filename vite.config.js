import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// A short commit id and the build date, shown beside the version so it is obvious which build a browser is running.
let commit = 'dev';
try { commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a git checkout */ }
const build = `${commit} ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;

// Relative base so the same bundle works on GitHub Pages project sites
// (https://<user>.github.io/<repo>/) and when opened from any static host.
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(`${pkg.version} (${build})`) },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
