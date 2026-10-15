import * as THREE from 'three';
import { isa } from './atmosphere.js';
import {
  calibrateStall, deriveAero, flapConfig, groundEffect, liftCoefficient, waveDrag,
} from './aerodynamics.js';
import { Engine } from './engine.js';
import { FlightControlSystem } from './fcs.js';
import { LandingGear } from './gear.js';
import { AircraftSystems } from './systems.js';
import { DEG, FPM, G, KT, approach, clamp } from './units.js';

// 6-DOF rigid-body flight model.
//
// Frames: world +X east, +Y up, -Z north. Body +X forward (nose), +Y up, +Z right wing,
// origin at the centre of gravity. Aerodynamics use standard flight-dynamics sign
// conventions (see aerodynamics.js); body-axis torques are converted at the end:
//   body torque = (roll L, -yaw N, pitch M)   (body +Y rotates the nose LEFT)

const _vAir = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _qInv = new THREE.Quaternion();
const _force = new THREE.Vector3();
const _torque = new THREE.Vector3();
const _gearForce = new THREE.Vector3();
const _gearTorque = new THREE.Vector3();
const _aeroForceB = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _wind = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _gust = new THREE.Vector3();
const _flap = {};
const _cl = {};

export class FlightModel {
  constructor(spec, world) {
    this.spec = spec;
    this.world = world;
    this.derived = deriveAero(spec);
    // Calibrate the stall blend per flap stage so the CL peak matches the stall speeds in the data.
    this.derived.stages.forEach((st) => calibrateStall(st, this.derived.clAlpha));
    this.gear = new LandingGear(spec.gear, spec.strike, spec.mass.ref);
    this.engines = spec.engines.positions.map((p) => new Engine(spec.engines.spec, p));
    this.fcs = new FlightControlSystem(spec);
    this.sys = new AircraftSystems(spec);
    this.crossfeed = false; // fuel crossfeed valve: any tank may feed any engine
    this.assist = 'light';

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.prevPos = new THREE.Vector3(); // state at the start of the last step, for render interpolation
    this.prevQ = new THREE.Quaternion();
    this.w = new THREE.Vector3(); // body rates (x roll-right, y yaw-left, z pitch-up), rad/s
    this.time = 0;
    this.events = [];
    this.crashed = null;

    this.controls = {
      pitch: 0, roll: 0, yaw: 0, trim: 0,
      throttle: this.engines.map(() => 0),
      brakeLeft: 0, brakeRight: 0, parkingBrake: false,
      flapsStage: 0, gearDown: true, speedbrake: false, steer: 0, lights: true, mixture: 1, prop: 1,
    };
    this.surfaces = { elevator: 0, aileron: 0, rudder: 0, flap: 0, speedbrake: 0 };
    // Optional multi-tank layout (spec.tanks): each tank has its own arm for the CG calculation and
    // feeds either every engine or a listed subset, drawn in ascending `order`.
    this.tanks = (spec.tanks ?? []).map((t) => ({ ...t, content: 0 }));
    this._fuel = 0;
    this.fuel = spec.mass.fuelStart;
    this.damage = { overspeed: 0, overG: 0, landing: 0, scrape: 0 };
    this.air = {
      tas: 0, ias: 0, mach: 0, sigma: 1, rho: 1.225, qbar: 0, alpha: 0, beta: 0, cl: 0, cd: 0,
      separation: 0, nz: 1, alphaStall: 0.28,
    };
    this.nzPeak = 1;
    this.rates = { p: 0, q: 0, r: 0 };
    this.agl = 0;
    this.vs = 0;
    this.stallWarning = false;
    this.refCg = spec.cg.ref;
    this.damageEnabled = true; // false: overspeed, over-g, hard landings and scrapes do not destroy the aircraft
    this.reset({ mode: 'runway' });
  }

  get fuel() {
    return this.tanks.length ? this.tanks.reduce((sum, t) => sum + t.content, 0) : this._fuel;
  }

  set fuel(total) {
    if (!this.tanks.length) { this._fuel = total; return; }
    // Fill the tanks that burn last first (reverse burn order), the way a fuelling truck loads them;
    // tanks that burn together (same order) share the load in proportion to their capacity.
    let left = Math.max(0, total);
    for (const t of this.tanks) t.content = 0;
    const orders = [...new Set(this.tanks.map((t) => t.order))].sort((a, b) => b - a);
    for (const order of orders) {
      const group = this.tanks.filter((t) => t.order === order);
      const capacity = group.reduce((sum, t) => sum + t.capacity, 0);
      const put = Math.min(capacity, left);
      for (const t of group) t.content = (put * t.capacity) / capacity;
      left -= put;
    }
  }

  /** Draw `amount` kg for engine `index` from the tanks that feed it, in burn order. */
  #drawFuel(index, amount) {
    if (!this.tanks.length) { this._fuel = Math.max(0, this._fuel - amount); return; }
    const feeding = this.tanks.filter((t) => t.content > 0 && t.pump !== false && (this.crossfeed || !t.feeds || t.feeds.includes(index)))
      .sort((a, b) => a.order - b.order);
    let left = amount;
    for (const t of feeding) {
      const take = Math.min(t.content, left);
      t.content -= take;
      left -= take;
      if (left <= 0) break;
    }
  }

  /** Remove fuel for a leak or a dump: from the fullest tanks first. */
  drainFuel(amount) {
    if (!this.tanks.length) { this._fuel = Math.max(0, this._fuel - amount); return; }
    let left = amount;
    for (const t of [...this.tanks].sort((a, b) => b.content / b.capacity - a.content / a.capacity)) {
      const take = Math.min(t.content, left);
      t.content -= take;
      left -= take;
      if (left <= 0) break;
    }
  }

  crashWith(reason) { if (!this.crashed) this.#crash(reason); }

  /** True when engine `index` still has a tank to draw from. */
  #hasFuelFor(index) {
    if (!this.tanks.length) return this._fuel > 0;
    return this.tanks.some((t) => t.content > 0 && t.pump !== false && (this.crossfeed || !t.feeds || t.feeds.includes(index)));
  }

  get mass() {
    return this.spec.mass.empty + this.spec.mass.payload + this.fuel;
  }

  // ---- placement --------------------------------------------------------------
  /**
   * @param init.mode 'runway' | 'air' | 'final'
   * @param init.x,z  position (metres); runway mode uses the threshold
   * @param init.heading degrees (0 = north)
   * @param init.altitude metres MSL (air), init.distance metres from threshold (final)
   */
  reset(init = {}) {
    const spec = this.spec;
    this.time = 0;
    this.events.length = 0;
    this.crashed = null;
    this.fuel = init.fuel ?? spec.mass.fuelStart;
    this.damage = { overspeed: 0, overG: 0, landing: 0, scrape: 0 };
    this.strikeReported = false;
    this.nzPeak = 1;
    this.w.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.gear.touchdown = null;
    this.gear.strike = null;
    this.gear.wasOnGround = false;
    this.gear.weightOnWheels = false;
    this.stalled = false;
    this.controls.pitch = this.controls.roll = this.controls.yaw = this.controls.trim = 0;
    this.controls.throttle.fill(0);
    this.controls.brakeLeft = this.controls.brakeRight = 0;
    this.controls.speedbrake = false;
    this.surfaces.elevator = this.surfaces.aileron = this.surfaces.rudder = this.surfaces.speedbrake = 0;
    this.sys.reset();
    this.crossfeed = false;
    this.controls.mixture = 1;
    this.controls.prop = 1;
    this.tanks.forEach((t) => { t.pump = true; });
    this.engines.forEach((e) => { e.failed = false; e.fire = false; e.spool = spec.engines.spec.idle ?? 0.1; });

    const heading = (init.heading ?? 0) * DEG;
    const mode = init.mode ?? 'runway';
    if (mode === 'runway') {
      this.controls.flapsStage = spec.flaps.takeoffStage ?? 0;
      this.surfaces.flap = spec.flaps.stages[this.controls.flapsStage].deg;
      this.gear.extension = this.gear.target = 1;
      this.controls.gearDown = true;
      this.controls.parkingBrake = true;
      const x = init.x ?? 0;
      const z = init.z ?? 0;
      this.#setOrientation(heading, 0, 0);
      this.pos.set(x, this.world.groundHeight(x, z) + this.gear.height - this.gear.staticCompression, z);
      this.#settleOnGround();
      this.prevPos.copy(this.pos);
      this.prevQ.copy(this.q);
      return;
    }
    // Airborne starts: steady, trimmed flight at the requested speed.
    const speed = init.speed ?? spec.speeds.cruise * KT;
    const gamma = (init.pathAngle ?? 0) * DEG;
    const config = mode === 'final' ? 'landing' : 'clean';
    this.controls.flapsStage = config === 'landing' ? spec.flaps.landingStage : 0;
    this.surfaces.flap = spec.flaps.stages[this.controls.flapsStage].deg;
    const gearDown = config === 'landing' || !spec.gear.retractable;
    this.gear.extension = this.gear.target = gearDown ? 1 : 0;
    this.controls.gearDown = gearDown;
    this.controls.parkingBrake = false;
    this.pos.set(init.x ?? 0, init.altitude ?? 1000, init.z ?? 0);
    this.agl = this.pos.y - this.world.groundHeight(this.pos.x, this.pos.z);
    this.#setTrimmedFlight(heading, speed, gamma);
    this.prevPos.copy(this.pos);
    this.prevQ.copy(this.q);
  }

  #setOrientation(heading, pitch, bank) {
    // Intrinsic yaw -> pitch -> roll. Heading h (0 = north) is a rotation of (90deg - h) about world +Y.
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2 - heading);
    const pit = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pitch);
    const rol = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), bank);
    this.q.copy(yaw).multiply(pit).multiply(rol).normalize();
  }

  #settleOnGround() {
    // Let the struts settle with the brakes on before the player sees anything.
    for (let i = 0; i < 360; i++) this.step(1 / 120, true);
    this.time = 0;
    this.events.length = 0;
    this.gear.touchdown = null;
    this.vel.set(0, 0, 0);
    this.w.set(0, 0, 0);
    this.controls.parkingBrake = false;
  }

  /** Initialise level (or gliding) flight with elevator trim and throttle solved for equilibrium. */
  #setTrimmedFlight(heading, speed, gamma) {
    const spec = this.spec;
    const env = isa(this.pos.y);
    const eas = speed; // the requested speed is indicated (equivalent) airspeed
    const tas = eas / Math.sqrt(env.sigma);
    const qbar = 0.5 * 1.225 * eas * eas; // equals 0.5 * rho * TAS^2
    const flap = flapConfig(this.derived, this.surfaces.flap, {});
    const clNeeded = (this.mass * G * Math.cos(gamma)) / (qbar * spec.wing.area);
    const alpha = (clNeeded - flap.cl0) / this.derived.clAlpha;
    this.#setOrientation(heading, gamma + alpha, 0);
    // Velocity runs along the flight path (pitch minus alpha above the horizon).
    const dir = new THREE.Vector3(Math.sin(heading) * Math.cos(gamma), Math.sin(gamma), -Math.cos(heading) * Math.cos(gamma));
    this.vel.copy(dir).multiplyScalar(tas);
    this.w.set(0, 0, 0);

    // Throttle: bisect so thrust balances drag + weight component along the path.
    const air = this.#computeAero(0, true);
    const dragForce = air.cd * qbar * spec.wing.area;
    const needed = dragForce + this.mass * G * Math.sin(gamma);
    const e = { sigma: env.sigma, mach: tas / env.speedOfSound, tas };
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const t = this.engines.reduce((sum, eng) => sum + eng.steadyThrust(mid, e), 0);
      if (t < needed) lo = mid; else hi = mid;
    }
    const throttle = clamp(hi, 0.05, 1);
    this.controls.throttle.fill(throttle);
    this.engines.forEach((eng) => eng.settleAt(throttle));

    // Elevator trim from the pitch-moment balance.
    const cmOther = this.#pitchMoment(air, 0);
    const elevMax = spec.controls.elevatorUp * DEG;
    const thrustSteady = this.engines.reduce((sum, eng) => sum + eng.steadyThrust(throttle, e), 0);
    const tailRatio = this.#tailRatio(air, thrustSteady);
    // Engines above/below the CG add a pitching moment (nose-down for engines above the CG).
    const thrustMoment = this.engines.reduce((sum, eng) => sum - eng.position.y * eng.steadyThrust(throttle, e), 0);
    const cmThrust = thrustMoment / (qbar * spec.wing.area * spec.wing.chord);
    this.controls.trim = clamp(-(cmOther + cmThrust) / (spec.aero.cmDe * elevMax * tailRatio), -0.9, 0.9);
    this.surfaces.elevator = this.controls.trim * elevMax;
    this.fcs.reset(gamma + alpha, this.controls.trim);
  }

  // ---- aerodynamics -----------------------------------------------------------
  /** Fills this.air for the current state (or a trim-solver probe with `probe`). */
  #computeAero(unusedHeight, probe = false) {
    const spec = this.spec;
    const air = this.air;
    const env = isa(this.pos.y);
    this.world.wind(this.pos, this.time, _wind);
    _vAir.copy(this.vel).sub(_wind);
    _qInv.copy(this.q).invert();
    _vb.copy(_vAir).applyQuaternion(_qInv);
    const tas = _vb.length();
    air.tas = tas;
    air.rho = env.rho;
    air.sigma = env.sigma;
    air.mach = tas / env.speedOfSound;
    air.ias = tas * Math.sqrt(env.sigma);
    air.qbar = 0.5 * env.rho * tas * tas;
    if (!probe && tas < 0.01) return air;
    air.alpha = tas > 0.5 ? Math.atan2(-_vb.y, _vb.x) : 0;
    air.beta = tas > 0.5 ? Math.asin(clamp(_vb.z / tas, -1, 1)) : 0;

    const flap = flapConfig(this.derived, this.surfaces.flap, _flap);
    air.alphaStall = flap.alphaStall;
    liftCoefficient(air.alpha, flap, this.derived.clAlpha, _cl);
    const ge = groundEffect(Math.max(this.agl, 0.1) + (spec.geometry.wingHeight ?? 0), spec.wing.span);
    air.cl = _cl.cl * ge.liftFactor;
    air.separation = _cl.separation;
    const a = spec.aero;
    const gear = this.gear.extension;
    air.cd = a.cd0 + flap.cd + a.gearCd * gear
      + a.speedbrakeCd * this.surfaces.speedbrake
      + this.derived.inducedK * air.cl * air.cl * ge.inducedFactor
      + waveDrag(air.mach, a)
      + _cl.separation * 1.1 * Math.sin(air.alpha) ** 2
      + 0.5 * air.beta * air.beta;
    return air;
  }

  /** Pitch-moment coefficient from everything except the elevator (airframe, flaps, CG position, stall break). */
  #pitchMoment(air, qHat) {
    const a = this.spec.aero;
    const flap = flapConfig(this.derived, this.surfaces.flap, _flap);
    const dh = this.#cgFraction() - this.refCg; // CG aft of the reference reduces stability
    const stallSign = Math.sign(air.alpha) || 1;
    return a.cm0 + flap.cm + a.cmAlpha * air.alpha + a.cmq * qHat + air.cl * dh - 0.22 * air.separation * stallSign;
  }

  /** Ratio of dynamic pressure at the tail to free-stream (propeller slipstream raises it). */
  #tailRatio(air, thrustTotal) {
    const wash = this.spec.aero.propwash;
    if (!wash || air.qbar < 1) return 1;
    const disc = this.spec.engines.spec.propArea * this.engines.length;
    const vi = Math.sqrt(Math.max(thrustTotal, 0) / (2 * air.rho * disc));
    const vt = air.tas + wash * vi;
    return (vt * vt) / (air.tas * air.tas);
  }

  #cgFraction() {
    const { cg, mass } = this.spec;
    if (this.tanks.length) {
      const dry = mass.empty + mass.payload;
      const moment = dry * cg.empty + this.tanks.reduce((sum, t) => sum + t.content * t.arm, 0);
      return moment / (dry + this.fuel);
    }
    return cg.empty + (cg.full - cg.empty) * clamp(this.fuel / mass.fuelCapacity, 0, 1);
  }

  // ---- simulation step ------------------------------------------------------------
  step(dt, settling = false) {
    if (this.crashed) return;
    const spec = this.spec;
    const c = this.controls;
    this.prevPos.copy(this.pos);
    this.prevQ.copy(this.q);
    this.time += dt;
    this.agl = this.pos.y - this.world.groundHeight(this.pos.x, this.pos.z);

    const air = this.#computeAero(0);
    const mass = this.mass;
    const ref = spec.mass.ref;
    const inertia = spec.inertia;
    const scale = mass / ref;
    const Ix = inertia.roll * scale;
    const Iy = inertia.yaw * scale; // body Y (up) axis
    const Iz = inertia.pitch * scale; // body Z (right) axis

    // Standard-axis body rates: p roll right, q pitch up, r yaw right.
    const p = this.w.x;
    const q = this.w.z;
    const r = -this.w.y;
    this.rates.p = p; this.rates.q = q; this.rates.r = r;

    // Pilot input -> control surfaces.
    const bankAngle = this.#bank();
    const pitchAngle = this.#pitch();
    const cmd = this.fcs.update(dt, c, {
      p, q, r, alpha: air.alpha, beta: air.beta, bank: bankAngle, pitch: pitchAngle,
      pathAngle: Math.asin(clamp(this.vel.y / Math.max(this.vel.length(), 1), -1, 1)),
      qbar: air.qbar, tas: air.tas, alphaStall: air.alphaStall,
    }, this.assist, c.trim);
    const ctl = spec.controls;
    const surf = this.surfaces;
    const sys = this.sys;
    const auth = sys.controlAuthority;
    const slew = ctl.rate * DEG * dt * sys.controlRate;
    const elevTarget = cmd.elevator * ctl.elevatorUp * DEG * auth; // symmetric authority; elevatorDown only limits the visual travel
    surf.elevator = approach(surf.elevator, elevTarget, slew);
    surf.aileron = approach(surf.aileron, cmd.aileron * ctl.aileron * DEG * auth, slew);
    surf.rudder = approach(surf.rudder, cmd.rudder * ctl.rudder * DEG * auth, slew);
    if (sys.jam) surf[sys.jam.axis] = sys.jam.value;
    const flapTarget = sys.flapStuck ? surf.flap : spec.flaps.stages[c.flapsStage].deg;
    surf.flap = approach(surf.flap, flapTarget, spec.flaps.rate * dt);
    surf.speedbrake = approach(surf.speedbrake, c.speedbrake ? 1 : 0, dt / 2);
    if (sys.gearEmergency) this.gear.target = 1;
    else if (!sys.gearLocked) this.gear.setLever(c.gearDown);

    // Engines.
    const env = { sigma: air.sigma, mach: air.mach, tas: air.tas };
    let thrustTotal = 0;
    let fuelFlow = 0;
    for (let i = 0; i < this.engines.length; i++) {
      const e = this.engines[i];
      e.mixture = c.mixture ?? 1;
      e.propLever = c.prop ?? 1;
      e.step(dt, c.throttle[i], env, this.#hasFuelFor(i));
      thrustTotal += e.thrust;
      fuelFlow += e.fuelFlow;
      if (!settling) this.#drawFuel(i, e.fuelFlow * dt);
    }

    // Aerodynamic forces and moments.
    const S = spec.wing.area;
    const b = spec.wing.span;
    const cbar = spec.wing.chord;
    const a = spec.aero;
    const qbar = air.qbar;
    _aeroForceB.set(0, 0, 0);
    _torque.set(0, 0, 0);
    if (air.tas > 0.5) {
      const vx = _vb.x / air.tas;
      const vy = _vb.y / air.tas;
      const lh = Math.hypot(vx, vy) || 1;
      const liftDirX = -vy / lh;
      const liftDirY = vx / lh;
      const CY = a.cyBeta * air.beta + a.cyDr * surf.rudder;
      const qs = qbar * S;
      _aeroForceB.set(
        -air.cd * qs * vx + air.cl * qs * liftDirX,
        -air.cd * qs * vy + air.cl * qs * liftDirY,
        -air.cd * qs * (_vb.z / air.tas) + CY * qs,
      );

      const vHat = Math.max(air.tas, 12);
      const pHat = (p * b) / (2 * vHat);
      const qHat = (q * cbar) / (2 * vHat);
      const rHat = (r * b) / (2 * vHat);
      const sep = air.separation;
      const elevFrac = surf.elevator / (ctl.elevatorUp * DEG);
      const rudFrac = surf.rudder / (ctl.rudder * DEG);
      const ailFrac = surf.aileron / (ctl.aileron * DEG);
      const tailRatio = this.#tailRatio(air, thrustTotal);

      // Pitch (nose-up positive). Elevator effectiveness follows tail dynamic pressure.
      const cm = this.#pitchMoment(air, qHat)
        + a.cmDe * (ctl.elevatorUp * DEG) * elevFrac * tailRatio * (1 - 0.4 * sep);
      const M = qbar * S * cbar * cm;
      // Roll (right wing down positive). Stalled wings lose roll damping (autorotation).
      const cl = a.clBeta * air.beta + a.clp * (1 - 1.5 * sep) * pHat + a.clr * rHat
        + a.clDa * ailFrac * (ctl.aileron * DEG) * (1 - 0.65 * sep) + a.clDr * rudFrac * (ctl.rudder * DEG) * tailRatio;
      const Lroll = qbar * S * b * cl;
      // Yaw (nose right positive).
      const cn = a.cnBeta * air.beta + a.cnr * rHat + a.cnDr * rudFrac * (ctl.rudder * DEG) * tailRatio
        + a.cnDa * ailFrac * (ctl.aileron * DEG);
      const Nyaw = qbar * S * b * cn;

      _torque.set(Lroll, -Nyaw, M); // convert to body axes
    }

    // Thrust, engine offsets and propeller reaction effects.
    for (const e of this.engines) {
      _aeroForceB.x += e.thrust;
      _torque.y += e.position.z * e.thrust; // engine on the right pushes the nose left
      _torque.z += -e.position.y * e.thrust; // engine above the CG pitches the nose down
      if (spec.engines.spec.propTorque) {
        const f = e.thrust / Math.max(spec.engines.spec.staticThrust, 1);
        _torque.x += -spec.engines.spec.propTorque * f; // reaction roll, opposite the prop rotation
        _torque.y += spec.engines.spec.propYaw * f * Math.max(0, 1 - air.tas / 60); // slipstream/P-factor pulls left at low speed
      }
    }
    this.air.nz = (_aeroForceB.y) / (mass * G);

    // World forces: aero+thrust, gravity, ground.
    _force.copy(_aeroForceB).applyQuaternion(this.q);
    _force.y -= mass * G;
    _gearForce.set(0, 0, 0);
    _gearTorque.set(0, 0, 0);
    const brakeAll = c.parkingBrake ? 1 : 0;
    const gearCtl = {
      brakeLeft: Math.max(c.brakeLeft, brakeAll) * sys.brakePower,
      brakeRight: Math.max(c.brakeRight, brakeAll) * sys.brakePower,
    };
    const speedForSteer = Math.hypot(this.vel.x, this.vel.z);
    // Steering authority falls off quickly with speed so keyboard taps stay controllable.
    this.gear.steerAngle = sys.steeringWorks ? c.steer * spec.gear.steerMax * DEG / (1 + (speedForSteer / 12) ** 2) : 0;
    this.gear.update(dt, { pos: this.pos, vel: this.vel, q: this.q, w: this.w, mass, time: this.time }, gearCtl, this.world, _gearForce, _gearTorque);
    _force.add(_gearForce);
    _torque.add(_gearTorque);

    // Turbulence kicks the aircraft in all three axes; light aircraft feel it more than heavy ones.
    if (this.world.gustAccel) {
      this.world.gustAccel(this.pos, this.time, _gust);
      const k = clamp(Math.sqrt(1500 / mass), 0.25, 1.2) * clamp(air.tas / 60, 0, 1.5) * (this.gear.weightOnWheels ? 0 : 1);
      this.w.x += _gust.x * k * dt;
      this.w.y += _gust.y * k * dt;
      this.w.z += _gust.z * k * dt;
    }

    // Integrate translation (semi-implicit Euler).
    this.vel.addScaledVector(_force, dt / mass);
    this.pos.addScaledVector(this.vel, dt);
    this.vs = this.vel.y;

    // Integrate rotation: I*dw/dt = T - w x (I*w), body inertia diag(Ix, Iy, Iz).
    const w = this.w;
    const wxIw = _tmp.set(
      w.y * Iz * w.z - w.z * Iy * w.y,
      w.z * Ix * w.x - w.x * Iz * w.z,
      w.x * Iy * w.y - w.y * Ix * w.x,
    );
    w.x += ((_torque.x - wxIw.x) / Ix) * dt;
    w.y += ((_torque.y - wxIw.y) / Iy) * dt;
    w.z += ((_torque.z - wxIw.z) / Iz) * dt;
    // Quaternion kinematics: q += 0.5 * q * (0, w) * dt
    _dq.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0).premultiply(this.q);
    this.q.set(this.q.x + _dq.x, this.q.y + _dq.y, this.q.z + _dq.z, this.q.w + _dq.w).normalize();
    // (set from components: premultiply gives q * dq ordering as required for body rates)

    if (!settling) {
      sys.update(dt, this, air);
      this.#checkLimits(dt, air);
    }
  }

  // ---- damage, limits, events ----------------------------------------------------------
  #checkLimits(dt, air) {
    const lim = this.spec.limits;
    const dmg = this.damage;
    this.nzPeak = Math.max(this.nzPeak, air.nz);

    const overspeed = air.ias / (lim.vne * KT);
    const vulnerable = this.damageEnabled;
    if (vulnerable && (overspeed > 1 || (lim.mmo && air.mach > lim.mmo))) {
      dmg.overspeed += dt * Math.max(overspeed - 1, air.mach - (lim.mmo ?? 9)) * 2.5 + (overspeed > 1.2 ? 1 : 0);
    }
    if (dmg.overspeed >= 1) return this.#crash('Structural failure: overspeed');
    if (vulnerable && (air.nz > lim.nzPos * 1.45 || air.nz < lim.nzNeg * 3.2)) { // negative g is very forgiving: the pilot has to try hard to break the airframe
      return this.#crash(air.nz > 0 ? 'Structural failure: wing overload' : 'Structural failure: negative g overload');
    }

    const td = this.gear.touchdown;
    if (td && !td.handled) {
      td.handled = true;
      const sink = td.sink;
      td.fpm = sink / FPM;
      td.grade = gradeLanding(sink, lim);
      this.events.push({ type: 'touchdown', ...td });
      if (vulnerable && sink > lim.crashLanding) return this.#crash(`Crashed on landing (${Math.round(td.fpm)} ft/min)`);
      if (sink > lim.hardLanding) dmg.landing = Math.min(1, dmg.landing + 0.5);
    }
    const strike = this.gear.strike;
    if (strike) {
      const horizontal = Math.hypot(this.vel.x, this.vel.z);
      if (!this.strikeReported) {
        this.strikeReported = true;
        this.events.push({ type: 'strike', where: 'airframe' });
      }
      // A hard impact destroys the aircraft; a scrape (tail strike, belly slide) builds up damage over time.
      if (strike.sink > 6 || (vulnerable && strike.load > 30 * this.mass * G)) {
        return this.#crash('Crashed: airframe struck the ground');
      }
      dmg.scrape = (dmg.scrape ?? 0) + dt * (strike.load / (this.mass * G)) * Math.min(horizontal / 40, 1.5) * 0.35;
      if (vulnerable && dmg.scrape >= 1) return this.#crash('Airframe destroyed by ground scraping');
      this.gear.strike = null;
    } else if (this.gear.strikeLoad === 0) {
      this.strikeReported = false;
    }
    if (this.pos.y < this.world.groundHeight(this.pos.x, this.pos.z) - 2) {
      return this.#crash('Crashed into terrain');
    }
    const stalled = air.separation > 0.5 && !this.gear.weightOnWheels;
    if (stalled && !this.stalled) this.events.push({ type: 'stall' });
    this.stalled = stalled;
    this.stallWarning = air.alpha > 0.88 * air.alphaStall && air.tas > 8 && !this.gear.weightOnWheels;
  }

  #crash(reason) {
    this.crashed = { reason, time: this.time };
    this.events.push({ type: 'crash', reason });
    this.engines.forEach((e) => { e.thrust = 0; });
  }

  /** Interpolated render pose between the last two physics steps (alpha 0..1). */
  samplePose(alpha, outPos, outQuat) {
    outPos.lerpVectors(this.prevPos, this.pos, alpha);
    outQuat.slerpQuaternions(this.prevQ, this.q, alpha);
  }

  // ---- derived readouts -------------------------------------------------------------------
  #forward() { return _tmp.set(1, 0, 0).applyQuaternion(this.q); }
  #pitch() { return Math.asin(clamp(this.#forward().y, -1, 1)); }
  #bank() {
    const right = new THREE.Vector3(0, 0, 1).applyQuaternion(this.q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.q);
    return Math.atan2(-right.y, up.y);
  }

  /** Snapshot for the HUD and cockpit instruments (display units noted). */
  get telemetry() {
    const f = new THREE.Vector3(1, 0, 0).applyQuaternion(this.q);
    let heading = Math.atan2(f.x, -f.z) / DEG;
    if (heading < 0) heading += 360;
    const air = this.air;
    return {
      ias: this.sys.shownIas(air, this.pos.y) / KT, iasTrue: air.ias / KT, tas: air.tas / KT, mach: air.mach,
      altitudeFt: this.pos.y / 0.3048, aglFt: this.agl / 0.3048,
      vsFpm: this.vel.y / FPM,
      heading, pitch: this.#pitch() / DEG, bank: this.#bank() / DEG, pitchRate: this.w.z / DEG, rollRate: this.w.x / DEG,
      alpha: air.alpha / DEG, beta: air.beta / DEG, nz: air.nz,
      flaps: this.surfaces.flap, gear: this.gear.extension, gearLever: this.controls.gearDown,
      fuel: this.fuel, fuelCapacity: this.spec.mass.fuelCapacity, mass: this.mass, cg: this.#cgFraction(),
      tanks: this.tanks,
      throttle: this.controls.throttle, mixture: this.controls.mixture, prop: this.controls.prop, engines: this.engines.map((e) => e.gauges),
      onGround: this.gear.weightOnWheels,
      groundSpeed: Math.hypot(this.vel.x, this.vel.z) / KT,
      stallWarning: this.stallWarning, stalled: !!this.stalled,
      overspeed: air.ias > this.spec.limits.vne * KT * 0.98,
      parkingBrake: this.controls.parkingBrake, trim: this.controls.trim,
      speedbrake: this.surfaces.speedbrake, afterburner: Math.max(0, ...this.engines.map((e) => e.afterburner)),
      powered: this.sys.powered, failures: this.sys.describe(this), apuSpool: this.sys.apu.spool, dumping: this.sys.dumping, crossfeed: this.crossfeed,
      crashed: this.crashed, fuelFlow: this.engines.reduce((s, e) => s + e.fuelFlow, 0),
    };
  }
}

function gradeLanding(sink, lim) {
  const fpm = sink / FPM;
  if (fpm < 150) return 'Smooth';
  if (fpm < 300) return 'Good';
  if (fpm < 500) return 'Firm';
  if (sink < lim.hardLanding) return 'Hard';
  return 'Very hard';
}
