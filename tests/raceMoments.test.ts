// The race's moments: each kind from a scripted race (a stand-in with only what the watcher
// reads), and passes from a real one.

import { describe, expect, it } from 'vitest';
import { createAiDriver } from '../src/ai/driver';
import { TUNING } from '../src/config';
import { PHYSICS_STEP } from '../src/constants';
import { initPhysics } from '../src/physics';
import { Race } from '../src/race/race';
import { MomentWatcher, type WatchedRace } from '../src/race/raceMoments';
import { RaceRecorder, type RaceMoment } from '../src/race/raceRecording';
import type { Simulation } from '../src/sim';
import { TEST_CIRCUIT } from '../src/track/circuits';
import { buildTrack } from '../src/track/track';
import { controls } from '../src/vehicle/car';
import { KESTREL } from '../src/vehicle/cars';

/** A race of `n` cars on a straight: positions along x, progress by hand. */
function scripted(n: number, laps = 3) {
  const cars = Array.from({ length: n }, (_, k) => ({
    position: { x: -10 * k, y: 0, z: 0 },
    bodySlipAngle: 0,
    velocity: { x: 30, y: 0, z: 0 },
    body: { linvel: () => cars[k].velocity },
  }));
  const timers = cars.map(() => ({ laps: 0, lastLap: null as number | null }));
  const pits = { state: cars.map(() => ({ servicing: null as number | null, inLane: false })) };
  const contacts: { car: number; impulse: number }[] = [];
  const progress = cars.map((_, k) => -0.01 * k);
  const race = {
    sim: { cars, timers, pits, contacts } as unknown as Simulation,
    finishTimes: cars.map(() => null as number | null),
    time: 0 as number | null,
    laps,
    progressOf: (k: number) => progress[k],
  } satisfies WatchedRace;
  const recorder = new RaceRecorder('test', cars.map(() => 'Kestrel'), laps);
  const watcher = new MomentWatcher(recorder, n);
  const moments = (kind?: RaceMoment['kind']) => recorder.recording().moments.filter((m) => !kind || m.kind === kind);
  /** Advance `seconds` at 30 Hz (places looked at every call), `each` changing the race first. */
  const run = (seconds: number, each?: (t: number) => void) => {
    for (let i = 0; i < Math.round(seconds * 30); i++) {
      race.time! += 1 / 30;
      each?.(race.time!);
      watcher.afterStep(race, true);
    }
  };
  return { cars, timers, pits, contacts, progress, race, moments, run };
}

describe('the moments of a race', () => {
  it('starts once, and calls the last lap once', () => {
    const r = scripted(2, 3);
    r.run(1);
    expect(r.moments('start')).toHaveLength(1);
    expect(r.moments('start')[0].time).toBeCloseTo(1 / 30, 9);
    r.timers[1].laps = 2;
    r.run(1);
    r.timers[0].laps = 2;
    r.run(1);
    expect(r.moments('lastLap')).toHaveLength(1);
    expect(r.moments('lastLap')[0].lap).toBe(3);
  });

  it('counts a pass once it holds, from when it began, and not a swap that comes straight back', () => {
    const r = scripted(3);
    r.run(0.5);
    // Car 2 draws alongside car 1 and pulls ahead briefly, then falls back: no pass.
    r.progress[2] = -0.005;
    r.run(0.5);
    r.progress[2] = -0.03;
    r.run(1);
    expect(r.moments('pass')).toHaveLength(0);
    // Now it gets by car 1 and car 0 and stays there.
    r.progress[2] = 0.01;
    const from = r.race.time!;
    r.run(2);
    const passes = r.moments('pass');
    expect(passes.map((m) => m.cars)).toEqual([
      [2, 0],
      [2, 1],
    ]);
    expect(passes[0].time).toBeCloseTo(from + 1 / 30, 6);
  });

  it('leaves out places changed by a car in the pit lane', () => {
    const r = scripted(2);
    r.run(0.5);
    r.pits.state[0].inLane = true;
    r.progress[1] = 0.01;
    r.run(2);
    expect(r.moments('pass')).toHaveLength(0);
  });

  it('notices a stop as the crew starts, a car put back, a spin and a hard contact, each once', () => {
    const r = scripted(3);
    r.run(0.5);
    r.pits.state[1].servicing = TUNING.pits.service;
    r.run(1);
    expect(r.moments('stop').map((m) => m.cars)).toEqual([[1]]);
    r.cars[2].position.x += 40;
    r.run(0.1);
    expect(r.moments('recovered').map((m) => m.cars)).toEqual([[2]]);
    r.cars[0].bodySlipAngle = 2;
    r.run(1);
    expect(r.moments('spin').map((m) => m.cars)).toEqual([[0]]);
    // A slow slide doesn't count.
    r.cars[1].bodySlipAngle = 2;
    r.cars[1].velocity = { x: 3, y: 0, z: 0 };
    r.run(1);
    expect(r.moments('spin')).toHaveLength(1);
    // Hard contacts, but not a light touch, and one per car while they keep coming.
    r.run(0.1, () => r.contacts.splice(0, r.contacts.length, { car: 1, impulse: TUNING.replay.moments.contact.impulse * 2 }, { car: 2, impulse: 10 }));
    r.contacts.length = 0;
    expect(r.moments('contact').map((m) => m.cars)).toEqual([[1]]);
  });

  it('gives fastest laps (not the standing first lap) and the finishes in order', () => {
    const r = scripted(2, 2);
    r.run(0.5);
    r.timers[0].laps = 1;
    r.timers[0].lastLap = 50;
    r.run(0.1);
    expect(r.moments('fastestLap')).toHaveLength(0);
    r.timers[1].laps = 2;
    r.timers[1].lastLap = 48;
    r.race.finishTimes[1] = r.race.time;
    r.run(0.1);
    r.timers[0].laps = 2;
    r.timers[0].lastLap = 49;
    r.race.finishTimes[0] = r.race.time;
    r.run(0.1);
    expect(r.moments('fastestLap').map((m) => [m.cars[0], m.value])).toEqual([[1, 48]]);
    expect(r.moments('finish').map((m) => [m.cars[0], m.value])).toEqual([
      [1, 1],
      [0, 2],
    ]);
  });
});

describe('the moments of a real race', () => {
  it('records a faster car coming through from behind as passes on the cars it gets by', async () => {
    await initPhysics();
    const track = buildTrack(TEST_CIRCUIT);
    // You on pole, driven gently; a hard field behind.
    const race = new Race(track, { opponents: 2, laps: 2, difficulty: 'hard', seed: 5, playerSlot: 0 });
    const me = createAiDriver(track, KESTREL, { pace: 0.6, braking: 0.8, precision: 0.2, mistakes: 0, aggression: 0.2 }, 3);
    for (let k = 0; k < 300 * 120 && race.phase !== 'finished'; k++) {
      race.traffic.advise(0, me, PHYSICS_STEP, race.sim.timer.laps < 1);
      race.step(race.phase === 'lights' ? controls({}) : me.drive(race.sim.car, PHYSICS_STEP));
    }
    const moments = race.recorder.recording().moments;
    const passesOnMe = moments.filter((m) => m.kind === 'pass' && m.cars[1] === 0);
    expect(passesOnMe.length).toBeGreaterThanOrEqual(2);
    // Whoever got by is ahead at the flag.
    const order = race.standings().map((r) => r.car);
    for (const m of passesOnMe) expect(order.indexOf(m.cars[0])).toBeLessThan(order.indexOf(0));
    // Every car's finish, in the order of the result.
    expect(moments.filter((m) => m.kind === 'finish').map((m) => m.cars[0])).toEqual(order);
  }, 300_000);
});
