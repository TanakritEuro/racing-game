import { PHYSICS_STEP } from '../src/constants';
import { clamp } from '../src/math';
import { initPhysics } from '../src/physics';
import { Simulation } from '../src/sim';
import { TEST_CIRCUIT } from '../src/track/circuits';
import { buildTrack, lateralOffset, nearestSample, type Track, type TrackDef } from '../src/track/track';
import { controls, type Controls } from '../src/vehicle/car';
import type { CarDef } from '../src/vehicle/carDef';
import { KESTREL } from '../src/vehicle/cars';

/** Built tracks by definition: building is pure, so tests share them (and their terrain). */
const tracks = new Map<TrackDef, Track>();

export async function createSim(trackDef: TrackDef = TEST_CIRCUIT, carDef: CarDef = KESTREL): Promise<Simulation> {
  await initPhysics();
  let track = tracks.get(trackDef);
  if (!track) {
    track = buildTrack(trackDef);
    tracks.set(trackDef, track);
  }
  return new Simulation(track, carDef);
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
 * towards a point `lookahead` seconds ahead (at least `minLookahead` metres), `offset`
 * metres left of the centreline (negative = right), proportional throttle (up to
 * `maxThrottle`) and brake. It drives through `Controls` like any other driver, so it gets
 * no help from the car model.
 */
export function followLine(
  sim: Simulation,
  targetSpeed: number,
  { maxThrottle = 1, lookahead = 0.8, minLookahead = 12, offset = 0 } = {},
): () => Controls {
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
    const dx = target.x + target.nx * offset - p.x;
    const dz = target.z + target.nz * offset - p.z;
    // Angle to the target, positive to the right; the car's right on the ground is (-fz, fx).
    const alpha = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);
    const wheelAngle = Math.atan((4 * car.def.wheelbaseHalf * Math.sin(alpha)) / Math.hypot(dx, dz));
    const lock = car.def.steering.lock;
    const error = targetSpeed - car.speed;
    return controls({
      steer: clamp(wheelAngle / lock, -1, 1),
      throttle: clamp(error * 0.5, 0, maxThrottle),
      brake: clamp(-error * 0.3, 0, 1),
    });
  };
}

/**
 * Steady-state cornering limit on a constant-radius circle centred on the origin: settle at
 * 15 m/s, then creep the target speed up until the car can't hold the circle. Returns the
 * best 1 s average of the horizontal lateral acceleration (g), the slip angles there, and
 * the front axle's share of the lateral load transfer at ~0.65 g.
 */
export async function skidpadLimit(trackDef: TrackDef, carDef: CarDef = KESTREL, seconds = 75) {
  const s = await createSim(trackDef, carDef);
  let target = 15;
  const drive = () => followLine(s, target, { maxThrottle: 0.4 })();
  let index: number | undefined;
  let best = 0;
  const atBest = { front: 0, rear: 0, peakSlipAngle: s.car.wheels[0].tyre.peakSlipAngle };
  let frontTransferShare = 0;
  const window: number[] = [];
  for (let i = 0; i < seconds * 120; i++) {
    if (i > 15 * 120) target += 0.1 / 120;
    s.step(drive());
    const p = s.car.position;
    index = nearestSample(s.track, p.x, p.z, index);
    const v = s.car.body.linvel();
    window.push((v.x * v.x + v.z * v.z) / Math.hypot(p.x, p.z) / 9.81);
    if (window.length > 120) window.shift();
    const g = window.reduce((a, b) => a + b, 0) / window.length;
    const [fl, fr, rl, rr] = s.car.wheels;
    if (i === 30 * 120) {
      const front = Math.abs(fl.load - fr.load);
      frontTransferShare = front / (front + Math.abs(rl.load - rr.load));
    }
    if (window.length === 120 && Math.abs(lateralOffset(s.track, index, p.x, p.z)) < 5 && g > best) {
      best = g;
      atBest.front = Math.abs(fl.slipAngle + fr.slipAngle) / 2;
      atBest.rear = Math.abs(rl.slipAngle + rr.slipAngle) / 2;
    }
  }
  return { best, atBest, frontTransferShare };
}
