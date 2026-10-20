// The time of day a session is run at: day, dusk or night, or dusk running into night over a
// race. The physics doesn't change with it (the tyres don't know); the presentation draws the
// sky, the light and the lamps from the light level. Pure.

import { TUNING } from '../config';

export type TimeOfDay = 'day' | 'dusk' | 'night' | 'duskToNight';

export const TIMES_OF_DAY: readonly TimeOfDay[] = ['day', 'dusk', 'night', 'duskToNight'];

/** A time of day from a link or storage, or null if it isn't one. */
export function parseTimeOfDay(raw: unknown): TimeOfDay | null {
  return typeof raw === 'string' && (TIMES_OF_DAY as readonly string[]).includes(raw) ? (raw as TimeOfDay) : null;
}

/**
 * The light level (1 full day … 0 full night) at `t` seconds into a session that lasts about
 * `length` seconds: steady, or for dusk to night falling from dusk's level to night's.
 */
export function lightLevel(time: TimeOfDay, t = 0, length = 0): number {
  const L = TUNING.night.levels;
  if (time !== 'duskToNight') return L[time];
  const f = length > 0 ? Math.min(1, Math.max(0, t / (length * TUNING.night.fade))) : 0;
  return L.dusk + (L.night - L.dusk) * f;
}

/** Floodlights and headlights are on at this light level. */
export function lightsOn(level: number): boolean {
  return level < TUNING.night.lightsOn;
}
