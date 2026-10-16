import { describe, expect, it } from 'vitest';
import { PHYSICS_STEP } from '../src/constants';
import { initPhysics } from '../src/physics';
import { Simulation, type Contact } from '../src/sim';
import { TEST_CIRCUIT } from '../src/track/circuits';
import { barrierOffset } from '../src/track/geometry';
import { buildTrack, lateralOffset } from '../src/track/track';
import { controls, NO_CONTROLS, poseOnTrack, type Controls } from '../src/vehicle/car';
import { createSim, followLine } from './helpers';

/** Step `seconds`, keeping copies of every contact reported. */
function collect(sim: Simulation, driver: () => Controls | Controls[], seconds: number): Contact[] {
  const seen: Contact[] = [];
  for (let k = 0; k < seconds / PHYSICS_STEP; k++) {
    sim.step(driver());
    for (const c of sim.contacts) seen.push({ ...c });
  }
  return seen;
}

/** Drive into the barrier on the right of the first straight (the pit lane is on its left) at `speed` (m/s). */
async function intoBarrier(speed: number): Promise<{ contacts: Contact[]; sim: Simulation }> {
  const sim = await createSim();
  const { track } = sim;
  const p = track.samples[40];
  // Turned 60° to the right of the track's direction.
  const pose = poseOnTrack(p);
  const angle = -Math.PI / 3;
  const half = angle / 2;
  // Rotate about up (+Y): q_turn × q.
  const q = pose.rotation;
  const t = { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
  pose.rotation = {
    w: t.w * q.w - t.y * q.y,
    x: t.w * q.x + t.y * q.z,
    y: t.w * q.y + t.y * q.w,
    z: t.w * q.z - t.y * q.x,
  };
  sim.car.reset(pose);
  // Launch it at `speed` along where it now points.
  const f = sim.car.forward;
  sim.car.body.setLinvel({ x: f.x * speed, y: 0, z: f.z * speed }, true);
  return { contacts: collect(sim, () => NO_CONTROLS, 2), sim };
}

describe('contacts', () => {
  it('reports nothing while driving clean', async () => {
    const sim = await createSim();
    const driver = followLine(sim, 25, { corners: true });
    expect(collect(sim, driver, 20)).toEqual([]);
  });

  it('reports hitting a barrier, harder the faster the car hits it', async () => {
    const slow = await intoBarrier(10);
    const fast = await intoBarrier(25);
    for (const r of [slow, fast]) {
      expect(r.contacts.length).toBeGreaterThan(0);
      expect(r.contacts.every((c) => c.against === 'barrier' && c.car === 0)).toBe(true);
      // Where the barrier is, beside the track.
      const c = r.contacts[0];
      const i = r.sim.timer.index;
      const off = Math.abs(lateralOffset(r.sim.track, i, c.x, c.z));
      expect(off).toBeGreaterThan(barrierOffset(r.sim.track.samples[i], 'right') - 2);
    }
    const hardest = (cs: Contact[]) => Math.max(...cs.map((c) => c.impulse));
    expect(hardest(fast.contacts)).toBeGreaterThan(1.5 * hardest(slow.contacts));
  });

  it('reports two cars touching, for both of them', async () => {
    await initPhysics();
    const sim = new Simulation(buildTrack(TEST_CIRCUIT), undefined, { cars: 2 });
    // Car 1 (right, a little behind) steers across into car 0.
    collect(sim, () => [NO_CONTROLS, NO_CONTROLS], 0.5);
    const contacts = collect(sim, () => [NO_CONTROLS, controls({ throttle: 1, steer: -0.6 })], 4);
    const cars = new Set(contacts.filter((c) => c.against === 'car').map((c) => c.car));
    expect(cars).toEqual(new Set([0, 1]));
  });
});
