// A circuit's pit lane: a strip of road beside the start straight, on the side of the pit
// building. It grows out of the road edge over its entry taper, runs at full width past the
// boxes behind a pit wall, and closes back into the road edge over its exit taper. Its strips
// are both the colliders and the meshes, as the rest of the circuit's are. Pure.

import { TUNING } from '../config';
import { crossSection, sweep, type BarrierSegment, type Sweep } from './geometry';
import type { Side, Track } from './track';
import { normalize } from '../math';

export interface PitLaneDef {
  side: Side;
  /** Where the lane leaves the track (m before the start line) and where it rejoins (m after). */
  entry: number;
  exit: number;
  /** The entry and exit tapers' length (m; default TUNING.pits.taper). */
  taper?: number;
}

export interface PitLane {
  def: PitLaneDef;
  /** +1 for a lane on the left, −1 on the right (offsets are m left of the centreline). */
  sign: 1 | -1;
  /** Samples where it leaves the track and rejoins it, and its length along the road (m). */
  first: number;
  last: number;
  length: number;
  taper: number;
  /** Where each box is: its sample. */
  boxes: number[];
}

const lanes = new WeakMap<Track, PitLane | null>();

/** The pit lane of `track`, or null if it has none. */
export function pitLane(track: Track): PitLane | null {
  const known = lanes.get(track);
  if (known !== undefined) return known;
  const def = track.def.pitLane;
  if (!def) {
    lanes.set(track, null);
    return null;
  }
  const P = TUNING.pits;
  const { samples, length } = track;
  const n = samples.length;
  const spacing = length / n;
  const at = (s: number) => ((Math.round(s / spacing) % n) + n) % n;
  const taper = def.taper ?? P.taper;
  // Boxes in front of the pit building if it's on this side, else mid-way along the full-width part.
  const building = track.def.scenery?.pits;
  const full: [number, number] = [-def.entry + taper, def.exit - taper];
  const middle = building && building.side === def.side ? (building.from + building.to) / 2 : (full[0] + full[1]) / 2;
  const half = ((P.boxes - 1) / 2) * P.boxSpacing;
  const centre = Math.min(full[1] - half - P.boxSpacing / 2, Math.max(full[0] + half + P.boxSpacing / 2, middle));
  const boxes = Array.from({ length: P.boxes }, (_, k) => at(centre - half + k * P.boxSpacing));
  const first = at(-def.entry);
  const last = at(def.exit);
  // Its length in whole samples, so its ends are exactly where it joins the road.
  const lane: PitLane = { def, sign: def.side === 'left' ? 1 : -1, first, last, length: ((last - first + n) % n) * spacing, taper, boxes };
  lanes.set(track, lane);
  return lane;
}

/** How far along the lane sample `i` is (m from where it leaves the track), or −1 off its stretch. */
export function laneAlong(track: Track, lane: PitLane, i: number): number {
  const n = track.samples.length;
  const u = ((i - lane.first + n) % n) * (track.length / n);
  return u <= lane.length ? u : -1;
}

/** How far out of the road edge the lane has grown at `u` (0 joined to the road … 1 full), smoothly. */
export function laneOpen(lane: PitLane, u: number): number {
  if (u < 0) return 0;
  const f = Math.min(1, Math.max(0, Math.min(u, lane.length - u) / lane.taper));
  return f * f * (3 - 2 * f);
}

/** The lane's edges at sample `i` (m beyond the road edge, inner and outer), or null off its stretch. */
export function laneEdges(track: Track, lane: PitLane, i: number): [number, number] | null {
  const u = laneAlong(track, lane, i);
  if (u < 0) return null;
  const P = TUNING.pits;
  const f = laneOpen(lane, u);
  return [P.inner * f, (P.inner + P.width) * f];
}

/** The lane's road: a strip a little above the run-off under it. */
export function laneSweep(track: Track, lane: PitLane): Sweep {
  const P = TUNING.pits;
  const n = track.samples.length;
  return sweep(track, lane.first, lane.last, 1, (p) => {
    const i = Math.round((p.s / track.length) * n) % n;
    const e = laneEdges(track, lane, i) ?? [0, 0];
    const a = p.halfWidth + e[0];
    const b = p.halfWidth + e[1];
    return lane.sign > 0
      ? [
          [a, P.lift],
          [b, P.lift],
        ]
      : [
          [-b, P.lift],
          [-a, P.lift],
        ];
  });
}

/** The pit wall between the road and the lane, along its full-width part. */
export function pitWall(track: Track, lane: PitLane, step = 3): BarrierSegment[] {
  const P = TUNING.pits;
  const { samples } = track;
  const n = samples.length;
  const spacing = track.length / n;
  const out: BarrierSegment[] = [];
  const from = (lane.first + Math.round(lane.taper / spacing)) % n;
  const count = Math.round((lane.length - 2 * lane.taper) / spacing);
  for (let k = 0; k + step <= count; k += step) {
    const pa = samples[(from + k) % n];
    const pb = samples[(from + k + step) % n];
    const a = crossSection(pa, lane.sign * (pa.halfWidth + P.wall));
    const b = crossSection(pb, lane.sign * (pb.halfWidth + P.wall));
    const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    out.push({ centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }, dir: normalize(d), length: Math.hypot(d.x, d.y, d.z) + 0.3 });
  }
  return out;
}

/** Where a car in box `k` stops: its centre's offset beyond the road edge (m). */
export function boxOffset(): number {
  const P = TUNING.pits;
  return P.inner + P.width - P.boxDepth / 2;
}

/** The middle of the lane's through lane (m beyond the road edge). */
export function fastLaneOffset(): number {
  const P = TUNING.pits;
  return P.inner + (P.width - P.boxDepth) / 2;
}
