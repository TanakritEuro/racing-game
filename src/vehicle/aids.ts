// Driver aids: ABS and traction control. Like the real systems they don't add grip; they
// back off the brakes or the engine when a tyre slips past its peak, so it stays near
// the slip where it grips best (and, under braking, can still steer).
//
// Both are integral controllers on a 0–1 factor, run every substep: while the slip is
// past the target the factor falls at `release` / `cut` per second, otherwise it comes
// back at `apply` / `restore`. They cycle at tens of hertz, as real ones do.

export interface AidsDef {
  abs: {
    /** Braking slip allowed, as a multiple of the tyre's peak slip ratio. */
    slip: number;
    /** How fast the brake comes off while a wheel slips too much, and goes back on (per second). */
    release: number;
    apply: number;
    /** Below this wheel speed (m/s) ABS stands down, so the car can stop. */
    minSpeed: number;
  };
  tc: {
    /** Drive slip allowed, as a multiple of the peak slip ratio... */
    slip: number;
    /** ...once the wheel's surface also outruns the road by this much (m/s): near a standstill a tiny difference is a large ratio. */
    minSlipSpeed: number;
    /** How fast the throttle is cut while a driven wheel slips too much, and restored (per second). */
    cut: number;
    restore: number;
  };
}

/** Which aids are switched on. */
export interface AidSettings {
  abs: boolean;
  tc: boolean;
}

/**
 * One ABS step for a wheel: its brake factor after `dt`. `slipRatio` is the wheel's
 * relaxed slip, `speed` its contact patch speed along the wheel (m/s).
 */
export function absStep(def: AidsDef['abs'], factor: number, slipRatio: number, peakSlip: number, speed: number, dt: number): number {
  if (Math.abs(speed) < def.minSpeed) return 1;
  // Braking slip is slip against the direction of travel.
  const braking = -slipRatio * Math.sign(speed);
  return braking > def.slip * peakSlip ? Math.max(0, factor - def.release * dt) : Math.min(1, factor + def.apply * dt);
}

/**
 * One traction control step: the drive factor after `dt`. `driveSlip` and `slipSpeed` are
 * the driven wheels' largest drive slip ratio and how fast that wheel's surface outruns the road (m/s).
 */
export function tcStep(def: AidsDef['tc'], factor: number, driveSlip: number, slipSpeed: number, peakSlip: number, dt: number): number {
  const spinning = driveSlip > def.slip * peakSlip && slipSpeed > def.minSlipSpeed;
  return spinning ? Math.max(0, factor - def.cut * dt) : Math.min(1, factor + def.restore * dt);
}
