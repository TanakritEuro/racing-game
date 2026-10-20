// Floodlight towers for night racing: tall towers beyond the barriers, placed round the lap
// until every point of the road has its minimum of light (more at the corners and on the
// grid). Their light adds up and falls off smoothly with distance. The presentation bakes it
// into the track's vertices; nothing here lights anything. Pure data and maths.

import { TUNING } from '../config';
import { beyondBarriers } from './cameras';
import { barrierOffset } from './geometry';
import { terrainHeight, type Terrain } from './terrain';
import type { Track, TrackSample } from './track';

export interface Floodlight {
  /** The lamp head. */
  x: number;
  y: number;
  z: number;
  /** The sample it stands beside (it faces the track there). */
  sample: number;
}

/** The light one tower gives at horizontal distance `d` (m): 1 at its foot, nothing beyond its reach. */
function falloff(d: number): number {
  const r = TUNING.night.floodlights.reach;
  if (d >= r) return 0;
  const q = 1 - (d / r) ** 2;
  return q * q;
}

/** Floodlights bucketed on a grid, for the light at any point quickly. */
export class FloodlightField {
  private readonly cells = new Map<number, Floodlight[]>();
  private readonly size = TUNING.night.floodlights.reach;

  constructor(readonly lights: readonly Floodlight[]) {
    for (const l of lights) {
      const key = this.key(Math.floor(l.x / this.size), Math.floor(l.z / this.size));
      let cell = this.cells.get(key);
      if (!cell) this.cells.set(key, (cell = []));
      cell.push(l);
    }
  }

  private key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  /** The light at (x, z): the towers' light added up, to at most `max`. */
  at(x: number, z: number): number {
    const cx = Math.floor(x / this.size);
    const cz = Math.floor(z / this.size);
    let sum = 0;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const cell = this.cells.get(this.key(cx + i, cz + j));
        if (!cell) continue;
        for (const l of cell) sum += falloff(Math.hypot(l.x - x, l.z - z));
      }
    }
    return Math.min(TUNING.night.floodlights.max, sum);
  }
}

/** How much light the road at sample `i` needs: more at a corner and on the grid. */
export function lightNeeded(track: Track, i: number): number {
  const F = TUNING.night.floodlights;
  const n = track.samples.length;
  const spacing = track.length / n;
  const a = track.samples[(i - 1 + n) % n];
  const b = track.samples[(i + 1) % n];
  const turn = Math.abs(Math.atan2(a.tx * b.tz - a.tz * b.tx, a.tx * b.tx + a.tz * b.tz)) / (2 * spacing);
  const grid = (n - i) * spacing < F.grid || i * spacing < spacing;
  return turn > F.cornerCurvature || grid ? F.corner : F.min;
}

/** The darker of the road's two edges at sample `p`: what a sample's light is judged by. */
export function sampleLight(field: FloodlightField, p: TrackSample): number {
  const h = p.halfWidth;
  return Math.min(field.at(p.x + p.nx * h, p.z + p.nz * h), field.at(p.x - p.nx * h, p.z - p.nz * h));
}

/** Towers round the lap until every sample has the light it needs. */
export function placeFloodlights(track: Track, terrain: Terrain): Floodlight[] {
  const F = TUNING.night.floodlights;
  const { samples } = track;
  const n = samples.length;
  const spacing = track.length / n;
  const need = samples.map((_, i) => lightNeeded(track, i));
  const lights: Floodlight[] = [];
  // The light each sample has so far (both edges), kept up to date as towers go up.
  const have = new Float64Array(n);
  const edges = samples.map((p) => [
    { x: p.x + p.nx * p.halfWidth, z: p.z + p.nz * p.halfWidth },
    { x: p.x - p.nx * p.halfWidth, z: p.z - p.nz * p.halfWidth },
  ]);
  const gain = (t: { x: number; z: number }, i: number) => Math.min(falloff(Math.hypot(edges[i][0].x - t.x, edges[i][0].z - t.z)), falloff(Math.hypot(edges[i][1].x - t.x, edges[i][1].z - t.z)));
  // Samples a tower could reach, either side of the one it stands beside.
  const span = Math.ceil((F.reach + 40) / spacing);
  const near = (k: number, f: (i: number) => void) => {
    for (let d = -span; d <= span; d++) f((((k + d) % n) + n) % n);
  };

  for (let guard = 0; guard < n; guard++) {
    let dark = -1;
    for (let i = 0; i < n; i++) {
      if (have[i] < need[i] - 1e-9) {
        dark = i;
        break;
      }
    }
    if (dark < 0) break;
    // Posts a little way along from the first dark sample, either side: keep the one that lights
    // the most of what is still short.
    let best: Floodlight | null = null;
    let bestScore = 0;
    for (const ahead of F.ahead) {
      const k = (dark + Math.round(ahead / spacing)) % n;
      const p = samples[k];
      for (const side of [1, -1] as const) {
        const off = barrierOffset(p, side === 1 ? 'left' : 'right') + F.setback;
        const x = p.x + p.nx * off * side;
        const z = p.z + p.nz * off * side;
        if (!beyondBarriers(track, x, z)) continue;
        let score = 0;
        near(k, (i) => {
          const short = need[i] - have[i];
          if (short > 0) score += Math.min(short, gain({ x, z }, i));
        });
        if (score > bestScore) {
          bestScore = score;
          best = { x, y: Math.max(terrainHeight(terrain, x, z), p.y) + F.height, z, sample: k };
        }
      }
    }
    if (!best) {
      // Hemmed in (a barrier on both sides): a tower right at the dark sample, outside its left barrier.
      const p = samples[dark];
      const off = barrierOffset(p, 'left') + F.setback;
      const x = p.x + p.nx * off;
      const z = p.z + p.nz * off;
      best = { x, y: Math.max(terrainHeight(terrain, x, z), p.y) + F.height, z, sample: dark };
    }
    lights.push(best);
    const tower = best;
    near(tower.sample, (i) => (have[i] = Math.min(F.max, have[i] + gain(tower, i))));
    // A tower that doesn't reach the dark sample at all would loop forever: count it lit.
    if (gain(tower, dark) <= 0) have[dark] = need[dark];
  }
  return lights;
}
