import { describe, expect, it } from 'vitest';
import { FRAME_DT, type LapRecording } from '../src/race/recording';
import { TimeTrial } from '../src/race/session';
import { bestKey, memoryBestStore, openBestStore, type BestRecord } from '../src/storage/bests';
import { createSim } from './helpers';

function record(fingerprint: string, lapTime = 80): BestRecord {
  const lap: LapRecording = { version: 1, trackId: 'proving-ground', carName: 'Kestrel', fingerprint, lapTime, valid: true, sectors: [25, 25, lapTime - 50], frameDt: FRAME_DT, frames: new Float32Array(48) };
  return { key: bestKey('proving-ground', 'Kestrel'), fingerprint, lap, bestSectors: [24, 26, 29], timeAtSample: new Float32Array(10) };
}

describe('stored bests', () => {
  it('come back for the same layout only', async () => {
    const store = memoryBestStore();
    expect(await store.save(record('a'))).toBe(true);
    expect((await store.load(bestKey('proving-ground', 'Kestrel'), 'a'))!.lap.lapTime).toBe(80);
    expect(await store.load(bestKey('proving-ground', 'Kestrel'), 'b')).toBeNull();
    expect(await store.load(bestKey('harrowmere', 'Kestrel'), 'a')).toBeNull();
  });

  it('are kept apart per weather, dry under the key it always had', async () => {
    expect(bestKey('saltmarsh', 'Kestrel')).toBe('saltmarsh/Kestrel');
    expect(bestKey('saltmarsh', 'Kestrel', 'dry')).toBe('saltmarsh/Kestrel');
    const keys = new Set(['dry', 'damp', 'wet'].map((w) => bestKey('saltmarsh', 'Kestrel', w as 'dry' | 'damp' | 'wet')));
    expect(keys.size).toBe(3);
  });

  it('fall back to memory without IndexedDB', async () => {
    const store = await openBestStore();
    expect(store.persistent).toBe(false);
    await store.save(record('a'));
    expect(await store.load(bestKey('proving-ground', 'Kestrel'), 'a')).not.toBeNull();
  });

  it('bring back the ghost, the delta and the best sectors', async () => {
    const sim = await createSim();
    const session = new TimeTrial(sim);
    const stored = record(session.fingerprint);
    session.loadBest(stored.lap, new Float32Array(sim.track.samples.length), stored.bestSectors);
    expect(session.ghost).toBe(stored.lap);
    expect(sim.timer.bestLap).toBe(80);
    // Each sector's best is the better of the stored best and the best lap's own.
    expect(sim.timer.bestSectors).toEqual([24, 25, 29]);
    expect(session.bests()!.lap).toBe(stored.lap);
    // A delta profile for another number of samples is no use.
    const other = new TimeTrial(await createSim());
    other.loadBest(stored.lap, new Float32Array(10), stored.bestSectors);
    expect(other.ghost).toBeNull();
  });
});
