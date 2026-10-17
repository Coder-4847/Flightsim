import * as THREE from 'three';
import { clamp } from '../flight/units.js';

// Camera rigs for the flight scene. Modes cycle with the camera key:
//   chase      damped follow camera; drag to orbit, scroll to zoom
//   cockpit    inside the aircraft; drag (or pointer lock) to look around
//   cinematic  slow orbit around the aircraft
//   tower      fixed ground position that tracks the aircraft with a zoom lens
// Free camera arrives with the maps in Phase 3.

export const CAMERA_MODES = ['chase', 'cinematic', 'tower'];

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _target = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _look = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);

export class CameraSystem {
  constructor(camera, { towerPosition }) {
    this.camera = camera;
    this.towerPosition = towerPosition;
    this.mode = 'chase';
    this.chase = { quat: new THREE.Quaternion(), yaw: 0, pitch: 0.12, distance: 20, idle: 0 };
    this.head = { yaw: 0, pitch: 0, dragging: false, locked: false };
    this.cinematicAngle = 0;
    this.reduceMotion = false;
    this.smoothPos = new THREE.Vector3();
    this.smoothOffset = new THREE.Vector3();
    this.initialised = false;
    this.pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    this.aircraftRadius = 8;
    this.cockpitAvailable = false; // the cockpit view was retired; chase, cinematic and tower remain
  }

  /** Called when the aircraft changes. `view` supplies the cockpit eye point and size. */
  setAircraft(view) {
    this.view = view;
    this.chase.distance = view.chaseDistance;
    this.aircraftRadius = view.chaseDistance / 2;
    this.initialised = false;
    this.head.yaw = this.head.pitch = 0;
  }

  setMode(mode) {
    if (mode === 'cockpit' && !this.cockpitAvailable) mode = 'chase';
    this.mode = mode;
    this.camera.near = mode === 'cockpit' ? 0.06 : 0.5;
    this.camera.updateProjectionMatrix();
    if (mode !== 'cockpit' && this.head.locked) document.exitPointerLock?.();
  }

  cycle() {
    const modes = CAMERA_MODES.filter((m) => m !== 'cockpit' || this.cockpitAvailable);
    this.setMode(modes[(modes.indexOf(this.mode) + 1) % modes.length]);
    return this.mode;
  }

  reset() {
    this.chase.yaw = 0;
    this.chase.pitch = 0.12;
    this.head.yaw = this.head.pitch = 0;
  }

  // Pointer input: `dx, dy` in pixels.
  drag(dx, dy) {
    if (this.mode === 'chase') {
      this.chase.yaw -= dx * 0.006;
      this.chase.pitch = clamp(this.chase.pitch + dy * 0.005, -0.15, 1.3);
      this.chase.idle = 0;
    } else if (this.mode === 'cockpit') {
      this.head.yaw = clamp(this.head.yaw - dx * 0.004, -2.6, 2.6);
      this.head.pitch = clamp(this.head.pitch - dy * 0.004, -1.0, 1.3);
    }
  }

  zoom(delta) {
    if (this.mode === 'chase') {
      const base = this.view.chaseDistance;
      this.chase.distance = clamp(this.chase.distance * Math.exp(delta * 0.001), base * 0.45, base * 5);
    } else if (this.mode === 'cockpit') {
      this.camera.fov = clamp(this.camera.fov + delta * 0.02, 45, 95);
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * @param pos,quat interpolated aircraft pose (world)
   * @param lookInput {x,y} analog look (gamepad)
   */
  update(dt, pos, quat, lookInput) {
    const cam = this.camera;
    const view = this.view;
    if (!view) return;
    const c = this.chase;

    if (this.mode === 'cockpit') {
      // Head returns to centre unless the mouse is locked or being dragged.
      if (!this.head.dragging && !this.head.locked) {
        const k = 1 - Math.exp(-dt * 5);
        this.head.yaw -= this.head.yaw * k;
        this.head.pitch -= this.head.pitch * k;
      }
      const yaw = clamp(this.head.yaw, -2.6, 2.6);
      const pitch = clamp(this.head.pitch + lookInput.y * 0.8, -1.0, 1.3);
      _euler.set(pitch, yaw, 0, 'YXZ');
      _look.setFromEuler(_euler);
      _offset.copy(view.cockpit.eye).applyQuaternion(quat);
      _pos.copy(pos).add(_offset);
      // Head look is applied in the camera frame, after converting from the body frame.
      _quat.copy(quat).multiply(BODY_TO_CAMERA).multiply(_look);
      cam.position.copy(_pos);
      cam.quaternion.copy(_quat);
      this.pose.pos.copy(_pos);
      return;
    }

    if (this.mode === 'chase') {
      c.idle += dt;
      if (!this.reduceMotion && c.idle > 6) {
        c.yaw -= c.yaw * (1 - Math.exp(-dt * 0.8));
        c.pitch += (0.12 - c.pitch) * (1 - Math.exp(-dt * 0.8));
      }
      // Smoothed follow orientation: only heading and a damped share of pitch, never the roll.
      _offset.set(1, 0, 0).applyQuaternion(quat);
      const heading = Math.atan2(_offset.x, -_offset.z);
      const pitchShare = Math.asin(clamp(_offset.y, -1, 1)) * 0.45;
      _euler.set(pitchShare, -heading, 0, 'YXZ');
      _look.setFromEuler(_euler);
      if (!this.initialised) c.quat.copy(_look);
      c.quat.slerp(_look, 1 - Math.exp(-dt * 3.5));
      _euler.setFromQuaternion(c.quat, 'YXZ');
      _euler.y += c.yaw;
      _euler.x = clamp(_euler.x - c.pitch, -1.45, 0.5); // positive orbit pitch raises the camera
      _quat.setFromEuler(_euler);
      // Camera sits behind (+Z in camera-forward -Z terms) and above the aircraft.
      _offset.set(0, 0, c.distance).applyQuaternion(_quat);
      _target.copy(pos);
      _offset.y += c.distance * 0.06;
      // Smooth the camera's offset from the aircraft, never its world position: smoothing the world position lags
      // by speed/rate metres, and that lag changes with every frame-time wobble, which made the aircraft (and so the
      // whole scene) shake on screen at fighter speeds.
      if (this.initialised) this.smoothOffset.lerp(_offset, 1 - Math.exp(-dt * 12));
      else this.smoothOffset.copy(_offset);
      this.smoothPos.copy(_target).add(this.smoothOffset);
      cam.position.copy(this.smoothPos);
      _m.lookAt(cam.position, _target, _up);
      cam.quaternion.setFromRotationMatrix(_m);
      this.initialised = true;
      return;
    }

    if (this.mode === 'crash') {
      // Slow orbit around the wreck, rising a little, then holding.
      this.crashTime += dt;
      const r = this.crashRadius * (1.1 - Math.min(this.crashTime, 6) * 0.04);
      const a = this.crashAngle + this.crashTime * 0.28;
      _pos.set(this.crashTarget.x + Math.cos(a) * r, this.crashTarget.y + this.crashRadius * (0.25 + Math.min(this.crashTime, 6) * 0.03), this.crashTarget.z + Math.sin(a) * r);
      const g = this.groundAt?.(_pos.x, _pos.z);
      if (g != null && _pos.y < g + 3) _pos.y = g + 3;
      cam.position.copy(_pos);
      _m.lookAt(_pos, this.crashTarget, _up);
      cam.quaternion.setFromRotationMatrix(_m);
      return;
    }

    if (this.mode === 'cinematic') {
      if (!this.reduceMotion) this.cinematicAngle += dt * 0.22;
      const r = this.aircraftRadius * 3.4;
      _pos.set(pos.x + Math.cos(this.cinematicAngle) * r, pos.y + r * 0.28 + Math.sin(this.cinematicAngle * 0.6) * r * 0.1, pos.z + Math.sin(this.cinematicAngle) * r);
      cam.position.copy(_pos);
      _m.lookAt(_pos, pos, _up);
      cam.quaternion.setFromRotationMatrix(_m);
      return;
    }

    // tower
    _pos.copy(this.towerPosition);
    const dist = _pos.distanceTo(pos);
    cam.position.copy(_pos);
    _m.lookAt(_pos, pos, _up);
    cam.quaternion.setFromRotationMatrix(_m);
    const wantFov = clamp((2 * Math.atan(this.aircraftRadius * 3 / Math.max(dist, 1)) * 180) / Math.PI, 4, 65);
    cam.fov += (wantFov - cam.fov) * (1 - Math.exp(-dt * 4));
    cam.updateProjectionMatrix();
  }

  /** Orbit the wreck at `target` (world position); `radius` is about the aircraft size. */
  startCrash(target, radius, groundAt) {
    this.previousMode = this.mode;
    this.mode = 'crash';
    this.crashTarget = this.crashTarget ?? new THREE.Vector3();
    this.crashTarget.copy(target);
    this.crashRadius = Math.max(radius * 2.2, 40);
    this.crashAngle = Math.atan2(this.camera.position.z - target.z, this.camera.position.x - target.x);
    this.crashTime = 0;
    this.groundAt = groundAt;
    this.camera.near = 0.5;
    this.camera.fov = 55;
    this.camera.updateProjectionMatrix();
  }

  endCrash() {
    if (this.mode !== 'crash') return;
    this.mode = this.previousMode ?? 'chase';
    this.initialised = false;
    this.applyLens();
  }

  /** Restore the standard lens when leaving tower/cockpit. */
  applyLens() {
    this.camera.fov = this.mode === 'cockpit' ? 75 : 60;
    this.camera.updateProjectionMatrix();
  }
}

// Maps camera-local axes (-Z forward, +X right) onto the aircraft body frame (+X forward, +Z right):
// a rotation of -90 degrees about Y sends camera -Z to body +X and camera +X to body +Z.
const BODY_TO_CAMERA = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
