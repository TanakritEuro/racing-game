// The car's pose: what the presentation draws (and what lap recordings store), with
// helpers to copy it and to blend between two poses. Pure data and maths.

import type { Quat, Vec3 } from '../math';

/** The chassis transform and each wheel's travel, steer and roll (unwrapped). */
export interface CarPose {
  position: Vec3;
  rotation: Quat;
  wheels: { suspensionLength: number; steer: number; spin: number }[];
}

export function createPose(): CarPose {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    wheels: [0, 1, 2, 3].map(() => ({ suspensionLength: 0, steer: 0, spin: 0 })),
  };
}

export function copyPose(from: CarPose, to: CarPose): void {
  Object.assign(to.position, from.position);
  Object.assign(to.rotation, from.rotation);
  from.wheels.forEach((w, i) => Object.assign(to.wheels[i], w));
}

/** `out` = the pose `t` (0–1) of the way from `a` to `b`. Wheel spin is unwrapped, so it blends directly. */
export function interpolatePose(a: CarPose, b: CarPose, t: number, out: CarPose): void {
  const lerp = (x: number, y: number) => x + (y - x) * t;
  out.position.x = lerp(a.position.x, b.position.x);
  out.position.y = lerp(a.position.y, b.position.y);
  out.position.z = lerp(a.position.z, b.position.z);

  // Normalised lerp, taking the short way round: indistinguishable from slerp over one step.
  const qa = a.rotation;
  const qb = b.rotation;
  const sign = qa.x * qb.x + qa.y * qb.y + qa.z * qb.z + qa.w * qb.w < 0 ? -1 : 1;
  const x = lerp(qa.x, sign * qb.x);
  const y = lerp(qa.y, sign * qb.y);
  const z = lerp(qa.z, sign * qb.z);
  const w = lerp(qa.w, sign * qb.w);
  const l = Math.hypot(x, y, z, w);
  out.rotation.x = x / l;
  out.rotation.y = y / l;
  out.rotation.z = z / l;
  out.rotation.w = w / l;

  a.wheels.forEach((wa, i) => {
    const wb = b.wheels[i];
    const o = out.wheels[i];
    o.suspensionLength = lerp(wa.suspensionLength, wb.suspensionLength);
    o.steer = lerp(wa.steer, wb.steer);
    o.spin = lerp(wa.spin, wb.spin);
  });
}
