import { initPhysics } from '../src/physics';
import { Simulation } from '../src/sim';
import { TEST_CIRCUIT } from '../src/track/circuits';
import { buildTrack } from '../src/track/track';
import type { Controls } from '../src/vehicle/car';
import { PHYSICS_STEP } from '../src/constants';

export async function createSim(): Promise<Simulation> {
  await initPhysics();
  return new Simulation(buildTrack(TEST_CIRCUIT));
}

/** Step the simulation for `seconds` with fixed controls. */
export function run(sim: Simulation, controls: Controls, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / PHYSICS_STEP); i++) sim.step(controls);
}

/** Step until `done` returns true or `limit` seconds pass; returns the time taken, or null. */
export function runUntil(sim: Simulation, controls: Controls, done: () => boolean, limit: number): number | null {
  const start = sim.time;
  while (sim.time - start < limit) {
    sim.step(controls);
    if (done()) return sim.time - start;
  }
  return null;
}
