// A circuit is a closed centreline (control points through which a centripetal
// Catmull–Rom spline passes) with a road width, elevation and banking at each point.
// This module is pure data and maths: physics (physics.ts) and rendering
// (render/trackView.ts) both build from the same samples.
//
// Each sample carries a cross-section frame: the tangent along the road (with its
// grade), "left" across the road (rolled by the banking) and "up" out of the road.
// Everything you drive on is a strip across that frame (track/geometry.ts).

import type { SceneryDef } from './scenery';
import type { TerrainDef } from './terrain';

export interface ControlPoint {
  x: number;
  z: number;
  /** Elevation of the road's centreline (m). Default 0. */
  y?: number;
  /** Road roll (rad): positive raises the left edge, for a right-hander. Default 0. */
  bank?: number;
  /** Road width here (m). Default `TrackDef.width`. */
  width?: number;
}

export type Side = 'left' | 'right';
export type RunoffSurface = 'grass' | 'gravel';

/** A stretch of the track by distance from the start line (m), on one side. */
export interface Span {
  from: number;
  to: number;
  side: Side;
}

export interface TrackDef {
  /** Short id, used in URLs (`?track=`). */
  id: string;
  name: string;
  /** Control points in driving order. The loop closes back to the first, which is the start line. */
  points: readonly ControlPoint[];
  /** Default road width (m). */
  width: number;
  /** Run-off between the road edge (or kerb) and the barrier. */
  runoff: { width: number; surface: RunoffSurface };
  /** Raised kerbs along the road edge. */
  kerbs?: readonly Span[];
  /** Gravel traps in place of the grass run-off. */
  gravel?: readonly (Span & { width?: number })[];
  /** The landscape around the circuit. Default: flat. */
  terrain?: TerrainDef;
  /** Where sectors 1 and 2 end (m from the start line). Default: a third and two thirds of the lap. */
  sectors?: readonly [number, number];
  /** Trees, grandstands and pits. Default: none. */
  scenery?: SceneryDef;
}

/** One sample along the centreline. */
export interface TrackSample {
  x: number;
  y: number;
  z: number;
  /** Distance along the centreline (on the ground) from the start line (m). */
  s: number;
  /** Unit tangent: the driving direction, with the road's grade. */
  tx: number;
  ty: number;
  tz: number;
  /** Unit normal on the ground pointing to the driver's left (for lateral offsets). */
  nx: number;
  nz: number;
  /** The cross-section frame: banked left across the road, and up out of it. */
  lx: number;
  ly: number;
  lz: number;
  ux: number;
  uy: number;
  uz: number;
  bank: number;
  halfWidth: number;
  /** What lies beyond each road edge here. */
  left: SideProfile;
  right: SideProfile;
}

/** One side of the track beyond the road edge, at a sample. */
export interface SideProfile {
  /** Kerb width (m): 0 with no kerb, tapering in and out at a kerb's ends. */
  kerb: number;
  /** Run-off width from the kerb (or road edge) to the barrier (m). */
  runoff: number;
  runoffSurface: RunoffSurface;
}

/** Full kerb width (m), and the distance over which a kerb tapers in at each end. */
export const KERB_WIDTH = 1;
const KERB_TAPER = 3;
/** Distance over which a gravel trap's width blends in from the grass run-off's (m). */
const GRAVEL_TAPER = 15;

export interface Track {
  def: TrackDef;
  samples: TrackSample[];
  /** Centreline length (m). */
  length: number;
}

/** Sample spacing along the centreline (m). */
const SPACING = 2;

/** A point on the dense spline. */
interface SplinePoint {
  x: number;
  y: number;
  z: number;
  bank: number;
  width: number;
}

/** Build a track: sample the closed spline evenly by ground distance. Sample 0 is the start line. */
export function buildTrack(def: TrackDef): Track {
  const points = def.points.map((p) => ({ x: p.x, z: p.z, y: p.y ?? 0, bank: p.bank ?? 0, width: p.width ?? def.width }));
  // Dense sampling of the spline first, then resample at even spacing.
  const dense: SplinePoint[] = [];
  const n = points.length;
  const perSegment = 64;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    for (let k = 0; k < perSegment; k++) dense.push(splineAt(p0, p1, p2, p3, k / perSegment));
  }
  dense.push(dense[0]);

  const cumulative = [0];
  for (let i = 1; i < dense.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z));
  }
  const length = cumulative[cumulative.length - 1];
  const count = Math.round(length / SPACING);

  const even: SplinePoint[] = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const s = (i / count) * length;
    while (cumulative[j + 1] < s) j++;
    const f = (s - cumulative[j]) / (cumulative[j + 1] - cumulative[j]);
    const a = dense[j];
    const b = dense[j + 1];
    even.push({
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      z: a.z + (b.z - a.z) * f,
      bank: a.bank + (b.bank - a.bank) * f,
      width: a.width + (b.width - a.width) * f,
    });
  }

  const samples = even.map((p, i): TrackSample => {
    const a = even[(i - 1 + count) % count];
    const b = even[(i + 1) % count];
    // Ground-plane tangent and left normal, as before.
    const gx = b.x - a.x;
    const gz = b.z - a.z;
    const gl = Math.hypot(gx, gz);
    const nx = gz / gl;
    const nz = -gx / gl;
    // 3D tangent with the grade.
    const gy = b.y - a.y;
    const tl = Math.hypot(gx, gy, gz);
    const tx = gx / tl;
    const ty = gy / tl;
    const tz = gz / tl;
    // Unbanked frame: left level across the road, up = tangent × left. Then roll by the bank.
    const ux0 = ty * nz;
    const uy0 = tz * nx - tx * nz;
    const uz0 = -ty * nx;
    const c = Math.cos(p.bank);
    const sn = Math.sin(p.bank);
    return {
      x: p.x,
      y: p.y,
      z: p.z,
      s: (i / count) * length,
      tx,
      ty,
      tz,
      nx,
      nz,
      lx: nx * c + ux0 * sn,
      ly: uy0 * sn,
      lz: nz * c + uz0 * sn,
      ux: ux0 * c - nx * sn,
      uy: uy0 * c,
      uz: uz0 * c - nz * sn,
      bank: p.bank,
      halfWidth: p.width / 2,
      left: sideProfile(def, 'left', (i / count) * length, length),
      right: sideProfile(def, 'right', (i / count) * length, length),
    };
  });
  return { def, samples, length };
}

/** How far into span `span` distance `s` is from its nearer end (m), or −1 outside it. Spans may wrap past the start line. */
function insideSpan(span: Span, s: number, length: number): number {
  const fromStart = (s - span.from + length) % length;
  const toEnd = (span.to - s + length) % length;
  const spanLength = (span.to - span.from + length) % length;
  return fromStart <= spanLength && toEnd <= spanLength ? Math.min(fromStart, toEnd) : -1;
}

function sideProfile(def: TrackDef, side: Side, s: number, length: number): SideProfile {
  let kerb = 0;
  for (const span of def.kerbs ?? []) {
    if (span.side !== side) continue;
    const d = insideSpan(span, s, length);
    if (d >= 0) kerb = Math.max(kerb, KERB_WIDTH * Math.min(1, d / KERB_TAPER));
  }
  let runoff = def.runoff.width;
  let runoffSurface = def.runoff.surface;
  for (const span of def.gravel ?? []) {
    if (span.side !== side) continue;
    const d = insideSpan(span, s, length);
    if (d < 0) continue;
    runoffSurface = 'gravel';
    const width = span.width ?? def.runoff.width;
    runoff = def.runoff.width + (width - def.runoff.width) * Math.min(1, d / GRAVEL_TAPER);
  }
  return { kerb, runoff, runoffSurface };
}

/**
 * The spline between control points `p1` and `p2` at `u` (0–1). The centreline (x, y, z)
 * is a centripetal Catmull–Rom curve, knotted by ground distance; width and bank ease
 * between the two points.
 */
function splineAt(p0: SplinePoint, p1: SplinePoint, p2: SplinePoint, p3: SplinePoint, u: number): SplinePoint {
  const knot = (a: SplinePoint, b: SplinePoint) => Math.sqrt(Math.hypot(b.x - a.x, b.z - a.z));
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;
  // Barry–Goldman pyramid, on each coordinate.
  const coord = (k: 'x' | 'y' | 'z') => {
    const lerp = (a: number, b: number, ta: number, tb: number) => a + ((b - a) * (t - ta)) / (tb - ta);
    const a1 = lerp(p0[k], p1[k], t0, t1);
    const a2 = lerp(p1[k], p2[k], t1, t2);
    const a3 = lerp(p2[k], p3[k], t2, t3);
    const b1 = lerp(a1, a2, t0, t2);
    const b2 = lerp(a2, a3, t1, t3);
    return lerp(b1, b2, t1, t2);
  };
  const ease = u * u * (3 - 2 * u);
  return {
    x: coord('x'),
    y: coord('y'),
    z: coord('z'),
    bank: p1.bank + (p2.bank - p1.bank) * ease,
    width: p1.width + (p2.width - p1.width) * ease,
  };
}

/**
 * Index of the sample nearest (x, z). With `hint` (the last known index) only a window
 * around it is searched, which is what per-step callers should use.
 */
export function nearestSample(track: Track, x: number, z: number, hint?: number, span = 40): number {
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
  else for (let k = -span; k <= span; k++) check((((hint + k) % n) + n) % n);
  return best;
}

/** Signed distance (m) of (x, z) from the centreline at sample `i`: positive to the left. */
export function lateralOffset(track: Track, i: number, x: number, z: number): number {
  const p = track.samples[i];
  return (x - p.x) * p.nx + (z - p.z) * p.nz;
}
