// A car is data: every number about one car lives in a `CarDef`, so more cars are just
// more definitions (`cars.ts`). Numbers that aren't about a particular car (surfaces,
// keyboard steering assistance, camera, integration settings) stay in `TUNING`.

import type { Vec3 } from '../math';
import type { AidsDef } from './aids';
import type { DifferentialDef } from './differential';
import type { ClutchDef } from './drivetrain';
import type { EngineDef } from './engine';
import type { GearboxDef } from './gearbox';
import type { SteeringDef } from './steering';
import type { TyreModel } from './tyre';

export interface SuspensionDef {
  /** Spring fully extended (m). */
  restLength: number;
  /** Spring rate per wheel (N/m). */
  stiffness: number;
  /** Damping per wheel in compression (bump) and extension (rebound) (N·s/m). */
  bump: number;
  rebound: number;
  /** Below this suspension length (m) a much stiffer bump stop adds its force (N/m). */
  bumpStop: { length: number; stiffness: number };
  /**
   * Anti-roll bar (N/m): force per metre of difference between the axle's two wheels'
   * travel, pushing the more compressed side up and the other down. Stiffer at one end
   * moves more of the cornering load transfer there, so that end gives up grip first.
   */
  antiRoll: number;
}

export interface TyreDef extends TyreModel {
  radius: number; // m
  /** Wheel, tyre and brake disc about the axle (kg·m²). */
  inertia: number;
  /** Distance the tyre rolls for its slip to build up (m): longitudinal and lateral relaxation lengths. */
  relaxationLong: number;
  relaxationLat: number;
  /** Rolling resistance coefficient (fraction of load). */
  rollingResistance: number;
}

export interface BrakesDef {
  /** Brake torque of all four wheels together at full pedal (N·m). */
  maxTorque: number;
  /** Share of it on the front axle. */
  frontBias: number;
  /** Handbrake torque on each rear wheel at full pull (N·m). */
  handbrakeTorque: number;
}

export interface CarDef {
  name: string;
  mass: number; // kg
  /** Centre of mass relative to the chassis box's centre (m, car local). Lower = less body roll; +z = towards the rear. */
  centreOfMass: Vec3;
  /** Chassis collision box half extents (m): width, height, length. */
  halfExtents: Vec3;
  /** Wheel mounts (top of the suspension) in car local space. -Z is the front. */
  wheelbaseHalf: number;
  trackHalf: number;
  mountHeight: number;
  steering: SteeringDef;
  suspension: { front: SuspensionDef; rear: SuspensionDef };
  tyres: { front: TyreDef; rear: TyreDef };
  engine: EngineDef;
  clutch: ClutchDef;
  gearbox: GearboxDef;
  differential: DifferentialDef;
  brakes: BrakesDef;
  aids: AidsDef;
  aero: {
    /** Drag coefficient × frontal area, C_d·A (m²). */
    dragArea: number;
    /** Lift coefficient × area at each axle, C_L·A (m²): negative is downforce. */
    lift: { front: number; rear: number };
  };
  /** Where the bumper and hood cameras sit, in car local space (they look along -Z). */
  cameras: { bumper: Vec3; hood: Vec3 };
}
