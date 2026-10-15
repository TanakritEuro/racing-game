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
    /** Friction coefficient (peak grip as a multiple of load) and extra rolling drag. */
    asphalt: { grip: 1.05, drag: 0 },
    grass: { grip: 0.55, drag: 0.08 },
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
