import { describe, expect, it } from 'vitest';
import { barrierOffset, barriers, crossSection, road, strip } from '../src/track/geometry';
import { buildTrack } from '../src/track/track';
import { BANKED_SKIDPAD, HILL } from './tracks';

describe('track geometry', () => {
  const banked = buildTrack(BANKED_SKIDPAD);

  it('puts the road edges half the width either side, along the banked cross-section', () => {
    const r = road(banked);
    banked.samples.forEach((p, i) => {
      const outer = r.positions.subarray(i * 6, i * 6 + 3);
      const inner = r.positions.subarray(i * 6 + 3, i * 6 + 6);
      expect(Math.hypot(outer[0] - inner[0], outer[1] - inner[1], outer[2] - inner[2])).toBeCloseTo(2 * p.halfWidth, 3);
      // Banked 15° with the right edge up: the right (inner vertex) is higher than the left.
      expect(inner[1] - outer[1]).toBeCloseTo(2 * p.halfWidth * Math.sin((15 * Math.PI) / 180), 2);
      const left = crossSection(p, p.halfWidth);
      expect(outer[0]).toBeCloseTo(left.x, 3);
      expect(outer[1]).toBeCloseTo(left.y, 3);
    });
  });

  it('lifts a strip along the road surface normal and keeps it finite', () => {
    const hill = buildTrack(HILL);
    const lifted = strip(hill, -1, 1, 0.5);
    const flat = strip(hill, -1, 1, 0);
    for (let i = 0; i < hill.samples.length; i++) {
      const p = hill.samples[i];
      const d = [0, 1, 2].map((k) => lifted.positions[i * 6 + k] - flat.positions[i * 6 + k]);
      expect(d[0]).toBeCloseTo(0.5 * p.ux, 4);
      expect(d[1]).toBeCloseTo(0.5 * p.uy, 4);
      expect(d[2]).toBeCloseTo(0.5 * p.uz, 4);
    }
    expect(lifted.positions.every(Number.isFinite)).toBe(true);
  });

  it('stands the barriers at the edge of the run-off, at the road height there', () => {
    const hill = buildTrack(HILL);
    const segs = barriers(hill);
    expect(segs.length).toBeGreaterThan(100);
    for (const b of segs) {
      // Each segment's middle sits on one of the run-off's outer edges.
      let closest = Infinity;
      for (const p of hill.samples) {
        for (const [side, k] of [
          ['left', 1],
          ['right', -1],
        ] as const) {
          const e = crossSection(p, k * barrierOffset(p, side));
          closest = Math.min(closest, Math.hypot(e.x - b.centre.x, e.y - b.centre.y, e.z - b.centre.z));
        }
      }
      expect(closest).toBeLessThan(3.5);
      expect(Math.hypot(b.dir.x, b.dir.y, b.dir.z)).toBeCloseTo(1, 9);
    }
  });
});
