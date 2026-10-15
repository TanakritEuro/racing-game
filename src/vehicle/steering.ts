// Steering geometry: a rack that turns the front wheels at a limited rate, and Ackermann
// geometry so the inside wheel turns more than the outside one.

export interface SteeringDef {
  /** Wheel angle at full lock, for the middle of the axle (rad). */
  lock: number;
  /** Fastest the rack can move the wheels (rad/s of wheel angle). */
  rate: number;
  /**
   * 0: both wheels turn the same (parallel steer). 1: full Ackermann, each wheel pointing
   * square to a turn centre on the rear axle line. In between blends the two.
   */
  ackermann: number;
}

/** Move the rack's wheel angle `current` towards `target` (rad) at no more than `rate` for `dt`. */
export function rackStep(current: number, target: number, rate: number, dt: number): number {
  const most = rate * dt;
  return current + Math.max(-most, Math.min(most, target - current));
}

/**
 * The angle of a front wheel `x` metres to the right of the car's centreline, when the
 * middle of the axle is at `centre` (rad, positive = right). With full Ackermann the turn
 * centre lies on the rear axle line `wheelbase` behind, at L / tan(centre) to the right.
 */
export function wheelSteerAngle(centre: number, x: number, wheelbase: number, ackermann: number): number {
  const t = Math.tan(centre);
  // atan(L / (R − x)) with R = L / tan(centre), written so it is smooth through zero.
  const full = Math.atan2(wheelbase * t, wheelbase - x * t);
  return centre + ackermann * (full - centre);
}
