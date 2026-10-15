// The engine: torque against RPM at full throttle, engine braking at closed throttle, and
// the blend between them. Idle control and the rev limiter live in the drivetrain.

export interface EngineDef {
  /** Full-throttle torque at the flywheel (N·m) against RPM, in rising RPM order. Linear between points. */
  torqueCurve: readonly (readonly [rpm: number, torque: number])[];
  /** Friction and pumping losses at closed throttle (engine braking): base + perRpm × RPM (N·m). */
  friction: { base: number; perRpm: number };
  idleRpm: number;
  /** Fuel is cut above this. */
  limiterRpm: number;
  /** Crank, flywheel and clutch plate (kg·m²). */
  inertia: number;
  /**
   * How progressive the throttle is: the share of full-throttle torque at pedal p is
   * 1 − (1 − p)^throttleMap. 1 is linear; 2 gives 75 % at half pedal, as a real
   * engine's airflow does.
   */
  throttleMap: number;
}

/** rad/s → RPM. */
export const RPM_PER_RAD_S = 60 / (2 * Math.PI);

export function fullThrottleTorque(def: EngineDef, rpm: number): number {
  const curve = def.torqueCurve;
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [r1, t1] = curve[i];
    if (rpm <= r1) {
      const [r0, t0] = curve[i - 1];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return curve[curve.length - 1][1];
}

/** Engine braking torque at closed throttle (N·m, positive = slowing the engine). */
export function frictionTorque(def: EngineDef, rpm: number): number {
  return def.friction.base + def.friction.perRpm * Math.max(rpm, 0);
}

/** Net torque at the flywheel for a throttle pedal of 0–1: full-throttle torque blended with engine braking. */
export function engineTorque(def: EngineDef, rpm: number, throttle: number): number {
  const share = 1 - Math.pow(1 - throttle, def.throttleMap);
  return share * fullThrottleTorque(def, rpm) - (1 - share) * frictionTorque(def, rpm);
}
