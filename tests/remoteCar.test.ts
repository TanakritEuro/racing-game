import { describe, expect, it } from 'vitest';
import { createRng } from '../src/math';
import { RemoteCar } from '../src/online/remoteCar';
import { createState, packState, unpackState, type CarState } from '../src/online/state';
import { copyPose, createPose } from '../src/vehicle/pose';
import { NO_CONTROLS } from '../src/vehicle/car';
import { createSim, followLine } from './helpers';

/** The sim's car as a state at its time. */
function stateOf(sim: Awaited<ReturnType<typeof createSim>>): CarState {
  const s = createState();
  s.time = sim.time;
  copyPose(sim.current, s.pose);
  const v = sim.car.body.linvel();
  const w = sim.car.body.angvel();
  s.velocity = { x: v.x, y: v.y, z: v.z };
  s.angular = { x: w.x, y: w.y, z: w.z };
  s.speed = sim.car.speed;
  s.rpm = sim.car.drivetrain.rpm;
  return s;
}

describe('car states', () => {
  it('pack and unpack exactly, and refuse junk', async () => {
    const sim = await createSim();
    const s = stateOf(sim);
    s.laps = 2;
    s.distance = 123.5;
    expect(unpackState(packState(s))).toEqual(s);
    expect(unpackState(new ArrayBuffer(12))).toBeNull();
    const bad = new Float64Array(packState(s));
    bad[3] = Number.NaN;
    expect(unpackState(bad.buffer)).toBeNull();
  });
});

describe('a remote car', () => {
  it('follows a car round corners within half a metre over a laggy line, without jumping', async () => {
    const sim = await createSim();
    const driver = followLine(sim, 35, { corners: true });
    const remote = new RemoteCar();
    const rng = createRng(4);
    // States sent at 30 Hz, each arriving 60 ± 20 ms later.
    const inFlight: { at: number; state: CarState }[] = [];
    const shown = createPose();
    const before = createPose();
    let worst = 0;
    let worstJump = 0;
    let have = false;
    for (let k = 0; k < 40 * 120; k++) {
      copyPose(sim.current, before);
      sim.step(driver());
      if (k % 4 === 0) inFlight.push({ at: sim.time + 0.06 + (rng() * 2 - 1) * 0.02, state: stateOf(sim) });
      for (let i = inFlight.length - 1; i >= 0; i--) {
        if (inFlight[i].at <= sim.time) {
          remote.receive(inFlight[i].state);
          inFlight.splice(i, 1);
        }
      }
      const was = { ...shown.position };
      if (!remote.sample(sim.time, shown)) continue;
      if (k < 120) {
        have = true;
        continue;
      }
      const p = sim.current.position;
      worst = Math.max(worst, Math.hypot(shown.position.x - p.x, shown.position.y - p.y, shown.position.z - p.z));
      // Moves no further in a step than the real car did, give or take 10 cm.
      if (have) {
        const moved = Math.hypot(shown.position.x - was.x, shown.position.z - was.z);
        const real = Math.hypot(p.x - before.position.x, p.z - before.position.z);
        worstJump = Math.max(worstJump, Math.abs(moved - real));
      }
    }
    expect(worst).toBeLessThan(0.5);
    expect(worstJump).toBeLessThan(0.1);
  });

  it('holds still when the car is still, and holds its last place if the states stop', async () => {
    const sim = await createSim();
    const remote = new RemoteCar();
    for (let k = 0; k < 10; k++) {
      sim.step(NO_CONTROLS);
      remote.receive(stateOf(sim));
    }
    const a = createPose();
    const b = createPose();
    remote.sample(sim.time + 0.1, a);
    remote.sample(sim.time + 5, b);
    expect(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z)).toBeLessThan(0.01);
  });
});
