import { describe, expect, it } from 'vitest';
import { barrierOffset } from '../src/track/geometry';
import { CIRCUITS } from '../src/track/circuits';
import { buildTrack, lateralOffset, nearestSample } from '../src/track/track';
import { validateTrack } from '../src/track/validate';
import { laneAlong, laneEdges, pitLane, pitWall } from '../src/track/pitLane';
import { TUNING } from '../src/config';
import { BARRIER_THICKNESS } from '../src/physics';

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

  it('has its intended length', () => {
    const [lo, hi] = LENGTHS[def.id];
    expect(track.length).toBeGreaterThan(lo);
    expect(track.length).toBeLessThan(hi);
  });

  it('keeps every circuit rule (no tight corners, steep grades or banking, overlaps; a straight start and grid; room for the pits)', () => {
    expect(validateTrack(track)).toEqual([]);
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

  it('has a pit lane joined to the track at both ends, inside its barrier, clear of kerbs', () => {
    const lane = pitLane(track)!;
    expect(lane).not.toBeNull();
    const P = TUNING.pits;
    const side = lane.def.side;
    expect(laneEdges(track, lane, lane.first)![1]).toBeLessThan(0.01);
    expect(laneEdges(track, lane, lane.last)![1]).toBeLessThan(0.01);
    let widest = 0;
    for (let i = lane.first; i !== lane.last; i = (i + 1) % n) {
      const p = samples[i];
      const [inner, outer] = laneEdges(track, lane, i)!;
      widest = Math.max(widest, outer - inner);
      // No kerb where cars cross onto the lane; the lane and its clearance inside the barrier.
      expect(p[side].kerb).toBe(0);
      expect(p.halfWidth + outer + P.clearance).toBeLessThanOrEqual(barrierOffset(p, side) + 1e-6);
    }
    expect(widest).toBeCloseTo(P.width, 6);
  });

  it('has its boxes on the lane’s full-width part, and its wall off the racing road', () => {
    const lane = pitLane(track)!;
    const P = TUNING.pits;
    for (const b of lane.boxes) {
      const u = laneAlong(track, lane, b);
      expect(u).toBeGreaterThanOrEqual(lane.taper);
      expect(u).toBeLessThanOrEqual(lane.length - lane.taper);
    }
    // Boxes in order along the lane, a car's length and more apart.
    for (let k = 1; k < lane.boxes.length; k++) {
      expect(laneAlong(track, lane, lane.boxes[k]) - laneAlong(track, lane, lane.boxes[k - 1])).toBeGreaterThan(P.boxSpacing - 3);
    }
    for (const w of pitWall(track, lane)) {
      // The wall's road-side face is beyond the road edge.
      const i = nearestSample(track, w.centre.x, w.centre.z);
      const off = Math.abs(lateralOffset(track, i, w.centre.x, w.centre.z));
      expect(off - BARRIER_THICKNESS / 2).toBeGreaterThan(samples[i].halfWidth + 0.5);
      expect(off + BARRIER_THICKNESS / 2).toBeLessThan(samples[i].halfWidth + P.inner);
    }
  });
});
