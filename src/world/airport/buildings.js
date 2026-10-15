// Buildings of an airport written into per-material buffers. All coordinates are airport-frame metres:
// x = u (along the main runway), z = v (to its right). Buildings are axis aligned in this frame.
// Material keys: wall, wall2, accent, glass, cab, punched, metal, metalH, roof, roofLight, carpark, steel,
// dark, tank, bridge, white, plain, red, wood.

const PI = Math.PI;

/** Add every building listed in layout.sites. `ctx` = { bufs, lights, rng, style, layout }. */
export function addBuildings(ctx) {
  const { layout } = ctx;
  for (const site of layout.sites) {
    const fn = BUILD[site.type];
    if (fn) fn(ctx, site);
  }
  // jet bridges for stands that have them
  for (const st of layout.stands) if (st.bridge) jetBridge(ctx, st);
}

const BUILD = {
  tower: (ctx, s) => (s.kind === 'big' ? towerBig(ctx, s) : towerSmall(ctx, s)),
  terminal: (ctx, s) => (s.variant === 'hub' ? terminalHub(ctx, s) : s.variant === 'regional' ? terminalRegional(ctx, s) : terminalSmall(ctx, s)),
  hangarGable: (ctx, s) => hangarGable(ctx, s),
  hangarArch: (ctx, s) => hangarArch(ctx, s),
  maint: (ctx, s) => maintHangar(ctx, s),
  cargo: (ctx, s) => cargoShed(ctx, s),
  fire: (ctx, s) => fireStation(ctx, s),
  carpark: (ctx, s) => carPark(ctx, s),
  hotel: (ctx, s) => hotel(ctx, s),
  portal: (ctx, s) => portal(ctx, s),
  tanks: (ctx, s) => fuelFarm(ctx, s),
  atis: (ctx, s) => atis(ctx, s),
  radar: (ctx, s) => radarTower(ctx, s),
  depot: (ctx, s) => depot(ctx, s),
  shed: (ctx, s) => bushShed(ctx, s),
  fuel: (ctx, s) => fuelPump(ctx, s),
};

const redLight = (ctx, x, y, z, size = 0.5) => ctx.lights.add(x, y, z, { color: 'red', size, int: 1.4, day: 0.45, minK: 1.5 });

// ---------------------------------------------------------------------------------------------------------------------
function towerBig(ctx, s) {
  const { bufs, lights, style } = ctx;
  const { u, v, h } = s;
  const w = bufs.get('wall'); const w2 = bufs.get('wall2'); const ac = bufs.get('accent'); const st = bufs.get('steel');
  w.box(u, 0, v, 17, 8, 17, { ao: 0.2 });
  ac.box(u, 8, v, 17.6, 0.7, 17.6);
  w.cyl(u, 8.7, v, 3.4, 4.5, h - 8.7 - 3.5, 16, { capTop: false, ao: 0.22 });
  // window slits and bands up the shaft
  const shaftH = h - 8.7 - 3.5;
  for (const y of [18, 28, 38]) {
    const r = 4.5 - 1.1 * ((y - 8.7) / shaftH);
    ac.cyl(u, y, v, r + 0.1, r + 0.1, 0.8, 16, { capTop: false, capBot: false, ao: 0 });
  }
  w2.cyl(u, h - 3.6, v, 6.2, 4.0, 3.6, 16, { capTop: true, ao: 0.1 });
  // cab: glass leaning outward, then roof
  bufs.get('cab').cyl(u, h, v, 7.3, 6.0, 4.3, 16, { capTop: false, capBot: false, ao: 0 });
  w2.cyl(u, h + 4.3, v, 8.0, 7.9, 0.8, 16, { capTop: true, capBot: true, ao: 0.1 });
  w2.cyl(u, h + 5.1, v, 3.6, 3.8, 1.3, 12, { ao: 0.1 });
  st.cyl(u, h + 0.1, v, 5.9, 5.9, 0.15, 16, { capTop: true, ao: 0 }); // cab floor
  // rotating radar dome and mast cluster on the roof
  bufs.get('white').sphere(u + 2.6, h + 5.1, v - 1.2, 1.5, 12, 8, { half: true });
  st.cyl(u - 1.5, h + 5.1, v + 1.8, 0.07, 0.1, 8, 6, { ao: 0 });
  st.cyl(u + 0.8, h + 5.1, v + 2.5, 0.06, 0.09, 6, 6, { ao: 0 });
  st.box(u - 1.5, h + 12, v + 1.8, 2.4, 0.1, 0.1, { ao: 0 });
  // catwalk rail around the roof
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * PI * 2;
    st.box(u + Math.cos(a) * 7.7, h + 5.1, v + Math.sin(a) * 7.7, 0.1, 1.0, 0.1, { ao: 0 });
  }
  redLight(ctx, u - 1.5, h + 13, v + 1.8, 0.7);
  redLight(ctx, u + 7.9, h + 5.4, v, 0.45);
  redLight(ctx, u - 7.9, h + 5.4, v, 0.45);
  // rotating beacon pair (white / green) on the roof
  lights.add(u + 0.8, h + 8.8, v + 2.5, { color: 'strobe', size: 0.9, int: 2.4, day: 0.85, mode: 2, phase: 0, minK: 2.5 });
  lights.add(u + 0.8, h + 8.8, v + 2.5, { color: 'green', size: 0.9, int: 2.4, day: 0.85, mode: 2, phase: PI, minK: 2.5 });
  ctx.towerCab = { u, v, h };
  void style;
}

function towerSmall(ctx, s) {
  const { bufs, lights } = ctx;
  const { u, v, h } = s;
  const w = bufs.get('wall'); const w2 = bufs.get('wall2'); const st = bufs.get('steel');
  w.box(u, 0, v, 7, h - 4, 7, { ao: 0.22 });
  bufs.get('accent').box(u, h - 4.8, v, 7.4, 0.7, 7.4);
  w2.box(u, h - 4, v, 8.8, 1.2, 8.8, { ao: 0.1 });
  bufs.get('cab').cyl(u, h - 2.8, v, 5.4, 4.4, 3.2, 12, { capTop: false, capBot: false, ao: 0 });
  w2.cyl(u, h + 0.4, v, 5.8, 5.7, 0.6, 12, { ao: 0.1 });
  bufs.get('white').sphere(u + 1.5, h + 1.0, v - 0.8, 1.1, 10, 6, { half: true });
  st.cyl(u - 1.3, h + 1.0, v + 1.2, 0.06, 0.08, 5.5, 6, { ao: 0 });
  redLight(ctx, u - 1.3, h + 6.7, v + 1.2, 0.55);
  lights.add(u + 0.5, h + 1.9, v + 1.8, { color: 'strobe', size: 0.8, int: 2.2, day: 0.8, mode: 2, phase: 0, minK: 2.5 });
  lights.add(u + 0.5, h + 1.9, v + 1.8, { color: 'green', size: 0.8, int: 2.2, day: 0.8, mode: 2, phase: PI, minK: 2.5 });
  ctx.towerCab = { u, v, h };
}

// ---------------------------------------------------------------------------------------------------------------------
function terminalHub(ctx, s) {
  const { bufs, lights, rng } = ctx;
  const C = s.concourse; const H = s.hall;
  const len = C.u1 - C.u0; const uc = (C.u0 + C.u1) / 2;
  const hw = C.half;
  const glass = bufs.get('glass'); const steel = bufs.get('steel'); const ac = bufs.get('accent'); const rl = bufs.get('roofLight'); const w2 = bufs.get('wall2');
  // concourse body: glass walls all round
  glass.box(uc, 0.0, 0, len, C.h, hw * 2, { top: false, ao: 0.1 });
  w2.box(uc, 0, 0, len + 0.4, 1.0, hw * 2 + 0.4, { ao: 0, top: false }); // plinth
  // fins and belt on both long sides
  for (const sd of [-1, 1]) {
    ac.box(uc, 4.6, sd * (hw + 0.28), len + 0.2, 0.9, 0.56, { ao: 0 });
    for (let x = C.u0 + 2; x <= C.u1 - 1; x += 7) steel.box(x, 0, sd * (hw + 0.3), 0.45, C.h, 0.55, { ao: 0.1 });
  }
  // cambered roof with overhang
  const rp = [[-hw - 3.5, C.h - 0.2], [hw + 3.5, C.h - 0.2], [hw + 3.5, C.h + 0.3], [hw * 0.55, C.h + 1.5], [0, C.h + 1.9], [-hw * 0.55, C.h + 1.5], [-hw - 3.5, C.h + 0.3]];
  rl.extrude(rp, C.u0 - 2, C.u1 + 2, { ry: PI / 2, ao: 0, caps: true });
  // rooftop plant
  for (let x = C.u0 + 20; x < C.u1 - 10; x += 38) w2.box(x, C.h + 1.4, rng.range(-4, 4), rng.range(4, 8), 1.6, rng.range(3, 5), { ao: 0.1 });
  // departure hall: tall glass volume with a sweeping roof, glazed fins, curbside canopy
  const hu = (H.u0 + H.u1) / 2; const hl = H.u1 - H.u0;
  glass.box(hu, 0, 0, hl, H.h - 3, H.half * 2, { top: false, ao: 0.08 });
  w2.box(hu, 0, 0, hl + 0.4, 1.2, H.half * 2 + 0.4, { ao: 0, top: false });
  const wave = [];
  const nW = 14;
  for (let i = 0; i <= nW; i++) { const t = i / nW; wave.push([H.u0 - 8 + (hl + 12) * t, H.h - 3 + 1.0 + Math.sin(t * PI) * 5.5 + (1 - t) * 1.5]); }
  const prof = [...wave.map(([x, y]) => [x, y - 1.3]), ...wave.slice().reverse()];
  rl.extrude(prof.map(([x, y]) => [x, y]), -H.half - 4, H.half + 4, { ry: 0, ao: 0, caps: true, smooth: false });
  // roof trusses visible as fins
  for (let z = -H.half; z <= H.half + 0.1; z += 7) steel.box(H.u0 - 0.4, 0, z, 0.8, H.h - 2.5, 0.6, { ao: 0.1 });
  for (let z = -H.half; z <= H.half + 0.1; z += 7) steel.box(H.u0 - 3.5, H.h - 3.4, z, 7, 0.5, 0.5, { ao: 0 });
  // curbside canopy
  rl.box(H.u0 - 15, 7.2, 0, 30, 0.6, 150, { ao: 0 });
  ac.box(H.u0 - 30.2, 6.4, 0, 0.6, 1.6, 150, { ao: 0 });
  for (let z = -70; z <= 70.1; z += 20) steel.box(H.u0 - 26, 0, z, 0.7, 7.2, 0.7, { ao: 0.1 });
  // entrance doors: dark band on the hall front
  bufs.get('dark').box(H.u0 - 0.3, 0.2, 0, 0.2, 4.5, H.half * 1.5, { ao: 0, top: false });
  // terminal sign anchor (the builder paints the airport name here)
  ctx.banners.push({ u: H.u0 - 0.5, y: H.h - 5.5, v: 0, w: 46, h: 4.6, facing: [-1, 0] });
  // lit steel belts: obstruction lights on the roof corners
  for (const [x, z] of [[H.u0, -H.half], [H.u0, H.half], [C.u1, -hw], [C.u1, hw]]) redLight(ctx, x, C.h + 3, z, 0.4);
  void lights;
}

function terminalRegional(ctx, s) {
  const { bufs, rng, layout } = ctx;
  const { u, v, w, d, h, face } = s;
  const glass = bufs.get('glass'); const wall = bufs.get('wall'); const w2 = bufs.get('wall2'); const rl = bufs.get('roof'); const ac = bufs.get('accent'); const steel = bufs.get('steel');
  // landside part in solid wall, airside strip (toward `face`) in glass
  wall.box(u, 0, v - face * d * 0.2, w, h, d * 0.6, { ao: 0.15 });
  glass.box(u, 0, v + face * d * 0.3, w, h, d * 0.4, { top: false, ao: 0.1 });
  // flat roof with parapet and a cantilevered canopy toward the apron
  w2.box(u, h, v, w + 0.6, 0.9, d + 0.6, { ao: 0 });
  rl.box(u, h + 0.9, v, w, 0.2, d, { ao: 0 });
  w2.box(u, h - 0.5, v + face * (d / 2 + 3.2), w + 0.6, 0.5, 6.4, { ao: 0 });
  ac.box(u, h - 0.6, v + face * (d / 2 + 6.4), w + 0.6, 1.0, 0.4, { ao: 0 });
  const bridges = layout.stands.filter((q) => q.bridge).map((q) => q.u);
  for (let x = u - w / 2 + 4; x <= u + w / 2 - 3; x += 12) {
    if (bridges.some((bu) => Math.abs(bu - x) < 6.5)) continue;
    steel.box(x, 0, v + face * (d / 2 + 5.9), 0.5, h - 0.5, 0.5, { ao: 0.1 });
  }
  for (let x = u - w / 2 + 12; x < u + w / 2 - 12; x += 26) w2.box(x, h + 1.1, v + rng.range(-3, 3), 5, 1.8, 3.6, { ao: 0.1 });
  ctx.banners.push({ u, y: h - 2.6, v: v - face * (d / 2 + 0.06), w: 26, h: 2.6, facing: [0, -face] });
}

function terminalSmall(ctx, s) {
  const { bufs } = ctx;
  const { u, v, w, d, h, face } = s;
  const wall = bufs.get('wall'); const glass = bufs.get('glass'); const roof = bufs.get('roof'); const ac = bufs.get('accent'); const steel = bufs.get('steel');
  wall.box(u, 0, v, w, h, d, { ao: 0.18 });
  glass.box(u, 0.8, v + face * (d / 2 + 0.02), w * 0.7, h - 1.6, 0.12, { ao: 0.05, top: false });
  // pitched roof along u with overhangs
  const rp = [[-d / 2 - 1.2, h], [d / 2 + 1.2, h], [0, h + 2.4]];
  roof.extrude(rp, u - w / 2 - 0.8, u + w / 2 + 0.8, { ry: PI / 2, ao: 0 });
  // canopy over the entrance
  ac.box(u, h - 0.7, v + face * (d / 2 + 1.5), w * 0.74, 0.35, 3, { ao: 0 });
  for (const sd of [-1, 1]) steel.box(u + sd * w * 0.35, 0, v + face * (d / 2 + 2.8), 0.25, h - 0.7, 0.25, { ao: 0.1 });
  bufs.get('dark').box(u + w * 0.35, 0.0, v + face * (d / 2 + 0.05), 1.6, 2.3, 0.1, { ao: 0, top: false });
  ctx.banners.push({ u, y: h - 1.6, v: v + face * (d / 2 + 3.0), w: 10, h: 1.3, facing: [0, face] });
}

// ---------------------------------------------------------------------------------------------------------------------
function jetBridge(ctx, st) {
  const { bufs } = ctx;
  const br = bufs.get('bridge'); const steel = bufs.get('steel'); const dk = bufs.get('dark'); const rot = bufs.get('accent');
  const ax = st.frameAxis; const left = { u: ax.v, v: -ax.u };
  const S = st.S;
  const ry = -Math.atan2(ax.v, ax.u);
  // distance from the stop mark to the terminal face along the axis, found from the stand layout
  const faceDist = ctx.faceDist(st);
  const lat = 3.3;
  const base = { u: S.u + left.u * lat, v: S.v + left.v * lat };
  const P = (a, y) => ({ x: base.u + ax.u * a, z: base.v + ax.v * a, y });
  const rc = faceDist - 2.6; // rotunda centre
  const r = P(rc, 0);
  br.cyl(r.x, 3.1, r.z, 2.6, 2.6, 3.4, 14, { capTop: true, ao: 0.1 });
  rot.cyl(r.x, 5.9, r.z, 2.7, 2.7, 0.6, 14, { capTop: true, ao: 0 });
  steel.cyl(r.x, 0, r.z, 0.55, 0.65, 3.1, 8, { ao: 0.1 });
  const seg = (a0, a1, w, h, y) => {
    const m = P((a0 + a1) / 2, y);
    br.box(m.x, y, m.z, a1 - a0, h, w, { ry, ao: 0.12 });
    // window strip on both sides
    const side = P((a0 + a1) / 2, y);
    for (const sd of [-1, 1]) {
      dk.box(side.x + left.u * sd * (w / 2 + 0.02), y + h * 0.45, side.z + left.v * sd * (w / 2 + 0.02), (a1 - a0) * 0.72, h * 0.28, 0.06, { ry, ao: 0, top: false });
    }
  };
  // from the rotunda out to the cab at a = 0 (stop mark side): the cab front sits 2 m past the mark
  const cabFront = -2.0;
  seg(cabFront + 3.3, rc - 1.0, 2.9, 2.7, 3.3);
  seg(cabFront + 3.3, (rc + cabFront) / 2 + 2, 2.6, 2.5, 3.4);
  // cab and its support column
  const cab = P(cabFront + 1.6, 3.2);
  br.box(cab.x, 3.0, cab.z, 3.4, 2.9, 3.2, { ry, ao: 0.1 });
  dk.box(cab.x + ax.u * 1.72, 3.5, cab.z + ax.v * 1.72, 0.08, 1.5, 2.2, { ry, ao: 0, top: false });
  const col = P(cabFront + 4.5, 0);
  steel.box(col.x, 0.35, col.z, 0.7, 2.7, 0.7, { ry, ao: 0.1 });
  steel.box(col.x, 0, col.z, 0.5, 0.45, 2.2, { ry, ao: 0 });
  dk.box(col.x, 0, col.z - 0.0, 0.5, 0.3, 2.4, { ry, ao: 0 });
}

// ---------------------------------------------------------------------------------------------------------------------
function hangarGable(ctx, s) {
  const { bufs, style, rng } = ctx;
  const { u, v, w, d, h, face } = s;
  const m = bufs.get('metal'); const roof = bufs.get('roof'); const door = bufs.get('metalH'); const steel = bufs.get('steel');
  m.box(u, 0, v, w, h, d, { top: false, ao: 0.16 });
  const rise = w * 0.12;
  // roof slabs
  const half = w / 2 + 0.5;
  roof.extrude([[-half, h - 0.05], [0, h + rise - 0.05], [0, h + rise + 0.3], [-half, h + 0.3]], v - d / 2 - 0.5, v + d / 2 + 0.5, { x: u, ao: 0, caps: true });
  roof.extrude([[0, h + rise - 0.05], [half, h - 0.05], [half, h + 0.3], [0, h + rise + 0.3]], v - d / 2 - 0.5, v + d / 2 + 0.5, { x: u, ao: 0, caps: true });
  // gable triangles on the front/back walls
  for (const sd of [-1, 1]) m.extrude([[-w / 2, h], [w / 2, h], [0, h + rise - 0.05]], 0, 0.25, { x: u, z: v + sd * d / 2 + (sd > 0 ? -0.25 : 0), ao: 0, caps: true });
  // doors on the face side
  const dw = w * 0.84; const dh = h * 0.86;
  door.box(u, 0, v + face * (d / 2 + 0.16), dw, dh, 0.3, { ao: 0.1, top: false });
  steel.box(u, dh, v + face * (d / 2 + 0.2), dw + 0.6, 0.5, 0.45, { ao: 0 });
  for (let x = -dw / 2; x <= dw / 2 + 0.1; x += dw / 4) steel.box(u + x, 0, v + face * (d / 2 + 0.34), 0.18, dh, 0.1, { ao: 0 });
  bufs.get('dark').box(u + w / 2 - 0.1, 0, v + (rng.chance(0.5) ? 1 : -1) * d * 0.25, 0.1, 2.1, 1.0, { ao: 0, top: false });
  void style;
}

function hangarArch(ctx, s) {
  const { bufs } = ctx;
  const { u, v, w, d, h, face } = s;
  const m = bufs.get('metal'); const door = bufs.get('metalH'); const steel = bufs.get('steel');
  const prof = [];
  const n = 18;
  for (let i = 0; i <= n; i++) { const t = (i / n) * PI; prof.push([Math.cos(t) * w / 2, Math.sin(t) * h]); }
  m.extrude(prof, v - d / 2, v + d / 2, { x: u, ao: 0.1, smooth: true, caps: true });
  // door opening and frame
  door.box(u, 0, v + face * (d / 2 + 0.12), w * 0.74, h * 0.62, 0.25, { ao: 0.1, top: false });
  steel.box(u, h * 0.62, v + face * (d / 2 + 0.16), w * 0.78, 0.45, 0.4, { ao: 0 });
  for (let x = -w * 0.37; x <= w * 0.371; x += w * 0.37 / 2) steel.box(u + x, 0, v + face * (d / 2 + 0.28), 0.16, h * 0.62, 0.1, { ao: 0 });
  for (let z = -d / 2 + 3; z < d / 2; z += 6) steel.box(u, h - 0.1, v + z, w * 0.14, 0.12, 0.3, { ao: 0 }); // ridge ribs
}

function maintHangar(ctx, s) {
  const { bufs, lights } = ctx;
  const { u, v, w, d, h } = s;
  const m = bufs.get('metal'); const roof = bufs.get('roof'); const door = bufs.get('metalH'); const steel = bufs.get('steel'); const wall = bufs.get('wall2');
  m.box(u, 0, v, w, h, d, { top: false, ao: 0.16 });
  const rise = d * 0.06;
  roof.extrude([[-d / 2 - 1, h - 0.05], [0, h + rise - 0.05], [0, h + rise + 0.4], [-d / 2 - 1, h + 0.4]], u - w / 2 - 1, u + w / 2 + 1, { ry: PI / 2, ao: 0, caps: true });
  roof.extrude([[0, h + rise - 0.05], [d / 2 + 1, h - 0.05], [d / 2 + 1, h + 0.4], [0, h + rise + 0.4]], u - w / 2 - 1, u + w / 2 + 1, { ry: PI / 2, ao: 0, caps: true });
  // large doors on both long sides, plus a two-storey annexe
  for (const sd of [-1, 1]) {
    door.box(u, 0, v + sd * (d / 2 + 0.2), w * 0.88, h * 0.9, 0.35, { ao: 0.1, top: false });
    steel.box(u, h * 0.9, v + sd * (d / 2 + 0.25), w * 0.92, 0.6, 0.5, { ao: 0 });
    for (let x = -w * 0.44; x <= w * 0.441; x += w * 0.88 / 4) steel.box(u + x, 0, v + sd * (d / 2 + 0.42), 0.22, h * 0.9, 0.12, { ao: 0 });
  }
  wall.box(u - w / 2 - 5, 0, v, 10, 9, d * 0.6, { ao: 0.16 });
  redLight(ctx, u + w / 2, h + rise + 0.6, v - d / 2, 0.45);
  redLight(ctx, u - w / 2, h + rise + 0.6, v + d / 2, 0.45);
  void lights;
}

function cargoShed(ctx, s) {
  const { bufs } = ctx;
  const { u, v, w, d, h } = s;
  const wall = bufs.get('wall2'); const dk = bufs.get('dark'); const roof = bufs.get('roof'); const steel = bufs.get('steel'); const m = bufs.get('metal');
  wall.box(u, 0, v, w, h, d, { ao: 0.16 });
  m.box(u, h * 0.55, v, w + 0.1, h * 0.45, d + 0.1, { ao: 0, top: false });
  roof.box(u, h, v, w + 1, 0.4, d + 1, { ao: 0 });
  for (const sd of [-1, 1]) {
    bufs.get('accent').box(u, 5.6, v + sd * (d / 2 + 3.5), w - 4, 0.4, 7, { ao: 0 }); // dock canopy
    for (let x = u - w / 2 + 8; x <= u + w / 2 - 7; x += 9) {
      dk.box(x, 0.8, v + sd * (d / 2 + 0.06), 3.2, 3.6, 0.12, { ao: 0, top: false });
      steel.box(x, 0, v + sd * (d / 2 + 0.7), 3.6, 1.0, 1.4, { ao: 0.1 }); // dock leveller
    }
    for (let x = u - w / 2 + 6; x <= u + w / 2 - 5; x += 18) steel.box(x, 0, v + sd * (d / 2 + 6.6), 0.4, 5.6, 0.4, { ao: 0.1 });
  }
}

function fireStation(ctx, s) {
  const { bufs } = ctx;
  const { u, v, w, d, h } = s;
  const wall = bufs.get('wall'); const red = bufs.get('red'); const roof = bufs.get('roof'); const steel = bufs.get('steel'); const dk = bufs.get('dark');
  wall.box(u, 0, v, w, h, d, { ao: 0.16 });
  roof.box(u, h, v, w + 0.8, 0.4, d + 0.8, { ao: 0 });
  for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) {
    const x = u - w / 2 + (w / 3) * (i + 0.5);
    red.box(x, 0, v + sd * (d / 2 + 0.1), w / 3 - 2.2, h * 0.8, 0.25, { ao: 0.08, top: false });
  }
  wall.box(u - w / 2 + 3, h, v - d / 2 + 3, 4, 9, 4, { ao: 0.12 }); // hose tower
  dk.box(u - w / 2 + 3, h + 6.5, v - d / 2 + 3, 4.2, 1.2, 4.2, { ao: 0, top: false });
  steel.box(u + w / 4, h + 0.4, v, 6, 0.3, 3, { ao: 0 });
  redLight(ctx, u - w / 2 + 3, h + 9.5, v - d / 2 + 3, 0.5);
}

function carPark(ctx, s) {
  const { bufs } = ctx;
  const { u, v, w, d, h } = s;
  const cp = bufs.get('carpark'); const plain = bufs.get('plain'); const wall = bufs.get('wall'); const steel = bufs.get('steel');
  cp.box(u, 0, v, w, h, d, { top: false, ao: 0.1 });
  plain.box(u, h, v, w + 0.4, 0.6, d + 0.4, { ao: 0.0 });
  // ramps hint, stair and lift cores in two corners
  wall.box(u - w / 2 + 3.5, 0, v - d / 2 + 3.5, 7, h + 3.5, 7, { ao: 0.18 });
  wall.box(u + w / 2 - 3.5, 0, v + d / 2 - 3.5, 7, h + 3.5, 7, { ao: 0.18 });
  bufs.get('glass').box(u - w / 2 + 3.5, 1, v - d / 2 + 7.1, 5, h + 1.5, 0.1, { ao: 0, top: false });
  for (const [x, z] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) steel.cyl(u + x * (w / 2 - 6), h + 0.6, v + z * (d / 2 - 6), 0.12, 0.15, 7, 6, { ao: 0 }); // lamp poles
  for (const [x, z] of [[-1, -1], [1, 1]]) ctx.lights.add(u + x * (w / 2 - 6), h + 7.7, v + z * (d / 2 - 6), { color: 'sodium', size: 0.8, int: 1.2, day: 0.1 });
  redLight(ctx, u - w / 2 + 3.5, h + 3.9, v - d / 2 + 3.5, 0.4);
}

function hotel(ctx, s) {
  const { bufs } = ctx;
  const { u, v, w, d, h } = s;
  const p = bufs.get('punched'); const roof = bufs.get('roof'); const w2 = bufs.get('wall2'); const ac = bufs.get('accent'); const dk = bufs.get('dark');
  p.box(u, 0, v, w, h, d, { top: false, ao: 0.1 });
  roof.box(u, h, v, w + 0.8, 0.8, d + 0.8, { ao: 0 });
  w2.box(u + 6, h + 0.8, v, 14, 3.4, d * 0.6, { ao: 0.1 });
  ac.box(u, 0, v - d / 2 - 2.5, w * 0.5, 0.5, 5, { ao: 0 });
  dk.box(u, 0.1, v - d / 2 - 0.1, w * 0.4, 3, 0.1, { ao: 0, top: false });
  ctx.banners.push({ u: u - w / 2 - 0.3, y: h - 5, v, w: d * 0.8, h: 3.2, facing: [-1, 0], vertical: true });
  for (const [x, z] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) redLight(ctx, u + x * (w / 2 - 1), h + 0.9, v + z * (d / 2 - 1), 0.45);
}

function portal(ctx, s) {
  const { bufs } = ctx;
  const { u, v } = s;
  const wall = bufs.get('wall2'); const dk = bufs.get('dark');
  wall.box(u - 8, 0, v, 16, 6.5, 30, { ao: 0.15 });
  dk.box(u + 0.05, 0, v, 0.3, 4.6, 11, { ao: 0, top: false });
  for (const sd of [-1, 1]) wall.box(u + 8, 0, v + sd * 11, 16, 3.2, 2, { ao: 0.1 });
}

function fuelFarm(ctx, s) {
  const { bufs, lights } = ctx;
  const { u, v, count } = s;
  const tank = bufs.get('tank'); const plain = bufs.get('plain'); const steel = bufs.get('steel'); const wall = bufs.get('wall');
  const cols = Math.min(3, count); const rows = Math.ceil(count / cols);
  const pitch = 25;
  const w = cols * pitch + 8; const d = rows * pitch + 8;
  // bund wall
  for (const sd of [-1, 1]) {
    plain.box(u, 0, v + sd * d / 2, w, 1.3, 0.6, { ao: 0.1 });
    plain.box(u + sd * w / 2, 0, v, 0.6, 1.3, d, { ao: 0.1 });
  }
  for (let i = 0; i < count; i++) {
    const x = u + (i % cols - (cols - 1) / 2) * pitch; const z = v + (Math.floor(i / cols) - (rows - 1) / 2) * pitch;
    tank.cyl(x, 0, z, 9.5, 9.5, 12, 24, { capTop: true, ao: 0.12 });
    plain.cyl(x, 12, z, 9.7, 9.7, 0.4, 24, { capTop: true, ao: 0 });
    steel.cyl(x + 4, 0, z + 9.6, 0.25, 0.25, 12.5, 6, { ao: 0 }); // stair/pipe riser
    steel.box(x, 12.4, z, 0.2, 1, 0.2, { ao: 0 });
  }
  wall.box(u + w / 2 + 7, 0, v, 8, 3.6, 6, { ao: 0.15 });
  steel.box(u + w / 2 + 14, 0, v, 6, 5, 4, { ao: 0.15 });
  steel.box(u, 1.0, v + d / 2 + 2, w, 0.3, 0.4, { ao: 0 }); // pipe run
  lights.add(u + w / 2, 4, v - d / 2, { color: 'sodium', size: 0.6, int: 1, day: 0.1 });
}

function atis(ctx, s) {
  const { bufs } = ctx;
  const { u, v } = s;
  bufs.get('wall').box(u, 0, v, 5, 3.2, 4, { ao: 0.2 });
  bufs.get('roof').box(u, 3.2, v, 5.6, 0.3, 4.6, { ao: 0 });
  const st = bufs.get('steel');
  st.cyl(u + 4, 0, v, 0.15, 0.25, 16, 8, { ao: 0.1 });
  st.box(u + 4, 14, v, 1.8, 0.08, 0.08, { ao: 0 });
  st.box(u + 4, 11, v, 1.2, 0.08, 0.08, { ao: 0 });
  redLight(ctx, u + 4, 16.4, v, 0.5);
}

function radarTower(ctx, s) {
  const { bufs } = ctx;
  const { u, v } = s;
  bufs.get('wall').cyl(u, 0, v, 1.7, 2.1, 15, 10, { ao: 0.2 });
  bufs.get('wall2').cyl(u, 15, v, 3.0, 2.2, 0.8, 10, { ao: 0 });
  bufs.get('white').sphere(u, 15.8, v, 3.2, 14, 10, { half: true });
  redLight(ctx, u, 19.4, v, 0.55);
}

function depot(ctx, s) {
  const { bufs } = ctx;
  const { u, v } = s;
  bufs.get('metal').box(u, 0, v, 44, 8, 20, { top: false, ao: 0.16 });
  bufs.get('roof').box(u, 8, v, 45, 0.5, 21, { ao: 0 });
  for (let i = 0; i < 4; i++) bufs.get('metalH').box(u - 16 + i * 10.5, 0, v - 10.1, 6, 5, 0.25, { ao: 0.1, top: false });
}

function bushShed(ctx, s) {
  const { bufs } = ctx;
  const { u, v, w, d, h, face } = s;
  const wood = bufs.get('wood'); const roof = bufs.get('roof'); const dk = bufs.get('dark');
  wood.box(u, 0, v, w, h, d, { top: false, ao: 0.2 });
  const rise = 1.5;
  roof.extrude([[-d / 2 - 0.5, h], [0, h + rise], [0, h + rise + 0.15], [-d / 2 - 0.5, h + 0.15]], u - w / 2 - 0.5, u + w / 2 + 0.5, { ry: PI / 2, ao: 0, caps: true });
  roof.extrude([[0, h + rise], [d / 2 + 0.5, h], [d / 2 + 0.5, h + 0.15], [0, h + rise + 0.15]], u - w / 2 - 0.5, u + w / 2 + 0.5, { ry: PI / 2, ao: 0, caps: true });
  dk.box(u + w * 0.2, 0, v + face * (d / 2 + 0.05), 2.4, 2.4, 0.1, { ao: 0, top: false });
  wood.box(u - w * 0.25, 1.0, v + face * (d / 2 + 0.05), 1.2, 0.9, 0.08, { ao: 0, top: false });
}

function fuelPump(ctx, s) {
  const { bufs } = ctx;
  const { u, v } = s;
  bufs.get('steel').box(u, 0, v, 1.0, 2.0, 0.8, { ao: 0.1 });
  bufs.get('red').box(u, 2.0, v, 1.1, 0.3, 0.9, { ao: 0 });
  bufs.get('tank').cyl(u + 4, 0, v, 1.6, 1.6, 2.6, 12, { capTop: true });
}
