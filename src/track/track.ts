// A circuit is a closed centreline (control points through which a centripetal
// Catmull–Rom spline passes) with a road width, elevation and banking at each point. A rally
// stage is an open one (`closed: false`): the road runs from its first point to its last.
// This module is pure data and maths: physics (physics.ts) and rendering
// (render/trackView.ts) both build from the same samples.
//
// Each sample carries a cross-section frame: the tangent along the road (with its
// grade), "left" across the road (rolled by the banking) and "up" out of the road.
// Everything you drive on is a strip across that frame (track/geometry.ts).

import type { SceneryDef } from './scenery';
import type { PitLaneDef } from './pitLane';
import { TUNING } from '../config';
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
/** What the road itself is made of. */
export type RoadSurface = 'asphalt' | 'gravel';

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
  /** Control points in driving order. The loop closes back to the first, which is the start line (a stage: from the first, the start, to the last, the finish). */
  points: readonly ControlPoint[];
  /** False for a rally stage: an open road from start to finish. Default true (a circuit). */
  closed?: boolean;
  /** The road's surface (default asphalt), and stretches of the other one. */
  surface?: RoadSurface;
  surfaceSpans?: readonly { from: number; to: number; surface: RoadSurface }[];
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
  /** The pit lane beside the start straight. Default: none. */
  pitLane?: PitLaneDef;
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
  /** The road's surface here. */
  surface: RoadSurface;
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
  /** Centreline length (m): round the lap, or start to finish. */
  length: number;
  /** A circuit (the samples wrap round) or a stage (they run from the start, 0, to the finish, the last). */
  closed: boolean;
}

/** Sample index `i` on `track`: wrapped round a circuit, held at the ends of a stage. */
export function sampleIndex(track: Track, i: number): number {
  const n = track.samples.length;
  return track.closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
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

/** Build a track: sample the spline evenly by ground distance. Sample 0 is the start line. */
export function buildTrack(def: TrackDef): Track {
  const closed = def.closed !== false;
  const points = def.points.map((p) => ({ x: p.x, z: p.z, y: p.y ?? 0, bank: p.bank ?? 0, width: p.width ?? def.width }));
  // Dense sampling of the spline first, then resample at even spacing.
  const dense: SplinePoint[] = [];
  const n = points.length;
  const perSegment = 64;
  // A stage's ends: a phantom point beyond each, carrying on straight, so the road leaves the
  // start and reaches the finish heading the way its first and last stretches go.
  const beyond = (a: SplinePoint, b: SplinePoint): SplinePoint => ({ ...a, x: 2 * a.x - b.x, y: 2 * a.y - b.y, z: 2 * a.z - b.z });
  const point = (i: number) => (closed ? points[(i + n) % n] : i < 0 ? beyond(points[0], points[1]) : i >= n ? beyond(points[n - 1], points[n - 2]) : points[i]);
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    for (let k = 0; k < perSegment; k++) dense.push(splineAt(point(i - 1), point(i), point(i + 1), point(i + 2), k / perSegment));
  }
  dense.push(closed ? dense[0] : points[n - 1]);

  const cumulative = [0];
  for (let i = 1; i < dense.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z));
  }
  const length = cumulative[cumulative.length - 1];
  // A circuit's last sample is one spacing short of the start; a stage's is the finish.
  const count = Math.round(length / SPACING) + (closed ? 0 : 1);
  const along = (i: number) => (closed ? (i / count) * length : (i / (count - 1)) * length);

  const even: SplinePoint[] = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const s = along(i);
    while (j + 2 < cumulative.length && cumulative[j + 1] < s) j++;
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
    const a = closed ? even[(i - 1 + count) % count] : even[Math.max(0, i - 1)];
    const b = closed ? even[(i + 1) % count] : even[Math.min(count - 1, i + 1)];
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
      s: along(i),
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
      surface: roadSurface(def, along(i)),
      left: sideProfile(def, 'left', along(i), length),
      right: sideProfile(def, 'right', along(i), length),
    };
  });
  return { def, samples, length, closed };
}

/** The road's surface at distance `s`: the default, or a stretch of the other. */
function roadSurface(def: TrackDef, s: number): RoadSurface {
  for (const span of def.surfaceSpans ?? []) if (s >= span.from && s <= span.to) return span.surface;
  return def.surface ?? 'asphalt';
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
  // Room for the pit lane on its side, blending in and out around it.
  const pit = def.pitLane;
  if (pit && pit.side === side) {
    const P = TUNING.pits;
    const span: Span = { from: (length - pit.entry - P.blend + length) % length, to: (pit.exit + P.blend) % length, side };
    const d = insideSpan(span, s, length);
    if (d >= 0) runoff = Math.max(runoff, runoff + (P.inner + P.width + P.clearance - runoff) * Math.min(1, d / P.blend));
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
  else for (let k = -span; k <= span; k++) check(sampleIndex(track, hint + k));
  return best;
}

/** Signed distance (m) of (x, z) from the centreline at sample `i`: positive to the left. */
export function lateralOffset(track: Track, i: number, x: number, z: number): number {
  const p = track.samples[i];
  return (x - p.x) * p.nx + (z - p.z) * p.nz;
}

/**
 * A short fingerprint of a built track's layout: everything that decides where the road is.
 * Saved laps carry it, so a ghost recorded on an older layout isn't drawn off the road.
 */
export function trackFingerprint(track: Track): string {
  const { def } = track;
  // (A circuit's fingerprint is as it always was: the stage-only fields join it only when set.)
  const extra = def.closed === false || def.surface || def.surfaceSpans ? [def.closed ?? true, def.surface ?? 'asphalt', def.surfaceSpans ?? []] : [];
  const layout = JSON.stringify([def.points, def.width, def.runoff, def.kerbs ?? [], def.gravel ?? [], track.samples.length, ...extra]);
  // FNV-1a, 32 bits.
  let h = 0x811c9dc5;
  for (let i = 0; i < layout.length; i++) {
    h ^= layout.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${def.id}-${(h >>> 0).toString(16).padStart(8, '0')}-${Math.round(track.length)}`;
}
