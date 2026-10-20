// The other cars against their own targets (Kestrel's fuller checks are in car.test.ts).

import { describe, expect, it } from 'vitest';
import { createAiDriver } from '../src/ai/driver';
import { PHYSICS_STEP } from '../src/constants';
import { TEST_CIRCUIT } from '../src/track/circuits';
import { controls, NO_CONTROLS } from '../src/vehicle/car';
import type { CarDef } from '../src/vehicle/carDef';
import { CARS, FINCH, HARRIER, KESTREL, OSPREY, WREN } from '../src/vehicle/cars';
import { createSim, followLine, run, runUntil, skidpadLimit } from './helpers';
import { LONG_OVAL, SKIDPAD } from './tracks';

const KMH_100 = 100 / 3.6;

interface Targets {
  zeroTo100: [number, number];
  topSpeed: [number, number];
  stop: [number, number];
  skidpad: [number, number];
  /** An AI flying lap of the Proving Ground (s). */
  aiLap: [number, number];
}

const TARGETS = new Map<CarDef, Targets>([
  [WREN, { zeroTo100: [7.3, 8.6], topSpeed: [195, 212], stop: [39, 45], skidpad: [0.88, 0.98], aiLap: [52, 55.5] }],
  [HARRIER, { zeroTo100: [4.8, 5.9], topSpeed: [270, 292], stop: [35.5, 41], skidpad: [0.95, 1.06], aiLap: [47.5, 50.5] }],
  [FINCH, { zeroTo100: [6.2, 7.3], topSpeed: [227, 244], stop: [37.5, 43], skidpad: [0.91, 1.0], aiLap: [49.5, 52.5] }],
  [OSPREY, { zeroTo100: [3.5, 4.4], topSpeed: [262, 282], stop: [35, 40.5], skidpad: [0.96, 1.05], aiLap: [47, 50.5] }],
]);

const within = (value: number, [lo, hi]: [number, number]) => {
  expect(value).toBeGreaterThan(lo);
  expect(value).toBeLessThan(hi);
};

describe('the car list', () => {
  it('has every car once, each with its own name', () => {
    expect(CARS).toContain(KESTREL);
    expect(new Set(CARS.map((c) => c.name)).size).toBe(CARS.length);
  });
});

describe.each([...TARGETS.entries()].map(([def, t]) => [def.name, def, t] as const))('%s', (_, def, t) => {
  it('settles with its static loads summing to its weight', async () => {
    const s = await createSim(TEST_CIRCUIT, def);
    run(s, NO_CONTROLS, 2);
    const total = s.car.wheels.reduce((sum, w) => sum + w.load, 0);
    expect(Math.abs(total - def.mass * 9.81) / (def.mass * 9.81)).toBeLessThan(0.01);
  });

  it('accelerates, reaches its top speed and stops as intended', async () => {
    const a = await createSim(LONG_OVAL, def);
    run(a, NO_CONTROLS, 1);
    within(runUntil(a, controls({ throttle: 1 }), () => a.car.speed > KMH_100, 20)!, t.zeroTo100);

    const b = await createSim(LONG_OVAL, def);
    run(b, followLine(b, 100), 70);
    within(b.car.speed * 3.6, t.topSpeed);

    // Stamping the brake from 100 km/h, with ABS.
    const c = await createSim(LONG_OVAL, def);
    run(c, NO_CONTROLS, 1);
    runUntil(c, controls({ throttle: 1 }), () => c.car.speed > KMH_100 + 0.5, 20);
    runUntil(c, NO_CONTROLS, () => c.car.speed < KMH_100, 5);
    const from = { ...c.car.position };
    runUntil(c, controls({ brake: 1 }), () => c.car.speed < 0.05, 15);
    within(Math.hypot(c.car.position.x - from.x, c.car.position.z - from.z), t.stop);
  }, 180_000);

  it('corners at its grip on the skidpad, front tyres giving up first', async () => {
    const { best, atBest } = await skidpadLimit(SKIDPAD, def);
    within(best, t.skidpad);
    expect(atBest.front).toBeGreaterThan(atBest.rear * 1.2);
  }, 180_000);

  it('can be lapped cleanly by the AI', async () => {
    const s = await createSim(TEST_CIRCUIT, def);
    const ai = createAiDriver(s.track, def);
    for (let k = 0; k < 200 * 120 && s.timer.laps < 2; k++) s.step(ai.drive(s.car, PHYSICS_STEP));
    expect(s.timer.laps).toBe(2);
    expect(s.timer.lastValid).toBe(true);
    within(s.timer.lastLap!, t.aiLap);
  }, 180_000);
});

describe('the cars compared', () => {
  it('Wren is the slowest and gentlest, Harrier the quickest', () => {
    const power = (d: CarDef) => Math.max(...d.engine.torqueCurve.map(([rpm, nm]) => (rpm * nm * Math.PI) / 30)) / d.mass;
    expect(power(WREN)).toBeLessThan(power(KESTREL));
    expect(power(KESTREL)).toBeLessThan(power(HARRIER));
  });
});
