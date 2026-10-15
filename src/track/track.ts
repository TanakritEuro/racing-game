// A circuit is a closed centreline (control points through which a centripetal
// Catmull–Rom spline passes) plus a road width. This module is pure data and maths:
// physics (track/physics.ts) and rendering (render/trackMesh.ts) both build from it.
//
// The scaffold's track is flat (y = 0). Elevation and banking come in Milestone 3.

import type { Vec2 } from '../math';

export interface TrackDef {
  name: string;
  /** Control points on the ground (m), in driving order. The loop closes back to the first. */
  points: readonly Vec2[];
  /** Road width (m). */
  width: number;
  /** Grass run-off between the road edge and the barrier (m). */
  runoff: number;
}

/** One sample along the centreline. */
export interface TrackSample {
  x: number;
  z: number;
  /** Distance along the centreline from the start line (m). */
  s: number;
  /** Unit tangent (driving direction) on the ground. */
  tx: number;
  tz: number;
  /** Unit normal pointing to the driver's left. */
  nx: number;
  nz: number;
}

export interface Track {
  def: TrackDef;
  samples: TrackSample[];
  /** Centreline length (m). */
  length: number;
}

/** Sample spacing along the centreline (m). */
const SPACING = 2;

/** Build a track: sample the closed spline evenly by arc length. Sample 0 is the start line. */
export function buildTrack(def: TrackDef): Track {
  // Dense sampling of the spline first, then resample at even spacing.
  const dense: Vec2[] = [];
  const n = def.points.length;
  const perSegment = 64;
  for (let i = 0; i < n; i++) {
    const p0 = def.points[(i - 1 + n) % n];
    const p1 = def.points[i];
    const p2 = def.points[(i + 1) % n];
    const p3 = def.points[(i + 2) % n];
    for (let k = 0; k < perSegment; k++) dense.push(catmullRom(p0, p1, p2, p3, k / perSegment));
  }
  dense.push(dense[0]);

  const cumulative = [0];
  for (let i = 1; i < dense.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z));
  }
  const length = cumulative[cumulative.length - 1];
  const count = Math.round(length / SPACING);

  const points: Vec2[] = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const s = (i / count) * length;
    while (cumulative[j + 1] < s) j++;
    const f = (s - cumulative[j]) / (cumulative[j + 1] - cumulative[j]);
    points.push({ x: dense[j].x + (dense[j + 1].x - dense[j].x) * f, z: dense[j].z + (dense[j + 1].z - dense[j].z) * f });
  }

  const samples = points.map((p, i): TrackSample => {
    const a = points[(i - 1 + count) % count];
    const b = points[(i + 1) % count];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz);
    const tx = dx / l;
    const tz = dz / l;
    // Left of the driving direction, looking down from +Y with the tangent (tx, tz): (tz, -tx).
    return { x: p.x, z: p.z, s: (i / count) * length, tx, tz, nx: tz, nz: -tx };
  });
  return { def, samples, length };
}

/** Centripetal Catmull–Rom (alpha = 0.5): no cusps or loops between control points. */
function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, u: number): Vec2 {
  const knot = (a: Vec2, b: Vec2) => Math.sqrt(Math.hypot(b.x - a.x, b.z - a.z));
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const lerp = (a: Vec2, b: Vec2, ta: number, tb: number): Vec2 => {
    const w = (t - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * w, z: a.z + (b.z - a.z) * w };
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/**
 * Index of the sample nearest (x, z). With `hint` (the last known index) only a window
 * around it is searched, which is what per-step callers should use.
 */
export function nearestSample(track: Track, x: number, z: number, hint?: number, window = 40): number {
  const { samples } = track;
  const n = samples.length;
  let best = 0;
  let bestD = Infinity;
  const check = (i: number) => {
    const d = (samples[i].x - x) ** 2 + (samples[i].z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  };
  if (hint === undefined) for (let i = 0; i < n; i++) check(i);
  else for (let k = -window; k <= window; k++) check((((hint + k) % n) + n) % n);
  return best;
}

/** Signed distance (m) of (x, z) from the centreline at sample `i`: positive to the left. */
export function lateralOffset(track: Track, i: number, x: number, z: number): number {
  const p = track.samples[i];
  return (x - p.x) * p.nx + (z - p.z) * p.nz;
}
