import { describe, expect, it } from 'vitest';
import { shouldStop, wearLoss } from '../src/ai/pitStrategy';

const base = { lapTime: 95, stopCost: 33 };

describe('the pit strategy', () => {
  it('counts the time worn tyres lose, more the more worn', () => {
    expect(wearLoss(0, 0, 5, 95)).toBe(0);
    expect(wearLoss(0.5, 0.1, 3, 95)).toBeGreaterThan(wearLoss(0.1, 0.1, 3, 95));
  });

  it('never stops on the last lap, or without wear', () => {
    expect(shouldStop({ ...base, wear: 0.79, perLap: 0.2, lapsLeft: 0 })).toBe(false);
    expect(shouldStop({ ...base, wear: 0.5, perLap: 0, lapsLeft: 5 })).toBe(false);
  });

  it('stops before the tyres go over the cliff', () => {
    expect(shouldStop({ ...base, wear: 0.6, perLap: 0.15, lapsLeft: 4 })).toBe(true);
  });

  it('waits for the best lap to stop on, not the first that would pay', () => {
    // Early in a long race on high wear: one stop, but not yet.
    expect(shouldStop({ ...base, wear: 0.15, perLap: 0.15, lapsLeft: 8 })).toBe(false);
    // Fresh enough to finish: no stop at all.
    expect(shouldStop({ ...base, wear: 0.3, perLap: 0.1, lapsLeft: 3 })).toBe(false);
  });
});
