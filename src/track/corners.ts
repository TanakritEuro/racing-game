// Corners found from a track's curvature, and kerbs placed from them: on the inside of every
// corner tighter than a given radius, and on the outside of its exit. Circuits use it so their
// kerbs follow the layout when the control points move.

import { buildTrack, type Side, type Span, type Track, type TrackDef } from './track';

export interface Corner {
  /** Where the corner starts and ends (m from the start line) and which way it turns. */
  from: number;
  to: number;
  turn: Side;
  /** Tightest radius in it (m). */
  radius: number;
}

/** Signed curvature at sample i (1/m), positive turning right, from the heading change over ±3 samples. */
export function curvature(track: Track, i: number): number {
  const { samples } = track;
  const n = samples.length;
  const a = samples[(i - 3 + n) % n];
  const b = samples[(i + 3) % n];
  let d = Math.atan2(b.tz, b.tx) - Math.atan2(a.tz, a.tx);
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  // With +X right and +Z towards the viewer from above, a right turn increases the heading angle.
  return d / (6 * (track.length / n));
}

/** The corners tighter than `maxRadius` (m). */
export function findCorners(track: Track, maxRadius: number): Corner[] {
  const { samples } = track;
  const n = samples.length;
  const k = samples.map((_, i) => curvature(track, i));
  const sharp = (i: number) => Math.abs(k[i % n]) > 1 / maxRadius;
  // Start from a sample that isn't in a corner, so none is split at the start line.
  const start = Math.max(0, k.findIndex((_, i) => !sharp(i)));
  const out: Corner[] = [];
  let first = -1;
  for (let j = 1; j <= n; j++) {
    const i = (start + j) % n;
    if (sharp(i) && first < 0) first = i;
    if (!sharp(i) && first >= 0) {
      let tightest = first;
      for (let m = first; m !== i; m = (m + 1) % n) if (Math.abs(k[m]) > Math.abs(k[tightest])) tightest = m;
      out.push({ from: samples[first].s, to: samples[(i - 1 + n) % n].s, turn: k[tightest] > 0 ? 'right' : 'left', radius: 1 / Math.abs(k[tightest]) });
      first = -1;
    }
  }
  return out;
}

/** `def` with kerbs inside each corner tighter than `maxRadius` and outside its exit (`exit` metres past it). */
export function withCornerKerbs(def: TrackDef, maxRadius = 200, exit = 25): TrackDef {
  const track = buildTrack(def);
  const kerbs: Span[] = [];
  for (const c of findCorners(track, maxRadius)) {
    const length = (c.to - c.from + track.length) % track.length;
    const mid = (c.from + length / 2) % track.length;
    kerbs.push({ from: c.from, to: c.to, side: c.turn });
    kerbs.push({ from: mid, to: (c.to + exit) % track.length, side: c.turn === 'left' ? 'right' : 'left' });
  }
  return { ...def, kerbs: [...(def.kerbs ?? []), ...kerbs] };
}

/** `def` with gravel traps on the outside of every corner tighter than `maxRadius` (hairpins), from `before` metres ahead of it. */
export function withHairpinGravel(def: TrackDef, maxRadius = 30, before = 50, width = 25): TrackDef {
  const track = buildTrack(def);
  const gravel = findCorners(track, maxRadius).map((c) => ({
    from: (c.from - before + track.length) % track.length,
    to: (c.to + 10) % track.length,
    side: (c.turn === 'left' ? 'right' : 'left') as Side,
    width,
  }));
  return { ...def, gravel: [...(def.gravel ?? []), ...gravel] };
}

/** Control points scaled by `k` on the ground (heights unchanged). */
export function scaled<T extends { x: number; z: number }>(k: number, points: T[]): T[] {
  return points.map((p) => ({ ...p, x: p.x * k, z: p.z * k }));
}
