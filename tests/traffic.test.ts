import { describe, expect, it } from 'vitest';
import { createAiDriver, type AiDriver } from '../src/ai/driver';
import { PERFECT, type Skill } from '../src/ai/skill';
import { Traffic } from '../src/ai/traffic';
import { PHYSICS_STEP } from '../src/constants';
import { initPhysics } from '../src/physics';
import { Simulation } from '../src/sim';
import { TEST_CIRCUIT } from '../src/track/circuits';
import { buildTrack } from '../src/track/track';
import { KESTREL } from '../src/vehicle/cars';

const track = buildTrack(TEST_CIRCUIT);

/** AI cars with `skills` in grid `slots`, raced for up to `seconds`; counts steps with cars touching. */
async function race(skills: Skill[], slots: number[], seconds: number, until?: (sim: Simulation, traffic: Traffic) => boolean) {
  await initPhysics();
  const sim = new Simulation(track, KESTREL, { cars: skills.length, slots });
  const drivers: AiDriver[] = skills.map((s, k) => createAiDriver(track, KESTREL, s, k + 1));
  const traffic = new Traffic(track, sim.cars);
  let touching = 0;
  for (let k = 0; k < seconds * 120; k++) {
    traffic.update(sim.cars);
    const c = drivers.map((d, i) => {
      traffic.advise(i, d, PHYSICS_STEP, sim.timers[i].laps < 1);
      return d.drive(sim.cars[i], PHYSICS_STEP);
    });
    sim.step(c);
    let contact = false;
    for (let i = 0; i < sim.cars.length; i++) {
      for (let j = i + 1; j < sim.cars.length; j++) {
        sim.physics.world.contactPair(sim.cars[i].collider, sim.cars[j].collider, (manifold) => {
          if (manifold.numContacts() > 0) contact = true;
        });
      }
    }
    if (contact) touching++;
    drivers.forEach((d, i) => {
      if (d.stuck) {
        sim.recover(i);
        d.recovered();
      }
    });
    if (until?.(sim, traffic)) break;
  }
  return { sim, drivers, traffic, touching };
}

/** Laps plus the fraction of the current one, from the timer and the track position. */
const progress = (sim: Simulation, traffic: Traffic, i: number) => sim.timers[i].laps + traffic.positions[i].distance / track.length;

describe('traffic', () => {
  it('a faster car gets past a slower one without touching it', async () => {
    const slow = { ...PERFECT, pace: 0.8, aggression: 0.5 };
    const fast = { ...PERFECT, pace: 0.98, aggression: 0.7 };
    // The slow car on pole, the fast one a row behind.
    const { sim, traffic, touching } = await race([slow, fast], [0, 2], 200, (s, t) => s.timers[1].laps >= 1 && progress(s, t, 1) > progress(s, t, 0) + 0.05);
    expect(progress(sim, traffic, 1)).toBeGreaterThan(progress(sim, traffic, 0));
    // Passed within three laps.
    expect(sim.timers[1].laps).toBeLessThanOrEqual(3);
    expect(touching).toBe(0);
  }, 120_000);

  it('two equal cars side by side keep apart', async () => {
    const skill = { ...PERFECT, pace: 0.95 };
    const { sim, touching } = await race([skill, skill], [0, 1], 60);
    expect(touching).toBe(0);
    expect(sim.timers[0].laps + sim.timers[1].laps).toBeGreaterThan(0);
  }, 120_000);

  it('a field of eight gets round a lap without a pile-up', async () => {
    const skills = Array.from({ length: 8 }, (_, k) => ({ ...PERFECT, pace: 0.9 + 0.01 * k, aggression: 0.6 }));
    const { sim, touching, drivers } = await race(skills, [0, 1, 2, 3, 4, 5, 6, 7], 120, (s) => s.timers.every((t) => t.laps >= 1));
    expect(sim.timers.every((t) => t.laps >= 1)).toBe(true);
    // A bump or two is racing; a pile-up is not (under a second of contact in all).
    expect(touching).toBeLessThan(120);
    expect(drivers.every((d) => !d.stuck)).toBe(true);
  }, 120_000);
});
