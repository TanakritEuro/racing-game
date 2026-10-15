import { describe, expect, it } from 'vitest';
import type { Simulation } from '../src/sim';
import { controls, type Controls } from '../src/vehicle/car';
import { createSim } from './helpers';

/** A scripted drive with a bit of everything: launch, weaving, braking, a shift request, reverse. */
function script(step: number): Controls {
  const t = step / 120;
  if (t < 8) return controls({ throttle: 1, steer: 0.6 * Math.sin(t * 1.3), shift: step === 400 ? 1 : 0 });
  if (t < 12) return controls({ brake: 0.8, steer: -0.3 });
  if (t < 20) return controls({ throttle: 0.7, steer: Math.sin(t * 2.1) });
  if (t < 24) return controls({ brake: 1 });
  return controls({ brake: 1, steer: 0.5 });
}

/** Everything about the car's state that later steps depend on. */
function snapshot(sim: Simulation) {
  const body = sim.car.body;
  return {
    time: sim.time,
    position: body.translation(),
    rotation: body.rotation(),
    linvel: body.linvel(),
    angvel: body.angvel(),
    steer: sim.car.steerAngle,
    wheels: sim.car.wheels.map((w) => ({ ...w })),
    laps: sim.timer.laps,
  };
}

describe('determinism', () => {
  it('gives a bit-identical state for the same controls', async () => {
    const a = await createSim();
    const b = await createSim();
    for (let i = 0; i < 30 * 120; i++) {
      a.step(script(i));
      b.step(script(i));
    }
    expect(snapshot(b)).toEqual(snapshot(a));
    // The script actually moved the car.
    expect(Math.hypot(a.car.position.x, a.car.position.z)).toBeGreaterThan(10);
  });
});
