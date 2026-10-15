import { describe, expect, it } from 'vitest';
import { interpolatePose } from '../src/render/interpolate';
import { createPose, NO_CONTROLS } from '../src/vehicle/car';
import { createSim, run } from './helpers';

describe('pose interpolation', () => {
  it('runs from the previous pose to the current one', async () => {
    const sim = await createSim();
    run(sim, NO_CONTROLS, 0.5);
    run(sim, { ...NO_CONTROLS, throttle: 1, steer: 1 }, 1);
    const out = createPose();
    interpolatePose(sim.previous, sim.current, 0, out);
    expect(out.position).toEqual(sim.previous.position);
    expect(out.wheels).toEqual(sim.previous.wheels);
    for (const k of ['x', 'y', 'z', 'w'] as const) expect(out.rotation[k]).toBeCloseTo(sim.previous.rotation[k], 6); // Rapier's are float32
    interpolatePose(sim.previous, sim.current, 1, out);
    expect(out.position).toEqual(sim.current.position);
    expect(out.wheels[0].spin).toBeCloseTo(sim.current.wheels[0].spin, 9);
    interpolatePose(sim.previous, sim.current, 0.5, out);
    expect(Math.hypot(out.rotation.x, out.rotation.y, out.rotation.z, out.rotation.w)).toBeCloseTo(1, 9);
    expect(out.position.x).toBeCloseTo((sim.previous.position.x + sim.current.position.x) / 2, 9);
  });

  it('takes the short way between a quaternion and its negation', () => {
    const a = createPose();
    const b = createPose();
    b.rotation = { x: 0, y: -Math.sin(0.05), z: 0, w: -Math.cos(0.05) }; // same as a 0.1 rad turn, negated
    const out = createPose();
    interpolatePose(a, b, 0.5, out);
    expect(Math.abs(out.rotation.w)).toBeGreaterThan(0.99);
  });

  it('settles both poses after a recovery, so the reset is not drawn as a slide', async () => {
    const sim = await createSim();
    run(sim, { ...NO_CONTROLS, throttle: 1 }, 3);
    sim.recover();
    expect(sim.previous).toEqual(sim.current);
  });
});
