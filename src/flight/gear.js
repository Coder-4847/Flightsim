import * as THREE from 'three';
import { G, approach, clamp } from './units.js';

// Landing gear and body-contact model. Each wheel is a spring-damper strut with
// tyre friction (rolling resistance, brakes, cornering). Extra "strike points"
// (nose, tail, wingtips, belly) make the airframe itself collide with the ground.

const UP = new THREE.Vector3(0, 1, 0);
const _r = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _f = new THREE.Vector3();
const _right = new THREE.Vector3();
const _force = new THREE.Vector3();
const _tq = new THREE.Vector3();
const _qInv = new THREE.Quaternion();

export class LandingGear {
  /**
   * @param spec    aircraft.gear (positions are metres from the CG, +X fwd, +Y up, +Z right)
   * @param strikes aircraft.strike points
   * @param refMass mass the struts are tuned for (kg)
   * @param cgX     CG x (for load sharing), usually 0
   */
  constructor(spec, strikes, refMass) {
    this.spec = spec;
    this.retractable = spec.retractable;
    this.extension = 1; // 0 = fully up, 1 = down and locked
    this.target = 1;
    this.steerAngle = 0;
    this.weightOnWheels = false;
    this.touchdown = null; // last touchdown event
    this.strike = null; // last body strike event {speed, sink, load}
    this.wasOnGround = false;

    const travel = spec.travel;
    const kTotal = (refMass * G) / (0.4 * travel); // ~40% of travel used when static
    const zeta = 0.45;
    const nose = spec.nose;
    const mains = [spec.mainLeft, spec.mainRight];
    // Static load sharing from the CG position (CG at x = 0).
    const mainX = (mains[0].x + mains[1].x) / 2;
    const noseShare = clamp(-mainX / (nose.x - mainX), 0.05, 0.35);
    const shares = [noseShare, (1 - noseShare) / 2, (1 - noseShare) / 2];
    this.wheels = [nose, ...mains].map((pos, i) => {
      const k = kTotal * shares[i];
      return {
        name: ['nose', 'mainLeft', 'mainRight'][i],
        pos: new THREE.Vector3(pos.x, pos.y, pos.z),
        isNose: i === 0,
        brakeable: i > 0,
        k,
        c: 2 * zeta * Math.sqrt(k * refMass * shares[i]),
        travel,
        compression: 0,
        load: 0,
        spin: 0,
        radius: spec.wheelRadius ?? 0.3,
        onGround: false,
      };
    });
    const kBody = kTotal * 2.5;
    this.strikes = (strikes ?? []).map((pos) => ({
      pos: new THREE.Vector3(pos.x, pos.y, pos.z),
      k: kBody,
      c: 2 * 0.5 * Math.sqrt(kBody * refMass * 0.4),
      load: 0,
    }));
    // Lowest wheel (for spawning on the ground).
    this.height = -Math.min(...this.wheels.map((w) => w.pos.y));
    this.staticCompression = 0.4 * travel;
  }

  setLever(down) {
    if (!this.retractable) return;
    // Squat switch: the gear cannot be raised while weight is on the wheels.
    if (!down && this.weightOnWheels) return;
    this.target = down ? 1 : 0;
  }

  get locked() {
    return this.extension >= 0.999;
  }

  /**
   * Accumulates ground forces into `forceOut` (world, N) and `torqueOut` (body, N*m).
   * `ctl`: {brakeLeft, brakeRight, steer}. `surface(x,z)`: {rolling, friction}.
   */
  update(dt, state, ctl, world, forceOut, torqueOut) {
    const { pos, vel, q, w } = state;
    this.extension = this.retractable
      ? approach(this.extension, this.target, (dt / this.spec.transitTime) * (this.rateScale ?? 1))
      : 1;
    _qInv.copy(q).invert();
    _w.copy(w).applyQuaternion(q); // body rates -> world
    let anyContact = false;
    let maxSink = 0;

    if (this.extension > 0.9) {
      for (const wh of this.wheels) {
        _r.copy(wh.pos).applyQuaternion(q);
        _p.copy(pos).add(_r);
        _v.copy(_w).cross(_r).add(vel);
        const ground = world.groundHeight(_p.x, _p.z);
        const pen = ground - _p.y;
        wh.compression = clamp(pen, 0, wh.travel);
        if (pen <= 0) {
          wh.load = 0;
          wh.onGround = false;
          continue;
        }
        const compRate = -_v.y;
        let n = wh.k * Math.min(pen, wh.travel) + (compRate > 0 ? wh.c : wh.c * 0.5) * compRate;
        if (pen > wh.travel) n += wh.k * 10 * (pen - wh.travel); // bottomed out
        n = clamp(n, 0, 25 * state.mass * G);
        wh.load = n;
        wh.onGround = n > 1;
        if (n <= 0) continue;
        anyContact = true;
        maxSink = Math.max(maxSink, -_v.y);

        // Wheel axes on the ground plane.
        _f.set(1, 0, 0).applyQuaternion(q);
        if (wh.isNose && this.steerAngle !== 0) {
          _f.applyAxisAngle(UP, -this.steerAngle); // steering right turns the nose toward +Z (right)
        }
        _f.y = 0;
        if (_f.lengthSq() < 1e-6) _f.set(1, 0, 0);
        _f.normalize();
        _right.crossVectors(_f, UP);
        const vf = _v.dot(_f);
        const vs = _v.dot(_right);
        const surf = world.surface(_p.x, _p.z);

        const brake = wh.brakeable ? (wh.name === 'mainLeft' ? ctl.brakeLeft : ctl.brakeRight) : 0;
        let fx = -n * (surf.rolling * Math.tanh(vf / 0.6) + this.spec.brakeMu * brake * Math.tanh(vf / 0.12));
        let fs = -n * surf.friction * Math.tanh(vs / (0.15 * (Math.abs(vf) + 1.5)));
        const limit = n * surf.friction;
        const mag = Math.hypot(fx, fs);
        if (mag > limit) {
          fx *= limit / mag;
          fs *= limit / mag;
        }
        wh.spin += (vf / wh.radius) * dt;

        _force.copy(UP).multiplyScalar(n).addScaledVector(_f, fx).addScaledVector(_right, fs);
        forceOut.add(_force);
        _tq.crossVectors(_r, _force).applyQuaternion(_qInv);
        torqueOut.add(_tq);
      }
    } else {
      for (const wh of this.wheels) { wh.onGround = false; wh.load = 0; wh.compression = 0; }
    }

    // Airframe strike points.
    let strikeLoad = 0;
    let strikeSink = 0;
    for (const sp of this.strikes) {
      _r.copy(sp.pos).applyQuaternion(q);
      _p.copy(pos).add(_r);
      const pen = world.groundHeight(_p.x, _p.z) - _p.y;
      if (pen <= 0) { sp.load = 0; continue; }
      _v.copy(_w).cross(_r).add(vel);
      const n = clamp(sp.k * pen + sp.c * Math.max(-_v.y, 0), 0, 40 * state.mass * G);
      sp.load = n;
      strikeLoad = Math.max(strikeLoad, n);
      strikeSink = Math.max(strikeSink, -_v.y);
      const horiz = Math.hypot(_v.x, _v.z) || 1;
      _force.set(-_v.x / horiz, 0, -_v.z / horiz).multiplyScalar(0.6 * n * Math.tanh(horiz / 0.5)).addScaledVector(UP, n);
      forceOut.add(_force);
      _tq.crossVectors(_r, _force).applyQuaternion(_qInv);
      torqueOut.add(_tq);
    }
    this.strikeLoad = strikeLoad;
    if (strikeLoad > 0) this.strike = { sink: strikeSink, load: strikeLoad };

    this.weightOnWheels = anyContact;
    if (anyContact && !this.wasOnGround) {
      this.touchdown = { sink: maxSink, time: state.time, speed: vel.length() };
    }
    this.wasOnGround = anyContact;
  }
}
