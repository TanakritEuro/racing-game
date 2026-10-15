export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A point or direction on the ground plane (world x, z). */
export interface Vec2 {
  x: number;
  z: number;
}

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 1e-9 ? scale(a, 1 / l) : { x: 0, y: 0, z: 0 };
};

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Rotate vector `v` by unit quaternion `q`. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  // v' = v + 2w(u × v) + 2u × (u × v), with u = (q.x, q.y, q.z)
  const u = { x: q.x, y: q.y, z: q.z };
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q.w)), cross(u, t));
}

/** Rotate `v` about unit axis `axis` by `angle` radians (Rodrigues). */
export function rotateAbout(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Frame-rate independent exponential smoothing factor for `rate` per second over `dt`. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** A random number generator returning floats in [0, 1), like `Math.random`. */
export type Rng = () => number;

/**
 * Seeded PRNG (mulberry32). Simulation code takes an `Rng` instead of calling
 * `Math.random`, so tests, ghosts and replays can reproduce a run exactly.
 */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The rotation taking the local axes to `x`, `y`, `z` (orthonormal, right-handed). */
export function quatFromBasis(x: Vec3, y: Vec3, z: Vec3): Quat {
  // From the rotation matrix with columns x, y, z (Shepperd's method).
  const trace = x.x + y.y + z.z;
  if (trace > 0) {
    const s = 2 * Math.sqrt(trace + 1);
    return { w: s / 4, x: (y.z - z.y) / s, y: (z.x - x.z) / s, z: (x.y - y.x) / s };
  }
  if (x.x > y.y && x.x > z.z) {
    const s = 2 * Math.sqrt(1 + x.x - y.y - z.z);
    return { w: (y.z - z.y) / s, x: s / 4, y: (y.x + x.y) / s, z: (z.x + x.z) / s };
  }
  if (y.y > z.z) {
    const s = 2 * Math.sqrt(1 + y.y - x.x - z.z);
    return { w: (z.x - x.z) / s, x: (y.x + x.y) / s, y: s / 4, z: (z.y + y.z) / s };
  }
  const s = 2 * Math.sqrt(1 + z.z - x.x - y.y);
  return { w: (x.y - y.x) / s, x: (z.x + x.z) / s, y: (z.y + y.z) / s, z: s / 4 };
}

/** A rotation whose local +Z points along `dir` and whose +Y is as close to world up as it can be. */
export function uprightAlong(dir: Vec3): Quat {
  const z = normalize(dir);
  const x = normalize(cross({ x: 0, y: 1, z: 0 }, z));
  return quatFromBasis(x, cross(z, x), z);
}
