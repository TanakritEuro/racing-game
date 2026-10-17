// Custom circuits, kept in localStorage between visits (up to a limit). Everything read back
// goes through `cleanCustom`; where storage is missing or blocked, circuits last for the visit.

import { cleanCustom, customId, type CustomCircuit } from '../track/custom';
import type { KeyValue } from './setups';

const KEY = 'racing.circuits.v1';
/** The most circuits kept. */
export const MAX_CIRCUITS = 20;

export class CustomTrackStore {
  private circuits: CustomCircuit[] = [];

  constructor(private readonly storage: KeyValue | null = browserStorage()) {
    try {
      const raw: unknown = JSON.parse(storage?.getItem(KEY) ?? '[]');
      if (Array.isArray(raw)) for (const c of raw) {
        const clean = cleanCustom(c);
        if (clean) this.circuits.push(clean);
      }
    } catch {
      this.circuits = [];
    }
  }

  /** Every circuit kept, newest first. */
  list(): readonly CustomCircuit[] {
    return this.circuits;
  }

  /** The circuit with this id, or null. */
  get(id: string): CustomCircuit | null {
    return this.circuits.find((c) => customId(c) === id) ?? null;
  }

  /** Keep `circuit` (replacing `replaces`, the id it had before an edit); false if the store is full. */
  save(circuit: CustomCircuit, replaces: string | null = null): boolean {
    const id = customId(circuit);
    const others = this.circuits.filter((c) => customId(c) !== id && customId(c) !== replaces);
    if (others.length >= MAX_CIRCUITS) return false;
    this.circuits = [circuit, ...others];
    this.write();
    return true;
  }

  remove(id: string): void {
    this.circuits = this.circuits.filter((c) => customId(c) !== id);
    this.write();
  }

  private write(): void {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.circuits));
    } catch {
      // Kept for this visit only.
    }
  }
}

function browserStorage(): KeyValue | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
