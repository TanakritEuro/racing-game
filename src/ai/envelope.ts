// A car's performance envelope, from its data alone: how hard it can corner, brake and
// accelerate at a given speed. The AI's speed profile is built from this, so every car
// (and every future car) gets a profile without hand tuning. Pure maths.

import { TUNING } from '../config';
import { AIR_DENSITY, GRAVITY } from '../constants';
import { drivenTyre, type CarDef } from '../vehicle/carDef';
import { fullThrottleTorque } from '../vehicle/engine';
import { frictionCoefficient } from '../vehicle/tyre';
import { surfaceGrip } from '../track/weather';

export interface CarEnvelope {
  mass: number;
  /** Friction coefficients the whole car reaches, cornering and braking. */
  lateralMu: number;
  brakingMu: number;
  /** Downforce per unit of speed squared, over mass (1/m): downforce / m = downforce·v². */
  downforce: number;
  /**
   * The downforce cornering can use (1/m, as `downforce`): each axle has to hold its share
   * of the car's weight sideways, so the end with the least downforce for its share of the
   * weight sets the limit (a car with its downforce further back than its weight runs out of
   * front grip first at speed); and only part of that (`aeroCredit`).
   */
  corneringDownforce: number;
  /** Drag per unit of speed squared, over mass (1/m), and rolling resistance (fraction of g). */
  drag: number;
  rolling: number;
  /** Share of the grip the driven wheels have for accelerating (their axle's load share; all of it for all-wheel drive). */
  traction: number;
  /** Highest drive force at the wheels at speed v (N), in the best gear. */
  driveForce(v: number): number;
  /**
   * Highest acceleration the engine gives at speed v (m/s²), before drag: the drive force
   * over the car's mass plus the engine and wheels it has to spin up (in first gear the
   * engine alone adds the equivalent of ~200 kg).
   */
  driveAccel(v: number): number;
}

const G = -GRAVITY;

/** `wet`: how wet the road is (0–1): the grip the car reaches falls with the road's. */
export function carEnvelope(def: CarDef, wet = 0): CarEnvelope {
  const E = TUNING.ai.envelope;
  // Static loads: the centre of mass sits `centreOfMass.z` behind the middle of the wheelbase.
  const frontShare = 0.5 - def.centreOfMass.z / (2 * def.wheelbaseHalf);
  const weight = def.mass * G;
  const frontMu = frictionCoefficient(def.tyres.front, (weight * frontShare) / 2);
  const rearMu = frictionCoefficient(def.tyres.rear, (weight * (1 - frontShare)) / 2);
  const mu = (frontMu * frontShare + rearMu * (1 - frontShare)) * surfaceGrip('asphalt', wet, 0).grip;
  const lift = -(def.aero.lift.front + def.aero.lift.rear);
  const balanced = Math.min(-def.aero.lift.front / frontShare, -def.aero.lift.rear / (1 - frontShare));
  const { engine, gearbox, clutch } = def;
  const radius = drivenTyre(def).radius;
  const rpmPerSpeed = 60 / (2 * Math.PI * radius);
  const wheelInertia = 2 * (def.tyres.front.inertia + def.tyres.rear.inertia);
  // Best gear at speed v: its drive force and the mass it accelerates.
  const best = (v: number) => {
    let force = 0;
    let accel = 0;
    for (const ratio of gearbox.ratios) {
      const overall = ratio * gearbox.finalDrive;
      const rpm = Math.abs(v) * rpmPerSpeed * overall;
      if (rpm > engine.limiterRpm) continue;
      // Below the launch speed the clutch slips with the engine held at its launch rpm.
      const f = (fullThrottleTorque(engine, Math.max(rpm, clutch.launchRpm)) * overall * gearbox.efficiency) / radius;
      const mass = def.mass + (engine.inertia * overall * overall + wheelInertia) / (radius * radius);
      force = Math.max(force, f);
      accel = Math.max(accel, f / mass);
    }
    return { force, accel };
  };
  return {
    mass: def.mass,
    lateralMu: mu * E.lateral,
    brakingMu: mu * E.braking,
    downforce: (0.5 * AIR_DENSITY * lift) / def.mass,
    corneringDownforce: (0.5 * AIR_DENSITY * Math.max(0, balanced) * E.aeroCredit) / def.mass,
    drag: (0.5 * AIR_DENSITY * def.aero.dragArea) / def.mass,
    rolling: def.tyres.rear.rollingResistance,
    traction: tractionShare(def, frontShare),
    driveForce: (v) => best(v).force,
    driveAccel: (v) => best(v).accel * E.power,
  };
}

/**
 * Share of the car's grip its driven wheels can use to accelerate: their axle's static
 * share of the weight, plus (rear) or minus (front) what moves back onto the rear under
 * acceleration. All-wheel drive with an open centre differential uses only as much as the
 * axle with the least grip for its share of the torque; a locked one uses all of it, and a
 * limited-slip one some of the rest, as much as its ramp moves the torque.
 */
export function tractionShare(def: CarDef, frontShare: number): number {
  const transfer = TUNING.ai.envelope.tractionTransfer;
  const front = frontShare - transfer;
  const rear = 1 - front;
  const D = def.drivetrain;
  if (D.layout === 'rwd') return rear;
  if (D.layout === 'fwd') return front;
  const split = D.centre ? D.centre.split : 0.5;
  const open = Math.min(1, front / split, rear / (1 - split));
  const diff = D.centre?.diff;
  if (!diff || diff.type === 'open') return open;
  if (diff.type === 'locked') return 1;
  return open + (1 - open) * Math.min(1, diff.ramp);
}

/** `mu` with the share fast corners give up at speed v (`TUNING.ai.envelope.fast`). */
export function fastMu(mu: number, v: number): number {
  const F = TUNING.ai.envelope.fast;
  return mu * (1 - F.margin * Math.min(1, Math.max(0, (v - F.from) / (F.to - F.from))));
}

/**
 * Grip available (m/s²) at speed v, with `normal` the road's push per unit mass without
 * downforce (g on the flat; less over a crest, more in a dip or on a banking).
 */
export function gripAt(env: CarEnvelope, mu: number, v: number, normal = G): number {
  return mu * Math.max(0, normal + env.downforce * v * v);
}
