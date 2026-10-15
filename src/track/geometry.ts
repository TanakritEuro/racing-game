// Plain-array geometry built from a Track, shared by the physics colliders and the meshes,
// so what you see is exactly what the tyres drive on.
//
// Everything is a strip across each sample's cross-section frame: an offset along the
// banked "left" and a lift along the banked "up".

import { normalize, type Vec3 } from '../math';
import type { Track, TrackSample } from './track';

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

/** How far from the centreline the barriers stand at sample `p` (m). */
export function barrierOffset(track: Track, p: TrackSample): number {
  return p.halfWidth + track.def.runoff.width;
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
  for (const side of [1, -1]) {
    for (let i = 0; i < n; i += step) {
      const pa = samples[i];
      const pb = samples[(i + step) % n];
      const a = crossSection(pa, side * barrierOffset(track, pa));
      const b = crossSection(pb, side * barrierOffset(track, pb));
      const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
      const length = Math.hypot(d.x, d.y, d.z);
      // Inside tight corners the offset curve folds back on itself; skip those slivers.
      if (length < 0.5) continue;
      out.push({ centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }, dir: normalize(d), length: length + 0.3 });
    }
  }
  return out;
}
