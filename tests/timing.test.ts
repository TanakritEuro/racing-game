import { describe, expect, it } from 'vitest';
import { formatLapTime, LapTimer } from '../src/race/timing';
import { TEST_CIRCUIT } from '../src/track/circuits';
import { buildTrack } from '../src/track/track';

const track = buildTrack(TEST_CIRCUIT);
const n = track.samples.length;

/** Move a timer along the centreline from sample `from` for `count` samples, one sample per 0.1 s. */
function drive(timer: LapTimer, from: number, count: number, t0: number, dir = 1): number {
  let t = t0;
  for (let k = 1; k <= count; k++) {
    const p = track.samples[(((from + dir * k) % n) + n) % n];
    t += 0.1;
    timer.update(p.x, p.z, t);
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

  it('formats times', () => {
    expect(formatLapTime(83.4567)).toBe('1:23.457');
    expect(formatLapTime(null)).toBe('–:––.–––');
  });
});
