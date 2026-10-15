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
  name: 'Skidpad',
  width: 12,
  runoff: 8,
  points: [{ x: 40, z: 0 }, ...arc(0, 0, 40, 0, -2 * Math.PI, 32)],
};

const STRAIGHT = 5000;
const END_RADIUS = 250;

/**
 * Oval with 5 km straights, for top speed. Sample 0 is 500 m along the bottom straight,
 * so the car starts with 4.5 km of straight road ahead, driving towards +X.
 */
export const LONG_OVAL: TrackDef = {
  name: 'Long oval',
  width: 15,
  runoff: 10,
  points: [
    ...[500, 1500, 2500, 3500, 4500, STRAIGHT].map((x) => ({ x, z: 0 })),
    ...arc(STRAIGHT, -END_RADIUS, END_RADIUS, Math.PI / 2, -Math.PI / 2, 6),
    ...[STRAIGHT, 4000, 3000, 2000, 1000, 0].map((x) => ({ x, z: -2 * END_RADIUS })),
    ...arc(0, -END_RADIUS, END_RADIUS, -Math.PI / 2, -(3 * Math.PI) / 2, 6),
    { x: 0, z: 0 },
  ],
};
