import { describe, expect, it } from 'vitest';
import { counterSteer, KeyboardSteering, usableLock } from '../src/drivers/steeringAssist';
import { TUNING } from '../src/config';
import type { Simulation } from '../src/sim';
import { controls, NO_CONTROLS } from '../src/vehicle/car';
import { KESTREL } from '../src/vehicle/cars';
import { rackStep, wheelSteerAngle } from '../src/vehicle/steering';
import { createSim, followLine, run, runUntil } from './helpers';
import { LONG_OVAL } from './tracks';

const L = 2 * KESTREL.wheelbaseHalf;
const T = KESTREL.trackHalf;

describe('steering geometry', () => {
  it('turns the inside wheel more, with the axes meeting on the rear axle line at full Ackermann', () => {
    for (const centre of [0.05, 0.2, 0.5, -0.3]) {
      const left = wheelSteerAngle(centre, -T, L, 1);
      const right = wheelSteerAngle(centre, T, L, 1);
      // Turning right (positive), the right wheel is on the inside.
      const [inner, outer] = centre > 0 ? [right, left] : [left, right];
      expect(Math.abs(inner)).toBeGreaterThan(Math.abs(centre));
      expect(Math.abs(outer)).toBeLessThan(Math.abs(centre));
      // Each wheel's axis crosses the rear axle line at the same turn centre.
      const centreX = L / Math.tan(centre);
      expect(-T + L / Math.tan(left)).toBeCloseTo(centreX, 6);
      expect(T + L / Math.tan(right)).toBeCloseTo(centreX, 6);
    }
    expect(wheelSteerAngle(0, T, L, 1)).toBe(0);
    // Parallel steer: both wheels at the centre angle.
    expect(wheelSteerAngle(0.3, T, L, 0)).toBeCloseTo(0.3, 12);
    expect(wheelSteerAngle(0.3, -T, L, 0)).toBeCloseTo(0.3, 12);
  });

  it('moves the rack no faster than its rate', () => {
    expect(rackStep(0, 1, 3, 0.1)).toBeCloseTo(0.3, 12);
    expect(rackStep(0.5, 0.45, 3, 0.1)).toBeCloseTo(0.45, 12);
  });

  it('steers the car through the rack, inside wheel more', async () => {
    const sim = await createSim();
    run(sim, NO_CONTROLS, 0.5);
    const rate = KESTREL.steering.rate / 120;
    let previous = sim.car.steerAngle;
    for (let i = 0; i < 60; i++) {
      sim.step(controls({ steer: 1 }));
      expect(sim.car.steerAngle - previous).toBeLessThanOrEqual(rate + 1e-12);
      previous = sim.car.steerAngle;
    }
    expect(sim.car.steerAngle).toBeCloseTo(KESTREL.steering.lock, 9);
    const [fl, fr, rl] = sim.car.wheels;
    expect(fr.steer).toBeGreaterThan(fl.steer);
    expect(fl.steer).toBeGreaterThan(0);
    expect(rl.steer).toBe(0);
  });
});

describe('keyboard steering assist', () => {
  let sim: Simulation;

  it('gives full lock at walking pace and less with speed, matching what the tyres can use', async () => {
    sim = await createSim();
    const car = sim.car;
    expect(usableLock(car, 1)).toBe(1);
    let previous = 1;
    for (const v of [10, 20, 30, 45, 60]) {
      const lock = usableLock(car, v);
      expect(lock).toBeLessThan(previous);
      previous = lock;
    }
    const K = TUNING.keyboardSteering;
    const at40 = usableLock(car, 40) * KESTREL.steering.lock;
    expect(at40).toBeCloseTo(Math.atan((L * K.limitG * 9.81) / 1600) + K.slipMargin * car.wheels[0].tyre.peakSlipAngle, 9);
  });

  it('eases towards the keys, with full lock regardless of speed when the assist is off', async () => {
    sim = await createSim(LONG_OVAL);
    runUntil(sim, followLine(sim, 30), () => sim.car.speed > 30, 20);
    const on = new KeyboardSteering();
    const off = new KeyboardSteering();
    off.assist = false;
    for (let i = 0; i < 240; i++) {
      on.update(1, sim.car, 1 / 120);
      off.update(1, sim.car, 1 / 120);
    }
    expect(off.position).toBeGreaterThan(0.99);
    expect(on.position).toBeCloseTo(usableLock(sim.car, sim.car.speed), 2);
    expect(on.position).toBeLessThan(0.6);
  });

  /** On the long oval at 90 km/h, kick the car into a slide (yaw rate `kick`), then let go of the keys. */
  async function kickAndRelease(assist: boolean, kick = 1.2) {
    const s = await createSim(LONG_OVAL);
    runUntil(s, followLine(s, 25), () => s.car.speed > 25, 20);
    const steering = new KeyboardSteering();
    steering.assist = assist;
    s.car.body.setAngvel({ x: 0, y: kick, z: 0 }, true);
    let recovered: number | null = null;
    let calm = 0;
    let worstSlip = 0;
    let helpOpposedSlide = true;
    // Until it has recovered: once straight, it is pointing at the barrier with nobody steering.
    for (let i = 0; i < 6 * 120 && recovered === null; i++) {
      const help = counterSteer(s.car);
      if (help !== 0 && Math.sign(help) !== Math.sign(s.car.bodySlipAngle)) helpOpposedSlide = false;
      s.step(controls({ throttle: 0.2, steer: steering.update(0, s.car, 1 / 120) }));
      const slip = Math.abs(s.car.bodySlipAngle);
      worstSlip = Math.max(worstSlip, slip);
      // Recovered: half a second of straight running.
      calm = Math.abs(s.car.body.angvel().y) < 0.1 && slip < 0.05 ? calm + 1 : 0;
      if (calm === 60 && recovered === null) recovered = (i - 60) / 120;
    }
    return { recovered, worstSlip, helpOpposedSlide };
  }

  it('leans against a slide so letting go of the keys catches it', async () => {
    const helped = await kickAndRelease(true);
    expect(helped.helpOpposedSlide).toBe(true);
    expect(helped.recovered).not.toBeNull();
    expect(helped.recovered!).toBeLessThan(2);
    expect(helped.worstSlip).toBeLessThan(0.4);
    // Without the help, the same kick spins the car round.
    const alone = await kickAndRelease(false);
    expect(alone.worstSlip).toBeGreaterThan(1.5);
  });

  it('lets keys held against the help win', async () => {
    const s = await createSim(LONG_OVAL);
    runUntil(s, followLine(s, 25), () => s.car.speed > 25, 20);
    s.car.body.setAngvel({ x: 0, y: 1.2, z: 0 }, true);
    run(s, controls({ throttle: 0.2 }), 0.3);
    const help = counterSteer(s.car);
    expect(help).not.toBe(0);
    const steering = new KeyboardSteering();
    for (let i = 0; i < 30; i++) steering.update(-Math.sign(help), s.car, 1 / 120);
    expect(Math.sign(steering.position)).toBe(-Math.sign(help));
  });
});
