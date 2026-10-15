// Where a circuit's scenery goes: trees in clumps, grandstands and a pit building beside the
// track. Pure data from a seeded PRNG, so a circuit always looks the same; render/scenery.ts
// draws it. Nothing here collides: it all stands beyond the barriers.

import { createRng } from '../math';
import { barrierOffset, crossSection } from './geometry';
import { terrainHeight, type Terrain } from './terrain';
import { nearestSample, type Side, type Span, type Track } from './track';

export interface SceneryDef {
  seed: number;
  /** About how many trees, in clumps. */
  trees: number;
  /** Grandstands along these spans, facing the track. */
  grandstands?: readonly Span[];
  /** The pit building along this span. */
  pits?: Span;
}

export interface Tree {
  x: number;
  y: number;
  z: number;
  /** Size relative to a standard tree, and a 0–1 shade for colour variation. */
  scale: number;
  shade: number;
}

/** A building beside the track: its footprint's centre at ground level, its length along the track, and which way it faces. */
export interface Building {
  x: number;
  y: number;
  z: number;
  length: number;
  /** Unit direction along the track at the building, on the ground. */
  ax: number;
  az: number;
  /** Unit direction from the building towards the track. */
  fx: number;
  fz: number;
}

export interface SceneryLayout {
  trees: Tree[];
  grandstands: Building[];
  pits: Building | null;
}

/** Trees keep at least this far beyond the barriers (m). */
export const TREE_CLEARANCE = 8;
/** Grandstands stand this far behind the barrier, the pit building this far (m). */
const STAND_SETBACK = 4;
const PITS_SETBACK = 10;
/** Trees per clump, and the clumps' spread (m). */
const CLUMP = 12;
const CLUMP_RADIUS = 35;

export function layoutScenery(track: Track, terrain: Terrain, def: SceneryDef): SceneryLayout {
  const rng = createRng(def.seed);
  const width = (terrain.nx - 1) * terrain.spacing;
  const depth = (terrain.nz - 1) * terrain.spacing;
  // Stay a little inside the terrain's edge.
  const margin = 60;

  const trees: Tree[] = [];
  const clumps = Math.ceil(def.trees / CLUMP);
  for (let c = 0; c < clumps; c++) {
    const cx = terrain.x0 + margin + rng() * (width - 2 * margin);
    const cz = terrain.z0 + margin + rng() * (depth - 2 * margin);
    for (let k = 0; k < CLUMP; k++) {
      const r = CLUMP_RADIUS * Math.sqrt(rng());
      const a = rng() * 2 * Math.PI;
      const x = cx + r * Math.cos(a);
      const z = cz + r * Math.sin(a);
      const scale = 0.7 + rng() * 0.7;
      const shade = rng();
      if (!clearOfTrack(track, x, z, TREE_CLEARANCE)) continue;
      trees.push({ x, y: terrainHeight(terrain, x, z), z, scale, shade });
    }
  }

  const building = (span: Span, setback: number): Building => {
    const n = track.samples.length;
    const length = (span.to - span.from + track.length) % track.length;
    const mid = (span.from + length / 2) % track.length;
    const p = track.samples[Math.round((mid / track.length) * n) % n];
    const k = span.side === 'left' ? 1 : -1;
    const base = crossSection(p, k * (barrierOffset(p, span.side) + setback));
    const gl = Math.hypot(p.tx, p.tz);
    return {
      x: base.x,
      y: terrainHeight(terrain, base.x, base.z),
      z: base.z,
      length,
      ax: p.tx / gl,
      az: p.tz / gl,
      // Towards the track: the opposite of the side's outward normal.
      fx: -k * p.nx,
      fz: -k * p.nz,
    };
  };
  return {
    trees,
    grandstands: (def.grandstands ?? []).map((s) => building(s, STAND_SETBACK)),
    pits: def.pits ? building(def.pits, PITS_SETBACK) : null,
  };
}

/** True if (x, z) is at least `clearance` beyond the barriers of every part of the track. */
export function clearOfTrack(track: Track, x: number, z: number, clearance: number): boolean {
  const p = track.samples[nearestSample(track, x, z)];
  const across = (x - p.x) * p.nx + (z - p.z) * p.nz;
  const side: Side = across >= 0 ? 'left' : 'right';
  return Math.hypot(x - p.x, z - p.z) > barrierOffset(p, side) + clearance;
}
