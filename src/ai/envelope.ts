// A car's performance envelope, from its data alone: how hard it can corner, brake and
// accelerate at a given speed. The AI's speed profile is built from this, so every car
// (and every future car) gets a profile without hand tuning. Pure maths.

import { TUNING } from '../config';
import { AIR_DENSITY, GRAVITY } from '../constants';
import type { CarDef } from '../vehicle/carDef';
import { fullThrottleTorque } from '../vehicle/engine';
import { frictionCoefficient } from '../vehicle/tyre';

export interface CarEnvelope {
  mass: number;
  /** Friction coefficients the whole car reaches, cornering and braking. */
  lateralMu: number;
  brakingMu: number;
  /** Downforce per unit of speed squared, over mass (1/m): downforce / m = downforce·v². */
  downforce: number;
  /** Drag per unit of speed squared, over mass (1/m), and rolling resistance (fraction of g). */
  drag: number;
  rolling: number;
  /** Highest drive force at the wheels at speed v (N), in the best gear. */
  driveForce(v: number): number;
}

const G = -GRAVITY;

export function carEnvelope(def: CarDef): CarEnvelope {
  const E = TUNING.ai.envelope;
  // Static loads: the centre of mass sits `centreOfMass.z` behind the middle of the wheelbase.
  const frontShare = 0.5 - def.centreOfMass.z / (2 * def.wheelbaseHalf);
  const weight = def.mass * G;
  const frontMu = frictionCoefficient(def.tyres.front, (weight * frontShare) / 2);
  const rearMu = frictionCoefficient(def.tyres.rear, (weight * (1 - frontShare)) / 2);
  const mu = frontMu * frontShare + rearMu * (1 - frontShare);
  const lift = -(def.aero.lift.front + def.aero.lift.rear);
  const { engine, gearbox, clutch } = def;
  const radius = def.tyres.rear.radius;
  const rpmPerSpeed = 60 / (2 * Math.PI * radius);
  return {
    mass: def.mass,
    lateralMu: mu * E.lateral,
    brakingMu: mu * E.braking,
    downforce: (0.5 * AIR_DENSITY * lift) / def.mass,
    drag: (0.5 * AIR_DENSITY * def.aero.dragArea) / def.mass,
    rolling: def.tyres.rear.rollingResistance,
    driveForce(v: number): number {
      let best = 0;
      for (const ratio of gearbox.ratios) {
        const overall = ratio * gearbox.finalDrive;
        const rpm = Math.abs(v) * rpmPerSpeed * overall;
        if (rpm > engine.limiterRpm) continue;
        // Below the launch speed the clutch slips with the engine held at its launch rpm.
        const torque = fullThrottleTorque(engine, Math.max(rpm, clutch.launchRpm));
        best = Math.max(best, (torque * overall * gearbox.efficiency) / radius);
      }
      return best;
    },
  };
}

/**
 * Grip available (m/s²) at speed v, with `normal` the road's push per unit mass without
 * downforce (g on the flat; less over a crest, more in a dip or on a banking).
 */
export function gripAt(env: CarEnvelope, mu: number, v: number, normal = G): number {
  return mu * Math.max(0, normal + env.downforce * v * v);
}
