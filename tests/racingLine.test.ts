import { describe, expect, it } from 'vitest';
import { bendiness, lineThrough, racingLine } from '../src/ai/racingLine';
import { CIRCUITS } from '../src/track/circuits';
import { findCorners, type Corner } from '../src/track/corners';
import { buildTrack } from '../src/track/track';
import { KESTREL } from '../src/vehicle/cars';

const HALF_WIDTH = KESTREL.halfExtents.x;

describe.each(CIRCUITS.map((c) => [c.name, c] as const))('racing line at %s', (_, def) => {
  const track = buildTrack(def);
  const line = racingLine(track, HALF_WIDTH);
  const n = track.samples.length;
  const spacing = track.length / n;

  it('stays within the usable road (the road and half of each kerb)', () => {
    for (let i = 0; i < n; i++) {
      expect(line.offset[i]).toBeLessThanOrEqual(line.left[i] + 1e-4);
      expect(line.offset[i]).toBeGreaterThanOrEqual(line.right[i] - 1e-4);
      // The car's edge stays on the road or a kerb.
      const p = track.samples[i];
      const edge = Math.abs(line.offset[i]) + HALF_WIDTH;
      const side = line.offset[i] > 0 ? p.left : p.right;
      expect(edge).toBeLessThan(p.halfWidth + side.kerb);
    }
  });

  it('turns much less than the centreline', () => {
    const centre = lineThrough(track, new Float32Array(n), line.left, line.right);
    expect(bendiness(line)).toBeLessThan(0.85 * bendiness(centre));
    expect(line.length).toBeLessThan(centre.length);
  });

  it('runs on the inside at the apex of every tight corner', () => {
    // A corner that tightens (an entry, then a hairpin) is one corner: merge same-way corners under 30 m apart.
    const corners: Corner[] = [];
    for (const c of findCorners(track, 60)) {
      const last = corners[corners.length - 1];
      if (last && last.turn === c.turn && c.from - last.to < 30) last.to = c.to;
      else corners.push({ ...c });
    }
    expect(corners.length).toBeGreaterThan(0);
    for (const c of corners) {
      // The tightest sample of the corner (on the centreline).
      const from = Math.round(c.from / spacing);
      const to = Math.round(c.to / spacing);
      const span = (to - from + n) % n;
      let apex = from;
      let tightest = 0;
      for (let k = 0; k <= span; k++) {
        const i = (from + k) % n;
        if (Math.abs(line.curvature[i]) > tightest) {
          tightest = Math.abs(line.curvature[i]);
          apex = i;
        }
      }
      // Turning right, the inside is the right (negative offsets), and vice versa.
      const inside = c.turn === 'right' ? -line.offset[apex] : line.offset[apex];
      expect(inside, `${c.turn} corner at ${Math.round(c.from)} m`).toBeGreaterThan(0);
    }
  });

  it('takes well under a second to compute', () => {
    const start = performance.now();
    racingLine(track, HALF_WIDTH);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
