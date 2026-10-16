// A car's state on the wire: everything the other browser needs to place, draw and hear the
// car, packed into a Float64Array (time on the shared clock needs more than float32). Pure.

import type { Vec3 } from '../math';
import { createPose, type CarPose } from '../vehicle/pose';

export interface CarState {
  /** When (s, on the host's clock). */
  time: number;
  pose: CarPose;
  /** Linear (m/s) and angular (rad/s) velocity, for dead reckoning. */
  velocity: Vec3;
  angular: Vec3;
  /** Forward speed (m/s), engine RPM and throttle, for the HUD and the engine's sound. */
  speed: number;
  rpm: number;
  throttle: number;
  /** Laps completed and distance round the current lap (m), for positions. */
  laps: number;
  distance: number;
}

export function createState(): CarState {
  return { time: 0, pose: createPose(), velocity: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 }, speed: 0, rpm: 0, throttle: 0, laps: 0, distance: 0 };
}

/** Numbers per packed state. */
export const STATE_SIZE = 1 + 3 + 4 + 3 + 3 + 12 + 5;

export function packState(s: CarState): ArrayBuffer {
  const d = new Float64Array(STATE_SIZE);
  const p = s.pose;
  d.set([s.time, p.position.x, p.position.y, p.position.z, p.rotation.x, p.rotation.y, p.rotation.z, p.rotation.w]);
  d.set([s.velocity.x, s.velocity.y, s.velocity.z, s.angular.x, s.angular.y, s.angular.z], 8);
  p.wheels.forEach((w, i) => d.set([w.suspensionLength, w.steer, w.spin], 14 + i * 3));
  d.set([s.speed, s.rpm, s.throttle, s.laps, s.distance], 26);
  return d.buffer;
}

/** A packed state back, or null if it isn't one (wrong size, or not finite). */
export function unpackState(buffer: ArrayBuffer, out: CarState = createState()): CarState | null {
  if (buffer.byteLength !== STATE_SIZE * 8) return null;
  const d = new Float64Array(buffer);
  if (!d.every(Number.isFinite)) return null;
  out.time = d[0];
  const p = out.pose;
  p.position.x = d[1];
  p.position.y = d[2];
  p.position.z = d[3];
  p.rotation.x = d[4];
  p.rotation.y = d[5];
  p.rotation.z = d[6];
  p.rotation.w = d[7];
  out.velocity = { x: d[8], y: d[9], z: d[10] };
  out.angular = { x: d[11], y: d[12], z: d[13] };
  p.wheels.forEach((w, i) => {
    w.suspensionLength = d[14 + i * 3];
    w.steer = d[15 + i * 3];
    w.spin = d[16 + i * 3];
  });
  out.speed = d[26];
  out.rpm = d[27];
  out.throttle = d[28];
  out.laps = d[29];
  out.distance = d[30];
  return out;
}
