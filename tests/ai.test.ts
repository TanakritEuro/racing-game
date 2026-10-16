// Soak tests: the AI laps every circuit cleanly, within a target time. The slowest tests in
// the suite (several laps of real simulation per circuit).

import { describe, expect, it } from 'vitest';
import { circuitAi, createAiDriver } from '../src/ai/driver';
import { profileLapTime, speedProfile } from '../src/ai/speedProfile';
import { PHYSICS_STEP } from '../src/constants';
import { initPhysics } from '../src/physics';
import { Simulation } from '../src/sim';
import { CIRCUITS } from '../src/track/circuits';
import { barrierOffset } from '../src/track/geometry';
import { buildTrack, lateralOffset } from '../src/track/track';
import { KESTREL } from '../src/vehicle/cars';

/** Flying-lap targets for a hard AI (s): measured, with a few percent either way. */
const TARGETS: Record<string, [number, number]> = {
  harrowmere: [103, 110],
  saltmarsh: [90, 97],
  ridgeback: [102, 109],
  'proving-ground': [50, 56],
};

describe.each(CIRCUITS.map((c) => [c.name, c] as const))('AI at %s', (_, def) => {
  it('laps three times cleanly within its target time', async () => {
    await initPhysics();
    const track = buildTrack(def);
    const sim = new Simulation(track);
    const ai = createAiDriver(track, KESTREL);
    const laps: { time: number; valid: boolean }[] = [];
    let closest = Infinity;
    let recoveries = 0;
    for (let k = 0; k < 600 * 120 && sim.timer.laps < 3; k++) {
      sim.step(ai.drive(sim.car, PHYSICS_STEP));
      if (ai.stuck) {
        recoveries++;
        sim.recover();
        ai.recovered();
      }
      // How close the car's side comes to a barrier.
      const p = sim.car.position;
      const i = sim.timer.index;
      const off = lateralOffset(track, i, p.x, p.z);
      closest = Math.min(closest, barrierOffset(track.samples[i], off > 0 ? 'left' : 'right') - Math.abs(off) - KESTREL.halfExtents.x);
      if (sim.timer.laps > laps.length) laps.push({ time: sim.timer.lastLap!, valid: sim.timer.lastValid });
    }
    expect(laps).toHaveLength(3);
    expect(laps.every((l) => l.valid)).toBe(true);
    expect(recoveries).toBe(0);
    expect(closest).toBeGreaterThan(1);
    const [lo, hi] = TARGETS[def.id];
    // Lap 1 starts just behind the line from a standstill; laps 2 and 3 are flying laps.
    for (const lap of laps.slice(1)) {
      expect(lap.time).toBeGreaterThan(lo);
      expect(lap.time).toBeLessThan(hi);
    }
    // ...and within ~6 % of what its speed profile predicts.
    const { line, env } = circuitAi(track, KESTREL);
    const predicted = profileLapTime(line, speedProfile(line, env));
    expect(laps[2].time / predicted).toBeLessThan(1.06);
  }, 300_000);
});
