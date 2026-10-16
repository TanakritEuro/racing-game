import { describe, expect, it } from 'vitest';
import { SetupStore, type KeyValue } from '../src/storage/setups';

/** A storage in memory, as localStorage behaves. */
function memory(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('stored setups', () => {
  it('come back per car and circuit, in a new visit', () => {
    const storage = memory();
    new SetupStore(storage).save('saltmarsh', 'Kestrel', { gearing: 2, wingRear: -1 });
    const again = new SetupStore(storage);
    expect(again.load('saltmarsh', 'Kestrel')).toEqual({ gearing: 2, wingRear: -1 });
    expect(again.load('saltmarsh', 'Wren')).toEqual({});
    expect(again.load('ridgeback', 'Kestrel')).toEqual({});
  });

  it('forget a setup put back to as designed', () => {
    const storage = memory();
    const store = new SetupStore(storage);
    store.save('saltmarsh', 'Kestrel', { gearing: 2 });
    store.save('saltmarsh', 'Kestrel', { gearing: 0 });
    expect(JSON.parse(storage.data.get('racing.setups.v1')!)).toEqual({});
  });

  it('are cleaned when read, never trusted', () => {
    const storage = memory();
    storage.setItem('racing.setups.v1', JSON.stringify({ 'saltmarsh/Kestrel': { gearing: 40, turbo: 3, dampers: '2' }, junk: 'x' }));
    expect(new SetupStore(storage).load('saltmarsh', 'Kestrel')).toEqual({ gearing: 5 });
    storage.setItem('racing.setups.v1', '{not json');
    expect(new SetupStore(storage).load('saltmarsh', 'Kestrel')).toEqual({});
  });

  it('last for the visit where storage is missing or refuses', () => {
    const none = new SetupStore(null);
    none.save('saltmarsh', 'Kestrel', { diff: 3 });
    expect(none.load('saltmarsh', 'Kestrel')).toEqual({ diff: 3 });
    const refusing = new SetupStore({
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    });
    refusing.save('saltmarsh', 'Kestrel', { diff: -2 });
    expect(refusing.load('saltmarsh', 'Kestrel')).toEqual({ diff: -2 });
  });
});
