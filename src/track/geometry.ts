// Plain-array geometry built from a Track, shared by the physics colliders and the meshes,
// so what you see is exactly what the tyres drive on.

import type { Track } from './track';

export interface Ribbon {
  /** x, y, z per vertex: two vertices (left, right) per sample, looping. */
  positions: Float32Array;
  /** Triangle indices. */
  indices: Uint32Array;
  /** Distance along the track per vertex (m), for texturing. */
  distance: Float32Array;
}

/**
 * A strip following the centreline between two lateral offsets (m, positive = left; inner < outer,
 * or the faces point down).
 * The road is ribbon(-w/2, +w/2); kerbs and edge lines are narrow ribbons.
 */
export function ribbon(track: Track, inner: number, outer: number, y = 0): Ribbon {
  const n = track.samples.length;
  const positions = new Float32Array(n * 2 * 3);
  const distance = new Float32Array(n * 2);
  track.samples.forEach((p, i) => {
    positions.set([p.x + p.nx * outer, y, p.z + p.nz * outer, p.x + p.nx * inner, y, p.z + p.nz * inner], i * 6);
    distance[i * 2] = distance[i * 2 + 1] = p.s;
  });
  const indices = new Uint32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    // Counter-clockwise seen from above (+Y), so the faces point up.
    indices.set([a, a + 1, b, b, a + 1, b + 1], i * 6);
  }
  return { positions, indices, distance };
}

export interface BarrierSegment {
  /** Centre on the ground and yaw (rotation about +Y, rad). */
  x: number;
  z: number;
  yaw: number;
  /** Segment length (m). */
  length: number;
}

/** Barrier segments along both sides, `runoff` metres beyond the road edges. */
export function barriers(track: Track, step = 3): BarrierSegment[] {
  const { samples } = track;
  const n = samples.length;
  const offset = track.def.width / 2 + track.def.runoff;
  const out: BarrierSegment[] = [];
  for (const side of [1, -1]) {
    for (let i = 0; i < n; i += step) {
      const a = samples[i];
      const b = samples[(i + step) % n];
      const ax = a.x + a.nx * offset * side;
      const az = a.z + a.nz * offset * side;
      const bx = b.x + b.nx * offset * side;
      const bz = b.z + b.nz * offset * side;
      const length = Math.hypot(bx - ax, bz - az);
      // Inside tight corners the offset curve folds back on itself; skip those slivers.
      if (length < 0.5) continue;
      out.push({ x: (ax + bx) / 2, z: (az + bz) / 2, yaw: Math.atan2(bx - ax, bz - az), length: length + 0.3 });
    }
  }
  return out;
}
