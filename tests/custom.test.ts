import { describe, expect, it } from 'vitest';
import { packCircuit, unpackCircuit, MAX_PACKED } from '../src/share';
import { CustomTrackStore, MAX_CIRCUITS } from '../src/storage/customTracks';
import type { KeyValue } from '../src/storage/setups';
import { HARROWMERE } from '../src/track/circuits';
import { cleanCustom, customDef, customId, fromBuiltIn, ovalTemplate } from '../src/track/custom';
import { pitLane } from '../src/track/pitLane';
import { buildTrack } from '../src/track/track';
import { validateTrack } from '../src/track/validate';

function memory(): KeyValue {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('a custom circuit', () => {
  it('becomes a full circuit: kerbs, gravel, a pit lane, the pits and a grandstand', () => {
    const def = customDef(fromBuiltIn(HARROWMERE));
    expect(def.kerbs!.length).toBeGreaterThan(8);
    expect(def.pitLane).toBeDefined();
    expect(def.scenery?.pits?.side).toBe('left');
    expect(def.scenery?.grandstands?.[0].side).toBe('right');
    const track = buildTrack(def);
    expect(pitLane(track)).not.toBeNull();
    expect(validateTrack(track)).toEqual([]);
  });

  it('has the same id for the same circuit, and another once changed', () => {
    const a = ovalTemplate();
    const b = ovalTemplate('Another name');
    expect(customId(a)).toBe(customId(b));
    b.points[2] = { ...b.points[2], y: 3 };
    expect(customId(b)).not.toBe(customId(a));
  });

  it('is cleaned when it comes from outside: brought within the limits, or refused', () => {
    const c = ovalTemplate();
    const dirty = { ...c, name: '  x'.padEnd(100, 'y'), width: 50, hills: -3, trees: 1e9, points: c.points.map((p, i) => (i === 3 ? { ...p, y: 500, bank: 2 } : p)) };
    const clean = cleanCustom(JSON.parse(JSON.stringify(dirty)))!;
    expect(clean.name.length).toBeLessThanOrEqual(40);
    expect(clean.width).toBe(16);
    expect(clean.hills).toBe(0);
    expect(clean.trees).toBe(3000);
    expect(clean.points[3].y).toBe(40);
    expect(clean.points[3].bank).toBeCloseTo((12 * Math.PI) / 180, 9);
    expect(cleanCustom(null)).toBeNull();
    expect(cleanCustom({ ...c, points: c.points.slice(0, 3) })).toBeNull();
    expect(cleanCustom({ ...c, points: [...c.points.slice(1), { x: 'a', z: 0 }] })).toBeNull();
    expect(cleanCustom({ ...c, version: 2 })).toBeNull();
  });
});

describe('a shared circuit', () => {
  it('survives a link both ways', () => {
    const c = cleanCustom(fromBuiltIn(HARROWMERE))!;
    const packed = packCircuit(c);
    expect(packed).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(packed.length).toBeLessThan(MAX_PACKED);
    const back = unpackCircuit(packed)!;
    expect(back.name).toBe(c.name);
    expect(back.points.length).toBe(c.points.length);
    back.points.forEach((p, i) => {
      expect(p.x).toBeCloseTo(c.points[i].x, 1);
      expect(p.z).toBeCloseTo(c.points[i].z, 1);
      expect(p.y ?? 0).toBeCloseTo(c.points[i].y ?? 0, 1);
      expect(p.bank ?? 0).toBeCloseTo(c.points[i].bank ?? 0, 2);
    });
    expect(validateTrack(buildTrack(customDef(back)))).toEqual([]);
  });

  it('refuses a link that is broken or too long', () => {
    expect(unpackCircuit('not a circuit!')).toBeNull();
    expect(unpackCircuit('e30')).toBeNull();
    expect(unpackCircuit('A'.repeat(MAX_PACKED + 1))).toBeNull();
    const packed = packCircuit(ovalTemplate());
    expect(unpackCircuit(packed.slice(0, packed.length - 6))).toBeNull();
  });
});

describe('stored custom circuits', () => {
  it('come back in a new visit, newest first, replaced when edited, and removed', () => {
    const storage = memory();
    const store = new CustomTrackStore(storage);
    const a = ovalTemplate('A');
    const b = fromBuiltIn(HARROWMERE);
    store.save(a);
    store.save(b);
    const again = new CustomTrackStore(storage);
    expect(again.list().map((c) => c.name)).toEqual([b.name, 'A']);
    const edited = { ...a, points: a.points.map((p, i) => (i === 1 ? { ...p, y: 2 } : p)) };
    again.save(edited, customId(a));
    expect(again.list().length).toBe(2);
    expect(again.get(customId(edited))).not.toBeNull();
    expect(again.get(customId(a))).toBeNull();
    again.remove(customId(b));
    expect(new CustomTrackStore(storage).list().map((c) => c.name)).toEqual(['A']);
  });

  it('keep at most twenty', () => {
    const store = new CustomTrackStore(null);
    for (let k = 0; k < MAX_CIRCUITS; k++) expect(store.save({ ...ovalTemplate(), trees: k })).toBe(true);
    // (Trees don't change a circuit's id: one id, replaced each time.)
    expect(store.list().length).toBe(1);
    for (let k = 0; k < MAX_CIRCUITS + 1; k++) store.save({ ...ovalTemplate(), hills: k });
    expect(store.list().length).toBe(MAX_CIRCUITS);
  });
});
