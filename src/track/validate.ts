// The rules every circuit keeps, built-in or drawn in the editor: a sensible length, no corner
// tighter than 12 m, no grade over 12 %, no banking over 12°, no part of the circuit (with its
// run-off) touching another, a straight start and grid, and a pit lane that fits. Each broken
// rule comes back in words with where on the track it is, so the editor can mark it. Pure.

import { TUNING } from '../config';
import { curvature } from './corners';
import { barrierOffset } from './geometry';
import { laneAlong, pitLane } from './pitLane';
import type { Track } from './track';

export type Rule = 'length' | 'radius' | 'grade' | 'banking' | 'overlap' | 'start' | 'grid' | 'pits';

export interface Problem {
  rule: Rule;
  /** What's wrong, in words, with the number. */
  message: string;
  /** Where (m from the start line): one place per run of samples that break it. */
  at: number[];
}

export const RULES = {
  length: [800, 8000],
  /** Tightest corner radius (m), steepest grade, most banking (rad). */
  radius: 12,
  grade: 0.12,
  banking: (12 * Math.PI) / 180,
  /** Parts of the track closer than this along it (m) are neighbours, not overlaps. */
  neighbours: 150,
  /** Nothing tighter than `bend` (m radius) within `length` (m) after the line; the grid's `length` before it nothing tighter than its `bend`. */
  start: { length: 150, bend: 300 },
  grid: { length: 50, bend: 200 },
} as const;

/** Every rule `track` breaks (none: it's a circuit). */
export function validateTrack(track: Track): Problem[] {
  const { samples, length } = track;
  const n = samples.length;
  const spacing = length / n;
  const problems: Problem[] = [];
  const km = (m: number) => (m / 1000).toFixed(2);

  if (length < RULES.length[0] || length > RULES.length[1]) {
    problems.push({ rule: 'length', message: `It is ${km(length)} km long: a circuit is ${km(RULES.length[0])}–${km(RULES.length[1])} km.`, at: [] });
  }

  /** The middle of each run of samples where `bad` holds, and the worst value in it. */
  const runs = (bad: (i: number) => number | null): { at: number; worst: number }[] => {
    const out: { at: number; worst: number }[] = [];
    let start = -1;
    let worst = 0;
    for (let i = 0; i <= n; i++) {
      const v = i < n ? bad(i) : null;
      if (v !== null) {
        if (start < 0) {
          start = i;
          worst = v;
        } else worst = Math.max(worst, v);
      } else if (start >= 0) {
        out.push({ at: samples[Math.floor((start + i - 1) / 2)].s, worst });
        start = -1;
      }
    }
    return out;
  };

  const tight = runs((i) => {
    const k = Math.abs(curvature(track, i));
    return k >= 1 / RULES.radius ? 1 / k : null;
  });
  // (The worst of a tight run is its smallest radius: runs keeps the largest, so invert.)
  if (tight.length > 0) {
    const r = Math.min(
      ...samples.map((_, i) => {
        const k = Math.abs(curvature(track, i));
        return k > 0 ? 1 / k : Infinity;
      }),
    );
    problems.push({ rule: 'radius', message: `${plural(tight.length, 'corner is', 'corners are')} tighter than ${RULES.radius} m (the tightest ${r.toFixed(1)} m).`, at: tight.map((t) => t.at) });
  }

  const steep = runs((i) => {
    const g = Math.abs(samples[(i + 1) % n].y - samples[i].y) / spacing;
    return g >= RULES.grade ? g : null;
  });
  if (steep.length > 0) {
    const worst = Math.max(...steep.map((s) => s.worst));
    problems.push({ rule: 'grade', message: `Too steep in ${plural(steep.length, 'place', 'places')}: ${Math.round(worst * 100)} % (at most ${RULES.grade * 100} %).`, at: steep.map((s) => s.at) });
  }

  const banked = runs((i) => (Math.abs(samples[i].bank) >= RULES.banking ? Math.abs(samples[i].bank) : null));
  if (banked.length > 0) {
    const worst = Math.max(...banked.map((b) => b.worst));
    problems.push({ rule: 'banking', message: `Banked too steeply: ${((worst * 180) / Math.PI).toFixed(1)}° (at most 12°).`, at: banked.map((b) => b.at) });
  }

  // Overlaps: any two samples further apart along the track than neighbours, closer than their run-offs.
  const reach = samples.map((p) => Math.max(barrierOffset(p, 'left'), barrierOffset(p, 'right')));
  const near = Math.round(RULES.neighbours / spacing);
  const touching = new Set<number>();
  for (let i = 0; i < n; i += 2) {
    for (let j = i + 2; j < n; j += 2) {
      if (Math.min(j - i, n - (j - i)) < near) continue;
      const dx = samples[i].x - samples[j].x;
      const dz = samples[i].z - samples[j].z;
      const r = reach[i] + reach[j];
      if (dx * dx + dz * dz < r * r) {
        touching.add(i);
        touching.add(j);
      }
    }
  }
  if (touching.size > 0) {
    const at = runs((i) => (touching.has(i) || touching.has(i - 1) ? 1 : null)).map((t) => t.at);
    problems.push({ rule: 'overlap', message: `The circuit comes too close to itself in ${plural(at.length, 'place', 'places')} (its run-offs would touch).`, at });
  }

  // A straight start and grid.
  const S = RULES.start;
  for (let i = 0; i * spacing < S.length; i++) {
    if (Math.abs(curvature(track, i)) >= 1 / S.bend) {
      problems.push({ rule: 'start', message: `The start line needs ${S.length} m of straight after it.`, at: [samples[i].s] });
      break;
    }
  }
  const G = RULES.grid;
  for (let i = 1; i * spacing < G.length; i++) {
    if (Math.abs(curvature(track, n - i)) >= 1 / G.bend) {
      problems.push({ rule: 'grid', message: `The grid needs ${G.length} m of straight before the start line.`, at: [samples[n - i].s] });
      break;
    }
  }

  // The pit lane: joined to the road where there are no kerbs on its side, its boxes at full width.
  const def = track.def.pitLane;
  const lane = pitLane(track);
  if (!def || !lane) problems.push({ rule: 'pits', message: 'There is no straight through the start line long enough for a pit lane.', at: [0] });
  else {
    let kerbed = -1;
    for (let i = lane.first; i !== lane.last; i = (i + 1) % n) {
      if (samples[i][def.side].kerb > 0) {
        kerbed = i;
        break;
      }
    }
    if (kerbed >= 0) problems.push({ rule: 'pits', message: 'A kerb is in the way of the pit lane: straighten the road near the start line.', at: [samples[kerbed].s] });
    const P = TUNING.pits;
    const boxes = lane.boxes.map((b) => laneAlong(track, lane, b));
    if (boxes.some((u) => u < lane.taper || u > lane.length - lane.taper) || lane.length - 2 * lane.taper < (P.boxes - 1) * P.boxSpacing) {
      problems.push({ rule: 'pits', message: 'The straight through the start line is too short for the pit boxes.', at: [0] });
    }
  }
  return problems;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}
