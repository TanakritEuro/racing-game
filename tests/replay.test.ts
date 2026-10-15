import { describe, expect, it } from 'vitest';
import { FRAME_DT, FRAME_SIZE, type LapRecording } from '../src/race/recording';
import { Replay } from '../src/replay/replay';

/** A 10 s recording (301 frames). */
const rec: LapRecording = { version: 1, trackId: 't', carName: 'c', fingerprint: 'f', lapTime: 10, valid: true, sectors: [3, 3, 4], frameDt: FRAME_DT, frames: new Float32Array(301 * FRAME_SIZE) };

describe('replay player', () => {
  it('plays at its speed, pauses, skips within the lap', () => {
    const r = new Replay();
    expect(r.update(1)).toBeNull();
    r.play(rec, 'LAST LAP');
    expect(r.jumped).toBe(true);
    expect(r.update(1)).toBeCloseTo(1, 9);
    r.speed = 0.25;
    expect(r.update(2)).toBeCloseTo(1.5, 9);
    r.togglePause();
    expect(r.update(5)).toBeCloseTo(1.5, 9);
    r.togglePause();
    r.scrub(-4);
    expect(r.time).toBe(0);
    r.scrub(99);
    expect(r.time).toBeCloseTo(10, 6);
  });

  it('holds the last frame a moment, then hands back', () => {
    const r = new Replay();
    r.play(rec, 'BEST LAP');
    r.speed = 2;
    expect(r.update(5)).toBeCloseTo(10, 6);
    expect(r.update(1)).toBeCloseTo(10, 6);
    expect(r.active).toBe(true);
    expect(r.update(1)).toBeNull();
    expect(r.active).toBe(false);
  });
});
