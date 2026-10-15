import { describe, expect, it } from 'vitest';
import { TEST_CIRCUIT } from '../src/track/circuits';
import { buildTrack, lateralOffset, nearestSample } from '../src/track/track';

const track = buildTrack(TEST_CIRCUIT);

describe('track', () => {
  it('is a closed loop of evenly spaced samples', () => {
    const { samples } = track;
    expect(track.length).toBeGreaterThan(1300);
    for (let i = 0; i < samples.length; i++) {
      const a = samples[i];
      const b = samples[(i + 1) % samples.length];
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(2, 0);
    }
  });

  it('never comes near itself (road plus run-off on both sides)', () => {
    const { samples } = track;
    const n = samples.length;
    const clearance = TEST_CIRCUIT.width + 2 * TEST_CIRCUIT.runoff;
    let closest = Infinity;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const along = Math.min(j - i, n - (j - i)) * 2;
        if (along < clearance * 2) continue; // neighbours along the track
        closest = Math.min(closest, Math.hypot(samples[i].x - samples[j].x, samples[i].z - samples[j].z));
      }
    }
    expect(closest).toBeGreaterThan(clearance);
  });

  it('finds the nearest sample and the side of the road', () => {
    const p = track.samples[100];
    expect(nearestSample(track, p.x + p.nx * 3, p.z + p.nz * 3)).toBe(100);
    expect(lateralOffset(track, 100, p.x + p.nx * 3, p.z + p.nz * 3)).toBeCloseTo(3);
  });
});
