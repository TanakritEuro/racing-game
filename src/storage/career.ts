// The career in progress, kept in localStorage between visits. Storage can be missing or
// blocked (private windows): then there is simply no saved career.

import { parseCareer, type Career } from '../race/career';

const KEY = 'racing.career.v1';

/** The saved career, or null if there is none (or it can't be read). */
export function loadCareer(): Career | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseCareer(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveCareer(career: Career): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(career));
  } catch {
    // Not kept this time.
  }
}
