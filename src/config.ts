// Tuning values that aren't about a particular car. Everything you might want to tweak
// while playtesting lives here or in the car's data (`vehicle/cars.ts`), so feel can be
// adjusted without hunting through the code.

export const TUNING = {
  steering: {
    /**
     * Speed (m/s) at which full lock is halved; keyboard steering needs this to be drivable.
     * 12 gives ~10° at 100 km/h, about what the car needs at its limit (proper speed-sensitive
     * assistance is Milestone 2), and still ~19° for a hairpin at 36 km/h.
     */
    halfLockSpeed: 12,
    /** How fast the wheel turns towards the keyboard's target (per second) and back to centre. */
    rate: 4,
    returnRate: 7,
  },
  transmission: {
    /** Below this speed (m/s) the car counts as stopped: the automatic's brake pedal can select reverse. */
    reverseBelow: 0.5,
    /** In manual, reverse can only be selected below this speed (m/s). */
    reverseShiftBelow: 2,
    /** A manual downshift is refused if it would take the engine past the limiter by more than this (rpm). */
    overRevMargin: 300,
    /** The automatic waits this long after a shift before the next (s). */
    shiftPause: 0.4,
    /** The automatic only shifts down if the lower gear lands this far below its upshift point (rpm). */
    downshiftMargin: 300,
    /** Throttle per rpm short of the target while blipping to match revs on a downshift. */
    revMatchGain: 0.004,
    /** The automatic clutch latches fully in once it slips less than this (rpm)... */
    latchSlipRpm: 100,
    /** ...with the gearbox input at least this far above idle (rpm), and lets go below `unlatchAboveIdle`. */
    latchAboveIdle: 250,
    unlatchAboveIdle: 100,
    /** Pulling away, the automatic clutch carries this much extra torque per rpm above its bite point, at full throttle (N·m/rpm). */
    biteGain: 0.3,
    /** At or above this pedal the automatic clutch is dumped on a launch instead of fed in. */
    launchDumpPedal: 0.95,
  },
  drivetrain: {
    /** Gauss-Seidel passes over the clutch, differential and brake couplings per substep. */
    solverIterations: 10,
    /** Idle control: throttle per rpm below idle. */
    idleGain: 0.005,
    /** The limiter restores fuel this far below the limit (rpm). */
    limiterHysteresis: 150,
  },
  surfaces: {
    /** Grip relative to the tyre's own (multiplies its μ) and extra rolling drag (fraction of load). */
    asphalt: { grip: 1, drag: 0 },
    grass: { grip: 0.6, drag: 0.08 },
  },
  tyreIntegration: {
    /**
     * Wheel spin and slip are integrated this many times per physics step. A wheel's spin
     * against its tyre's grip rings at ~35 Hz, too fast for 120 Hz on its own.
     */
    substeps: 8,
    /**
     * Below `lowSpeedFade` (m/s) the tyre also damps its slip velocity, so the relaxed slip
     * (a spring at a standstill) doesn't ring. N·s/m per newton of load, at zero speed.
     */
    lowSpeedDamping: 1.5,
    lowSpeedFade: 3,
    /**
     * The relaxed slip ratio and tan(slip angle) are kept within ±this. Past it the tyre is
     * sliding anyway; the limit stops a stationary tyre storing a large deflection.
     */
    slipLimit: 1,
  },
  camera: {
    chase: {
      distance: 6.2,
      height: 2.1,
      lookAhead: 4,
      fov: 62,
      near: 0.3,
      /** Smoothing: fraction of the remaining gap closed per second (higher = stiffer). */
      follow: 6,
    },
    bumper: { fov: 75 },
    hood: { fov: 70 },
    /** Near clip plane for the cameras on the car (m), so the hood isn't cut off. */
    inCarNear: 0.05,
  },
};
