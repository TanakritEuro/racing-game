// Tuning values. Everything you might want to tweak while playtesting lives here, so the
// car's feel can be adjusted without hunting through the code.
//
// The car is a placeholder: a light rear-wheel-drive sports car (~1250 kg, ~150 kW).
// Milestone 1 replaces the simple tyre and drivetrain numbers with the real model.

export const TUNING = {
  car: {
    mass: 1250, // kg
    /** Centre of mass below the chassis box's centre (m, car local y). Lower = less body roll. */
    comHeightOffset: -0.25,
    /** Chassis collision box half extents (m): width, height, length. */
    halfExtents: { x: 0.9, y: 0.35, z: 2.15 },
    /** Wheel mounts (top of the suspension) in car local space. -Z is the front. */
    wheelbaseHalf: 1.3,
    trackHalf: 0.8,
    mountHeight: -0.1,
    wheelRadius: 0.33,
    /** Aerodynamic drag area C_d·A (m²). */
    dragArea: 0.7,
    /** Rolling resistance coefficient (fraction of weight). */
    rollingResistance: 0.015,
  },
  suspension: {
    restLength: 0.35, // m, spring fully extended
    stiffness: 26000, // N/m per wheel (~1.4 Hz ride frequency)
    damping: 2600, // N·s/m per wheel (~0.45 of critical)
  },
  steering: {
    /** Front wheel angle at full lock, standing still (rad). */
    maxAngle: 0.6,
    /** Speed (m/s) at which full lock is halved; keyboard steering needs this to be drivable. */
    halfLockSpeed: 22,
    /** How fast the wheel turns towards the keyboard's target (per second) and back to centre. */
    rate: 4,
    returnRate: 7,
  },
  engine: {
    /** Peak power (W) and the most drive force the engine can put down at low speed (N). */
    power: 150_000,
    maxDriveForce: 7000,
    /** Drive force when reversing (N). */
    reverseForce: 3000,
    /** Below this forward speed (m/s), holding brake engages reverse. */
    reverseBelow: 0.5,
  },
  brakes: {
    /**
     * Brake force per wheel at full pedal, as a fraction of that wheel's grip limit, before
     * the bias split. Above 1 the placeholder can't lock a wheel; the friction circle caps it.
     */
    strength: 1.15,
    /** Share of braking on the front axle. */
    frontBias: 0.6,
  },
  tyres: {
    /**
     * PLACEHOLDER tyre model (Milestone 1 replaces it with wheel spin dynamics and a
     * Pacejka curve): lateral force = cornering stiffness × slip angle × load, capped by
     * the friction circle. Units: per radian, as a multiple of the wheel's load.
     */
    corneringStiffness: 12,
    /** Slip angles use max(|forward speed|, this) so the force stays stable near standstill. */
    lowSpeedClamp: 3,
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
