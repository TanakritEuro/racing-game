// Each circuit and car's best lap, kept between visits in IndexedDB: the recording (the ghost),
// the best of each sector and the best lap's time at every track sample (the live delta).
// Records from a different layout (another fingerprint) are dropped when read. Where
// IndexedDB is missing or refuses (some private windows), bests live in memory for the visit.

import { decodeRecording, encodeRecording, type LapRecording } from '../race/recording';
import type { Sectors } from '../race/timing';

export interface BestRecord {
  /** `${trackId}/${carName}` */
  key: string;
  fingerprint: string;
  lap: LapRecording;
  /** Best of each sector over all valid laps, not necessarily one lap's. */
  bestSectors: Sectors;
  /** The best lap's elapsed time at each track sample. */
  timeAtSample: Float32Array;
}

/** As stored: the recording as bytes, so its own version check applies when read back. */
interface StoredBest {
  key: string;
  fingerprint: string;
  lap: ArrayBuffer;
  bestSectors: Sectors;
  timeAtSample: Float32Array;
}

export function bestKey(trackId: string, carName: string): string {
  return `${trackId}/${carName}`;
}

export interface BestStore {
  /** False when bests only last until the page is closed. */
  readonly persistent: boolean;
  /** The best for `key` on the layout `fingerprint`, or null (a record for another layout is deleted). */
  load(key: string, fingerprint: string): Promise<BestRecord | null>;
  /** Keep `record`; resolves false if it couldn't be written (then it is kept in memory). */
  save(record: BestRecord): Promise<boolean>;
}

const DB_NAME = 'racing';
const STORE = 'bests';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

class MemoryStore implements BestStore {
  readonly persistent: boolean = false;
  private readonly records = new Map<string, BestRecord>();

  async load(key: string, fingerprint: string): Promise<BestRecord | null> {
    const r = this.records.get(key);
    return r && r.fingerprint === fingerprint ? r : null;
  }

  async save(record: BestRecord): Promise<boolean> {
    this.records.set(record.key, record);
    return true;
  }
}

class IndexedDbStore implements BestStore {
  persistent = true;
  private readonly fallback = new MemoryStore();

  constructor(private readonly db: IDBDatabase) {}

  async load(key: string, fingerprint: string): Promise<BestRecord | null> {
    const kept = await this.fallback.load(key, fingerprint);
    if (kept) return kept;
    try {
      const stored = (await request(this.db.transaction(STORE).objectStore(STORE).get(key))) as StoredBest | undefined;
      if (!stored) return null;
      const lap = decodeRecording(stored.lap);
      if (stored.fingerprint !== fingerprint || !lap || lap.fingerprint !== fingerprint) {
        await request(this.db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key));
        return null;
      }
      return { key, fingerprint, lap, bestSectors: stored.bestSectors, timeAtSample: stored.timeAtSample };
    } catch {
      return null;
    }
  }

  async save(record: BestRecord): Promise<boolean> {
    const stored: StoredBest = {
      key: record.key,
      fingerprint: record.fingerprint,
      lap: encodeRecording(record.lap),
      bestSectors: [...record.bestSectors],
      timeAtSample: record.timeAtSample.slice(),
    };
    try {
      const tx = this.db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(stored);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
      return true;
    } catch {
      this.persistent = false;
      await this.fallback.save(record);
      return false;
    }
  }
}

/** The browser's store of bests, or one in memory if IndexedDB can't be opened. */
export async function openBestStore(): Promise<BestStore> {
  try {
    if (typeof indexedDB === 'undefined') return new MemoryStore();
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: 'key' });
    return new IndexedDbStore(await request(open));
  } catch {
    return new MemoryStore();
  }
}

/** A store that only lasts as long as the page (tests, and the fallback). */
export function memoryBestStore(): BestStore {
  return new MemoryStore();
}
