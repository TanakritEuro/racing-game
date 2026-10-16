// The cars. Invented makes only (CLAUDE.md conventions).

import type { CarDef, TyreDef } from './carDef';

/** A road-going performance tyre: peaks at about 10 % slip and 8°, slides at ~80 % of peak. */
const SPORT_TYRE: TyreDef = {
  radius: 0.33,
  width: 0.225,
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

/** Springs and dampers for a firm road car: ~1.4 Hz ride. */
const SPORT_SUSPENSION = {
  restLength: 0.35,
  stiffness: 26000,
  bump: 2600, // ~0.45 of critical
  rebound: 4000, // ~0.7 of critical
  bumpStop: { length: 0.1, stiffness: 150_000 },
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
  steering: {
    lock: 0.6,
    rate: 3, // full lock in 0.2 s
    ackermann: 0.6,
  },
  suspension: {
    // A stiffer rear bar: the front takes ~45 % of the lateral load transfer, for mild
    // understeer at the limit and ~0.98 g on the skidpad.
    front: { ...SPORT_SUSPENSION, antiRoll: 10_000 },
    rear: { ...SPORT_SUSPENSION, antiRoll: 16_000 },
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
    friction: { base: 15, perRpm: 0.006 }, // ~60 N·m of engine braking at the limiter
    idleRpm: 900,
    limiterRpm: 7500,
    inertia: 0.12,
    throttleMap: 2,
    cylinders: 4,
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
    handbrakeTorque: 1500,
  },
  aids: {
    abs: { slip: 1, release: 12, apply: 5, minSpeed: 2 },
    tc: { slip: 1.2, minSlipSpeed: 0.5, cut: 10, restore: 6 },
  },
  aero: {
    dragArea: 0.62,
    // ~560 N of downforce at 200 km/h, 40 % of it at the front: steadier at speed.
    lift: { front: -0.12, rear: -0.18 },
  },
  cameras: {
    bumper: { x: 0, y: -0.05, z: -2.2 },
    hood: { x: 0, y: 0.34, z: -0.8 },
  },
};

/**
 * Wren: a light, low-powered roadster on narrower tyres. Targets: 980 kg, 50 % on the front
 * axle, ~100 kW, about 8 s to 100 km/h, ~205 km/h, ~0.9 g, gentle at the limit.
 */
export const WREN: CarDef = {
  name: 'Wren',
  mass: 980,
  centreOfMass: { x: 0, y: -0.24, z: 0 },
  halfExtents: { x: 0.85, y: 0.32, z: 1.95 },
  wheelbaseHalf: 1.2,
  trackHalf: 0.75,
  mountHeight: -0.1,
  steering: { lock: 0.6, rate: 3, ackermann: 0.6 },
  suspension: {
    // Softer for the lighter car (~1.45 Hz), the same damping ratios as Kestrel's.
    front: { ...SPORT_SUSPENSION, stiffness: 21000, bump: 2050, rebound: 3200, antiRoll: 8000 },
    rear: { ...SPORT_SUSPENSION, stiffness: 21000, bump: 2050, rebound: 3200, antiRoll: 11000 },
  },
  tyres: {
    front: { ...SPORT_TYRE, radius: 0.31, width: 0.195, inertia: 0.75, mu: 1.02, nominalLoad: 2500 },
    rear: { ...SPORT_TYRE, radius: 0.31, width: 0.195, inertia: 0.75, mu: 1.02, nominalLoad: 2500 },
  },
  engine: {
    // 152 N·m at 5000 rpm, ~99 kW at 7000.
    torqueCurve: [
      [1000, 105],
      [2000, 125],
      [3000, 140],
      [4000, 150],
      [5000, 152],
      [6000, 148],
      [7000, 135],
      [7500, 124],
      [8000, 105],
    ],
    friction: { base: 12, perRpm: 0.005 },
    idleRpm: 950,
    limiterRpm: 7600,
    inertia: 0.1,
    throttleMap: 2,
    cylinders: 4,
  },
  clutch: { maxTorque: 300, engageRate: 6, launchRpm: 3500 },
  gearbox: {
    ratios: [3.4, 2.15, 1.6, 1.25, 1.03, 0.86],
    reverse: 3.3,
    finalDrive: 4.3,
    efficiency: 0.92,
    shiftTime: 0.2,
    upshiftRpm: { light: 3200, full: 7300 },
    downshiftRpm: { coast: 2200, full: 4200 },
  },
  differential: { type: 'lsd', preload: 40, ramp: 0.3 },
  brakes: { maxTorque: 3800, frontBias: 0.62, handbrakeTorque: 1200 },
  aids: KESTREL.aids,
  aero: {
    // An open roadster: more drag, next to no downforce.
    dragArea: 0.7,
    lift: { front: -0.03, rear: -0.05 },
  },
  cameras: {
    bumper: { x: 0, y: -0.05, z: -2.0 },
    hood: { x: 0, y: 0.32, z: -0.6 },
  },
};

/**
 * Harrier: a heavy, powerful front-engined GT on wide tyres with real downforce. Targets:
 * 1480 kg, 48 % on the front axle, ~260 kW, about 5 s to 100 km/h, ~285 km/h, ~1.05 g, and
 * a handful when the rear lets go.
 */
export const HARRIER: CarDef = {
  name: 'Harrier',
  mass: 1480,
  // 48 % front: 0.056 m behind the middle of the 2.8 m wheelbase.
  centreOfMass: { x: 0, y: -0.24, z: 0.056 },
  halfExtents: { x: 0.95, y: 0.34, z: 2.3 },
  wheelbaseHalf: 1.4,
  trackHalf: 0.84,
  mountHeight: -0.1,
  steering: { lock: 0.58, rate: 3, ackermann: 0.6 },
  suspension: {
    // Stiffer for the heavier car (~1.5 Hz).
    front: { ...SPORT_SUSPENSION, stiffness: 36000, bump: 3300, rebound: 5100, antiRoll: 15000 },
    rear: { ...SPORT_SUSPENSION, stiffness: 36000, bump: 3300, rebound: 5100, antiRoll: 22000 },
  },
  tyres: {
    front: { ...SPORT_TYRE, radius: 0.34, width: 0.255, inertia: 1.05, mu: 1.12, nominalLoad: 3600 },
    // Wider at the rear, and a little more grip there, for the power.
    rear: { ...SPORT_TYRE, radius: 0.34, width: 0.285, inertia: 1.15, mu: 1.16, nominalLoad: 3600 },
  },
  engine: {
    // 420 N·m at 4500 rpm, ~262 kW at 6500.
    torqueCurve: [
      [1000, 280],
      [2000, 340],
      [3000, 390],
      [4000, 415],
      [4500, 420],
      [5500, 410],
      [6500, 385],
      [7000, 360],
      [7500, 320],
    ],
    friction: { base: 20, perRpm: 0.008 },
    idleRpm: 850,
    limiterRpm: 7000,
    inertia: 0.16,
    throttleMap: 2,
    cylinders: 6,
  },
  clutch: { maxTorque: 700, engageRate: 6, launchRpm: 3000 },
  gearbox: {
    ratios: [3.0, 2.0, 1.5, 1.18, 0.97, 0.8],
    reverse: 3.0,
    finalDrive: 3.7,
    efficiency: 0.92,
    shiftTime: 0.2,
    upshiftRpm: { light: 3000, full: 6700 },
    downshiftRpm: { coast: 2000, full: 3800 },
  },
  differential: { type: 'lsd', preload: 60, ramp: 0.28 },
  brakes: { maxTorque: 7500, frontBias: 0.62, handbrakeTorque: 1800 },
  aids: KESTREL.aids,
  aero: {
    dragArea: 0.7,
    // ~1500 N of downforce at 200 km/h, 40 % of it at the front.
    lift: { front: -0.32, rear: -0.48 },
  },
  cameras: {
    bumper: { x: 0, y: -0.05, z: -2.35 },
    hood: { x: 0, y: 0.36, z: -0.9 },
  },
};

/** Every car, in the order a menu lists them. */
export const CARS: readonly CarDef[] = [WREN, KESTREL, HARRIER];
