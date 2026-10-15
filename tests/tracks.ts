// Test-only layouts for the vehicle tests: a skidpad and a very long oval.

import type { Vec2 } from '../src/math';
import type { TrackDef } from '../src/track/track';

/** Points on an arc around (cx, cz) from angle a0 to a1 (rad, measured from +X towards +Z), ends excluded. */
function arc(cx: number, cz: number, r: number, a0: number, a1: number, count: number): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 1; i < count; i++) {
    const a = a0 + ((a1 - a0) * i) / count;
    points.push({ x: cx + r * Math.cos(a), z: cz + r * Math.sin(a) });
  }
  return points;
}

/** Constant-radius circle for steady-state cornering: 40 m radius to the centreline, turning left. */
export const SKIDPAD: TrackDef = {
  id: 'skidpad',
  name: 'Skidpad',
  width: 12,
  runoff: { width: 8, surface: 'grass' },
  points: [{ x: 40, z: 0 }, ...arc(0, 0, 40, 0, -2 * Math.PI, 32)],
};

/** The skidpad on a 15° bank (outer, right-hand edge raised), lifted clear of the flat ground. */
export const BANKED_SKIDPAD: TrackDef = {
  ...SKIDPAD,
  id: 'banked-skidpad',
  name: 'Banked skidpad',
  points: SKIDPAD.points.map((p) => ({ ...p, y: 6, bank: (-15 * Math.PI) / 180 })),
};

const RISE = Math.tan((10 * Math.PI) / 180);

/**
 * A hill: a 400 m straight climbing at 10° towards +X (sample 0 at its foot), a level
 * hairpin at the top, a straight back down and a level hairpin at the bottom.
 */
export const HILL: TrackDef = {
  id: 'hill',
  name: 'Hill',
  width: 12,
  runoff: { width: 8, surface: 'grass' },
  points: [
    ...[0, 100, 200, 300, 400].map((x) => ({ x, z: 0, y: 2 + x * RISE })),
    ...arc(400, -60, 60, Math.PI / 2, -Math.PI / 2, 4).map((p) => ({ ...p, y: 2 + 400 * RISE })),
    ...[400, 300, 200, 100, 0].map((x) => ({ x, z: -120, y: 2 + x * RISE })),
    ...arc(0, -60, 60, -Math.PI / 2, -(3 * Math.PI) / 2, 4).map((p) => ({ ...p, y: 2 })),
  ],
};

const STRAIGHT = 5000;
const END_RADIUS = 250;

/**
 * Oval with 5 km straights, for top speed. Sample 0 is 500 m along the bottom straight,
 * so the car starts with 4.5 km of straight road ahead, driving towards +X.
 */
export const LONG_OVAL: TrackDef = {
  id: 'long-oval',
  name: 'Long oval',
  width: 15,
  runoff: { width: 10, surface: 'grass' },
  points: [
    ...[500, 1500, 2500, 3500, 4500, STRAIGHT].map((x) => ({ x, z: 0 })),
    ...arc(STRAIGHT, -END_RADIUS, END_RADIUS, Math.PI / 2, -Math.PI / 2, 6),
    ...[STRAIGHT, 4000, 3000, 2000, 1000, 0].map((x) => ({ x, z: -2 * END_RADIUS })),
    ...arc(0, -END_RADIUS, END_RADIUS, -Math.PI / 2, -(3 * Math.PI) / 2, 6),
    { x: 0, z: 0 },
  ],
};

/** The long oval with a kerb along the right of the first straight, from 100 m to 1500 m. */
export const KERBED_OVAL: TrackDef = {
  ...LONG_OVAL,
  id: 'kerbed-oval',
  name: 'Kerbed oval',
  kerbs: [{ from: 100, to: 1500, side: 'right' }],
};

/** The long oval with 40 m of run-off: all grass, or all gravel. */
export const GRASS_PAD: TrackDef = { ...LONG_OVAL, id: 'grass-pad', name: 'Grass pad', runoff: { width: 40, surface: 'grass' } };
export const GRAVEL_PAD: TrackDef = { ...LONG_OVAL, id: 'gravel-pad', name: 'Gravel pad', runoff: { width: 40, surface: 'gravel' } };
