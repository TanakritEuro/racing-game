import { describe, expect, it } from 'vitest';
import { carEnvelope, gripAt } from '../src/ai/envelope';
import { racingLine } from '../src/ai/racingLine';
import { corneringLimit, profileLapTime, speedProfile } from '../src/ai/speedProfile';
import { GRAVITY } from '../src/constants';
import { CIRCUITS } from '../src/track/circuits';
import { buildTrack } from '../src/track/track';
import { KESTREL } from '../src/vehicle/cars';
import { BANKED_SKIDPAD, SKIDPAD } from './tracks';

const G = -GRAVITY;
const env = carEnvelope(KESTREL);
const HALF_WIDTH = KESTREL.halfExtents.x;

describe('car envelope', () => {
  it('matches what the car does', () => {
    // ~0.98 g on the skidpad and ~1 g braking with ABS (Milestone 2 measurements).
    expect(env.lateralMu).toBeGreaterThan(0.93);
    expect(env.lateralMu).toBeLessThan(1.03);
    // ~150 kW: at 40 m/s the drive force is about power / speed (less the gearbox's losses).
    expect(env.driveForce(40) * 40).toBeGreaterThan(110_000);
    expect(env.driveForce(40) * 40).toBeLessThan(150_000);
    // Downforce is small: a few percent of the weight at 200 km/h.
    expect(env.downforce * 55.6 ** 2).toBeGreaterThan(0.02 * G);
    expect(env.downforce * 55.6 ** 2).toBeLessThan(0.1 * G);
  });
});

describe('speed profile', () => {
  it('takes the skidpad at the envelope’s lateral grip', () => {
    const line = racingLine(buildTrack(SKIDPAD), HALF_WIDTH);
    const v = speedProfile(line, env);
    const i = 100;
    const lateral = v[i] ** 2 * Math.abs(line.curvature[i]);
    expect(lateral / gripAt(env, env.lateralMu, v[i])).toBeCloseTo(1, 2);
    expect(lateral / G).toBeGreaterThan(0.9);
    expect(lateral / G).toBeLessThan(1.1);
  });

  it('goes faster round a banked skidpad', () => {
    const flat = racingLine(buildTrack(SKIDPAD), HALF_WIDTH);
    const banked = racingLine(buildTrack(BANKED_SKIDPAD), HALF_WIDTH);
    expect(speedProfile(banked, env)[100]).toBeGreaterThan(1.1 * speedProfile(flat, env)[100]);
  });

  it('is slower at a lower pace', () => {
    const line = racingLine(buildTrack(CIRCUITS[1]), HALF_WIDTH);
    expect(profileLapTime(line, speedProfile(line, env, { pace: 0.9 }))).toBeGreaterThan(profileLapTime(line, speedProfile(line, env)) * 1.03);
  });

  describe.each(CIRCUITS.map((c) => [c.name, c] as const))('at %s', (_, def) => {
    const line = racingLine(buildTrack(def), HALF_WIDTH);
    const v = speedProfile(line, env);
    const n = v.length;
    const step = (i: number) => (line.distance[(i + 1) % n] - line.distance[i] + line.length) % line.length;

    it('never corners, accelerates or brakes harder than the envelope allows', () => {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        expect(v[i]).toBeLessThanOrEqual(corneringLimit(line, env, i, env.lateralMu) + 1e-3);
        const a = (v[j] ** 2 - v[i] ** 2) / (2 * step(i));
        const grip = gripAt(env, env.brakingMu, Math.max(v[i], v[j]), G + Math.max(v[i], v[j]) ** 2 * Math.max(0, line.vertical[i]));
        expect(a).toBeLessThan(env.driveForce(v[i]) / env.mass + G * Math.max(0, -line.grade[i]) + 0.05);
        expect(-a).toBeLessThan(grip + env.drag * v[i] ** 2 + G * (env.rolling + Math.abs(line.grade[i])) + 0.05);
      }
    });

    it('brakes exactly down to the cornering limit', () => {
      let minima = 0;
      for (let i = 0; i < n; i++) {
        const prev = v[(i - 1 + n) % n];
        const next = v[(i + 1) % n];
        // A slowest point reached by braking in the 60 m before it (not where a climb alone
        // slows the car). Trail braking fades out towards the apex, so look back a way.
        let braked = false;
        for (let k = 1; k <= 30; k++) {
          const h = (i - k + n) % n;
          const decel = (v[h] ** 2 - v[(h + 1) % n] ** 2) / (2 * step(h));
          braked ||= decel > env.drag * v[h] ** 2 + G * (env.rolling + Math.max(0, line.grade[h])) + 2;
        }
        if (v[i] < prev && v[i] <= next && braked) {
          minima++;
          expect(v[i] / corneringLimit(line, env, i, env.lateralMu)).toBeGreaterThan(0.98);
        }
      }
      expect(minima).toBeGreaterThan(2);
    });
  });
});
