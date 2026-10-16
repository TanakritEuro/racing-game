// A whole short season, headless: an AI drives your car, one lap a round.

import { describe, expect, it } from 'vitest';
import { createAiDriver } from '../src/ai/driver';
import { PHYSICS_STEP } from '../src/constants';
import { finishingOrder, gridSlots, newSeason, recordRound, roundRace, seasonOver, standings } from '../src/race/championship';
import { initPhysics } from '../src/physics';
import { Race } from '../src/race/race';
import { CIRCUITS } from '../src/track/circuits';
import { buildTrack } from '../src/track/track';
import { controls } from '../src/vehicle/car';
import { KESTREL } from '../src/vehicle/cars';

describe('a season', () => {
  it('builds each round from the season: the field’s skills and the grid', async () => {
    await initPhysics();
    let season = newSeason(11, 'hard', 'Kestrel');
    season = recordRound(season, [5, 0, 1, 2, 3, 4, 6, 7]);
    const { track, options } = roundRace(season);
    expect(track).toBe('saltmarsh');
    const race = new Race(buildTrack(CIRCUITS.find((c) => c.id === track)!), options, KESTREL);
    expect(race.skills).toEqual(season.skills);
    // The leader of round 1 (entry 5) starts last: furthest from the line.
    const line = race.track.samples[0];
    const far = (k: number) => Math.hypot(race.sim.cars[k].position.x - line.x, race.sim.cars[k].position.z - line.z);
    const distances = race.sim.cars.map((_, k) => far(k));
    expect(Math.max(...distances)).toBe(far(5));
    expect(gridSlots(season)[5]).toBe(7);
  });

  it('runs four rounds with every car classified, 39 points a round', async () => {
    await initPhysics();
    let season = newSeason(3, 'hard', 'Kestrel');
    const me = { pace: 0.93, braking: 2, precision: 0.2, mistakes: 0, aggression: 0.6 };
    while (!seasonOver(season)) {
      const { track: id, options } = roundRace(season);
      const track = buildTrack(CIRCUITS.find((c) => c.id === id)!);
      const race = new Race(track, { ...options, laps: 1 }, KESTREL);
      const driver = createAiDriver(track, KESTREL, me, 1);
      for (let k = 0; k < 400 * 120 && race.phase !== 'finished'; k++) {
        race.traffic.advise(0, driver, PHYSICS_STEP, race.sim.timer.laps < 1);
        race.step(race.phase === 'lights' ? controls({}) : driver.drive(race.sim.car, PHYSICS_STEP));
      }
      expect(race.phase).toBe('finished');
      const order = finishingOrder(race.standings());
      expect(new Set(order).size).toBe(8);
      season = recordRound(season, order);
    }
    const rows = standings(season);
    expect(rows.reduce((sum, r) => sum + r.points, 0)).toBe(4 * 39);
    expect(rows.every((r) => r.finishes.length === 4)).toBe(true);
    expect(rows[0].points).toBeGreaterThanOrEqual(rows[1].points);
  }, 300_000);
});
