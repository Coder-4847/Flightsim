// See-through / inside-out check for the aircraft models (needs the dev server: `npx vite --port 5199 --host 127.0.0.1`).
//
//   node scripts/seethrough.mjs <aircraftId|all> [distance] [outDir]
//
// Each view of /models.html is rendered twice on a magenta background: as it is, then with every material forced to
// DoubleSide. A pixel that is background in the first image and covered in the second is a see-through hole (a face wound
// the wrong way or missing); a large colour change on pixels covered in both means a part is inside-out. Per view it prints
// the hole count and the inside-out count and writes an overlay PNG (yellow = hole, red = inside-out) to outDir.
// Glass, propeller discs and open nozzle liners are double-sided or open on purpose and show up as small counts.
// Playwright is not a dependency of the repo: set PLAYWRIGHT_MODULE to its index.mjs (default: the preinstalled one).
import fs from 'node:fs';
import path from 'node:path';

const pw = await import(process.env.PLAYWRIGHT_MODULE ?? '/opt/node-tools/node_modules/playwright/index.mjs');
const LENGTH = { cessna172: 8.3, caravan: 11.5, kingair: 13.3, citation: 15.5, turboprop72: 27.2, trainer: 12.1, fighter: 15, hornet: 17.1, heavyfighter: 21.9, regional: 31.7, narrowbody: 37.6, bizjet: 30.4, jumbo: 70.7, widebody: 73.9 };
const [idArg = 'all', distArg, outArg] = process.argv.slice(2);
const out = outArg ?? path.join(process.env.TMPDIR ?? '/tmp', 'seethrough');
fs.mkdirSync(out, { recursive: true });
const ids = idArg === 'all' ? Object.keys(LENGTH) : [idArg];
const VIEWS = [[0, 0], [45, 10], [90, 0], [135, -10], [180, 0], [225, 25], [0, 89], [0, -89], [300, -30], [20, -20]]; // [yaw, pitch]
const base = `http://127.0.0.1:${process.env.PORT ?? 5199}`;

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const cmp = await browser.newPage();

// Compare two PNG buffers in a canvas: returns counts and an overlay data URL.
async function compare(a, b) {
  return cmp.evaluate(async ([ua, ub]) => {
    const load = (u) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; });
    const [ia, ib] = await Promise.all([load(ua), load(ub)]);
    const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(ia, 0, 0); const A = g.getImageData(0, 0, c.width, c.height);
    g.drawImage(ib, 0, 0); const B = g.getImageData(0, 0, c.width, c.height);
    const bg = [A.data[8], A.data[9], A.data[10]];
    const near = (d, i) => Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) < 12;
    let holes = 0; let inside = 0;
    for (let i = 0; i < A.data.length; i += 4) {
      const bgA = near(A.data, i); const bgB = near(B.data, i);
      let mark = null;
      if (bgA && !bgB) { holes++; mark = [255, 255, 0]; } else if (!bgA && !bgB && Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) > 60) { inside++; mark = [255, 0, 0]; }
      if (mark) { A.data[i] = mark[0]; A.data[i + 1] = mark[1]; A.data[i + 2] = mark[2]; } else { A.data[i] >>= 1; A.data[i + 1] >>= 1; A.data[i + 2] >>= 1; }
    }
    g.putImageData(A, 0, 0);
    return { holes, inside, overlay: c.toDataURL('image/png') };
  }, [`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`]);
}

for (const id of ids) {
  const d = distArg || Math.round((LENGTH[id] ?? 15) * 1.5);
  console.log(`== ${id} (d=${d})`);
  let n = 0;
  for (const [yaw, pitch] of VIEWS) {
    await page.goto(`${base}/models.html?id=${id}&yaw=${yaw}&pitch=${pitch}&bg=ff00ff&air=1&lod=2&d=${d}`);
    await page.waitForFunction(() => document.title === 'ready', null, { timeout: 120000 });
    const a = await page.screenshot();
    await page.evaluate(() => { window.__view.root.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) { m.side = 2; m.needsUpdate = true; } }); });
    await page.waitForTimeout(1500);
    const b = await page.screenshot();
    const r = await compare(a, b);
    const file = path.join(out, `${id}_${String(n++).padStart(2, '0')}_yaw${yaw}_pitch${pitch}.png`);
    fs.writeFileSync(file, Buffer.from(r.overlay.split(',')[1], 'base64'));
    console.log(`yaw ${String(yaw).padStart(3)} pitch ${String(pitch).padStart(3)}: holes ${String(r.holes).padStart(5)}  inside-out ${String(r.inside).padStart(6)}  ${file}`);
  }
}
await browser.close();
