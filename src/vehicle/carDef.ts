// A car is data: every number about one car lives in a `CarDef`, so more cars are just
// more definitions (`cars.ts`). Numbers that aren't about a particular car (surfaces,
// keyboard steering assistance, camera) stay in `TUNING`.
//
// Milestone 1 grows this into the full model: tyre curves, engine, gearbox, clutch and
// differential. Fields marked PLACEHOLDER belong to the scaffold's simple model and go.

import type { Vec3 } from '../math';

export interface SuspensionDef {
  /** Spring fully extended (m). */
  restLength: number;
  /** Spring rate per wheel (N/m). */
  stiffness: number;
  /** Damping per wheel (N·s/m). */
  damping: number;
}

export interface TyreDef {
  radius: number; // m
  /** PLACEHOLDER: lateral force = cornering stiffness × slip angle × load (per radian, per newton of load). */
  corneringStiffness: number;
  /** PLACEHOLDER: slip angles use max(|forward speed|, this) so the force stays stable near standstill (m/s). */
  lowSpeedClamp: number;
  /** Rolling resistance coefficient (fraction of load). */
  rollingResistance: number;
}

export interface EngineDef {
  /** PLACEHOLDER: peak power (W) and the most drive force the engine can put down at low speed (N). */
  power: number;
  maxDriveForce: number;
  /** PLACEHOLDER: drive force when reversing (N). */
  reverseForce: number;
}

export interface BrakesDef {
  /**
   * PLACEHOLDER: brake force per wheel at full pedal, as a fraction of that wheel's grip
   * limit, before the bias split. The friction circle caps it, so wheels can't lock.
   */
  strength: number;
  /** Share of braking on the front axle. */
  frontBias: number;
}

export interface CarDef {
  name: string;
  mass: number; // kg
  /** Centre of mass relative to the chassis box's centre (m, car local y). Lower = less body roll. */
  comHeightOffset: number;
  /** Chassis collision box half extents (m): width, height, length. */
  halfExtents: Vec3;
  /** Wheel mounts (top of the suspension) in car local space. -Z is the front. */
  wheelbaseHalf: number;
  trackHalf: number;
  mountHeight: number;
  /** Front wheel angle at full lock (rad). */
  steeringLock: number;
  suspension: SuspensionDef;
  tyre: TyreDef;
  engine: EngineDef;
  brakes: BrakesDef;
  aero: {
    /** Drag coefficient × frontal area, C_d·A (m²). */
    dragArea: number;
  };
}
