import { beforeEach, describe, expect, it } from 'vitest';
import type { Simulation } from '../src/sim';
import { NO_CONTROLS } from '../src/vehicle/car';
import { createSim, run, runUntil } from './helpers';

let sim: Simulation;

beforeEach(async () => {
  sim = await createSim();
});

const FULL_THROTTLE = { throttle: 1, brake: 0, steer: 0 };

describe('car (placeholder model)', () => {
  it('settles on its suspension and stays still', () => {
    run(sim, NO_CONTROLS, 3);
    const car = sim.car;
    expect(car.wheels.every((w) => w.contact)).toBe(true);
    expect(Math.abs(car.speed)).toBeLessThan(0.01);
    // Static loads add up to the car's weight.
    const total = car.wheels.reduce((sum, w) => sum + w.load, 0);
    expect(total).toBeCloseTo(1250 * 9.81, -2);
    // Sitting on the springs, not on the bump stops.
    for (const w of car.wheels) expect(w.suspensionLength).toBeGreaterThan(0.1);
  });

  it('accelerates from 0 to 100 km/h in a plausible time', () => {
    run(sim, NO_CONTROLS, 1);
    const t = runUntil(sim, FULL_THROTTLE, () => sim.car.speed > 100 / 3.6, 15);
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThan(4);
    expect(t!).toBeLessThan(8);
  });

  it('brakes from 100 km/h to a stop in under 45 m', () => {
    run(sim, NO_CONTROLS, 1);
    runUntil(sim, FULL_THROTTLE, () => sim.car.speed > 100 / 3.6, 15);
    const from = sim.car.position;
    runUntil(sim, { throttle: 0, brake: 1, steer: 0 }, () => sim.car.speed < 0.1, 10);
    const to = sim.car.position;
    expect(Math.hypot(to.x - from.x, to.z - from.z)).toBeLessThan(45);
  });

  it('reverses when brake is held at a standstill', () => {
    run(sim, NO_CONTROLS, 1);
    run(sim, { throttle: 0, brake: 1, steer: 0 }, 2);
    expect(sim.car.reversing).toBe(true);
    expect(sim.car.speed).toBeLessThan(-1);
  });

  it('turns without rolling over and keeps the forces finite', () => {
    run(sim, NO_CONTROLS, 1);
    runUntil(sim, FULL_THROTTLE, () => sim.car.speed > 20, 15);
    run(sim, { throttle: 0.5, brake: 0, steer: 1 }, 4);
    const q = sim.car.rotation;
    // Car's up axis still points mostly up: |2(qx² + qz²)| small.
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    expect(upY).toBeGreaterThan(0.9);
    for (const w of sim.car.wheels) expect(Number.isFinite(w.latForce)).toBe(true);
  });
});
