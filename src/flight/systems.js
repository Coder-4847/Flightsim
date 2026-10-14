import { approach, clamp } from './units.js';

// Aircraft systems layered on the flight model: electrics (generators, APU, battery), hydraulics,
// fuel handling (pumps, crossfeed, dump, leak) and the failures that act on them. The model asks
// this object for the effects (control authority, locked gear, power for instruments, ...).

const APU_SPOOL_TIME = 14; // seconds to reach speed
const BATTERY_LIFE = 900; // seconds of battery power with no generator
const FIRE_DAMAGE_TIME = 55; // seconds an engine fire burns before the airframe is lost
const PITOT_CLEAR_TIME = 20; // seconds with pitot heat on to melt the ice

export const FAILURE_TYPES = ['engine_failure', 'engine_fire', 'hydraulic', 'electrical', 'flaps', 'gear', 'pitot', 'jam', 'fuel_leak', 'radio'];

export class AircraftSystems {
  constructor(spec) {
    this.spec = spec;
    this.engineCount = spec.engines.positions.length;
    this.dumpRate = spec.fuelDump ?? 0; // kg/s, 0 = cannot dump
    this.reset();
  }

  reset() {
    this.apu = { switchOn: false, spool: 0 };
    this.battery = 1;
    this.generators = Array(this.engineCount).fill(true); // generator healthy
    this.electricalFault = false; // total generator loss
    this.powered = true;
    this.hydLost = false;
    this.flapStuck = false;
    this.gearStuck = false; // retract/extend mechanism will not move without emergency extension
    this.gearEmergency = false;
    this.pitot = { iced: false, heat: false, frozenIas: 0, frozenAlt: 0, clear: 0 };
    this.jam = null; // { axis, value }
    this.leakRate = 0; // kg/s
    this.radioOk = true;
    this.fire = Array(this.engineCount).fill(false);
    this.fireTime = Array(this.engineCount).fill(0);
    this.extinguisher = Array(this.engineCount).fill(true); // one bottle per engine
    this.dumping = false;
    this.dumpFloor = 0; // kg of fuel to stop at
    this.active = new Set();
  }

  get apuRunning() { return this.apu.spool > 0.95; }

  /** Mark a failure active (used by the failure manager); `opt` carries engine index, axis, ... */
  apply(type, model, opt = {}) {
    this.active.add(type);
    switch (type) {
      case 'engine_failure': {
        const i = opt.engine ?? 0;
        model.engines[i].failed = true;
        this.generators[i] = false;
        break;
      }
      case 'engine_fire': {
        const i = opt.engine ?? 0;
        model.engines[i].failed = true;
        model.engines[i].fire = true;
        this.fire[i] = true;
        this.generators[i] = false;
        break;
      }
      case 'hydraulic': this.hydLost = true; this.gearStuck = true; this.flapStuck = true; break;
      case 'electrical': this.electricalFault = true; this.generators.fill(false); break;
      case 'flaps': this.flapStuck = true; break;
      case 'gear': this.gearStuck = true; break;
      case 'pitot': {
        const air = model.air;
        this.pitot.iced = true; this.pitot.clear = 0;
        this.pitot.frozenIas = air.ias; this.pitot.frozenAlt = model.pos.y;
        break;
      }
      case 'jam': {
        const axis = opt.axis ?? 'elevator';
        this.jam = { axis, value: model.surfaces[axis] };
        break;
      }
      case 'fuel_leak': this.leakRate = opt.rate ?? Math.max(0.4, model.fuel * 0.0006); break;
      case 'radio': this.radioOk = false; break;
      default: break;
    }
  }

  // ---- crew actions ----------------------------------------------------------------------------
  toggleApu() {
    this.apu.switchOn = !this.apu.switchOn;
    return this.apu.switchOn;
  }

  togglePitotHeat() {
    this.pitot.heat = !this.pitot.heat;
    return this.pitot.heat;
  }

  /** Shut an engine down with its fuel cutoff (used in the fire and failure checklists). */
  shutdownEngine(model, i) {
    model.engines[i].failed = true;
  }

  restartEngine(model, i) {
    if (this.fire[i] || this.active.has('engine_failure') && this.generators[i] === false && model.engines[i].fire) return false;
    model.engines[i].failed = false;
    this.generators[i] = !this.electricalFault;
    return true;
  }

  /** Discharge an engine's fire bottle. The fire goes out if the engine is shut down. */
  extinguish(model, i) {
    if (!this.extinguisher[i]) return 'empty';
    this.extinguisher[i] = false;
    if (model.engines[i].failed) {
      this.fire[i] = false;
      model.engines[i].fire = false;
      this.fireTime[i] = 0;
      return 'out';
    }
    return 'running';
  }

  emergencyGear() {
    this.gearEmergency = true;
  }

  toggleDump(model) {
    if (!this.dumpRate) return false;
    this.dumping = !this.dumping;
    if (this.dumping) this.dumpFloor = Math.max(model.spec.mass.ref - model.spec.mass.empty - model.spec.mass.payload, model.spec.mass.fuelCapacity * 0.18);
    return this.dumping;
  }

  // ---- per-step update -----------------------------------------------------------------------------
  update(dt, model, air) {
    // Generators and APU.
    const e = model.engines;
    const genOnline = e.some((eng, i) => this.generators[i] && !eng.failed && eng.spool > 0.35);
    this.apu.spool = approach(this.apu.spool, this.apu.switchOn ? 1 : 0, dt / APU_SPOOL_TIME * (this.apu.switchOn ? 1 : 2));
    const apuPower = this.apuRunning;
    if (genOnline || apuPower) this.battery = Math.min(1, this.battery + dt / 400);
    else this.battery = Math.max(0, this.battery - dt / BATTERY_LIFE);
    this.powered = genOnline || apuPower || this.battery > 0;
    this.busGenerators = genOnline || apuPower;

    // Hydraulics follow the engines unless failed: with all engines out only the ram air turbine helps.
    const anyEngine = e.some((eng) => !eng.failed && eng.spool > 0.3);
    this.hydPressure = this.hydLost ? 0.12 : anyEngine ? 1 : 0.35;

    // Engine fires.
    for (let i = 0; i < this.fire.length; i++) {
      if (this.fire[i]) {
        this.fireTime[i] += dt;
        if (this.fireTime[i] > FIRE_DAMAGE_TIME) model.crashWith('Structural failure: uncontrolled engine fire');
      }
    }

    // Pitot icing: pitot heat clears it after a while.
    if (this.pitot.iced) {
      if (this.pitot.heat && this.powered) this.pitot.clear += dt;
      if (this.pitot.clear >= PITOT_CLEAR_TIME) { this.pitot.iced = false; this.active.delete('pitot'); }
    }

    // Gear mechanism: emergency extension works without hydraulics, but slowly.
    model.gear.rateScale = this.gearEmergency && model.gear.target === 1 ? 0.28 : 1;
    if (this.gearEmergency && model.gear.extension >= 0.999) this.gearEmergency = false;

    // Leak and dump drain the tanks.
    let drain = this.leakRate;
    if (this.dumping && !model.gear.weightOnWheels) {
      if (model.fuel > this.dumpFloor) drain += this.dumpRate;
      else this.dumping = false;
    }
    if (drain > 0) model.drainFuel(drain * dt);
  }

  /** Airspeed as the pilot sees it, including a blocked pitot tube. */
  shownIas(air, altitude) {
    if (!this.pitot.iced) return air.ias;
    // With the tube sealed the reading behaves like an altimeter: it rises as you climb, falls as you descend.
    const climb = altitude - this.pitot.frozenAlt;
    return Math.max(0, this.pitot.frozenIas + climb * 0.012);
  }

  /** Control authority and rate multipliers from hydraulic loss. */
  get controlRate() { return this.hydLost ? 0.35 : 1; }
  get controlAuthority() { return this.hydLost ? 0.6 : 1; }
  get brakePower() { return this.hydLost ? 0.35 : 1; }
  get steeringWorks() { return !this.hydLost; }
  get gearLocked() { return this.gearStuck; }

  /** Names of what is wrong, for warnings and the status panel. */
  describe(model) {
    const out = [];
    model.engines.forEach((eng, i) => {
      if (this.fire[i]) out.push({ id: `fire${i}`, level: 'red', text: `ENGINE ${i + 1} FIRE` });
      else if (eng.failed) out.push({ id: `eng${i}`, level: 'amber', text: `ENGINE ${i + 1} FAIL` });
    });
    if (this.hydLost) out.push({ id: 'hyd', level: 'amber', text: 'HYDRAULIC LOSS' });
    if (this.electricalFault) out.push({ id: 'elec', level: 'amber', text: this.busGenerators ? 'ELEC GEN FAULT (APU)' : 'ELEC GEN FAULT' });
    if (!this.powered) out.push({ id: 'power', level: 'red', text: 'NO ELECTRICAL POWER' });
    if (this.flapStuck && !this.hydLost) out.push({ id: 'flap', level: 'amber', text: 'FLAPS JAMMED' });
    if (this.gearStuck && !this.hydLost) out.push({ id: 'gear', level: 'amber', text: 'GEAR WILL NOT MOVE' });
    if (this.pitot.iced) out.push({ id: 'pitot', level: 'amber', text: 'AIRSPEED UNRELIABLE' });
    if (this.jam) out.push({ id: 'jam', level: 'amber', text: `${this.jam.axis.toUpperCase()} JAMMED` });
    if (this.leakRate > 0) out.push({ id: 'leak', level: 'amber', text: 'FUEL LEAK' });
    if (!this.radioOk) out.push({ id: 'radio', level: 'amber', text: 'RADIO FAILURE' });
    if (this.dumping) out.push({ id: 'dump', level: 'info', text: 'FUEL DUMPING' });
    return out;
  }
}

export { clamp };
