// Each car's setup on each circuit, kept in localStorage between visits, like a team's setup
// sheets. What comes back is cleaned (an older version's settings, a hand-edited value), never
// trusted. Where storage is missing or blocked (private windows), setups last for the visit.

import { cleanSetup, type Setup } from '../vehicle/setup';

const KEY = 'racing.setups.v1';

/** The part of `Storage` used (so tests can pass their own). */
export type KeyValue = Pick<Storage, 'getItem' | 'setItem'>;

export class SetupStore {
  private sheets: Record<string, Setup> = {};

  /** `storage`: the browser's localStorage by default; null keeps setups in memory only. */
  constructor(private readonly storage: KeyValue | null = browserStorage()) {
    try {
      const raw: unknown = JSON.parse(storage?.getItem(KEY) ?? '{}');
      if (typeof raw === 'object' && raw !== null) for (const [k, v] of Object.entries(raw)) this.sheets[k] = cleanSetup(v);
    } catch {
      this.sheets = {};
    }
  }

  /** The setup for `car` on `track` (none saved: the car as designed). */
  load(track: string, car: string): Setup {
    return { ...(this.sheets[sheetKey(track, car)] ?? {}) };
  }

  save(track: string, car: string, setup: Setup): void {
    const clean = cleanSetup(setup);
    const key = sheetKey(track, car);
    if (Object.keys(clean).length === 0) delete this.sheets[key];
    else this.sheets[key] = clean;
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.sheets));
    } catch {
      // Kept for this visit only.
    }
  }
}

function sheetKey(track: string, car: string): string {
  return `${track}/${car}`;
}

function browserStorage(): KeyValue | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
