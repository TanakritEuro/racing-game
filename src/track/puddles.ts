// Where water stands on a wet circuit: in the dips, where the road is lowest for some way
// either side, and at a few seeded spots along long flat stretches (which drain badly); towards
// the edge the banking runs down to, or on a flat road either edge or now and then right
// across. Never near the start line. Seeded from the circuit, so a layout always has
// the same puddles; their strips are both the colliders (tagged `water`) and the meshes. Pure.

import { TUNING } from '../config';
import { createRng } from '../math';
import { sweep, type Sweep } from './geometry';
import { sampleIndex, type Track, type TrackSample } from './track';

export interface Puddle {
  /** Samples it covers along the road: first and one past the last. */
  first: number;
  last: number;
  /** Which part of the road: up to `width` (m) in from the right or left edge, or right across. */
  side: 'right' | 'left' | 'across';
  width: number;
}

/** A small, steady number from a circuit's id (its puddles' seed). */
function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) % 2 ** 30 || 1;
}

const placed = new WeakMap<Track, Puddle[]>();

export function puddles(track: Track): Puddle[] {
  const cached = placed.get(track);
  if (cached) return cached;
  const P = TUNING.weather.puddles;
  const { samples, length } = track;
  const n = samples.length;
  const spacing = length / n;
  const around = Math.round(P.around / spacing);
  const reach = Math.round(P.reach / spacing);
  const clear = P.startClear / spacing;
  const rng = createRng(seedOf(track.def.id));
  const centres: number[] = [];
  const at = (i: number) => samples[sampleIndex(track, i)];
  const allowed = (i: number) => i >= clear && i <= n - clear;
  for (let i = 0; i < n; i++) {
    if (!allowed(i)) continue;
    const y = samples[i].y;
    // The lowest point for `around` either side (the first of equals), and deep enough.
    let lowest = true;
    let before = -Infinity;
    let after = -Infinity;
    for (let k = 1; k <= around; k++) {
      const a = at(i - k).y;
      const b = at(i + k).y;
      // Lower than everything ahead and no higher than anything behind (a flat road has no lowest point).
      if (a < y || b <= y) {
        lowest = false;
        break;
      }
    }
    if (!lowest) continue;
    for (let k = 1; k <= reach; k++) {
      before = Math.max(before, at(i - k).y);
      after = Math.max(after, at(i + k).y);
    }
    if (Math.min(before, after) - y >= P.minDepth) centres.push(i);
  }

  // Long flat stretches: a few seeded spots, kept apart from each other and from the dips.
  const F = P.flatRoad;
  const flat = (i: number) => Math.abs(at(i + 1).y - at(i).y) / spacing < F.grade;
  const apart = Math.round(F.spacing / spacing);
  for (let i = 0; i < n; ) {
    if (!flat(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && flat(j)) j++;
    const run = (j - i) * spacing;
    if (run >= F.run) {
      const count = Math.max(1, Math.floor(run / F.every));
      for (let c = 0; c < count; c++) {
        const k = i + Math.floor(rng() * (j - i));
        if (allowed(k) && centres.every((m) => (track.closed ? Math.min(Math.abs(m - k), n - Math.abs(m - k)) : Math.abs(m - k)) >= apart)) centres.push(k);
      }
    }
    i = j;
  }

  const out: Puddle[] = [];
  for (const i of centres.sort((a, b) => a - b)) {
    const half = Math.round((P.length[0] + (P.length[1] - P.length[0]) * rng()) / spacing / 2);
    const p = samples[i];
    // Water runs to the low edge of a banked road; a flat one, either edge or right across.
    const side: Puddle['side'] = Math.abs(p.ly) > P.flat ? (p.ly > 0 ? 'right' : 'left') : rng() < P.across ? 'across' : rng() < 0.5 ? 'right' : 'left';
    const width = P.width[0] + (P.width[1] - P.width[0]) * rng();
    out.push({ first: sampleIndex(track, i - half), last: sampleIndex(track, i + half), side, width });
  }
  placed.set(track, out);
  return out;
}

/** The offsets (m left of the centreline) a puddle covers at sample `p`. */
export function puddleSpan(puddle: Puddle, p: TrackSample): [number, number] {
  const w = Math.min(puddle.width, 2 * p.halfWidth);
  if (puddle.side === 'across') return [-p.halfWidth, p.halfWidth];
  return puddle.side === 'right' ? [-p.halfWidth, -p.halfWidth + w] : [p.halfWidth - w, p.halfWidth];
}

/** Each puddle's strip, a few millimetres above the road (the tread rays find it first). */
export function puddleSweeps(track: Track): Sweep[] {
  const lift = TUNING.weather.puddles.lift;
  return puddles(track).map((pd) =>
    sweep(track, pd.first, pd.last, 1, (p) => {
      const [a, b] = puddleSpan(pd, p);
      return [
        [a, lift],
        [b, lift],
      ];
    }),
  );
}
