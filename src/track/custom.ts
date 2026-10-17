// A circuit drawn in the editor: control points and a few settings, turned into a full
// `TrackDef` the way the built-in circuits are made: kerbs at its corners and gravel at its
// hairpins (if asked), a pit lane along the straight through the start line, the pit building
// beside it and a grandstand opposite, trees and hills. Anything from outside (storage, a
// link, the other player) goes through `cleanCustom` first. Pure.

import { TUNING } from '../config';
import { withCornerKerbs, withHairpinGravel } from './corners';
import { curvature } from './corners';
import type { PitLaneDef } from './pitLane';
import { buildTrack, type ControlPoint, type RunoffSurface, type Side, type Track, type TrackDef } from './track';

export interface CustomCircuit {
  version: 1;
  name: string;
  /** In driving order; the first is the start line. */
  points: ControlPoint[];
  /** Default road width (m). */
  width: number;
  runoff: { width: number; surface: RunoffSurface };
  /** Height of the hills around it (m), and about how many trees. */
  hills: number;
  trees: number;
  pitSide: Side;
  /** Kerbs at the corners, gravel at the hairpins, as on the built-in circuits. */
  kerbs: boolean;
  gravel: boolean;
}

/** What a custom circuit may be (anything else is refused or brought within it). */
export const LIMITS = {
  points: [4, 80],
  name: 40,
  coordinate: 4000,
  elevation: [-20, 40],
  banking: (12 * Math.PI) / 180,
  width: [8, 16],
  runoff: [6, 30],
  hills: [0, 40],
  trees: [0, 3000],
} as const;

/** A stable id from the circuit itself: the same circuit, the same id (and the same bests). */
export function customId(c: CustomCircuit): string {
  // Every point in full (a missing elevation is 0), so it doesn't matter how it was written down.
  const points = c.points.map((p) => [p.x, p.z, p.y ?? 0, p.bank ?? 0, p.width ?? 0]);
  const text = JSON.stringify([points, c.width, c.runoff.width, c.runoff.surface, c.hills, c.pitSide, c.kerbs, c.gravel]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return `custom-${(h >>> 0).toString(36)}`;
}

const cache = new Map<string, TrackDef>();

/** The circuit's full definition (kerbs, gravel, pit lane, scenery placed). */
export function customDef(c: CustomCircuit): TrackDef {
  const id = customId(c);
  const known = cache.get(id);
  if (known && known.name === c.name) return known;
  const seed = Number.parseInt(id.slice(7), 36) % 100_000 || 1;
  let def: TrackDef = {
    id,
    name: c.name,
    points: c.points.map((p) => ({ ...p })),
    width: c.width,
    runoff: { ...c.runoff },
    terrain: { hills: c.hills, seed },
  };
  if (c.kerbs) def = withCornerKerbs(def);
  if (c.gravel) def = withHairpinGravel(def);
  const track = buildTrack(def);
  const lane = autoPitLane(track, c.pitSide);
  if (lane) {
    def = { ...def, pitLane: lane };
    const L = track.length;
    const taper = lane.taper ?? TUNING.pits.taper;
    // The pit building along the lane's full-width part; a grandstand opposite the start.
    const from = (L - lane.entry + taper + L) % L;
    const to = (lane.exit - taper + L) % L;
    def.scenery = {
      seed,
      trees: c.trees,
      pits: { from, to, side: c.pitSide },
      grandstands: [{ from: (L - 60) % L, to: 60, side: c.pitSide === 'left' ? 'right' : 'left' }],
    };
  } else def.scenery = { seed, trees: c.trees };
  cache.set(id, def);
  return def;
}

/**
 * A pit lane on `side` along the straight through the start line: in where the bend before
 * the line straightens out, out before the first corner after it (with some margin for the
 * kerbs). Null when the straight is too short for the boxes.
 */
export function autoPitLane(track: Track, side: Side): PitLaneDef | null {
  const P = TUNING.pits;
  const { samples, length } = track;
  const n = samples.length;
  const spacing = length / n;
  const straight = (i: number) => Math.abs(curvature(track, ((i % n) + n) % n)) < 1 / P.auto.bend;
  let after = 0;
  while (after < n / 2 && straight(after)) after++;
  let before = 0;
  while (before < n / 2 && straight(-before)) before++;
  const entry = Math.min(P.auto.maxEntry, before * spacing - P.auto.margin);
  const exit = Math.min(P.auto.maxExit, after * spacing - P.auto.margin);
  if (entry < P.auto.minEntry) return null;
  const total = entry + exit;
  const taper = Math.min(P.taper, total / 4);
  // Room for the boxes along the full-width part.
  if (total - 2 * taper < (P.boxes + 1) * P.boxSpacing) return null;
  return { side, entry: Math.round(entry), exit: Math.round(exit), taper: Math.round(taper) };
}

/** A blank start: an oval with a long start straight, 1.6 km round. */
export function ovalTemplate(name = 'New circuit'): CustomCircuit {
  const points: ControlPoint[] = [];
  const straight = 500;
  const r = 110;
  // Bottom straight driving +x from the start line, a semicircle, the back straight, a semicircle.
  for (const x of [0, 160, 330]) points.push({ x, z: 0 });
  for (let k = 0; k <= 4; k++) {
    const a = Math.PI / 2 - (k * Math.PI) / 4;
    points.push({ x: straight + r * Math.cos(a), z: -r + r * Math.sin(a) });
  }
  for (const x of [330, 160, 0]) points.push({ x, z: -2 * r });
  for (let k = 0; k <= 4; k++) {
    const a = -Math.PI / 2 - (k * Math.PI) / 4;
    points.push({ x: -170 + r * Math.cos(a), z: -r + r * Math.sin(a) });
  }
  return { version: 1, name, points, width: 12, runoff: { width: 12, surface: 'grass' }, hills: 6, trees: 600, pitSide: 'left', kerbs: true, gravel: true };
}

/** A copy of a built-in circuit to modify (its points and settings, not its kerbs or scenery). */
export function fromBuiltIn(def: TrackDef): CustomCircuit {
  return {
    version: 1,
    name: `${def.name} (copy)`,
    points: def.points.map((p) => ({ ...p })),
    width: def.width,
    runoff: { ...def.runoff },
    hills: def.terrain?.hills ?? 0,
    trees: def.scenery?.trees ?? 0,
    pitSide: def.pitLane?.side ?? 'left',
    kerbs: (def.kerbs?.length ?? 0) > 0,
    gravel: (def.gravel?.length ?? 0) > 0,
  };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const within = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A custom circuit from anywhere, brought within the limits; null if it can't be one. */
export function cleanCustom(raw: unknown): CustomCircuit | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || !Array.isArray(r.points)) return null;
  if (r.points.length < LIMITS.points[0] || r.points.length > LIMITS.points[1]) return null;
  const points: ControlPoint[] = [];
  for (const p of r.points as unknown[]) {
    if (typeof p !== 'object' || p === null) return null;
    const q = p as Record<string, unknown>;
    if (!finite(q.x) || !finite(q.z) || Math.abs(q.x) > LIMITS.coordinate || Math.abs(q.z) > LIMITS.coordinate) return null;
    const point: ControlPoint = { x: q.x, z: q.z };
    if (finite(q.y) && q.y !== 0) point.y = within(q.y, LIMITS.elevation[0], LIMITS.elevation[1]);
    if (finite(q.bank) && q.bank !== 0) point.bank = within(q.bank, -LIMITS.banking, LIMITS.banking);
    if (finite(q.width)) point.width = within(q.width, LIMITS.width[0], LIMITS.width[1]);
    points.push(point);
  }
  const runoff = (r.runoff ?? {}) as Record<string, unknown>;
  return {
    version: 1,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, LIMITS.name) : 'Custom circuit',
    points,
    width: finite(r.width) ? within(r.width, LIMITS.width[0], LIMITS.width[1]) : 12,
    runoff: {
      width: finite(runoff.width) ? within(runoff.width, LIMITS.runoff[0], LIMITS.runoff[1]) : 12,
      surface: runoff.surface === 'gravel' ? 'gravel' : 'grass',
    },
    hills: finite(r.hills) ? within(r.hills, LIMITS.hills[0], LIMITS.hills[1]) : 0,
    trees: finite(r.trees) ? Math.round(within(r.trees, LIMITS.trees[0], LIMITS.trees[1])) : 0,
    pitSide: r.pitSide === 'right' ? 'right' : 'left',
    kerbs: r.kerbs !== false,
    gravel: r.gravel !== false,
  };
}
