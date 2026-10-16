import { describe, expect, it } from 'vitest';
import { ClockSync } from '../src/online/clock';
import { loopback } from '../src/online/loopback';
import { parseMessage, PROTOCOL, type Message } from '../src/online/protocol';

describe('protocol', () => {
  it('passes every message type through a structured clone unchanged', () => {
    const all: Message[] = [
      { type: 'hello', version: PROTOCOL, car: 'Kestrel' },
      { type: 'welcome', track: 'saltmarsh', laps: 3, car: 'Wren', opponents: 3 },
      { type: 'reject', reason: 'full' },
      { type: 'ready' },
      { type: 'ping', t: 1.5 },
      { type: 'pong', t: 1.5, at: 7.25 },
      { type: 'lights', outAt: 12.5, wait: 1.2 },
      { type: 'state', car: 0, data: new Float32Array([1, 2, 3]).buffer },
      { type: 'finish', car: 0, time: 95.5, best: 30.1 },
      { type: 'finish', car: 4, time: 95.5, best: null },
      { type: 'rematch' },
      { type: 'bye', reason: 'left' },
    ];
    for (const m of all) expect(parseMessage(structuredClone(m))).toEqual(m);
  });

  it('refuses what it does not understand', () => {
    const bad: unknown[] = [
      null,
      'hello',
      { type: 'nonsense' },
      { type: 'hello', version: '1', car: 'Kestrel' },
      { type: 'welcome', track: 'saltmarsh', laps: 0, car: 'Wren', opponents: 0 },
      { type: 'welcome', track: 'saltmarsh', laps: 2.5, car: 'Wren', opponents: 0 },
      { type: 'welcome', track: 'saltmarsh', laps: 2, car: 'Wren', opponents: 8 },
      { type: 'welcome', track: 'saltmarsh', laps: 2, car: 'Wren' },
      { type: 'ping', t: Number.NaN },
      { type: 'lights', outAt: Infinity, wait: 1 },
      { type: 'lights', outAt: 3, wait: -1 },
      { type: 'state', car: 0, data: [1, 2, 3] },
      { type: 'state', car: 99, data: new ArrayBuffer(8) },
      { type: 'finish', car: 0, time: 90, best: 'fast' },
      { type: 'finish', time: 90, best: null },
      { type: 'bye', reason: 'x'.repeat(1000) },
    ];
    for (const b of bad) expect(parseMessage(b)).toBeNull();
  });
});

describe('loopback', () => {
  it('delivers after its delay, the reliable channel in order', () => {
    const { a, b, advance } = loopback({ delay: 0.05, jitter: 0.03, seed: 2 });
    const got: number[] = [];
    b.onMessage = (m) => got.push((m as { n: number }).n);
    for (let n = 0; n < 20; n++) a.send({ n });
    expect(advance(0.01)).toBe(0);
    advance(1);
    expect(got).toEqual(Array.from({ length: 20 }, (_, n) => n));
  });

  it('tells the other end when one hangs up', () => {
    const { a, b, advance } = loopback({ delay: 0.02 });
    let reason = '';
    b.onClose = (r) => (reason = r);
    a.close();
    advance(1);
    expect(reason).not.toBe('');
  });
});

describe('clock sync', () => {
  it('finds the other clock within 5 ms over a jittery line', () => {
    // The host's clock runs 3.7 s ahead of the guest's.
    const ahead = 3.7;
    const { a: guest, b: host, advance } = loopback({ delay: 0.04, jitter: 0.015, seed: 7 });
    const sync = new ClockSync();
    let now = 0;
    host.onMessage = (raw) => {
      const m = parseMessage(raw);
      if (m?.type === 'ping') host.send({ type: 'pong', t: m.t, at: now + ahead });
    };
    guest.onMessage = (raw) => {
      const m = parseMessage(raw);
      if (m?.type === 'pong') sync.add(m.t, m.at, now);
    };
    for (let k = 0; k < 20; k++) {
      guest.send({ type: 'ping', t: now });
      for (let s = 0; s < 25; s++) {
        now += 0.01;
        advance(now);
      }
    }
    expect(sync.samples.length).toBe(20);
    expect(Math.abs(sync.offset - ahead)).toBeLessThan(0.005);
    expect(sync.toLocal(sync.toHost(12))).toBeCloseTo(12, 9);
  });
});
