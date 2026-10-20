import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { lightLevel, lightsOn, parseTimeOfDay, TIMES_OF_DAY } from '../src/track/timeOfDay';

describe('the time of day', () => {
  it('gives day full light, night none and dusk between, all session long', () => {
    expect(lightLevel('day', 100, 300)).toBe(1);
    expect(lightLevel('night', 0)).toBe(0);
    const dusk = lightLevel('dusk', 50, 300);
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
    expect(lightsOn(1)).toBe(false);
    expect(lightsOn(0)).toBe(true);
  });

  it('runs dusk into night over the race, then stays dark', () => {
    const length = 400;
    expect(lightLevel('duskToNight', 0, length)).toBeCloseTo(lightLevel('dusk'), 9);
    let last = Infinity;
    for (let t = 0; t <= length; t += 10) {
      const l = lightLevel('duskToNight', t, length);
      expect(l).toBeLessThanOrEqual(last);
      last = l;
    }
    expect(lightLevel('duskToNight', length * TUNING.night.fade, length)).toBeCloseTo(0, 9);
    expect(lightLevel('duskToNight', length * 2, length)).toBe(0);
    // With no length to go by (a time trial), it stays at dusk.
    expect(lightLevel('duskToNight', 1000)).toBeCloseTo(lightLevel('dusk'), 9);
    // The lamps come on on the way down.
    expect(lightsOn(lightLevel('duskToNight', 0, length))).toBe(true);
  });

  it('reads a time of day from a link, and nothing else', () => {
    for (const t of TIMES_OF_DAY) expect(parseTimeOfDay(t)).toBe(t);
    expect(parseTimeOfDay('noon')).toBeNull();
    expect(parseTimeOfDay(3)).toBeNull();
  });
});
