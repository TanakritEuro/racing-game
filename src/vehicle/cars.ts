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
    // 220 N·m at 5000 rpm, 150 kW at 7000.
    torqueCurve: [
      [1000, 140],
      [2000, 168],
      [3000, 192],
      [4000, 210],
      [5000, 220],
      [6000, 218],
      [6500, 213],
      [7000, 207],
      [7500, 195],
      [8000, 170],
    ],
    friction: { base: 15, perRpm: 0.004 },
    idleRpm: 900,
    limiterRpm: 7500,
    inertia: 0.18,
    throttleMap: 2,
  },
  clutch: {
    maxTorque: 400,
    engageRate: 6,
    launchRpm: 3500,
  },
  gearbox: {
    ratios: [3.3, 2.1, 1.55, 1.2, 1.0, 0.82],
    reverse: 3.2,
    finalDrive: 4.1,
    efficiency: 0.92,
    shiftTime: 0.2,
    upshiftRpm: { light: 3200, full: 7200 },
    downshiftRpm: { coast: 2200, full: 4000 },
  },
  differential: { type: 'lsd', preload: 50, ramp: 0.3 },
  brakes: {
    maxTorque: 5000,
    frontBias: 0.62, // the front axle's share of the load at ~1 g: the fronts still lock first
  },
  aero: {
    dragArea: 0.62,
  },
};
