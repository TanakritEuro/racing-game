import { describe, expect, it } from 'vitest';
import { GRAVITY } from '../src/constants';
import { initPhysics } from '../src/physics';
import { Simulation } from '../src/sim';
import { CIRCUITS, TEST_CIRCUIT } from '../src/track/circuits';
import { buildTrack } from '../src/track/track';
import { controls, NO_CONTROLS, type Controls } from '../src/vehicle/car';

const track = buildTrack(TEST_CIRCUIT);

async function field(cars: number): Promise<Simulation> {
  await initPhysics();
  return new Simulation(track, undefined, { cars });
}

const idle = (sim: Simulation): Controls[] => sim.cars.map(() => NO_CONTROLS);

describe('several cars', () => {
  it('stand on a staggered grid behind the line, apart, and settle to their weight', async () => {
    const sim = await field(9);
    const positions = sim.cars.map((c) => ({ ...c.position }));
    for (let i = 0; i < 9; i++) {
      for (let j = i + 1; j < 9; j++) {
        expect(Math.hypot(positions[i].x - positions[j].x, positions[i].z - positions[j].z)).toBeGreaterThan(3.5);
      }
    }
    for (let k = 0; k < 2 * 120; k++) sim.step(idle(sim));
    for (const car of sim.cars) {
      const load = car.wheels.reduce((sum, w) => sum + w.load, 0);
      expect(load / (car.def.mass * -GRAVITY)).toBeCloseTo(1, 1);
      expect(car.body.linvel().x ** 2 + car.body.linvel().z ** 2).toBeLessThan(0.01);
    }
    // Every car is on its out lap, behind the line.
    for (const t of sim.timers) expect(t.current(sim.time)).toBeNull();
  });

  it('a lone car keeps its old spot on the centreline', async () => {
    const one = await field(1);
    const p = one.car.position;
    const s = track.samples[track.samples.length - 5];
    expect(Math.hypot(p.x - s.x, p.z - s.z)).toBeLessThan(0.1);
  });

  it('survive driving into each other', async () => {
    const sim = await field(2);
    // Car 1 (right column, a few metres back) steers left across car 0's path at full throttle.
    const c: Controls[] = [NO_CONTROLS, controls({ throttle: 1, steer: -0.6 })];
    for (let k = 0; k < 4 * 120; k++) sim.step(c);
    for (const car of sim.cars) {
      const p = car.position;
      expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
      expect(Math.abs(p.y)).toBeLessThan(20);
      expect(Math.hypot(car.body.linvel().x, car.body.linvel().z)).toBeLessThan(40);
    }
    // They touched: car 0 was pushed off its spot.
    const s = sim.gridPose(0).position;
    expect(Math.hypot(sim.car.position.x - s.x, sim.car.position.z - s.z)).toBeGreaterThan(0.2);
  });

  it('restart puts every car back in its slot', async () => {
    const sim = await field(4);
    for (let k = 0; k < 120; k++) sim.step(sim.cars.map(() => controls({ throttle: 1 })));
    sim.restart();
    sim.cars.forEach((car, i) => {
      const s = sim.gridPose(i).position;
      expect(Math.hypot(car.position.x - s.x, car.position.z - s.z)).toBeLessThan(0.5);
      expect(car.speed).toBe(0);
    });
  });

  it('can put the player in any slot', async () => {
    await initPhysics();
    const sim = new Simulation(track, undefined, { cars: 3, slots: [2, 0, 1] });
    const lead = sim.cars[1].position;
    const player = sim.car.position;
    // Pole is nearer the line (the end of the samples) than slot 2, a row back.
    const line = track.samples[0];
    expect(Math.hypot(lead.x - line.x, lead.z - line.z)).toBeLessThan(Math.hypot(player.x - line.x, player.z - line.z) - 5);
  });

  it('step nine cars in a few milliseconds', async () => {
    const sim = await field(9);
    const c = sim.cars.map(() => controls({ throttle: 0.6 }));
    for (let k = 0; k < 120; k++) sim.step(c);
    const start = performance.now();
    for (let k = 0; k < 240; k++) sim.step(c);
    const perStep = (performance.now() - start) / 240;
    // Loose: CI machines and parallel tests are slow. In the browser it's measured properly.
    expect(perStep).toBeLessThan(12);
  });

  it('every circuit has room for nine cars on its grid', async () => {
    await initPhysics();
    for (const def of CIRCUITS) {
      const sim = new Simulation(buildTrack(def), undefined, { cars: 9 });
      for (let k = 0; k < 120; k++) sim.step(idle(sim));
      sim.cars.forEach((_, i) => expect(sim.isOffTrack(i)).toBe(false));
    }
  });
});
