// Race recordings: every car from the lights to the flag, drawn back where the simulation had
// it, with the standings and gaps at any moment, in a bounded amount of memory.

import { describe, expect, it } from 'vitest';
import { PHYSICS_STEP } from '../src/constants';
import { initPhysics } from '../src/physics';
import { Race } from '../src/race/race';
import { progressAt, RaceRecorder, sampleCar, sampleIndexAt, standingsAt, timeAtProgress } from '../src/race/raceRecording';
import { createRecordedState, FRAME_DT, FRAME_SIZE, RECORD_EVERY } from '../src/race/recording';
import { TEST_CIRCUIT } from '../src/track/circuits';
import { buildTrack } from '../src/track/track';
import { controls } from '../src/vehicle/car';
import { createAiDriver } from '../src/ai/driver';
import { KESTREL } from '../src/vehicle/cars';

describe('a race recorder', () => {
  it('keeps every fourth step for every car, growing as it goes, and starts again on reset', () => {
    const rec = new RaceRecorder('t', ['A', 'B', 'C'], 2);
    const states = [0, 1, 2].map(() => createRecordedState());
    for (let i = 0; i < 4 * 30 * 150; i++) {
      states.forEach((s, k) => (s.pose.position.x = i + k * 1000));
      rec.capture(states, [i / 1000, i / 2000, 0]);
    }
    const r = rec.recording();
    // 150 s at 30 Hz: past the first minute's room, so it grew.
    expect(r.count).toBe(30 * 150);
    expect(r.duration).toBeCloseTo((30 * 150 - 1) * FRAME_DT, 9);
    for (const f of r.frames) expect(f.length).toBe(r.count * FRAME_SIZE);
    const out = createRecordedState();
    sampleCar(r, 1, 10, out);
    expect(out.pose.position.x).toBeCloseTo(10 / PHYSICS_STEP + 1000, 3);
    expect(progressAt(r, 0, 10)).toBeCloseTo(10 / PHYSICS_STEP / 1000, 6);
    expect(timeAtProgress(r, 0, 1.2)).toBeCloseTo(1200 * PHYSICS_STEP, 4);
    expect(timeAtProgress(r, 2, 1)).toBeNull();
    // About 3 KB per car per second at most (frames and progress, room to grow included).
    const bytes = r.frames.reduce((b, f) => b + f.buffer.byteLength, 0) + r.progress.reduce((b, p) => b + p.buffer.byteLength, 0);
    expect(bytes / 3 / 150).toBeLessThan(2 * (FRAME_SIZE + 1) * 4 * 30 + 1);
    rec.reset();
    expect(rec.recording().count).toBe(0);
    expect(rec.recording().moments).toEqual([]);
  });
});

describe('a race recording', () => {
  it('has every car from the lights to the flag, where the simulation had it, and the standings at any moment', async () => {
    await initPhysics();
    const track = buildTrack(TEST_CIRCUIT);
    const race = new Race(track, { opponents: 3, laps: 2, difficulty: 'medium', seed: 8 });
    const me = createAiDriver(track, KESTREL, { pace: 0.92, braking: 1, precision: 0.1, mistakes: 0, aggression: 0.5 }, 11);
    const checks: { t: number; positions: { x: number; z: number }[] }[] = [];
    const standings: { t: number; order: number[] }[] = [];
    let steps = 0;
    for (let k = 0; k < 300 * 120 && race.phase !== 'finished'; k++) {
      race.traffic.advise(0, me, PHYSICS_STEP, race.sim.timer.laps < 1);
      race.step(race.phase === 'lights' ? controls({}) : me.drive(race.sim.car, PHYSICS_STEP));
      if (race.phase === 'lights') continue;
      // A recorded step every few seconds: where each car was, and the order.
      if (steps % (RECORD_EVERY * 30 * 7) === 0) {
        checks.push({ t: race.time!, positions: race.sim.cars.map((c) => ({ x: c.position.x, z: c.position.z })) });
        standings.push({ t: race.time!, order: race.standings().map((r) => r.car) });
      }
      steps++;
    }
    expect(race.phase).toBe('finished');
    const rec = race.recorder.recording();
    expect(rec.cars).toEqual(race.sim.cars.map((c) => c.def.name));
    expect(rec.trackId).toBe(TEST_CIRCUIT.id);
    // From the lights to the last car home.
    expect(rec.duration).toBeGreaterThan(Math.max(...race.finishTimes.map((t) => t!)) - 2 * FRAME_DT);
    // Drawn where the simulation had each car.
    const out = createRecordedState();
    for (const c of checks) {
      c.positions.forEach((p, car) => {
        sampleCar(rec, car, c.t, out);
        expect(Math.hypot(out.pose.position.x - p.x, out.pose.position.z - p.z)).toBeLessThan(0.05);
      });
    }
    // The places at each check, as the race had them, and the result at the end.
    for (const s of standings) expect(standingsAt(rec, s.t).map((r) => r.car)).toEqual(s.order);
    const end = standingsAt(rec, rec.duration);
    expect(end.map((r) => r.car)).toEqual(race.standings().map((r) => r.car));
    // Gaps at the flag as the race timed them (the recording's within a frame or two).
    race.standings().forEach((r, i) => expect(Math.abs(end[i].gap - r.gap)).toBeLessThan(0.1));
    // Where each car is on the track, from its progress.
    const n = track.samples.length;
    const i = sampleIndexAt(rec, 0, checks[2].t, n);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(n);
  }, 300_000);

  it('starts again when the race restarts', async () => {
    await initPhysics();
    const race = new Race(buildTrack(TEST_CIRCUIT), { opponents: 1, laps: 1, difficulty: 'easy', seed: 2 });
    for (let k = 0; k < 120 * 12; k++) race.step(controls({ throttle: 1 }));
    expect(race.recorder.recording().count).toBeGreaterThan(0);
    race.restart();
    expect(race.recorder.recording().count).toBe(0);
    expect(race.recorder.recording().moments).toEqual([]);
  });
});
