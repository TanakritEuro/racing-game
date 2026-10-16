// The championship in progress, kept in localStorage between visits. Storage can be missing
// or blocked (private windows): then there is simply no saved season.

import { parseSeason, type Season } from '../race/championship';

const KEY = 'racing.season.v1';

/** The saved season, or null if there is none (or it can't be read). */
export function loadSeason(): Season | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseSeason(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveSeason(season: Season): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(season));
  } catch {
    // Not kept this time.
  }
}

export function clearSeason(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
