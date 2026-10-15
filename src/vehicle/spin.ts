// Wheel spin: each wheel has its own angular velocity, integrated from the torques on it.
// Friction torques (brakes, rolling resistance) can stop a wheel but never reverse it.

export interface SpinBody {
  /** Angular velocity (rad/s). */
  omega: number;
  /** Moment of inertia about the axle (kg·m²). */
  inertia: number;
  /** Torque driving it this substep: drive minus the tyre's reaction (N·m). */
  torque: number;
  /** Friction torque opposing its rotation: brakes plus rolling resistance (N·m, ≥ 0). */
  friction: number;
}

/** Advance a wheel by `h` seconds: torque first, then friction, which stops at zero. */
export function spinFree(b: SpinBody, h: number): void {
  b.omega += (h * b.torque) / b.inertia;
  applyFriction(b, h);
}

/** Apply `b.friction` for `h` seconds: it slows the wheel and can hold it at zero, but never reverses it. */
export function applyFriction(b: SpinBody, h: number): void {
  const stop = (h * b.friction) / b.inertia;
  if (Math.abs(b.omega) <= stop) b.omega = 0;
  else b.omega -= Math.sign(b.omega) * stop;
}
