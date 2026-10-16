import { describe, expect, it } from 'vitest';
import { distanceGain, engineVoice, impact, rumble, squeal, wind } from '../src/audio/mix';
import { HARRIER, KESTREL } from '../src/vehicle/cars';

const E = KESTREL.engine;

describe('the sound mix', () => {
  it('fires a four at RPM ÷ 30 and a six at RPM ÷ 20', () => {
    expect(engineVoice(E, 6000, 1).fundamental).toBeCloseTo(200, 6);
    expect(engineVoice(HARRIER.engine, 6000, 1).fundamental).toBeCloseTo(300, 6);
  });

  it('makes the engine louder and brighter with throttle and revs', () => {
    const shut = engineVoice(E, 3000, 0);
    const open = engineVoice(E, 3000, 1);
    expect(open.gain).toBeGreaterThan(shut.gain * 1.5);
    expect(open.brightness).toBeGreaterThan(shut.brightness * 2);
    expect(engineVoice(E, 7000, 1).gain).toBeGreaterThan(open.gain);
  });

  it('stutters only at the limiter with the throttle down', () => {
    expect(engineVoice(E, E.limiterRpm - 50, 1).limiter).toBe(true);
    expect(engineVoice(E, E.limiterRpm - 50, 0.2).limiter).toBe(false);
    expect(engineVoice(E, E.limiterRpm - 1000, 1).limiter).toBe(false);
  });

  it('squeals only when sliding, louder and higher the more', () => {
    expect(squeal(0, 30).gain).toBe(0);
    expect(squeal(0.5, 30).gain).toBeGreaterThan(squeal(0.2, 30).gain);
    expect(squeal(0.5, 30).pitch).toBeGreaterThan(squeal(0.1, 30).pitch);
    // Nor at a crawl.
    expect(squeal(1, 1).gain).toBeLessThan(squeal(1, 30).gain / 5);
  });

  it('raises the wind with speed squared', () => {
    expect(wind(0).gain).toBe(0);
    expect(wind(40).gain / wind(20).gain).toBeCloseTo(4, 6);
    expect(wind(200).gain).toBe(wind(100).gain);
  });

  it('rumbles over kerbs at the ridges’ rate', () => {
    expect(rumble(0, 30).gain).toBe(0);
    expect(rumble(2, 30).gain).toBeGreaterThan(rumble(1, 30).gain);
    expect(rumble(2, 30).frequency).toBeCloseTo(30, 6);
  });

  it('makes a crash louder than a touch, and far cars quieter', () => {
    expect(impact(6000)).toBeGreaterThan(impact(200) * 3);
    expect(impact(1e6)).toBe(impact(6000));
    expect(distanceGain(5)).toBe(1);
    expect(distanceGain(100)).toBeLessThan(0.05);
  });
});
