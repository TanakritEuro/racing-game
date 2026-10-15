// Tuning values that aren't about a particular car. Everything you might want to tweak
// while playtesting lives here or in the car's data (`vehicle/cars.ts`), so feel can be
// adjusted without hunting through the code.

export const TUNING = {
  steering: {
    /** Speed (m/s) at which full lock is halved; keyboard steering needs this to be drivable. */
    halfLockSpeed: 22,
    /** How fast the wheel turns towards the keyboard's target (per second) and back to centre. */
    rate: 4,
    returnRate: 7,
  },
  automatic: {
    /** Below this forward speed (m/s), holding brake engages reverse. */
    reverseBelow: 0.5,
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
    distance: 6.2,
    height: 2.1,
    lookAhead: 4,
    fov: 62,
    /** Smoothing: fraction of the remaining gap closed per second (higher = stiffer). */
    follow: 6,
  },
};
