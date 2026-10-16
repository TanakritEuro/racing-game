import { describe, expect, it } from 'vitest';
import { curvature } from '../src/track/corners';
import { barrierOffset } from '../src/track/geometry';
import { CIRCUITS } from '../src/track/circuits';
import { buildTrack, lateralOffset, nearestSample } from '../src/track/track';
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

  it('has its grid on a straight', () => {
    // Eight cars two by two reach ~40 m behind the line: nothing tighter than a 200 m bend there.
    for (let i = 1; i * spacing < 50; i++) expect(Math.abs(curvature(track, n - i))).toBeLessThan(1 / 200);
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
