import { describe, expect, it } from 'vitest';
import { duration, frameCount } from '../src/race/recording';
import { TimeTrial, type LapEvent } from '../src/race/session';
import type { Simulation } from '../src/sim';
import { createSim, followLine } from './helpers';

/** Drive at up to `speed` (m/s) until the next lap completes; return what the session said. */
function lapAt(session: TimeTrial, sim: Simulation, speed: number, during?: (sim: Simulation) => void): LapEvent {
  const driver = followLine(sim, speed, { corners: true });
  const laps = sim.timer.laps;
  let event: LapEvent = null;
  for (let i = 0; i < 300 * 120 && sim.timer.laps === laps; i++) {
    const c = driver();
    sim.step(c);
    event = session.afterStep(c) ?? event;
    during?.(sim);
  }
  expect(sim.timer.laps).toBe(laps + 1);
  return event;
}

describe('time trial session', () => {
  it('records every lap, and makes the best valid lap the ghost', async () => {
    const sim = await createSim();
    const session = new TimeTrial(sim);
    // From the grid over the line (that starts lap 1) and round: the first valid lap is the best.
    expect(lapAt(session, sim, 14)).toBe('best');
    expect(session.ghost).not.toBeNull();
    const first = session.ghost!;
    expect(first.valid).toBe(true);
    expect(first.lapTime).toBeCloseTo(sim.timer.bestLap!, 6);
    expect(frameCount(first)).toBeGreaterThan(first.lapTime * 30 - 3);
    expect(duration(first)).toBeLessThanOrEqual(first.lapTime);
    expect(first.fingerprint).toBe(session.fingerprint);

    // A quicker lap is the new best...
    expect(lapAt(session, sim, 18)).toBe('best');
    expect(session.ghost!.lapTime).toBeLessThan(first.lapTime);
    const best = session.ghost!;
    // ...a slower one isn't...
    expect(lapAt(session, sim, 12)).toBe('lap');
    expect(session.ghost).toBe(best);
    expect(session.lastLap!.lapTime).toBeGreaterThan(best.lapTime);
    // ...and neither is a quicker one that broke the limits.
    expect(lapAt(session, sim, 22, (s) => s.timer.invalidate())).toBe('lap');
    expect(session.lastLap!.valid).toBe(false);
    expect(session.ghost).toBe(best);
  });

  it('restarts from the grid on an out lap, keeping the ghost', async () => {
    const sim = await createSim();
    const session = new TimeTrial(sim);
    lapAt(session, sim, 16);
    const ghost = session.ghost;
    for (let i = 0; i < 600; i++) {
      const c = followLine(sim, 16)();
      sim.step(c);
      session.afterStep(c);
    }
    expect(session.lapTime).not.toBeNull();
    session.restart();
    expect(session.lapTime).toBeNull();
    expect(sim.car.speed).toBe(0);
    expect(session.ghost).toBe(ghost);
    expect(sim.timer.bestLap).toBe(ghost!.lapTime);
  });

  it('takes a stored best only if it is for this layout, valid and quicker', async () => {
    const sim = await createSim();
    const session = new TimeTrial(sim);
    const profile = new Float32Array(sim.track.samples.length);
    const lap = { version: 1 as const, trackId: 'proving-ground', carName: 'Kestrel', fingerprint: session.fingerprint, lapTime: 80, valid: true, sectors: [25, 25, 30] as [number, number, number], frameDt: 1 / 30, frames: new Float32Array(48) };
    session.loadBest({ ...lap, fingerprint: 'another-layout' }, profile);
    expect(session.ghost).toBeNull();
    session.loadBest({ ...lap, valid: false }, profile);
    expect(session.ghost).toBeNull();
    session.loadBest(lap, profile);
    expect(session.ghost!.lapTime).toBe(80);
    expect(sim.timer.bestLap).toBe(80);
    session.loadBest({ ...lap, lapTime: 90 }, profile);
    expect(session.ghost!.lapTime).toBe(80);
  });
});
