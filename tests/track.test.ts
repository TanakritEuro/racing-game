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
    const clearance = TEST_CIRCUIT.width + 2 * TEST_CIRCUIT.runoff.width;
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

describe('3D track', () => {
  /** A rounded loop that climbs, banks and narrows. */
  const loop = buildTrack({
    id: 'loop',
    name: 'Loop',
    width: 12,
    runoff: { width: 6, surface: 'grass' },
    points: [
      { x: 0, z: 0, y: 0 },
      { x: 200, z: 0, y: 8, width: 10 },
      { x: 300, z: -100, y: 12, bank: 0.15 },
      { x: 200, z: -200, y: 6 },
      { x: 0, z: -200, y: 2, bank: -0.1, width: 14 },
      { x: -100, z: -100, y: 0 },
    ],
  });
  const near = (x: number, z: number) => loop.samples[nearestSample(loop, x, z)];

  it('passes through the control points with their height, bank and width', () => {
    expect(near(200, 0).y).toBeCloseTo(8, 1);
    expect(near(200, 0).halfWidth).toBeCloseTo(5, 1);
    expect(near(300, -100).y).toBeCloseTo(12, 1);
    expect(near(300, -100).bank).toBeCloseTo(0.15, 2);
    expect(near(0, -200).bank).toBeCloseTo(-0.1, 2);
    expect(near(0, -200).halfWidth).toBeCloseTo(7, 1);
  });

  it('has an orthonormal cross-section frame at every sample', () => {
    for (const p of loop.samples) {
      const t = [p.tx, p.ty, p.tz];
      const l = [p.lx, p.ly, p.lz];
      const u = [p.ux, p.uy, p.uz];
      const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      for (const v of [t, l, u]) expect(dot(v, v)).toBeCloseTo(1, 9);
      expect(dot(t, l)).toBeCloseTo(0, 9);
      expect(dot(t, u)).toBeCloseTo(0, 9);
      expect(dot(l, u)).toBeCloseTo(0, 9);
      // Up is up, and the bank tilts left: its height is the sine of the bank.
      expect(p.uy).toBeGreaterThan(0.9);
      expect(p.ly).toBeCloseTo(Math.sin(p.bank), 2);
    }
  });

  it('climbs along its tangent and closes without a step at the start line', () => {
    const { samples } = loop;
    for (let i = 0; i < samples.length; i++) {
      const a = samples[i];
      const b = samples[(i + 1) % samples.length];
      const run = Math.hypot(b.x - a.x, b.z - a.z);
      // The step in height matches the tangent's grade.
      expect(b.y - a.y).toBeCloseTo((run * a.ty) / Math.hypot(a.tx, a.tz), 1);
    }
  });

  it('leaves the flat Proving Ground flat', () => {
    for (const p of track.samples) {
      expect(p.y).toBe(0);
      expect(p.uy).toBeCloseTo(1, 12);
      expect(p.halfWidth).toBe(6);
    }
  });
});
