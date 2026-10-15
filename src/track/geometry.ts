// Plain-array geometry built from a Track, shared by the physics colliders and the meshes,
// so what you see is exactly what the tyres drive on.
//
// Everything is a strip across each sample's cross-section frame: an offset along the
// banked "left" and a lift along the banked "up".

import { normalize, type Vec3 } from '../math';
import { KERB_WIDTH, type RunoffSurface, type Side, type SideProfile, type Track, type TrackSample } from './track';

/** Kerb height (m) and the extra height of the ridges under its red stripes (m). */
export const KERB_HEIGHT = 0.04;
export const KERB_RIDGE = 0.012;
/** Length of one paint stripe (m): red (ridged) and white alternate. */
export const KERB_STRIPE = 0.5;
/** Kerbs are swept in steps this many times finer than the 2 m samples, for the ridges. */
const KERB_STEPS = 16;

export interface Ribbon {
  /** x, y, z per vertex: two vertices (outer, inner) per sample, looping. */
  positions: Float32Array;
  /** Triangle indices. */
  indices: Uint32Array;
  /** Distance along the track per vertex (m), for texturing. */
  distance: Float32Array;
}

/** A distance across the road (m, positive = left), fixed or varying along the track. */
export type Offset = number | ((p: TrackSample) => number);

const at = (offset: Offset, p: TrackSample) => (typeof offset === 'number' ? offset : offset(p));

/** The point `offset` across and `lift` up from sample `p`'s centreline, in its cross-section frame. */
export function crossSection(p: TrackSample, offset: number, lift = 0): Vec3 {
  return {
    x: p.x + p.lx * offset + p.ux * lift,
    y: p.y + p.ly * offset + p.uy * lift,
    z: p.z + p.lz * offset + p.uz * lift,
  };
}

/**
 * A strip following the centreline between two offsets across the road (inner < outer,
 * or the faces point down), raised `lift` along the road's up. The road is
 * strip(−halfWidth, +halfWidth); kerbs, lines and run-off are strips beside it.
 */
export function strip(track: Track, inner: Offset, outer: Offset, lift: Offset = 0): Ribbon {
  const n = track.samples.length;
  const positions = new Float32Array(n * 2 * 3);
  const distance = new Float32Array(n * 2);
  track.samples.forEach((p, i) => {
    const h = at(lift, p);
    const o = crossSection(p, at(outer, p), h);
    const c = crossSection(p, at(inner, p), h);
    positions.set([o.x, o.y, o.z, c.x, c.y, c.z], i * 6);
    distance[i * 2] = distance[i * 2 + 1] = p.s;
  });
  const indices = new Uint32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    // Counter-clockwise seen from above the road, so the faces point up.
    indices.set([a, a + 1, b, b, a + 1, b + 1], i * 6);
  }
  return { positions, indices, distance };
}

/** The road surface. */
export function road(track: Track): Ribbon {
  return strip(
    track,
    (p) => -p.halfWidth,
    (p) => p.halfWidth,
  );
}

const profile = (p: TrackSample, side: Side): SideProfile => (side === 'left' ? p.left : p.right);
const sign = (side: Side) => (side === 'left' ? 1 : -1);

/** Where the run-off starts on `side`: beyond the kerb, or at the road edge (m from the centreline). */
export function runoffInner(p: TrackSample, side: Side): number {
  return p.halfWidth + profile(p, side).kerb;
}

/** How far from the centreline the barrier stands on `side` at sample `p` (m). */
export function barrierOffset(p: TrackSample, side: Side): number {
  const q = profile(p, side);
  return p.halfWidth + q.kerb + q.runoff;
}

/** A mesh swept along part of the track: positions, triangle indices, and u (across) / v (metres along) per vertex. */
export interface Sweep {
  positions: Float32Array;
  indices: Uint32Array;
  uv: Float32Array;
}

/** A sample part-way (`f`) from `a` to `b`: positions, frames and widths blended (good enough over 2 m). */
function blend(a: TrackSample, b: TrackSample, f: number, s: number): TrackSample {
  const l = (x: number, y: number) => x + (y - x) * f;
  const side = (x: SideProfile, y: SideProfile): SideProfile => ({ kerb: l(x.kerb, y.kerb), runoff: l(x.runoff, y.runoff), runoffSurface: x.runoffSurface });
  return {
    x: l(a.x, b.x),
    y: l(a.y, b.y),
    z: l(a.z, b.z),
    s,
    tx: l(a.tx, b.tx),
    ty: l(a.ty, b.ty),
    tz: l(a.tz, b.tz),
    nx: l(a.nx, b.nx),
    nz: l(a.nz, b.nz),
    lx: l(a.lx, b.lx),
    ly: l(a.ly, b.ly),
    lz: l(a.lz, b.lz),
    ux: l(a.ux, b.ux),
    uy: l(a.uy, b.uy),
    uz: l(a.uz, b.uz),
    bank: l(a.bank, b.bank),
    halfWidth: l(a.halfWidth, b.halfWidth),
    left: side(a.left, b.left),
    right: side(a.right, b.right),
  };
}

/**
 * Sweep a cross-section along samples `first`…`last` (wrapping past the start line),
 * `steps` stations per sample interval. `columns` gives the cross-section at a station as
 * [offset, lift] pairs, ordered from right to left (increasing offset), so faces point up.
 */
export function sweep(
  track: Track,
  first: number,
  last: number,
  steps: number,
  columns: (p: TrackSample) => [offset: number, lift: number][],
): Sweep {
  const { samples, length } = track;
  const n = samples.length;
  const intervals = (last - first + n) % n || n;
  const stations: TrackSample[] = [];
  for (let k = 0; k < intervals; k++) {
    const a = samples[(first + k) % n];
    const b = samples[(first + k + 1) % n];
    const sb = (first + k + 1) % n === 0 ? length : b.s;
    for (let j = 0; j < steps; j++) stations.push(blend(a, b, j / steps, a.s + ((sb - a.s) * j) / steps));
  }
  const end = samples[(first + intervals) % n];
  stations.push({ ...end, s: (first + intervals) % n === 0 && intervals > 0 ? length : end.s });

  const cols = columns(stations[0]).length;
  const positions = new Float32Array(stations.length * cols * 3);
  const uv = new Float32Array(stations.length * cols * 2);
  stations.forEach((p, k) => {
    columns(p).forEach(([offset, lift], c) => {
      const v = crossSection(p, offset, lift);
      positions.set([v.x, v.y, v.z], (k * cols + c) * 3);
      uv.set([c / (cols - 1), p.s], (k * cols + c) * 2);
    });
  });
  const indices = new Uint32Array((stations.length - 1) * (cols - 1) * 6);
  let o = 0;
  for (let k = 0; k < stations.length - 1; k++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = k * cols + c; // this station, right column
      const b = (k + 1) * cols + c; // next station
      // Like strip(): (outer, inner, next outer), (next outer, inner, next inner), outer = c + 1.
      indices.set([a + 1, a, b + 1, b + 1, a, b], o);
      o += 6;
    }
  }
  return { positions, indices, uv };
}

/** Runs of consecutive samples where `test` holds, as [first, last] with last one past the run (so neighbouring runs meet). */
export function runs(track: Track, test: (p: TrackSample) => boolean): [number, number][] {
  const { samples } = track;
  const n = samples.length;
  if (samples.every(test)) return [[0, 0]];
  // Start scanning just after a sample that fails, so no run is split at the start line.
  const start = samples.findIndex((p) => !test(p));
  const out: [number, number][] = [];
  let first = -1;
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    if (test(samples[i])) {
      if (first < 0) first = i;
    } else if (first >= 0) {
      out.push([first, i]);
      first = -1;
    }
  }
  return out;
}

/** Height of the ridges at distance `s` along the track: a hump under each red stripe. */
export function kerbRidge(s: number): number {
  return KERB_RIDGE * Math.max(0, Math.sin((Math.PI * s) / KERB_STRIPE));
}

/** The kerbs on both sides: raised, with a sloped inner edge, ridged under the red stripes. */
export function kerbs(track: Track): Sweep[] {
  const out: Sweep[] = [];
  for (const side of ['left', 'right'] as const) {
    const k = sign(side);
    for (const [first, last] of runs(track, (p) => profile(p, side).kerb > 0)) {
      // From one sample before the kerb starts (its taper begins at zero) to one past its end.
      const from = (first - 1 + track.samples.length) % track.samples.length;
      out.push(
        sweep(track, from, last, KERB_STEPS, (p) => {
          const w = profile(p, side).kerb;
          const h = (KERB_HEIGHT + kerbRidge(p.s)) * (w / KERB_WIDTH);
          const across = (f: number) => k * (p.halfWidth + f * w);
          // Road edge, top of the slope, outer top, outer foot; ordered right to left.
          const cols: [number, number][] = [
            [across(0), 0],
            [across(0.3), h],
            [across(0.85), h],
            [across(1), 0],
          ];
          return k > 0 ? cols : cols.reverse();
        }),
      );
    }
  }
  return out;
}

/** Run-off of one surface on both sides: from the kerb (or road edge) to the barrier. */
export function runoff(track: Track, surface: RunoffSurface): Sweep[] {
  const out: Sweep[] = [];
  for (const side of ['left', 'right'] as const) {
    const k = sign(side);
    for (const [first, last] of runs(track, (p) => profile(p, side).runoffSurface === surface)) {
      out.push(
        sweep(track, first, last, 1, (p) => {
          const cols: [number, number][] = [
            [k * runoffInner(p, side), 0],
            [k * barrierOffset(p, side), 0],
          ];
          return k > 0 ? cols : cols.reverse();
        }),
      );
    }
  }
  return out;
}

export interface BarrierSegment {
  /** Middle of the segment's bottom edge. */
  centre: Vec3;
  /** Unit direction along the segment. */
  dir: Vec3;
  /** Segment length (m). */
  length: number;
}

/** Barrier segments along both sides, at the run-off's outer edge, following the road's height. */
export function barriers(track: Track, step = 3): BarrierSegment[] {
  const { samples } = track;
  const n = samples.length;
  const out: BarrierSegment[] = [];
  for (const side of ['left', 'right'] as const) {
    for (let i = 0; i < n; i += step) {
      const pa = samples[i];
      const pb = samples[(i + step) % n];
      const a = crossSection(pa, sign(side) * barrierOffset(pa, side));
      const b = crossSection(pb, sign(side) * barrierOffset(pb, side));
      const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
      const length = Math.hypot(d.x, d.y, d.z);
      // Inside tight corners the offset curve folds back on itself; skip those slivers.
      if (length < 0.5) continue;
      out.push({ centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }, dir: normalize(d), length: length + 0.3 });
    }
  }
  return out;
}
