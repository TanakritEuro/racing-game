// How good an AI driver is. A difficulty sets a range for each skill; a field of drivers is
// spread across those ranges (seeded), so it isn't a train of identical cars. There is no
// rubber-banding: a driver's skill never changes with where the player is. Pure simulation.

import { TUNING } from '../config';
import type { Rng } from '../math';

export interface Skill {
  /** Fraction of the car's grip the speed profile uses. */
  pace: number;
  /** Extra metres before each braking point. */
  braking: number;
  /** How far it wanders off the line (m, standard deviation). */
  precision: number;
  /** Chance of a mistake at each corner. */
  mistakes: number;
  /** 0–1: how small a gap it will go for. */
  aggression: number;
}

export type Difficulty = keyof typeof TUNING.ai.difficulty;
export const DIFFICULTIES = Object.keys(TUNING.ai.difficulty) as Difficulty[];

/** A flawless driver at the car's limit: the tests' reference. */
export const PERFECT: Readonly<Skill> = { pace: 1, braking: 0, precision: 0, mistakes: 0, aggression: 0.8 };

/**
 * Skills for `count` drivers at `difficulty`: driver k is (k + ½)/count of the way from the
 * bottom of every range to the top (plus a little seeded jitter), and the order is shuffled.
 * So the field always spans the whole range.
 */
export function fieldSkills(difficulty: Difficulty, count: number, rng: Rng): Skill[] {
  const D = TUNING.ai.difficulty[difficulty];
  const at = ([lo, hi]: readonly number[], f: number) => lo + (hi - lo) * f;
  const skills: Skill[] = [];
  for (let k = 0; k < count; k++) {
    // How good this driver is overall (0 worst, 1 best), jittered a little within its slot.
    const f = Math.min(1, Math.max(0, (k + 0.5 + (rng() - 0.5) * 0.5) / count));
    skills.push({
      pace: at(D.pace, f),
      braking: at(D.braking, 1 - f),
      precision: at(D.precision, 1 - f),
      mistakes: at(D.mistakes, 1 - f),
      aggression: at(D.aggression, rng()),
    });
  }
  for (let k = skills.length - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1));
    [skills[k], skills[j]] = [skills[j], skills[k]];
  }
  return skills;
}

/** `profile` braking `margin` metres earlier: each sample takes the slowest speed in the next `margin` m. */
export function brakeEarlier(profile: Float32Array, margin: number, spacing: number): Float32Array {
  const n = profile.length;
  const reach = Math.round(margin / spacing);
  if (reach < 1) return profile;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = profile[i];
    for (let k = 1; k <= reach; k++) v = Math.min(v, profile[(i + k) % n]);
    out[i] = v;
  }
  return out;
}

/** A standard normal number from `rng` (Box–Muller). */
export function gaussian(rng: Rng): number {
  const u = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}
