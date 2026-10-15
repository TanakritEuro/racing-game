// Trackside TV cameras for replays: raised posts beyond the barriers, each covering a stretch
// of track it can see over the terrain. Placed greedily round the lap: from the first stretch
// no camera covers yet, try posts a little way ahead on either side and keep the one that sees
// furthest on. Pure data and maths.

import { barrierOffset } from './geometry';
import { terrainHeight, type Terrain } from './terrain';
import { lateralOffset, nearestSample, type Track, type TrackSample } from './track';

export interface TvCamera {
  x: number;
  y: number;
  z: number;
  /** The stretch it covers: samples `from` to `to`, counting on round the lap (to may pass n). */
  from: number;
  to: number;
}

/** How far beyond the barrier a post stands (m), and how high above the ground its lens is (m). */
const SETBACK = 8;
const HEIGHT = 6;
/** Furthest a camera follows the car (m). */
const RANGE = 180;
/** Height above the road of the point a camera must see (m): roughly the car's roof. */
const TARGET_HEIGHT = 1;
/** Line-of-sight check: step along the ray (m), clearance over the ground (m), and the stretch near the car left out (m). */
const SIGHT_STEP = 4;
const CLEARANCE = 0.3;
const NEAR_CAR = 6;
/** Posts tried this many metres ahead of the first uncovered sample. */
const AHEAD = [10, 30, 50, 70, 90];

/** Can a camera at `c` see the car at sample `p`: in range, and the ground never in the way? */
export function cameraSees(c: { x: number; y: number; z: number }, p: TrackSample, terrain: Terrain): boolean {
  const tx = p.x;
  const ty = p.y + TARGET_HEIGHT;
  const tz = p.z;
  const d = Math.hypot(tx - c.x, ty - c.y, tz - c.z);
  if (d > RANGE) return false;
  const end = d - NEAR_CAR;
  for (let s = SIGHT_STEP; s < end; s += SIGHT_STEP) {
    const f = s / d;
    const x = c.x + (tx - c.x) * f;
    const z = c.z + (tz - c.z) * f;
    if (c.y + (ty - c.y) * f < terrainHeight(terrain, x, z) + CLEARANCE) return false;
  }
  return true;
}

/** Is (x, z) beyond the barriers of every part of the track, with `margin` (m) to spare? */
export function beyondBarriers(track: Track, x: number, z: number, margin = 2): boolean {
  const i = nearestSample(track, x, z);
  const off = lateralOffset(track, i, x, z);
  return Math.abs(off) > barrierOffset(track.samples[i], off > 0 ? 'left' : 'right') + margin;
}

/** A post beside sample `p` on `side` (+1 left, −1 right). */
function post(p: TrackSample, side: 1 | -1, terrain: Terrain): { x: number; y: number; z: number } {
  const off = barrierOffset(p, side === 1 ? 'left' : 'right') + SETBACK;
  const x = p.x + p.nx * off * side;
  const z = p.z + p.nz * off * side;
  return { x, y: Math.max(terrainHeight(terrain, x, z), p.y) + HEIGHT, z };
}

/** Cameras covering the whole lap, in order round it. */
export function placeTvCameras(track: Track, terrain: Terrain): TvCamera[] {
  const { samples } = track;
  const n = samples.length;
  const spacing = track.length / n;
  const at = (i: number) => samples[((i % n) + n) % n];
  const cameras: TvCamera[] = [];
  let u = 0;
  while (u < n) {
    let best: TvCamera | null = null;
    for (const ahead of AHEAD) {
      for (const side of [1, -1] as const) {
        const c = post(at(u + Math.round(ahead / spacing)), side, terrain);
        if (!beyondBarriers(track, c.x, c.z) || !cameraSees(c, at(u), terrain)) continue;
        let to = u;
        while (to + 1 < u + n && cameraSees(c, at(to + 1), terrain)) to++;
        if (!best || to > best.to) best = { ...c, from: u, to };
      }
    }
    // Nothing ahead sees this sample (a blind crest): a post right beside it, on whichever side is clear.
    if (!best) {
      const left = post(at(u), 1, terrain);
      best = { ...(beyondBarriers(track, left.x, left.z) ? left : post(at(u), -1, terrain)), from: u, to: u };
    }
    cameras.push(best);
    u = best.to + 1;
  }
  return cameras;
}

/** Does `camera` cover sample `i`? */
export function covers(camera: TvCamera, i: number, n: number): boolean {
  const k = (((i - camera.from) % n) + n) % n;
  return k <= camera.to - camera.from;
}
