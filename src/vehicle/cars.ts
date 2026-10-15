// The cars. Invented makes only (CLAUDE.md conventions).

import type { CarDef, TyreDef } from './carDef';

/** A road-going performance tyre: peaks at about 10 % slip and 8°, slides at ~80 % of peak. */
const SPORT_TYRE: TyreDef = {
  radius: 0.33,
  inertia: 0.9,
  long: { B: 18, C: 1.45, E: 0 },
  lat: { B: 14, C: 1.35, E: -0.5 },
  mu: 1.1,
  nominalLoad: 3000,
  loadSensitivity: 0.15,
  relaxationLong: 0.15,
  relaxationLat: 0.35,
  rollingResistance: 0.015,
};

/**
 * Kestrel: a light rear-wheel-drive coupé, the reference car. Targets: 1250 kg, 47 %
 * on the front axle, 150 kW, about 6 s to 100 km/h, 245 km/h and about 1 g of lateral grip.
 */
export const KESTREL: CarDef = {
  name: 'Kestrel',
  mass: 1250,
  // 47 % front: the centre of mass sits 0.08 m behind the middle of the 2.6 m wheelbase.
  centreOfMass: { x: 0, y: -0.25, z: 0.08 },
  halfExtents: { x: 0.9, y: 0.35, z: 2.15 },
  wheelbaseHalf: 1.3,
  trackHalf: 0.8,
  mountHeight: -0.1,
  steeringLock: 0.6,
  suspension: {
    restLength: 0.35,
    stiffness: 26000, // ~1.4 Hz ride frequency
    bump: 2600, // ~0.45 of critical
    rebound: 4000, // ~0.7 of critical
    bumpStop: { length: 0.1, stiffness: 150_000 },
  },
  tyres: { front: SPORT_TYRE, rear: SPORT_TYRE },
  engine: {
    power: 150_000,
    maxWheelTorque: 2300,
    reverseTorque: 1000,
  },
  brakes: {
    maxTorque: 5000,
    frontBias: 0.62, // the front axle's share of the load at ~1 g: the fronts still lock first
  },
  aero: {
    dragArea: 0.62,
  },
};
