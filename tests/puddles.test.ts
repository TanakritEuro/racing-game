import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { CIRCUITS, HARROWMERE, SALTMARSH } from '../src/track/circuits';
import { puddles, puddleSpan } from '../src/track/puddles';
import { buildTrack } from '../src/track/track';

describe('standing water', () => {
  for (const def of CIRCUITS) {
    it(`lies on the road, away from the start, the same every time: ${def.name}`, () => {
      const track = buildTrack(def);
      const { samples, length } = track;
      const n = samples.length;
      const clear = TUNING.weather.puddles.startClear;
      const found = puddles(track);
      expect(puddles(buildTrack(def))).toEqual(found);
      for (const p of found) {
        for (let i = p.first; i !== p.last; i = (i + 1) % n) {
          const s = samples[i];
          const [a, b] = puddleSpan(p, s);
          expect(a).toBeGreaterThanOrEqual(-s.halfWidth - 1e-9);
          expect(b).toBeLessThanOrEqual(s.halfWidth + 1e-9);
          expect(b - a).toBeGreaterThan(2);
          expect(Math.min(s.s, length - s.s)).toBeGreaterThan(clear - 20);
        }
      }
    });
  }

  it('gathers in a dip, at its lowest point', () => {
    const track = buildTrack(HARROWMERE);
    const n = track.samples.length;
    const y = (i: number) => track.samples[((i % n) + n) % n].y;
    // Harrowmere's dip ~2.4 km round: the deepest water is at the lowest road thereabouts.
    const dip = puddles(track).find((p) => Math.abs(track.samples[p.first].s - 2390) < 40)!;
    expect(dip).toBeDefined();
    const centre = (dip.first + Math.floor(((dip.last - dip.first + n) % n) / 2)) % n;
    for (let k = 1; k <= 25; k++) {
      expect(y(centre)).toBeLessThanOrEqual(y(centre - k) + 0.05);
      expect(y(centre)).toBeLessThanOrEqual(y(centre + k) + 0.05);
    }
  });

  it('lies on a long flat road too, a few spots apart', () => {
    const found = puddles(buildTrack(SALTMARSH));
    expect(found.length).toBeGreaterThanOrEqual(2);
  });
});
