import { describe, expect, it } from 'vitest';
import { createAiDriver } from '../src/ai/driver';
import { TUNING } from '../src/config';
import { PHYSICS_STEP } from '../src/constants';
import { initPhysics } from '../src/physics';
import { Race } from '../src/race/race';
import { TEST_CIRCUIT } from '../src/track/circuits';
import { buildTrack } from '../src/track/track';
import { controls } from '../src/vehicle/car';
import { KESTREL } from '../src/vehicle/cars';
import { SALTMARSH } from '../src/track/circuits';
import { pitLane } from '../src/track/pitLane';

const track = buildTrack(TEST_CIRCUIT);

describe('race', () => {
  it('holds every car until the lights go out, the player revving or not', async () => {
    await initPhysics();
    const race = new Race(track, { opponents: 7, laps: 2, difficulty: 'hard', seed: 3 });
    const start = race.sim.cars.map((c) => ({ ...c.position }));
    const lit: number[] = [];
    while (race.phase === 'lights') {
      race.step(controls({ throttle: 1 }));
      if (lit[lit.length - 1] !== race.lights) lit.push(race.lights);
    }
    // The lights came on one by one, then went out together.
    expect(lit).toEqual([0, 1, 2, 3, 4, 5, 0]);
    const L = TUNING.race.lights;
    expect(race.startTime!).toBeGreaterThan(L.first + (L.count - 1) * L.interval + L.wait[0] - 0.01);
    expect(race.startTime!).toBeLessThan(L.first + (L.count - 1) * L.interval + L.wait[1] + 0.01);
    race.sim.cars.forEach((c, k) => expect(Math.hypot(c.position.x - start[k].x, c.position.z - start[k].z)).toBeLessThan(0.3));
    // Then they go.
    for (let k = 0; k < 3 * 120; k++) race.step(controls({ throttle: 1 }));
    race.sim.cars.forEach((c) => expect(c.speed).toBeGreaterThan(5));
  });

  it('puts the player mid-grid, and orders the field by progress', async () => {
    await initPhysics();
    const race = new Race(track, { opponents: 7, laps: 2, difficulty: 'medium', seed: 4 });
    const line = track.samples[0];
    const toLine = race.sim.cars.map((c) => Math.hypot(c.position.x - line.x, c.position.z - line.z));
    // Four cars ahead of the player on the grid, three behind.
    expect(toLine.filter((d) => d < toLine[0]).length).toBe(4);
    for (let k = 0; k < 20 * 120; k++) race.step(controls({ throttle: 0.6 }));
    const rows = race.standings();
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].progress).toBeLessThanOrEqual(rows[i - 1].progress);
      expect(rows[i].gap).toBeGreaterThanOrEqual(rows[i - 1].gap - 1e-9);
    }
  });

  it('counts laps from zero again after a restart', async () => {
    await initPhysics();
    const race = new Race(track, { opponents: 1, laps: 2, difficulty: 'medium', seed: 4 });
    // As if a lap had been done before Backspace.
    for (const t of race.sim.timers) t.laps = 1;
    race.restart();
    expect(race.sim.timers.map((t) => t.laps)).toEqual([0, 0]);
    expect(race.phase).toBe('lights');
  });

  it('runs a whole race: every car takes the flag, in order, nobody stuck', async () => {
    await initPhysics();
    const race = new Race(track, { opponents: 7, laps: 2, difficulty: 'hard', seed: 5 });
    // The "player" is an AI driver too.
    const me = createAiDriver(track, KESTREL, { pace: 0.92, braking: 2, precision: 0.2, mistakes: 0, aggression: 0.6 }, 77);
    for (let k = 0; k < 300 * 120 && race.phase !== 'finished'; k++) {
      race.traffic.advise(0, me, PHYSICS_STEP, race.sim.timer.laps < 1);
      race.step(race.phase === 'lights' ? controls({}) : me.drive(race.sim.car, PHYSICS_STEP));
    }
    expect(race.phase).toBe('finished');
    expect(race.finishTimes.every((t) => t !== null)).toBe(true);
    const rows = race.standings();
    expect(rows[0].laps).toBe(2);
    expect(rows[0].gap).toBe(0);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].finished).toBe(true);
      expect(rows[i].time!).toBeGreaterThan(rows[i - 1].time! - 1e-9);
    }
    // Two laps of the Proving Ground for a hard field: roughly two flying laps plus the start.
    expect(rows[0].time!).toBeGreaterThan(100);
    expect(rows[0].time!).toBeLessThan(125);
    expect(race.recoveries).toBe(0);
  }, 180_000);

  it('runs a long race on high wear: every car stops for tyres and finishes, nobody stuck in the lane', async () => {
    await initPhysics();
    const salt = buildTrack(SALTMARSH);
    const race = new Race(salt, { opponents: 3, laps: 10, difficulty: 'medium', seed: 9, wear: 'high' });
    const me = createAiDriver(salt, KESTREL, { pace: 0.94, braking: 1, precision: 0.1, mistakes: 0, aggression: 0.6 }, 78);
    const laps: number[][] = race.sim.cars.map(() => []);
    let mine = 0;
    for (let k = 0; k < 1200 * 120 && race.phase !== 'finished'; k++) {
      // The "player" answers the BOX call as the AI does, and is put back on the track as the AI is.
      if (race.boxCalls[0] && !me.pit) me.pit = { lane: pitLane(salt)!, state: race.sim.pits!.state[0], leaving: false };
      race.traffic.advise(0, me, PHYSICS_STEP, race.sim.timer.laps < 1);
      race.step(race.phase === 'lights' ? controls({}) : me.drive(race.sim.car, PHYSICS_STEP));
      if (me.stuck) {
        mine++;
        race.sim.recover();
        me.recovered();
      }
      race.sim.timers.forEach((t, c) => {
        if (t.laps > laps[c].length) laps[c].push(t.lastLap!);
      });
    }
    expect(race.phase).toBe('finished');
    expect(race.finishTimes.every((t) => t !== null)).toBe(true);
    const rows = race.standings();
    for (const r of rows) expect(r.stops).toBeGreaterThanOrEqual(1);
    // Ten laps on tyres going off: a spin or a car running wide into the end of the pit wall
    // can happen (and is put back); nobody is left stuck, in the lane or anywhere else.
    expect(race.recoveries + mine).toBeLessThanOrEqual(2);
    // What a stop costs: the lane crosses the line, so it is spread over two laps (in on one,
    // out on the next); against the car's typical lap. (The first lap is from the grid.)
    for (const times of laps.slice(1)) {
      const sorted = [...times.slice(1)].sort((a, b) => a - b);
      const typical = sorted[Math.floor(sorted.length / 2)];
      const cost = sorted[sorted.length - 1] + sorted[sorted.length - 2] - 2 * typical;
      expect(cost).toBeGreaterThan(18);
      expect(cost).toBeLessThan(45);
    }
  }, 600_000);
});
