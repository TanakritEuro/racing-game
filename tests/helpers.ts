import { TUNING } from '../src/config';
import { PHYSICS_STEP } from '../src/constants';
import { clamp } from '../src/math';
import { initPhysics } from '../src/physics';
import { Simulation } from '../src/sim';
import { TEST_CIRCUIT } from '../src/track/circuits';
import { buildTrack, nearestSample, type TrackDef } from '../src/track/track';
import { controls, type Controls } from '../src/vehicle/car';
import type { CarDef } from '../src/vehicle/carDef';
import { KESTREL } from '../src/vehicle/cars';

export async function createSim(trackDef: TrackDef = TEST_CIRCUIT, carDef: CarDef = KESTREL): Promise<Simulation> {
  await initPhysics();
  return new Simulation(buildTrack(trackDef), carDef);
}

/** Fixed controls, or a driver asked for controls before every step. */
export type Driver = Controls | (() => Controls);

const next = (driver: Driver): Controls => (typeof driver === 'function' ? driver() : driver);

/** Step the simulation for `seconds`. */
export function run(sim: Simulation, driver: Driver, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / PHYSICS_STEP); i++) sim.step(next(driver));
}

/** Step until `done` returns true or `limit` seconds pass; returns the time taken, or null. */
export function runUntil(sim: Simulation, driver: Driver, done: () => boolean, limit: number): number | null {
  const start = sim.time;
  while (sim.time - start < limit) {
    sim.step(next(driver));
    if (done()) return sim.time - start;
  }
  return null;
}

/**
 * A test driver that follows the centreline at `targetSpeed` (m/s): pure-pursuit steering
 * towards a point `lookahead` seconds ahead (at least `minLookahead` metres), proportional
 * throttle and brake. It drives through `Controls` like any other driver, so it gets no
 * help from the car model.
 */
export function followLine(sim: Simulation, targetSpeed: number, lookahead = 0.8, minLookahead = 12): () => Controls {
  const { track, car } = sim;
  const n = track.samples.length;
  const spacing = track.length / n;
  let index: number | undefined;
  return () => {
    const p = car.position;
    const f = car.forward;
    const fl = Math.hypot(f.x, f.z);
    const fx = f.x / fl;
    const fz = f.z / fl;
    index = nearestSample(track, p.x, p.z, index);
    const ahead = Math.round(Math.max(minLookahead, lookahead * Math.abs(car.speed)) / spacing);
    const target = track.samples[(index + ahead) % n];
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    // Angle to the target, positive to the right; the car's right on the ground is (-fz, fx).
    const alpha = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);
    const wheelAngle = Math.atan((4 * car.def.wheelbaseHalf * Math.sin(alpha)) / Math.hypot(dx, dz));
    const lock = car.def.steeringLock / (1 + Math.abs(car.speed) / TUNING.steering.halfLockSpeed);
    const error = targetSpeed - car.speed;
    return controls({
      steer: clamp(wheelAngle / lock, -1, 1),
      throttle: clamp(error * 0.5, 0, 1),
      brake: clamp(-error * 0.3, 0, 1),
    });
  };
}
