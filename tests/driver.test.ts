import { describe, expect, it } from 'vitest';
import { lateralOffset, nearestSample } from '../src/track/track';
import { createSim, followLine } from './helpers';
import { LONG_OVAL, SKIDPAD } from './tracks';

describe('test tracks and the line-following test driver', () => {
  it('holds the skidpad line at a steady speed', async () => {
    const sim = await createSim(SKIDPAD);
    // Part throttle: a full-throttle launch into a constant turn spins this car round.
    const driver = followLine(sim, 12, { maxThrottle: 0.6 });
    let index: number | undefined;
    let worst = 0;
    for (let t = 0; t < 20; t += 1 / 120) {
      sim.step(driver());
      const p = sim.car.position;
      index = nearestSample(sim.track, p.x, p.z, index);
      if (t > 4) worst = Math.max(worst, Math.abs(lateralOffset(sim.track, index, p.x, p.z)));
    }
    expect(worst).toBeLessThan(1.5);
    expect(sim.car.speed).toBeGreaterThan(11);
    expect(sim.car.speed).toBeLessThan(13);
    // 40 m radius: one lap is ~251 m.
    expect(sim.track.length).toBeGreaterThan(245);
    expect(sim.track.length).toBeLessThan(255);
  });

  it('laps the test circuit, hairpin included, at 12 m/s', async () => {
    const sim = await createSim();
    // The tightest corner is a ~12 m radius: ~10 m/s at the car's grip, so 12 m/s runs a little wide there.
    const driver = followLine(sim, 12, { maxThrottle: 0.7 });
    let index: number | undefined;
    let worst = 0;
    while (sim.timer.laps < 1 && sim.time < 200) {
      sim.step(driver());
      const p = sim.car.position;
      index = nearestSample(sim.track, p.x, p.z, index);
      worst = Math.max(worst, Math.abs(lateralOffset(sim.track, index, p.x, p.z)));
    }
    expect(sim.timer.laps).toBe(1);
    expect(worst).toBeLessThan(2);
  });

  it('keeps the car on the long oval straight at full speed', async () => {
    const sim = await createSim(LONG_OVAL);
    const driver = followLine(sim, 100);
    let index: number | undefined;
    let worst = 0;
    for (let t = 0; t < 40; t += 1 / 120) {
      sim.step(driver());
      const p = sim.car.position;
      index = nearestSample(sim.track, p.x, p.z, index);
      worst = Math.max(worst, Math.abs(lateralOffset(sim.track, index, p.x, p.z)));
    }
    expect(worst).toBeLessThan(1);
    expect(sim.car.speed).toBeGreaterThan(50);
    // Still on the first straight.
    expect(sim.car.position.x).toBeLessThan(5000);
    expect(Math.abs(sim.car.position.z)).toBeLessThan(1);
  });
});
