import { beforeEach, describe, expect, it } from 'vitest';
import type { Simulation } from '../src/sim';
import { controls, NO_CONTROLS } from '../src/vehicle/car';
import { KESTREL } from '../src/vehicle/cars';
import { createSim, followLine, run, runUntil } from './helpers';
import { LONG_OVAL } from './tracks';

let sim: Simulation;

beforeEach(async () => {
  sim = await createSim();
});

const FULL_THROTTLE = controls({ throttle: 1 });
const KMH_100 = 100 / 3.6;
const WEIGHT = KESTREL.mass * 9.81;

const flatDistance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(b.x - a.x, b.z - a.z);

interface Stop {
  distance: number;
  frontsLocked: boolean;
  rearsLocked: boolean;
}

/**
 * On the long oval: accelerate past 100 km/h, lift off until 100 km/h, then squeeze the
 * brake on to `pedal` over `squeeze` seconds (as a driver does) and hold it to a stop.
 */
async function brakeFrom100(pedal: number, squeeze: number): Promise<Stop> {
  const s = await createSim(LONG_OVAL);
  run(s, NO_CONTROLS, 1);
  runUntil(s, FULL_THROTTLE, () => s.car.speed > KMH_100 + 0.5, 15);
  runUntil(s, NO_CONTROLS, () => s.car.speed < KMH_100, 5);
  const from = s.car.position;
  const stop = { distance: 0, frontsLocked: false, rearsLocked: false };
  let t = 0;
  runUntil(
    s,
    () => controls({ brake: pedal * Math.min(1, (t += 1 / 120) / Math.max(squeeze, 1e-9)) }),
    () => {
      const [fl, fr, rl, rr] = s.car.wheels;
      if (s.car.speed > 5 && fl.locked && fr.locked) stop.frontsLocked = true;
      if (s.car.speed > 5 && (rl.locked || rr.locked)) stop.rearsLocked = true;
      return s.car.speed < 0.05;
    },
    15,
  );
  stop.distance = flatDistance(from, s.car.position);
  return stop;
}

/** Tilt gravity so the car sits on a slope of `degrees`, nose uphill. */
function tiltNoseUp(s: Simulation, degrees: number): void {
  const th = (degrees * Math.PI) / 180;
  const f = s.car.forward;
  const l = Math.hypot(f.x, f.z);
  s.physics.world.gravity = { x: (-9.81 * Math.sin(th) * f.x) / l, y: -9.81 * Math.cos(th), z: (-9.81 * Math.sin(th) * f.z) / l };
}

describe('car', () => {
  it('settles on its suspension, with the static loads summing to the weight', () => {
    run(sim, NO_CONTROLS, 3);
    const car = sim.car;
    expect(car.wheels.every((w) => w.contact)).toBe(true);
    expect(Math.abs(car.speed)).toBeLessThan(0.001);
    const total = car.wheels.reduce((sum, w) => sum + w.load, 0);
    expect(Math.abs(total - WEIGHT) / WEIGHT).toBeLessThan(0.01);
    // 47 % on the front axle.
    expect((car.wheels[0].load + car.wheels[1].load) / total).toBeCloseTo(0.47, 2);
    // Sitting on the springs, clear of the bump stops.
    for (const w of car.wheels) expect(w.suspensionLength).toBeGreaterThan(KESTREL.suspension.bumpStop.length + 0.05);
  });

  it('stays still at rest without jitter or creep', () => {
    run(sim, NO_CONTROLS, 2);
    const from = sim.car.position;
    let fastest = 0;
    for (let i = 0; i < 10 * 120; i++) {
      sim.step(NO_CONTROLS);
      fastest = Math.max(fastest, Math.abs(sim.car.speed));
    }
    expect(fastest).toBeLessThan(0.001);
    expect(flatDistance(from, sim.car.position)).toBeLessThan(0.001);
  });

  it('accelerates from 0 to 100 km/h in a plausible time', () => {
    run(sim, NO_CONTROLS, 1);
    const t = runUntil(sim, FULL_THROTTLE, () => sim.car.speed > KMH_100, 15);
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThan(4.5);
    expect(t!).toBeLessThan(7);
  });

  it('stops from 100 km/h in under 45 m at the best pedal without locking a wheel', async () => {
    let best = Infinity;
    for (let pedal = 0.7; pedal < 0.95; pedal += 0.02) {
      const stop = await brakeFrom100(pedal, 0.3);
      if (!stop.frontsLocked && !stop.rearsLocked) best = Math.min(best, stop.distance);
    }
    // ~0.95 g plus the 0.3 s squeeze; no more grip than the tyres have.
    expect(best).toBeLessThan(45);
    expect(best).toBeGreaterThan(36);
  });

  it('locks the fronts, not the rears, when the brake is stamped on (no ABS until M2)', async () => {
    const stamp = await brakeFrom100(1, 0);
    expect(stamp.frontsLocked).toBe(true);
    expect(stamp.distance).toBeLessThan(55);
    const firm = await brakeFrom100(0.9, 0.3);
    expect(firm.frontsLocked).toBe(true);
    expect(firm.rearsLocked).toBe(false);
  });

  it('holds still on a slope with the brake held', () => {
    run(sim, NO_CONTROLS, 1);
    runUntil(sim, FULL_THROTTLE, () => sim.car.speed > 8, 10);
    runUntil(sim, controls({ brake: 0.6 }), () => Math.abs(sim.car.speed) < 0.01, 10);
    for (const degrees of [10, 20]) {
      tiltNoseUp(sim, degrees);
      run(sim, controls({ brake: 1 }), 2);
      const from = sim.car.position;
      run(sim, controls({ brake: 1 }), 10);
      expect(flatDistance(from, sim.car.position)).toBeLessThan(0.01);
      expect(sim.car.reversing).toBe(false);
    }
  });

  it('keeps braking after stopping with the brake held, and reverses when it is pressed again', () => {
    run(sim, NO_CONTROLS, 1);
    runUntil(sim, FULL_THROTTLE, () => sim.car.speed > 10, 10);
    runUntil(sim, controls({ brake: 1 }), () => Math.abs(sim.car.speed) < 0.01, 10);
    run(sim, controls({ brake: 1 }), 2);
    expect(sim.car.reversing).toBe(false);
    expect(Math.abs(sim.car.speed)).toBeLessThan(0.01);

    run(sim, NO_CONTROLS, 0.2);
    run(sim, controls({ brake: 1 }), 2);
    expect(sim.car.reversing).toBe(true);
    expect(sim.car.speed).toBeLessThan(-1);
  });

  it('turns without rolling over and keeps the forces finite', () => {
    run(sim, NO_CONTROLS, 1);
    runUntil(sim, FULL_THROTTLE, () => sim.car.speed > 20, 15);
    run(sim, controls({ throttle: 0.5, steer: 1 }), 4);
    const q = sim.car.rotation;
    // Car's up axis still points mostly up: 1 - 2(qx² + qz²) is its world y component.
    expect(1 - 2 * (q.x * q.x + q.z * q.z)).toBeGreaterThan(0.9);
    for (const w of sim.car.wheels) expect(Number.isFinite(w.latForce)).toBe(true);
  });

  it.each([1, 0.3, -0.15])('survives hitting a barrier at 150 km/h (steer %s)', async (steer) => {
    const s = await createSim(LONG_OVAL);
    const v0 = 150 / 3.6;
    expect(runUntil(s, followLine(s, v0 + 1), () => s.car.speed > v0, 30)).not.toBeNull();
    let fastest = 0;
    let reached = false;
    for (let i = 0; i < 5 * 120; i++) {
      s.step(controls({ throttle: 1, steer }));
      const v = s.car.body.linvel();
      fastest = Math.max(fastest, Math.hypot(v.x, v.y, v.z));
      for (const w of s.car.wheels) {
        expect(Number.isFinite(w.load + w.longForce + w.latForce + w.omega)).toBe(true);
        expect(Math.abs(w.omega * w.tyre.radius)).toBeLessThan(120);
      }
      // Barriers stand 17.5 m from the centreline.
      if (Math.abs(s.car.position.z) > 14) reached = true;
    }
    expect(reached).toBe(true);
    expect(fastest).toBeLessThan(v0 + 3);
    run(s, NO_CONTROLS, 5);
    const q = s.car.rotation;
    expect(1 - 2 * (q.x * q.x + q.z * q.z)).toBeGreaterThan(0.95);
    expect(s.car.wheels.every((w) => w.contact)).toBe(true);
    expect(Math.abs(s.car.position.z)).toBeLessThan(17.5);
  });
});
