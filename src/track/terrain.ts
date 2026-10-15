// The ground around a circuit: a heightfield shared by the physics (a Rapier HeightField
// collider) and the ground mesh. Within the barriers it sits just under the run-off; further
// out it blends into gentle seeded hills, so a hilly circuit sits in a landscape rather than
// on a plane. Pure data and maths.

import { createRng } from '../math';
import { barrierOffset } from './geometry';
import type { Track, TrackSample } from './track';

export interface Terrain {
  /** Corner of the grid with the smallest x and z (m), and the spacing between heights (m). */
  x0: number;
  z0: number;
  spacing: number;
  /** Heights along x and along z. */
  nx: number;
  nz: number;
  /** Heights (m), column-major as Rapier wants them: index = iz + ix × nz. */
  heights: Float32Array;
}

/** Grid spacing (m). */
const SPACING = 6;
/** Ground beyond the barriers' furthest reach (m). */
const MARGIN = 400;
/** Depth of the terrain under the run-off (m), so the strips always lie on top. */
const DEPTH = 0.7;
/** Distance beyond the barriers over which the ground blends from the track's level to the hills (m). */
const BLEND = 120;
/** Track samples further apart than this along the track count as different parts of it (m). */
const PART_GAP = 120;
/** How far around a point to look for track (m); its influence fades to nothing there. */
const SEARCH = 200;
/** Spatial hash cell size (m). */
const CELL = 50;
/** The search looks at every STRIDE-th sample, then refines the nearest among its neighbours. */
const STRIDE = 4;

export interface TerrainDef {
  /** Height of the far hills, peak to mean (m). 0 for flat. */
  hills: number;
  seed: number;
}

export function buildTerrain(track: Track, def: TerrainDef = { hills: 0, seed: 1 }): Terrain {
  const { samples } = track;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let meanY = 0;
  for (const p of samples) {
    const reach = Math.max(barrierOffset(p, 'left'), barrierOffset(p, 'right'));
    minX = Math.min(minX, p.x - reach);
    maxX = Math.max(maxX, p.x + reach);
    minZ = Math.min(minZ, p.z - reach);
    maxZ = Math.max(maxZ, p.z + reach);
    meanY += p.y / samples.length;
  }
  const x0 = minX - MARGIN;
  const z0 = minZ - MARGIN;
  const nx = Math.ceil((maxX + MARGIN - x0) / SPACING) + 1;
  const nz = Math.ceil((maxZ + MARGIN - z0) / SPACING) + 1;

  // Spatial hash of the samples.
  const buckets = new Map<number, number[]>();
  const key = (cx: number, cz: number) => cx * 100_003 + cz;
  // Only every STRIDE-th sample goes in the hash; the nearest one found is then refined.
  samples.forEach((p, i) => {
    if (i % STRIDE !== 0) return;
    const k = key(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
    const list = buckets.get(k);
    if (list) list.push(i);
    else buckets.set(k, [i]);
  });

  const hills = valueNoise(def.seed);
  const far = (x: number, z: number) => meanY - DEPTH + def.hills * hills(x, z);
  const n = samples.length;
  const partGap = Math.round(PART_GAP / (track.length / n));
  const reachCells = Math.ceil(SEARCH / CELL);

  const heights = new Float32Array(nx * nz);
  const candidates: number[] = [];
  const distances: number[] = [];
  const parts: number[] = [];
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const x = x0 + ix * SPACING;
      const z = z0 + iz * SPACING;
      // Track samples within reach, nearest first.
      candidates.length = 0;
      distances.length = 0;
      const cx = Math.floor(x / CELL);
      const cz = Math.floor(z / CELL);
      for (let a = -reachCells; a <= reachCells; a++) {
        for (let b = -reachCells; b <= reachCells; b++) {
          const list = buckets.get(key(cx + a, cz + b));
          if (!list) continue;
          for (const i of list) {
            const d = Math.hypot(samples[i].x - x, samples[i].z - z);
            if (d >= SEARCH) continue;
            candidates.push(i);
            distances.push(d);
          }
        }
      }
      // The nearest sample of each separate part of the track (up to three), within reach.
      parts.length = 0;
      for (let k = 0; k < 3; k++) {
        let best = -1;
        let bestD = SEARCH;
        for (let c = 0; c < candidates.length; c++) {
          const i = candidates[c];
          if (distances[c] < bestD && parts.every((j) => Math.min(Math.abs(i - j), n - Math.abs(i - j)) > partGap)) {
            best = i;
            bestD = distances[c];
          }
        }
        if (best < 0) break;
        parts.push(best);
      }
      // Refine the nearest part's sample among its neighbours that weren't in the hash.
      if (parts.length > 0) {
        let best = parts[0];
        let bestD = Math.hypot(samples[best].x - x, samples[best].z - z);
        for (let o = -STRIDE + 1; o < STRIDE; o++) {
          const i = (((parts[0] + o) % n) + n) % n;
          const d = Math.hypot(samples[i].x - x, samples[i].z - z);
          if (d < bestD) {
            best = i;
            bestD = d;
          }
        }
        parts[0] = best;
      }

      let h: number;
      if (parts.length === 0) h = far(x, z);
      else {
        // Inside the barriers of the nearest part: just under its run-off.
        const nearest = sideOf(samples[parts[0]], x, z);
        if (nearest.inside) h = nearest.edge;
        else {
          // Outside: a blend of each nearby part's barrier-edge height and the far hills,
          // the nearer the stronger.
          let sum = far(x, z) / (BLEND * BLEND);
          let weight = 1 / (BLEND * BLEND);
          for (const i of parts) {
            const s = sideOf(samples[i], x, z);
            // Fades to nothing at the edge of the search, so there's no seam where a part drops out.
            const w = Math.max(0, 1 / (s.beyond + 1) ** 2 - 1 / (SEARCH - s.reach + 1) ** 2);
            sum += s.edge * w;
            weight += w;
          }
          h = sum / weight;
        }
      }
      heights[iz + ix * nz] = h;
    }
  }
  return { x0, z0, spacing: SPACING, nx, nz, heights };
}

/**
 * Where (x, z) lies relative to sample `p`: whether it is between the barriers there, how
 * far it is beyond them (straight-line, so a point far ahead along the track counts as far),
 * and the height the ground should have under the run-off, clamped to the barrier.
 */
function sideOf(p: TrackSample, x: number, z: number): { inside: boolean; beyond: number; edge: number; reach: number } {
  const across = (x - p.x) * p.nx + (z - p.z) * p.nz;
  const reach = barrierOffset(p, across >= 0 ? 'left' : 'right');
  const distance = Math.hypot(x - p.x, z - p.z);
  const clamped = Math.max(-reach, Math.min(reach, across));
  // Height of the cross-section at that offset (banked), less the depth.
  const edge = p.y + (p.ly * clamped) / Math.hypot(p.lx, p.lz) - DEPTH;
  return { inside: Math.abs(across) <= reach, beyond: Math.max(0, distance - reach), edge, reach };
}

/** Terrain height at (x, z), bilinear between grid points. */
export function terrainHeight(t: Terrain, x: number, z: number): number {
  const fx = Math.max(0, Math.min(t.nx - 1.000001, (x - t.x0) / t.spacing));
  const fz = Math.max(0, Math.min(t.nz - 1.000001, (z - t.z0) / t.spacing));
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const u = fx - ix;
  const v = fz - iz;
  const h = (i: number, k: number) => t.heights[k + i * t.nz];
  return h(ix, iz) * (1 - u) * (1 - v) + h(ix + 1, iz) * u * (1 - v) + h(ix, iz + 1) * (1 - u) * v + h(ix + 1, iz + 1) * u * v;
}

/** Smooth value noise in about −1..1: two octaves of random heights on 300 m and 100 m lattices. */
function valueNoise(seed: number): (x: number, z: number) => number {
  const rng = createRng(seed);
  const size = 64;
  const table = Float32Array.from({ length: size * size }, () => rng() * 2 - 1);
  const lattice = (x: number, z: number) => {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const u = smooth(x - ix);
    const v = smooth(z - iz);
    const at = (i: number, k: number) => table[(((i % size) + size) % size) + (((k % size) + size) % size) * size];
    return at(ix, iz) * (1 - u) * (1 - v) + at(ix + 1, iz) * u * (1 - v) + at(ix, iz + 1) * (1 - u) * v + at(ix + 1, iz + 1) * u * v;
  };
  return (x, z) => 0.7 * lattice(x / 300, z / 300) + 0.3 * lattice(x / 100 + 17, z / 100 + 31);
}

const smooth = (t: number) => t * t * (3 - 2 * t);
