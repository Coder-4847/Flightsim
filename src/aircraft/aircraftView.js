import * as THREE from 'three';
import { HIGH, LOW, MEDIUM, makeMaterials } from './models/builders.js';
import { buildCessna172 } from './models/cessna172.js';
import { buildCitation } from './models/citation.js';
import { buildFighter } from './models/fighter.js';
import { buildKingAir } from './models/kingair.js';
import {
  buildBizjet, buildJumbo, buildNarrowbody, buildRegional, buildWidebody,
} from './models/airliner.js';
import { buildCaravan, buildTurboprop72 } from './models/highwing.js';
import { buildHeavyFighter, buildHornet } from './models/twinfighter.js';
import { buildTrainer } from './models/trainer.js';
import { setCockpitNight } from './cockpit/index.js';
import { clamp, DEG, smoothstep } from '../flight/units.js';

// Builds the visual aircraft (three LOD levels sharing materials), animates it from the
// flight model every frame, and lazily creates the cockpit when first needed.

const BUILDERS = {
  cessna172: buildCessna172,
  kingair: buildKingAir,
  citation: buildCitation,
  fighter: buildFighter,
  caravan: buildCaravan,
  turboprop72: buildTurboprop72,
  bizjet: buildBizjet,
  narrowbody: buildNarrowbody,
  regional: buildRegional,
  widebody: buildWidebody,
  jumbo: buildJumbo,
  hornet: buildHornet,
  heavyfighter: buildHeavyFighter,
  trainer: buildTrainer,
};

export function hasModel(id) {
  return id in BUILDERS;
}

const _axisQuat = new THREE.Quaternion();

export class AircraftView {
  /** `opts.detail` (HIGH, MEDIUM or LOW) builds just that one level instead of all three (the hangar showroom uses this). */
  constructor(spec, createCockpit, opts = {}) {
    this.spec = spec;
    this.createCockpit = createCockpit;
    this.root = new THREE.Group();
    this.mats = makeMaterials(spec, { quality: createCockpit ? 1 : 0.5 });
    this.lod = new THREE.LOD();
    this.rigs = [];
    const length = spec.geometry.length;
    // Distances at which each level takes over (metres from the camera).
    const levels = opts.detail !== undefined ? [[opts.detail, 0]] : [[HIGH, 0], [MEDIUM, length * 8], [LOW, length * 28]];
    for (const [detail, distance] of levels) {
      const { group, rig } = BUILDERS[spec.id](spec, this.mats, detail);
      this.lod.addLevel(group, distance);
      this.rigs.push(rig);
    }
    this.root.add(this.lod);
    // Exterior glass would block the view from inside, so it is hidden in cockpit mode.
    this.glassMeshes = [];
    this.root.traverse((o) => { if (o.isMesh && (o.material === this.mats.glass || o.userData.exteriorOnly)) this.glassMeshes.push(o); });
    this.chaseDistance = length * 1.9 + 4;
    this.cockpit = { eye: new THREE.Vector3(spec.cockpit.eye.x, spec.cockpit.eye.y, spec.cockpit.eye.z) };
    this.cockpitGroup = null;
    this.cockpitActive = false;
    this.spin = 0;
  }

  /** Create the cockpit the first time it is needed; keep it hidden otherwise. */
  setCockpitActive(active) {
    if (active && !this.cockpitGroup) {
      this.cockpitGroup = this.createCockpit(this.spec, this.mats);
      this.root.add(this.cockpitGroup.group);
    }
    this.cockpitActive = active;
    if (this.cockpitGroup) this.cockpitGroup.group.visible = active;
    // From inside, hide the exterior fuselage skin so only the cockpit shell frames the view.
    for (const rig of this.rigs) if (rig.fuselage) rig.fuselage.visible = !active;
    for (const glass of this.glassMeshes) glass.visible = !active;
  }

  /** Cabin windows glow warm after dark (0 = day .. 1 = night). */
  setNight(night) {
    const level = Math.round(night * 20) / 20;
    if (level === this._night) return;
    this._night = level;
    this.mats.window.emissiveIntensity = 0.9 * level;
    this.mats.setNight?.(level);
    setCockpitNight(level);
  }

  update(model, alpha, dt, time) {
    model.samplePose(alpha, this.root.position, this.root.quaternion);
    const t = model.telemetry;
    const surf = model.surfaces;
    const ctl = this.spec.controls;
    const elevator = clamp(surf.elevator, -ctl.elevatorDown * DEG, ctl.elevatorUp * DEG);
    const lightsOn = model.controls.lights;
    for (const rig of this.rigs) {
      for (const e of rig.elevators) e.pivot.quaternion.setFromAxisAngle(e.axis, -elevator);
      for (const a of rig.ailerons) a.pivot.quaternion.setFromAxisAngle(a.axis, -surf.aileron * a.side);
      for (const r of rig.rudders) r.pivot.quaternion.setFromAxisAngle(r.axis, -surf.rudder);
      for (const f of rig.flaps) f.pivot.quaternion.setFromAxisAngle(f.axis, surf.flap * DEG);
      for (const s of rig.speedbrakes) s.pivot.quaternion.setFromAxisAngle(s.axis, s.angle * surf.speedbrake);
      this.#animateGear(rig, model);
      this.#animatePropulsion(rig, model, dt);
      this.#animateLights(rig, lightsOn, time, model);
    }
    if (this.cockpitActive && this.cockpitGroup) this.cockpitGroup.update(model, t, dt);
  }

  #animateGear(rig, model) {
    const gear = rig.gear;
    const ext = model.gear.extension;
    const wheels = model.gear.wheels;
    const showGear = gear.fixed || ext > 0.02;
    const apply = (entry, wheelIndex) => {
      const w = wheels[wheelIndex];
      const lower = entry.lower ?? entry.leg.userData.lower;
      lower.position.y = clamp(w.compression, 0, 0.5);
      for (const wheel of entry.wheels ?? entry.leg.userData.wheels) wheel.rotation.z = w.spin;
    };
    if (gear.nose) {
      const leg = gear.nose.leg;
      leg.visible = showGear;
      leg.rotation.y = -model.gear.steerAngle;
      if (!gear.fixed) leg.rotation.z = (1 - ext) * (gear.nose.retract ?? 1) * (Math.PI / 2);
      apply(gear.nose, 0);
    }
    for (const main of gear.mains) {
      main.leg.visible = showGear;
      if (!gear.fixed) main.leg.rotation.x = (1 - ext) * main.side * (main.retractAngle ?? Math.PI / 2);
      apply(main, main.wheelIndex);
    }
    // Doors swing open while the gear is in transit and close once it is up or down.
    const transit = ext > 0.03 && ext < 0.97 ? Math.sin(ext * Math.PI) : 0;
    for (const door of gear.doors) door.pivot.quaternion.setFromAxisAngle(door.axis, transit * door.open);
  }

  #animatePropulsion(rig, model, dt) {
    const engines = model.engines;
    rig.props.forEach((prop, i) => {
      const e = engines[Math.min(i, engines.length - 1)];
      const spool = e.spool;
      const spec = model.spec.engines.spec;
      const omega = (0.15 + 0.85 * spool) * (spec.type === 'piston' ? 251 : 180);
      // Slow-motion blades at idle, then a blur disc once the rotation would alias.
      const blur = smoothstep(0.18, 0.5, spool);
      prop.userData.disc.material.opacity = blur * 0.32;
      prop.userData.blades.forEach((b) => { b.visible = blur < 0.85; });
      this.spin = (this.spin + Math.min(omega, 22) * dt) % (Math.PI * 2);
      prop.rotation.x = e.running || spool > 0.03 ? this.spin * (blur > 0.5 ? 1 : Math.max(0.2, spool * 3)) : 0;
    });
    rig.fans.forEach((fan, i) => {
      const e = engines[Math.min(i, engines.length - 1)];
      fan.userData.disc.material.opacity = smoothstep(0.25, 0.7, e.spool) * 0.8;
      fan.rotation.x = (fan.rotation.x + Math.min(e.spool * 40, 20) * dt) % (Math.PI * 2);
    });
    rig.burners.forEach((b, i) => {
      const e = engines[Math.min(i, engines.length - 1)];
      b.group.visible = e.afterburner > 0.02;
      b.group.scale.set(0.4 + e.afterburner * 1.6, 1, 1);
      b.mat.opacity = 0.45 + 0.35 * Math.random();
    });
  }

  #animateLights(rig, on, time, model) {
    const l = rig.lights;
    const t = time % 1.3;
    const strobeOn = on && (t < 0.06 || (t > 0.16 && t < 0.22));
    const pulse = on ? 0.4 + 0.6 * Math.max(0, Math.sin(time * 6)) : 0;
    const setLight = (light, level) => {
      light.visible = level > 0.02;
      light.userData.sprite.material.opacity = 0.85 * level;
      light.userData.sprite.scale.setScalar(light.userData.baseScale * (0.7 + 0.3 * level));
    };
    l.nav.forEach((x) => setLight(x, on ? 1 : 0));
    l.strobes.forEach((x) => setLight(x, strobeOn ? 1 : 0));
    l.beacon.forEach((x) => setLight(x, pulse));
    l.landing.forEach((x) => setLight(x, on && model.gear.extension > 0.5 ? 1 : 0));
  }
}

export { HIGH, LOW, MEDIUM };
