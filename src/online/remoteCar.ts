// The other player's car as this browser sees it: a stream of its states (30 a second,
// late by the network's delay and jitter) turned into where it is *now*. Between two states
// it is interpolated; past the newest it is dead-reckoned on its velocity and spin (for at
// most a moment); and when a new state moves the estimate, the jump is eased out over a short
// time instead of snapping. Pure.

import type { Quat } from '../math';
import { copyPose, createPose, interpolatePose, type CarPose } from '../vehicle/pose';
import { createState, type CarState } from './state';

/** States kept, and how far past the newest it will guess (s) before holding still. */
const KEEP = 12;
const MAX_EXTRAPOLATION = 0.35;
/** How quickly a correction is eased out (s, time constant). */
const EASE = 0.12;

export class RemoteCar {
  private readonly states: CarState[] = [];
  /** The correction still to ease out: position (m) and rotation (a quaternion). */
  private readonly error = { x: 0, y: 0, z: 0 };
  private errorRotation: Quat = { x: 0, y: 0, z: 0, w: 1 };
  private lastTime: number | null = null;
  private readonly lastRaw = createPose();
  private readonly scratch = createPose();

  /** The newest state heard, or null. */
  get latest(): CarState | null {
    return this.states[this.states.length - 1] ?? null;
  }

  /** A state arrived (any order; stale or repeated ones are ignored). */
  receive(state: CarState): void {
    const newest = this.latest;
    if (newest && state.time <= newest.time) {
      // Late: it can still fill a gap between older states.
      if (this.states.some((s) => s.time === state.time) || state.time < this.states[0].time) return;
      this.states.push(clone(state));
      this.states.sort((a, b) => a.time - b.time);
    } else {
      this.states.push(clone(state));
    }
    if (this.states.length > KEEP) this.states.shift();
    // Ease out the jump: whatever the estimate for the last moment shown moved by.
    if (this.lastTime !== null) {
      this.predict(this.lastTime, this.scratch);
      const a = this.lastRaw.position;
      const b = this.scratch.position;
      this.error.x += a.x - b.x;
      this.error.y += a.y - b.y;
      this.error.z += a.z - b.z;
      this.errorRotation = normalise(multiply(this.errorRotation, multiply(this.lastRaw.rotation, conjugate(this.scratch.rotation))));
      copyPose(this.scratch, this.lastRaw);
    }
  }

  /** The car's pose at `time` (s, host clock) into `out`; false before any state has arrived. */
  sample(time: number, out: CarPose): boolean {
    if (this.states.length === 0) return false;
    this.predict(time, out);
    copyPose(out, this.lastRaw);
    // Let the correction fade with the time that has passed.
    const dt = this.lastTime === null ? 0 : Math.max(0, time - this.lastTime);
    this.lastTime = time;
    const keep = Math.exp(-dt / EASE);
    this.error.x *= keep;
    this.error.y *= keep;
    this.error.z *= keep;
    this.errorRotation = slerpFromIdentity(this.errorRotation, keep);
    out.position.x += this.error.x;
    out.position.y += this.error.y;
    out.position.z += this.error.z;
    const r = normalise(multiply(this.errorRotation, out.rotation));
    Object.assign(out.rotation, r);
    return true;
  }

  /** The raw estimate at `time`: interpolated, or dead-reckoned past the newest state. */
  private predict(time: number, out: CarPose): void {
    const s = this.states;
    const newest = s[s.length - 1];
    if (time <= s[0].time) {
      copyPose(s[0].pose, out);
      return;
    }
    if (time <= newest.time) {
      let k = s.length - 2;
      while (k > 0 && s[k].time > time) k--;
      const a = s[k];
      const b = s[k + 1];
      interpolatePose(a.pose, b.pose, (time - a.time) / Math.max(1e-6, b.time - a.time), out);
      return;
    }
    // Past the newest: carry on at its velocity and spin, for a moment.
    const dt = Math.min(MAX_EXTRAPOLATION, time - newest.time);
    copyPose(newest.pose, out);
    const v = newest.velocity;
    out.position.x += v.x * dt;
    out.position.y += v.y * dt;
    out.position.z += v.z * dt;
    const w = newest.angular;
    const angle = Math.hypot(w.x, w.y, w.z) * dt;
    if (angle > 1e-9) {
      const k = Math.sin(angle / 2) / (angle / dt);
      const turn = { x: w.x * k, y: w.y * k, z: w.z * k, w: Math.cos(angle / 2) };
      Object.assign(out.rotation, normalise(multiply(turn, newest.pose.rotation)));
    }
    // Wheels keep rolling at the rate they were.
    const before = s.length > 1 ? s[s.length - 2] : null;
    if (before && newest.time > before.time) {
      out.wheels.forEach((wheel, i) => {
        wheel.spin += ((newest.pose.wheels[i].spin - before.pose.wheels[i].spin) / (newest.time - before.time)) * dt;
      });
    }
  }
}

function clone(s: CarState): CarState {
  const c = createState();
  c.time = s.time;
  copyPose(s.pose, c.pose);
  c.velocity = { ...s.velocity };
  c.angular = { ...s.angular };
  c.speed = s.speed;
  c.rpm = s.rpm;
  c.throttle = s.throttle;
  c.laps = s.laps;
  c.distance = s.distance;
  return c;
}

function multiply(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

function conjugate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

function normalise(q: Quat): Quat {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  // The short way round: w ≥ 0.
  const s = q.w < 0 ? -1 / l : 1 / l;
  return { x: q.x * s, y: q.y * s, z: q.z * s, w: q.w * s };
}

/** `t` (0–1) of the way from no rotation to `q`. */
function slerpFromIdentity(q: Quat, t: number): Quat {
  const n = normalise(q);
  const angle = 2 * Math.acos(Math.min(1, n.w));
  if (angle < 1e-9) return { x: 0, y: 0, z: 0, w: 1 };
  const s = Math.sin(angle / 2);
  const k = Math.sin((angle * t) / 2) / s;
  return { x: n.x * k, y: n.y * k, z: n.z * k, w: Math.cos((angle * t) / 2) };
}
