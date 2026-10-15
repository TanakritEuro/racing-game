import { describe, expect, it } from 'vitest';
import { curvature } from '../src/track/corners';
import { barrierOffset } from '../src/track/geometry';
import { CIRCUITS } from '../src/track/circuits';
import { buildTrack } from '../src/track/track';

/** Each circuit's intended length (m). */
const LENGTHS: Record<string, [number, number]> = {
  harrowmere: [4300, 4900],
  saltmarsh: [2800, 3400],
  ridgeback: [3700, 4300],
  'proving-ground': [1300, 1500],
};

describe.each(CIRCUITS.map((def) => [def.name, def] as const))('%s', (_, def) => {
  const track = buildTrack(def);
  const { samples } = track;
  const n = samples.length;
  const spacing = track.length / n;

  it('has its intended length', () => {
    const [lo, hi] = LENGTHS[def.id];
    expect(track.length).toBeGreaterThan(lo);
    expect(track.length).toBeLessThan(hi);
  });

  it('has no corner tighter than 12 m, no grade over 12 %, no banking over 12°', () => {
    for (let i = 0; i < n; i++) {
      expect(Math.abs(curvature(track, i))).toBeLessThan(1 / 12);
      expect(Math.abs(samples[(i + 1) % n].y - samples[i].y) / spacing).toBeLessThan(0.12);
      expect(Math.abs(samples[i].bank)).toBeLessThan((12 * Math.PI) / 180);
    }
  });

  it('never lets one part of the track (with its run-off) touch another', () => {
    const reach = (i: number) => Math.max(barrierOffset(samples[i], 'left'), barrierOffset(samples[i], 'right'));
    for (let i = 0; i < n; i += 2) {
      for (let j = i + 2; j < n; j += 2) {
        if (Math.min(j - i, n - (j - i)) * spacing < 150) continue; // neighbours along the track
        const gap = Math.hypot(samples[i].x - samples[j].x, samples[i].z - samples[j].z);
        expect(gap).toBeGreaterThan(reach(i) + reach(j));
      }
    }
  });

  it('starts on a straight', () => {
    // Nothing tighter than a gentle 300 m bend within 150 m after the start line (the grid is behind it).
    for (let i = 0; i * spacing < 150; i++) expect(Math.abs(curvature(track, i))).toBeLessThan(1 / 300);
  });

  it('puts its kerbs and gravel on the track', () => {
    for (const span of [...(def.kerbs ?? []), ...(def.gravel ?? [])]) {
      expect(span.from).toBeGreaterThanOrEqual(0);
      expect(span.from).toBeLessThan(track.length);
      expect(span.to).toBeGreaterThanOrEqual(0);
      expect(span.to).toBeLessThan(track.length);
    }
    if (def.id !== 'proving-ground') expect((def.kerbs ?? []).length).toBeGreaterThan(8);
  });
});
