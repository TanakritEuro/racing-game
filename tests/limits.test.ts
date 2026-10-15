import { describe, expect, it } from 'vitest';
import { crossSection } from '../src/track/geometry';
import { KERB_WIDTH } from '../src/track/track';
import { NO_CONTROLS, poseOnTrack } from '../src/vehicle/car';
import { KESTREL } from '../src/vehicle/cars';
import { createSim, run } from './helpers';
import { KERBED_OVAL } from './tracks';

describe('track limits', () => {
  /** Park the car on the kerbed straight, `offset` metres left of the centreline, and let it settle. */
  async function parkedAt(offset: number) {
    const s = await createSim(KERBED_OVAL);
    const p = s.track.samples[300]; // 600 m in: on the kerb's span
    s.car.reset({ ...poseOnTrack(p), position: crossSection(p, offset) });
    run(s, NO_CONTROLS, 1);
    return s;
  }

  it('counts two wheels on the kerb as on the track', async () => {
    const s = await parkedAt(-(7.5 + KERB_WIDTH / 2 - KESTREL.trackHalf));
    expect(s.car.wheels.map((w) => w.surface)).toEqual(['asphalt', 'kerb', 'asphalt', 'kerb']);
    expect(s.offTrack).toBe(false);
  });

  it('counts two wheels on the grass as on the track', async () => {
    const s = await parkedAt(-(8.5 + 0.2));
    expect(s.car.wheels.filter((w) => w.surface === 'grass').length).toBe(2);
    expect(s.offTrack).toBe(false);
  });

  it('counts all four wheels on the grass as off', async () => {
    const s = await parkedAt(-12);
    expect(s.car.wheels.every((w) => w.surface === 'grass')).toBe(true);
    expect(s.offTrack).toBe(true);
  });

  it('voids the lap in progress when the car is put back on the track', async () => {
    const s = await parkedAt(0);
    // Start a timed lap by crossing the line from the grid.
    const grid = await createSim(KERBED_OVAL);
    run(grid, { ...NO_CONTROLS, throttle: 1 }, 6);
    expect(grid.timer.current(grid.time)).not.toBeNull();
    expect(grid.timer.invalid).toBe(false);
    grid.recover();
    expect(grid.timer.invalid).toBe(true);
    expect(s.timer.invalid).toBe(false);
  });
});
