// The racing line: a lateral offset from the centreline at every track sample, chosen to
// make the line as straight as the road allows (minimum curvature). Pure maths, computed
// when a circuit loads.
//
// The line's points are P_i = C_i + d_i·N_i (C the centreline, N its unit left normal on the
// ground). Its curvature at j is about κ_j = (D_j·M_j) / h_j², with D_j = P_{j−1} − 2P_j + P_{j+1},
// M_j the line's own normal there and h_j its spacing. (The raw |D_j|² alone would also reward
// short spacing, which pulls the line to the inside of every corner: shortest, not straightest.)
// Σκ² is minimised over the offsets by coordinate descent, Gauss–Newton style: with M and h
// taken from the line as it stands, each d_i moves to its own optimum, clamped to the usable
// road. Long wavelengths converge slowly on 2 m samples, so it is solved first on a coarse
// subset of samples, then refined on finer ones.

import { TUNING } from '../config';
import type { Track } from '../track/track';

export interface RacingLine {
  /** Metres left of the centreline at each sample (negative = right). */
  offset: Float32Array;
  /** The line's points. */
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  /** Horizontal curvature (1/m), positive turning right (as `track/corners.ts`). */
  curvature: Float32Array;
  /** Vertical curvature (1/m): negative over a crest, positive in a dip. */
  vertical: Float32Array;
  /** Rise per metre along the line (positive uphill). */
  grade: Float32Array;
  /** Sine of the road's tilt towards the right: positive where the road leans into a right-hander. */
  tilt: Float32Array;
  /** Distance along the line from the start line to each sample (m), and the whole lap (a stage: start to finish). */
  distance: Float32Array;
  length: number;
  /** Round a circuit, or a stage's open road. */
  closed: boolean;
  /** The usable road at each sample: offsets the line may use. */
  left: Float32Array;
  right: Float32Array;
}

/** The usable road at each sample for a car `halfWidth` wide: the road plus part of each kerb, less a margin. */
export function usableRoad(track: Track, halfWidth: number): { left: Float32Array; right: Float32Array } {
  const L = TUNING.ai.line;
  const n = track.samples.length;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  track.samples.forEach((p, i) => {
    left[i] = p.halfWidth + L.kerbUse * p.left.kerb - halfWidth - L.margin;
    right[i] = -(p.halfWidth + L.kerbUse * p.right.kerb - halfWidth - L.margin);
  });
  return { left, right };
}

const NEIGHBOURS: readonly [number, number][] = [
  [-1, 1],
  [0, -2],
  [1, 1],
];

/** The minimum-curvature line for a car `halfWidth` wide (m). */
export function racingLine(track: Track, halfWidth: number): RacingLine {
  const L = TUNING.ai.line;
  const { samples } = track;
  const n = samples.length;
  const { left, right } = usableRoad(track, halfWidth);
  const offset = new Float32Array(n);
  // A stage's line starts and ends on the centreline, and nothing wraps from its finish to its start.
  const closed = track.closed;

  for (const stride of L.strides) {
    const m = Math.round(n / stride) + (closed ? 0 : 1);
    if (m < 12 && stride !== 1) continue;
    const idx = Array.from({ length: m }, (_, k) => (closed ? Math.round((k * n) / m) % n : Math.round((k * (n - 1)) / (m - 1))));
    const cx = idx.map((i) => samples[i].x);
    const cz = idx.map((i) => samples[i].z);
    const nx = idx.map((i) => samples[i].nx);
    const nz = idx.map((i) => samples[i].nz);
    const lo = idx.map((i) => right[i]);
    const hi = idx.map((i) => left[i]);
    const d = idx.map((i) => offset[i]);
    const wrap = (k: number) => (closed ? (k + m) % m : Math.max(0, Math.min(m - 1, k)));
    const px = (k: number) => {
      const j = wrap(k);
      return cx[j] + d[j] * nx[j];
    };
    const pz = (k: number) => {
      const j = wrap(k);
      return cz[j] + d[j] * nz[j];
    };
    // Curvature at j, and how it changes with d_k (j within one of k): written to cur / slope.
    let cur = 0;
    let slope = 0;
    const curvatureAt = (j: number, k: number, weight: number) => {
      const cxj = px(j + 1) - px(j - 1);
      const czj = pz(j + 1) - pz(j - 1);
      const chord = Math.hypot(cxj, czj);
      const mx = -czj / chord;
      const mz = cxj / chord;
      const h2 = (chord * chord) / 4;
      cur = ((px(j - 1) - 2 * px(j) + px(j + 1)) * mx + (pz(j - 1) - 2 * pz(j) + pz(j + 1)) * mz) / h2;
      const kk = wrap(k);
      slope = (weight * (nx[kk] * mx + nz[kk] * mz)) / h2;
    };
    for (let sweep = 0; sweep < L.maxSweeps; sweep++) {
      let moved = 0;
      for (let k = closed ? 0 : 1; k < (closed ? m : m - 1); k++) {
        // d_k appears in D_{k−1} (×1), D_k (×−2) and D_{k+1} (×1).
        let grad = 0;
        let hess = 0;
        for (const [j, w] of NEIGHBOURS) {
          // A stage's ends have no curvature of their own to count.
          if (!closed && (k + j <= 0 || k + j >= m - 1)) continue;
          curvatureAt(k + j, k, w);
          grad += cur * slope;
          hess += slope * slope;
        }
        if (hess === 0) continue;
        const next = Math.min(hi[k], Math.max(lo[k], d[k] - grad / hess));
        moved = Math.max(moved, Math.abs(next - d[k]));
        d[k] = next;
      }
      if (moved < L.tolerance) break;
    }
    // Back onto every sample (linearly between the subset), for the next, finer level.
    for (let k = 0; k < m; k++) {
      const a = idx[k];
      const b = k + 1 < m ? idx[k + 1] : n;
      if (!closed && k === m - 1) {
        offset[a] = Math.min(left[a], Math.max(right[a], d[k]));
        continue;
      }
      for (let i = a; i < b; i++) {
        const f = (i - a) / (b - a);
        const v = d[k] + (d[(k + 1) % m] - d[k]) * f;
        offset[i] = Math.min(left[i], Math.max(right[i], v));
      }
    }
  }
  return lineThrough(track, offset, left, right);
}

/** Points, distances, curvatures and slopes of the line at `offset` from the centreline. */
export function lineThrough(track: Track, offset: Float32Array, left: Float32Array, right: Float32Array): RacingLine {
  const { samples } = track;
  const n = samples.length;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const z = new Float32Array(n);
  const tilt = new Float32Array(n);
  samples.forEach((p, i) => {
    x[i] = p.x + offset[i] * p.nx;
    z[i] = p.z + offset[i] * p.nz;
    y[i] = p.y + offset[i] * p.ly;
    tilt[i] = -(p.ux * p.nx + p.uz * p.nz);
  });
  const distance = new Float32Array(n);
  let length = 0;
  for (let i = 0; i < n; i++) {
    distance[i] = length;
    // A stage's line ends at its finish: nothing back to the start.
    if (!track.closed && i === n - 1) break;
    const j = (i + 1) % n;
    length += Math.hypot(x[j] - x[i], y[j] - y[i], z[j] - z[i]);
  }
  const at = (i: number) => (track.closed ? (((i % n) + n) % n) : Math.max(0, Math.min(n - 1, i)));
  const ds = (a: number, b: number) => {
    const d = distance[at(b)] - distance[at(a)];
    if (!track.closed) return Math.max(1e-3, d);
    return d > 0 ? d : d + length;
  };
  const s = TUNING.ai.line.curvatureSpan;
  const heading = (i: number) => Math.atan2(z[at(i + 1)] - z[at(i - 1)], x[at(i + 1)] - x[at(i - 1)]);
  const curvature = new Float32Array(n);
  const vertical = new Float32Array(n);
  const grade = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let dh = heading(i + s) - heading(i - s);
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    curvature[i] = dh / ds(i - s, i + s);
    const back = ds(i - s, i);
    const fwd = ds(i, i + s);
    const g0 = (y[i] - y[at(i - s)]) / back;
    const g1 = (y[at(i + s)] - y[i]) / fwd;
    vertical[i] = (g1 - g0) / ((back + fwd) / 2);
    grade[i] = (y[at(i + 1)] - y[at(i - 1)]) / ds(i - 1, i + 1);
  }
  return { offset, x, y, z, curvature, vertical, grade, tilt, distance, length, left, right, closed: track.closed };
}

/** Total squared curvature of a line, times its length per sample: how hard it turns overall. */
export function bendiness(line: RacingLine): number {
  const n = line.curvature.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += line.curvature[i] ** 2;
  return (sum * line.length) / n;
}
