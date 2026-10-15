import { describe, expect, it } from 'vitest';
import { formatLapTime, LapTimer } from '../src/race/timing';
import { TEST_CIRCUIT } from '../src/track/circuits';
import { buildTrack } from '../src/track/track';

const track = buildTrack(TEST_CIRCUIT);
const n = track.samples.length;

/**
 * Move a timer along the centreline from sample `from` for `count` samples, one sample per
 * 0.1 s. `off(k)` says whether the car is off the track at step k.
 */
function drive(timer: LapTimer, from: number, count: number, t0: number, dir = 1, off: (k: number) => boolean = () => false, dt = 0.1): number {
  let t = t0;
  for (let k = 1; k <= count; k++) {
    const p = track.samples[(((from + dir * k) % n) + n) % n];
    t += dt;
    timer.update(p.x, p.z, t, off(k));
  }
  return t;
}

describe('lap timer', () => {
  it('starts on the first crossing and times full laps', () => {
    const start = track.samples[n - 5];
    const timer = new LapTimer(track, start.x, start.z);
    let t = drive(timer, n - 5, 10, 0); // cross the line: lap 1 starts
    expect(timer.current(t)).not.toBeNull();
    t = drive(timer, 5, n, t); // one full lap
    expect(timer.laps).toBe(1);
    expect(timer.lastLap).toBeCloseTo(n * 0.1, 5);
  });

  it('ignores rocking back and forth over the line', () => {
    const start = track.samples[n - 5];
    const timer = new LapTimer(track, start.x, start.z);
    let t = drive(timer, n - 5, 10, 0);
    t = drive(timer, 5, 10, t, -1);
    drive(timer, n - 5, 10, t);
    expect(timer.laps).toBe(0);
  });

  it('invalidates a lap that goes off the track, keeping it out of the best', () => {
    const start = track.samples[n - 5];
    const timer = new LapTimer(track, start.x, start.z);
    let t = drive(timer, n - 5, 10, 0);
    // A clean lap...
    t = drive(timer, 5, n, t);
    expect(timer.lastValid).toBe(true);
    const clean = timer.lastLap;
    expect(timer.bestLap).toBe(clean);
    // ...then a quicker one with a moment off the track: shown, but not the best.
    let off = 0;
    t = drive(timer, 5, n - 40, t, 1, (k) => k > 300 && k < 310 && ++off > 0);
    expect(timer.invalid).toBe(true);
    t = drive(timer, (5 + n - 40) % n, 40, t);
    expect(off).toBeGreaterThan(0);
    expect(timer.laps).toBe(2);
    expect(timer.lastValid).toBe(false);
    expect(timer.bestLap).toBe(clean);
    // The next lap starts clean.
    expect(timer.invalid).toBe(false);
    drive(timer, 5, 20, t);
    expect(timer.invalid).toBe(false);
  });

  it('ignores the track limits on the out lap, and voids a lap on request', () => {
    const start = track.samples[n - 5];
    const timer = new LapTimer(track, start.x, start.z);
    let t = drive(timer, n - 30, 20, 0, 1, () => true);
    expect(timer.invalid).toBe(false);
    timer.invalidate();
    expect(timer.invalid).toBe(false);
    t = drive(timer, n - 10, 20, t);
    timer.invalidate();
    expect(timer.invalid).toBe(true);
  });

  it('splits laps into sectors that add up, keeping the best of each', () => {
    const start = track.samples[n - 5];
    const timer = new LapTimer(track, start.x, start.z);
    let t = drive(timer, n - 5, 10, 0);
    expect(timer.sector).toBe(0);
    // A lap at 0.1 s per sample, then one slower in its first half and faster in its second.
    t = drive(timer, 5, n, t);
    const first = timer.lastSectors!;
    expect(first[0] + first[1] + first[2]).toBeCloseTo(timer.lastLap!, 6);
    const [e1, e2] = timer.sectorEnds;
    expect(first[0]).toBeCloseTo(e1 * 0.1, 1);
    expect(first[1]).toBeCloseTo((e2 - e1) * 0.1, 1);
    t = drive(timer, 5, n / 2 - 5, t, 1, () => false, 0.12);
    expect(timer.sector).toBe(1);
    t = drive(timer, n / 2, n / 2 + 5, t, 1, () => false, 0.08);
    const second = timer.lastSectors!;
    expect(second[0]).toBeGreaterThan(first[0]);
    expect(second[2]).toBeLessThan(first[2]);
    // The best of each sector, from different laps.
    expect(timer.bestSectors[0]).toBeCloseTo(first[0], 6);
    expect(timer.bestSectors[2]).toBeCloseTo(second[2], 6);
  });

  it('records the time at each sample and measures the live delta against the best lap', () => {
    const start = track.samples[n - 5];
    const timer = new LapTimer(track, start.x, start.z);
    let t = drive(timer, n - 5, 10, 0);
    t = drive(timer, 5, n, t);
    const profile = timer.lastProfile!;
    for (let i = 1; i < n; i++) expect(profile[i]).toBeGreaterThanOrEqual(profile[i - 1]);
    expect(profile[n - 1]).toBeLessThanOrEqual(timer.lastLap!);
    expect(timer.best!.time).toBe(timer.lastLap);
    // Matching the best lap: no delta. Slower by 0.02 s a sample: +0.02 per sample covered.
    t = drive(timer, 5, 100, t);
    expect(timer.delta(t)).toBeCloseTo(0, 1);
    t = drive(timer, 105, 100, t, 1, () => false, 0.12);
    expect(timer.delta(t)).toBeCloseTo(100 * 0.02, 1);
  });

  it('takes a stored best to measure against, unless it has a better one', () => {
    const start = track.samples[n - 5];
    const timer = new LapTimer(track, start.x, start.z);
    const profile = new Float32Array(n).map((_, i) => i * 0.09);
    timer.setBest({ time: n * 0.09, sectors: [30, 30, n * 0.09 - 60], profile });
    expect(timer.bestLap).toBeCloseTo(n * 0.09, 6);
    let t = drive(timer, n - 5, 10, 0);
    t = drive(timer, 5, 100, t);
    expect(timer.delta(t)).toBeGreaterThan(0.5);
    timer.setBest({ time: 999, sectors: [333, 333, 333], profile });
    expect(timer.bestLap).toBeCloseTo(n * 0.09, 6);
  });

  it('formats times', () => {
    expect(formatLapTime(83.4567)).toBe('1:23.457');
    expect(formatLapTime(null)).toBe('–:––.–––');
  });
});
