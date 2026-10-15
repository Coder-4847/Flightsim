import * as THREE from 'three';
import {
  DEG, Planform, airfoilYs, clamp, lerp, loftFrames, merge, mirrorZ, placed, revolve, smooth, std,
} from './jetKit.js';

// Wings, tailplanes and fins for the jet models: lofted airfoil surfaces with slats, Fowler flaps (rotating about a virtual hinge
// below the wing so they also move aft), ailerons, spoilers, flap-track canoes, and winglets / raked tips.

/** A pivot whose rotation is a function of the angle the view asks for (so slats can open before the flaps move far). */
class MappedQuaternion extends THREE.Quaternion {
  constructor(map) { super(); this.map = map; }

  setFromAxisAngle(axis, angle) { return super.setFromAxisAngle(axis, this.map(angle)); }
}

export function mappedPivot(map) {
  const o = new THREE.Object3D();
  Object.defineProperty(o, 'quaternion', { value: new MappedQuaternion(map), configurable: true });
  return o;
}

/** Spanwise extent used to normalise the wing texture's v coordinate (the tip structure extends past the last station). */
export function wingSemi(W) {
  const last = W.stations[W.stations.length - 1].z;
  const tip = W.tip ?? {};
  return last + (tip.ext ?? tip.height ?? 0.18);
}

const leftAxis = (a) => new THREE.Vector3(-a.x, -a.y, a.z);

/** Build a hinged surface (right wing coordinates). Returns { geo (local to hinge start), h0, axis }. */
function hingedSurface(pf, z0, z1, cf0, cf1, opts) {
  const { nChord, drop = 0, hingeCf = cf0, step = 0, teBlunt = 0 } = opts;
  const frames = pf.frames(z0, z1, { step });
  const geo = loftFrames(frames, { cf0, cf1, nChord, teBlunt });
  const hingePoint = (z) => {
    const f = pf.frame(z);
    const { up, lo } = airfoilYs(hingeCf, f.t, f.m || 0.012);
    const y = ((up + lo) / 2 - drop) * f.c.length();
    return f.p.clone().addScaledVector(f.c, hingeCf).addScaledVector(f.u, y);
  };
  const h0 = hingePoint(z0);
  const h1 = hingePoint(z1);
  const axis = h1.clone().sub(h0).normalize();
  geo.translate(-h0.x, -h0.y, -h0.z);
  return { geo, h0, h1, axis };
}

/** Attach a hinged surface to `root` for both sides. `invert` makes the axis point so that a positive angle lifts the trailing edge. */
function addHinged(root, mat, surf, { invert = false, pivotFactory = null } = {}) {
  const made = [];
  for (const side of [1, -1]) {
    const pivot = pivotFactory ? pivotFactory() : new THREE.Object3D();
    const geo = side > 0 ? surf.geo : mirrorZ(surf.geo);
    pivot.position.set(surf.h0.x, surf.h0.y, surf.h0.z * side);
    pivot.add(new THREE.Mesh(geo, mat));
    root.add(pivot);
    let axis = surf.axis.clone();
    if (invert) axis.negate();
    if (side < 0) axis = leftAxis(axis);
    made.push({ pivot, axis, side });
  }
  return made;
}

/** Streamlined body of revolution along X (used for flap-track canoes and pods). */
function canoe(len, r, segs = 10) {
  const prof = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    prof.push([len * (t - 0.4), r * Math.sqrt(Math.max(0.0004, 1 - (2 * t - 1) ** 2)) * (t < 0.5 ? 1 : 1 - 0.55 * (t - 0.5))]);
  }
  return revolve(prof, segs, { crease: 70 });
}

export class JetWingBuilder {
  /**
   * @param ctx { cfg, detail, J: materials, parts: Map material -> geos via PartSet, root: Group (body frame), rig }
   */
  constructor(ctx) {
    Object.assign(this, ctx);
    this.nChord = [4, 12, 26][this.detail];
  }

  // ---- main wing ---------------------------------------------------------------------------------------------
  buildWing() {
    const { cfg, detail, J, parts, root, rig } = this;
    const W = cfg.wing;
    const pf = new Planform(W.stations, 1 / wingSemi(W));
    this.pf = pf;
    const tip = pf.tipZ;
    const z0 = W.rootZ;
    const nC = this.nChord;
    const hinge = W.hinge ?? 0.74;
    const flaps = W.flaps ?? [];
    const ails = W.ailerons ?? [];
    const slats = detail > 0 ? (W.slats ?? []) : [];
    const slatCf = W.slatCf ?? 0.13;
    const surfaces = [...flaps.map((f) => ({ ...f, kind: 'flap' })), ...ails.map((a) => ({ ...a, kind: 'aileron' }))];
    // Spanwise break points for the fixed box.
    const zs = new Set([z0, tip]);
    for (const s of surfaces) { zs.add(clamp(s.z0, z0, tip)); zs.add(clamp(s.z1, z0, tip)); }
    for (const s of slats) { zs.add(s.z0); zs.add(s.z1); }
    const bz = [...zs].sort((a, b) => a - b);
    const cover = (z, list) => list.find((s) => z >= s.z0 - 1e-4 && z <= s.z1 + 1e-4);
    const solid = [];
    for (let i = 0; i < bz.length - 1; i++) {
      const a = bz[i];
      const b = bz[i + 1];
      if (b - a < 0.02) continue;
      const mid = (a + b) / 2;
      const cs = cover(mid, surfaces);
      const sl = cover(mid, slats);
      const cfA = sl ? slatCf : 0;
      const cfB = cs ? (cs.cf ?? hinge) : 1;
      const g = loftFrames(pf.frames(a, b, { step: detail > 1 ? 2.5 : 0 }), {
        cf0: cfA, cf1: cfB, nChord: Math.round(nC * (cfB - cfA) + 3), capStart: false, capEnd: false,
      });
      solid.push(g);
    }
    // Root cap and tip cap of the whole box are closed by the fuselage / the tip closure.
    const wingGeo = merge(solid);
    parts.add(J.wing, wingGeo);
    parts.add(J.wing, mirrorZ(wingGeo));

    // Control surfaces.
    for (const s of flaps) {
      const cf = s.cf ?? hinge;
      const surf = hingedSurface(pf, s.z0 + 0.012, s.z1 - 0.012, cf, 1, { nChord: Math.round(nC * (1 - cf) + 4), drop: s.drop ?? 0.2, hingeCf: cf, teBlunt: 0.002 });
      for (const m of addHinged(root, J.wing, surf)) rig.flaps.push({ pivot: m.pivot, axis: m.axis });
    }
    for (const s of ails) {
      const cf = s.cf ?? hinge;
      const surf = hingedSurface(pf, s.z0 + 0.012, s.z1 - 0.012, cf, 1, { nChord: Math.round(nC * (1 - cf) + 4), drop: 0, hingeCf: cf, teBlunt: 0.002 });
      for (const m of addHinged(root, J.wing, surf)) rig.ailerons.push({ pivot: m.pivot, axis: m.axis, side: m.side });
    }
    // Slats (open as the flaps come out).
    for (const s of slats) {
      const surf = hingedSurface(pf, s.z0 + 0.01, s.z1 - 0.01, 0, slatCf, {
        nChord: Math.round(nC * slatCf) + 4, drop: 0.07, hingeCf: slatCf * 0.8, step: 0,
      });
      const map = (a) => Math.min(1, Math.max(0, a / (14 * DEG))) * 0.36;
      for (const m of addHinged(root, J.wing, surf, { invert: true, pivotFactory: () => mappedPivot(map) })) rig.flaps.push({ pivot: m.pivot, axis: m.axis });
    }
    // Spoilers.
    if (W.spoilers && detail > 0) {
      const sp = W.spoilers;
      const n = sp.n;
      const cfS = sp.cf ?? hinge - 0.12;
      for (let i = 0; i < n; i++) {
        const a = sp.z0 + ((sp.z1 - sp.z0) * i) / n;
        const b = sp.z0 + ((sp.z1 - sp.z0) * (i + 1)) / n;
        const surf = hingedSurface(pf, a + 0.015, b - 0.015, cfS, sp.cfEnd ?? hinge + 0.03, {
          nChord: 6, drop: -0.0, hingeCf: cfS, teBlunt: 0.0,
        });
        // A spoiler is a thin plate on the upper surface: scale the section thickness down around the skin by clipping with a shell.
        for (const m of addHinged(root, J.wing, surf, { invert: true })) rig.speedbrakes.push({ pivot: m.pivot, axis: m.axis, angle: sp.angle ?? 0.85 });
      }
    }
    // Flap-track canoes.
    if (W.canoes && detail > 1) {
      for (const cn of W.canoes) {
        const f = pf.frame(cn.z);
        const { lo } = airfoilYs(cn.cf ?? 0.78, f.t, f.m || 0.012);
        const p = f.p.clone().addScaledVector(f.c, cn.cf ?? 0.78).addScaledVector(f.u, lo * f.c.length() - cn.r * 0.55);
        const geo = canoe(cn.len, cn.r, 10);
        parts.add(J.nacelle, placed(geo, p.x, p.y, p.z));
        parts.add(J.nacelle, placed(geo, p.x, p.y, -p.z));
      }
    }
    this.tipFrames = this.buildTip(pf, tip);
    return pf;
  }

  // ---- wing tip: winglet / sharklet / raked / plain ----------------------------------------------------------------
  buildTip(pf, tipZ) {
    const { cfg, detail, J, parts, rig, root } = this;
    const W = cfg.wing;
    const tip = W.tip ?? { type: 'round' };
    const nC = this.nChord;
    const last = pf.frame(tipZ);
    const frames = [];
    const steps = detail > 1 ? 10 : 4;
    if (tip.type === 'winglet' || tip.type === 'sharklet') {
      // Blended winglet: the section path curves from the wing plane up to `cant` degrees.
      const h = tip.height;
      const r = tip.radius ?? h * 0.55;
      const cantEnd = (tip.cant ?? 78) * DEG;
      const c0 = last.c.length();
      const sweepTan = Math.tan((tip.sweep ?? 38) * DEG);
      let pos = last.p.clone();
      let cy = 0;
      let cz = 0;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const cant = cantEnd * smooth(Math.min(1, t * 1.15)) ** 0.9;
        if (i > 0) {
          const ds = (h / steps) * 1.0;
          cy += Math.sin(cant) * ds * (cant > 0.3 ? 1 : 1);
          cz += Math.cos(cant) * ds;
        }
        const chord = lerp(c0, tip.tipChord, t ** 0.9);
        const tw = (last.rec.tw ?? 0) * DEG + (tip.toe ?? 0) * DEG * t;
        const lePos = new THREE.Vector3(last.rec.x - sweepTan * Math.hypot(cy, cz) * smooth(t * 1.2) * 0.9 - 0, last.rec.y + cy, tipZ + cz);
        // account for chord taper about the 25% line so the hinge-less winglet keeps a straight c/4
        lePos.x += (c0 - chord) * 0.25 * (tip.keepQuarter ?? 0);
        const cv = new THREE.Vector3(-Math.cos(tw), -Math.sin(tw), 0).multiplyScalar(chord);
        const u = new THREE.Vector3(-Math.sin(tw), Math.cos(cant), -Math.sin(cant) * 1).normalize();
        // make u perpendicular to chord direction
        u.addScaledVector(cv.clone().normalize(), -u.dot(cv.clone().normalize())).normalize();
        frames.push({ p: lePos, c: cv, u, t: lerp(last.t, tip.t ?? 0.07, t), m: 0.008, v: (tipZ + cz) * pf.vs });
      }
      void pos;
      void r;
    } else if (tip.type === 'raked') {
      const ext = tip.ext;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const z = tipZ + ext * t;
        const chord = lerp(last.c.length(), tip.tipChord, t ** 0.8);
        const tw = (last.rec.tw ?? 0) * DEG;
        const cv = new THREE.Vector3(-Math.cos(tw), -Math.sin(tw), 0).multiplyScalar(chord);
        const u = new THREE.Vector3(-Math.sin(tw), Math.cos(tw), 0);
        const le = new THREE.Vector3(last.rec.x - tip.sweep * ext * t + (last.c.length() - chord) * 0.0, last.rec.y + (tip.rise ?? 0.15) * ext * t, z);
        frames.push({ p: le, c: cv, u, t: lerp(last.t, 0.065, t), m: 0.01, v: z * pf.vs });
      }
    } else {
      // plain: closing ogive over the last bit
      const ext = tip.ext ?? 0.18;
      for (let i = 0; i <= 5; i++) {
        const t = i / 5;
        const z = tipZ + ext * t;
        const k = Math.sqrt(Math.max(0.02, 1 - t * t * 0.97));
        const chord = last.c.length() * (0.25 + 0.75 * k);
        const tw = (last.rec.tw ?? 0) * DEG;
        const cv = new THREE.Vector3(-Math.cos(tw), -Math.sin(tw), 0).multiplyScalar(chord);
        const u = new THREE.Vector3(-Math.sin(tw), Math.cos(tw), 0);
        const le = new THREE.Vector3(last.rec.x - (last.c.length() - chord) * 0.25 * 0 + (last.c.length() - chord) * 0.0, last.rec.y, z);
        frames.push({ p: le, c: cv, u, t: last.t * k, m: 0.008, v: z * pf.vs });
      }
    }
    // First frame must coincide with the wing's tip section.
    frames[0] = pf.frame(tipZ);
    const geo = loftFrames(frames, { nChord: nC, capStart: false, capEnd: true, crease: 40 });
    parts.add(J.wing, geo);
    parts.add(J.wing, mirrorZ(geo));
    void rig;
    void root;
    return frames;
  }

  /** Point at the outer end of the tip (for lights): {p (top of winglet or tip), chord}. */
  tipPoint() {
    const f = this.tipFrames[this.tipFrames.length - 1];
    return { le: f.p.clone(), te: f.p.clone().add(f.c) };
  }

  // ---- fin (vertical stabiliser) and rudder ---------------------------------------------------------------------------
  buildFin() {
    const { cfg, detail, J, parts, root, rig } = this;
    const F = cfg.fin;
    const nC = this.nChord;
    const st = F.stations; // {y (height), x (LE), c, t}
    const pf = new Planform(st.map((s) => ({ z: s.y, x: s.x, y: 0, c: s.c, t: s.t ?? 0.09, tw: 0, m: 0 })));
    const frameAt = (h) => {
      const r = pf.at(h);
      const cv = new THREE.Vector3(-r.c, 0, 0);
      return { p: new THREE.Vector3(r.x, h, 0), c: cv, u: new THREE.Vector3(0, 0, 1), t: r.t, m: 0, v: h / (F.stations[F.stations.length - 1].y) };
    };
    const framesBetween = (a, b) => {
      const hs = [a];
      for (const s of st) if (s.y > a + 1e-3 && s.y < b - 1e-3) hs.push(s.y);
      hs.push(b);
      return hs.map(frameAt);
    };
    const h0 = F.stations[0].y;
    const h1 = F.stations[F.stations.length - 1].y;
    const rudderCf = F.hinge ?? 0.7;
    const rz0 = F.rudderFrom ?? h0 + 0.1;
    // Fixed fin: full chord below the rudder, forward part above.
    const fixedLow = loftFrames(framesBetween(h0, rz0), { cf0: 0, cf1: 1, nChord: nC, capStart: false, capEnd: false });
    const fixedUp = loftFrames(framesBetween(rz0, h1), { cf0: 0, cf1: rudderCf, nChord: Math.round(nC * rudderCf) + 3, capStart: false, capEnd: true });
    parts.add(J.fin, fixedLow);
    parts.add(J.fin, fixedUp);
    // Rudder: pivot along the hinge line.
    const rframes = framesBetween(rz0 + 0.012, h1);
    const rgeo = loftFrames(rframes, { cf0: rudderCf, cf1: 1, nChord: Math.round(nC * (1 - rudderCf)) + 4, capStart: true, capEnd: true, teBlunt: 0.002 });
    const hp = (f) => f.p.clone().addScaledVector(f.c, rudderCf);
    const a0 = hp(rframes[0]);
    const a1 = hp(rframes[rframes.length - 1]);
    const axis = a1.clone().sub(a0).normalize();
    rgeo.translate(-a0.x, -a0.y, -a0.z);
    const pivot = new THREE.Object3D();
    pivot.position.copy(a0);
    pivot.add(new THREE.Mesh(rgeo, J.fin));
    root.add(pivot);
    rig.rudders.push({ pivot, axis });
    this.finPlanform = pf;
    this.finFrameAt = frameAt;
    return pf;
  }

  // ---- horizontal stabiliser + elevators -----------------------------------------------------------------------------------
  buildStab() {
    const { cfg, detail, J, parts, root, rig } = this;
    const S = cfg.stab;
    const nC = this.nChord;
    const pf = new Planform(S.stations, 0.8 / S.stations[S.stations.length - 1].z);
    this.stabPlanform = pf;
    const hinge = S.hinge ?? 0.68;
    const z0 = S.rootZ ?? S.stations[0].z;
    const tip = pf.tipZ;
    const fixed = loftFrames(pf.frames(z0, tip), { cf0: 0, cf1: hinge, nChord: Math.round(nC * hinge) + 3, capStart: false, capEnd: true });
    parts.add(J.wing, fixed);
    parts.add(J.wing, mirrorZ(fixed));
    const surf = hingedSurface(pf, z0 + 0.02, tip - 0.02, hinge, 1, { nChord: Math.round(nC * (1 - hinge)) + 4, hingeCf: hinge, teBlunt: 0.002 });
    for (const m of addHinged(root, J.wing, surf)) rig.elevators.push({ pivot: m.pivot, axis: m.axis });
    // Tip cap (small closure so the stabiliser end is not open).
    return pf;
  }
}

export { std };
