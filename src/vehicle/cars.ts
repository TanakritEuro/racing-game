// The cars. Invented makes only (CLAUDE.md conventions).

import type { CarDef } from './carDef';

/**
 * Kestrel: a light rear-wheel-drive coupé, the reference car. Milestone 1 targets
 * 1250 kg, 150 kW, about 6 s to 100 km/h, 245 km/h and about 1 g of lateral grip.
 */
export const KESTREL: CarDef = {
  name: 'Kestrel',
  mass: 1250,
  comHeightOffset: -0.25,
  halfExtents: { x: 0.9, y: 0.35, z: 2.15 },
  wheelbaseHalf: 1.3,
  trackHalf: 0.8,
  mountHeight: -0.1,
  steeringLock: 0.6,
  suspension: {
    restLength: 0.35,
    stiffness: 26000, // ~1.4 Hz ride frequency
    damping: 2600, // ~0.45 of critical
  },
  tyre: {
    radius: 0.33,
    corneringStiffness: 12,
    lowSpeedClamp: 3,
    rollingResistance: 0.015,
  },
  engine: {
    power: 150_000,
    maxDriveForce: 7000,
    reverseForce: 3000,
  },
  brakes: {
    strength: 1.15,
    frontBias: 0.6,
  },
  aero: {
    dragArea: 0.7,
  },
};
