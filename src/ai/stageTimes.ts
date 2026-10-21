// The rivals' times on a rally stage. A stage is run alone, so nobody else is on the road: each
// of the seven AI drivers' times comes from the speed profile they would drive (their pace and
// braking, the car's envelope, the road's grip and the weather), timed from the start to the
// flying finish, with a little slack for what a profile doesn't see (gear changes, the line not
// held exactly) and a seeded scatter of a run's luck. Pure.

import { TUNING } from '../config';
import { createRng } from '../math';
import type { Track } from '../track/track';
import type { Conditions } from '../track/weather';
import type { CarDef } from '../vehicle/carDef';
import { circuitAi } from './driver';
import { brakeEarlier, fieldSkills, type Difficulty } from './skill';
import { speedProfile } from './speedProfile';

export interface RivalTime {
  /** Which AI driver (index into the race's names). */
  driver: number;
  time: number;
}

/** Seconds from the start sample to sample `finish` at the speeds of `profile` along `line`. */
export function runTime(distance: Float32Array, profile: Float32Array, start: number, finish: number): number {
  let t = 0;
  for (let i = start; i < finish; i++) t += (2 * (distance[i + 1] - distance[i])) / Math.max(0.5, profile[i] + profile[i + 1]);
  return t;
}

/** Seven rivals' times on `track` in `def`, fastest first, drawn from `seed`. */
export function rivalTimes(track: Track, def: CarDef, difficulty: Difficulty, conditions: Conditions, seed: number, finish: number): RivalTime[] {
  const S = TUNING.stage.rivals;
  const rng = createRng(seed);
  const { line, env, grip } = circuitAi(track, def, conditions);
  const spacing = track.length / Math.max(1, track.samples.length - 1);
  const times = fieldSkills(difficulty, S.count, rng).map((skill, driver) => {
    const profile = brakeEarlier(speedProfile(line, env, { pace: skill.pace, grip }), skill.braking, spacing);
    const luck = 1 + S.scatter * (rng() * 2 - 1);
    return { driver, time: runTime(line.distance, profile, TUNING.stage.startSample, finish) * S.slack * luck };
  });
  return times.sort((a, b) => a.time - b.time);
}
