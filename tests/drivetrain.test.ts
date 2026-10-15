import { describe, expect, it } from 'vitest';
import { KESTREL } from '../src/vehicle/cars';
import type { DifferentialDef } from '../src/vehicle/differential';
import { Drivetrain, type DriveOut } from '../src/vehicle/drivetrain';
import { engineTorque, frictionTorque, fullThrottleTorque, RPM_PER_RAD_S } from '../src/vehicle/engine';
import { NEUTRAL } from '../src/vehicle/gearbox';
import type { SpinBody } from '../src/vehicle/spin';

const E = KESTREL.engine;
const STEP = 1 / 120;
const SUBSTEPS = 8;
const pedals = (throttle = 0, shift: -1 | 0 | 1 = 0) => ({ throttle, brake: 0, clutch: 0, shift });
const wheel = (omega = 0, torque = 0, friction = 0): SpinBody => ({ omega, inertia: KESTREL.tyres.rear.inertia, torque, friction });

/** Run a drivetrain on its own (wheels held still unless given) for `seconds`. */
function spin(dt: Drivetrain, seconds: number, throttle: number, left = wheel(0, 0, 1e6), right = wheel(0, 0, 1e6)): void {
  const out: DriveOut = { left: 0, right: 0 };
  for (let t = 0; t < seconds; t += STEP) {
    dt.update(pedals(throttle), (left.omega + right.omega) / 2, 0, STEP);
    for (let s = 0; s < SUBSTEPS; s++) dt.substep(STEP / SUBSTEPS, left, right, out);
  }
}

function inNeutral(): Drivetrain {
  const dt = new Drivetrain(KESTREL);
  dt.setMode('manual');
  dt.update(pedals(0, -1), 0, 0, STEP);
  spin(dt, 0.5, 0);
  expect(dt.gearbox.gear).toBe(NEUTRAL);
  return dt;
}

describe('engine', () => {
  it('follows its torque curve between and beyond the points', () => {
    expect(fullThrottleTorque(E, 5000)).toBe(220);
    expect(fullThrottleTorque(E, 4500)).toBeCloseTo(215, 6);
    expect(fullThrottleTorque(E, 500)).toBe(140);
    expect(fullThrottleTorque(E, 9000)).toBe(170);
  });

  it('brakes at closed throttle, more at high revs, and maps the pedal progressively', () => {
    expect(engineTorque(E, 3000, 0)).toBeCloseTo(-frictionTorque(E, 3000), 9);
    expect(engineTorque(E, 6000, 0)).toBeLessThan(engineTorque(E, 3000, 0));
    expect(engineTorque(E, 3000, 1)).toBe(fullThrottleTorque(E, 3000));
    // Half pedal gives most of the torque, as a real throttle does.
    expect(engineTorque(E, 3000, 0.5)).toBeGreaterThan(0.6 * fullThrottleTorque(E, 3000));
  });

  it('idles at its idle speed in neutral', () => {
    const dt = inNeutral();
    spin(dt, 3, 0);
    expect(Math.abs(dt.rpm - E.idleRpm)).toBeLessThan(60);
  });

  it('holds at the rev limiter in neutral at full throttle', () => {
    const dt = inNeutral();
    let highest = 0;
    let lowest = Infinity;
    for (let i = 0; i < 300; i++) {
      spin(dt, STEP, 1);
      if (i > 180) {
        highest = Math.max(highest, dt.rpm);
        lowest = Math.min(lowest, dt.rpm);
      }
    }
    expect(highest).toBeLessThan(E.limiterRpm + 150);
    expect(lowest).toBeGreaterThan(E.limiterRpm - 600);
  });
});

describe('gearbox', () => {
  it('takes a manual shift in shiftTime, changing gear halfway with the clutch out', () => {
    const dt = new Drivetrain(KESTREL);
    dt.setMode('manual');
    const T = KESTREL.gearbox.shiftTime;
    dt.update(pedals(0, 1), 0, 0, STEP);
    expect(dt.gearbox.shifting).toBeGreaterThan(0);
    let changedAt = -1;
    let clutchDuring = 0;
    for (let t = STEP; t < 2 * T; t += STEP) {
      dt.update(pedals(), 0, 0, STEP);
      if (changedAt < 0 && dt.gearbox.gear === 2) changedAt = t;
      if (t < T / 2 - STEP) clutchDuring = Math.max(clutchDuring, dt.clutch);
    }
    expect(dt.gearbox.gear).toBe(2);
    expect(dt.gearbox.shifting).toBe(0);
    expect(changedAt).toBeGreaterThan(T / 2 - 2 * STEP);
    expect(changedAt).toBeLessThan(T / 2 + 2 * STEP);
    expect(clutchDuring).toBe(0);
  });

  it('refuses reverse on the move and over-revving downshifts in manual', () => {
    const dt = new Drivetrain(KESTREL);
    dt.setMode('manual');
    // At 20 m/s in first, down to neutral is fine but reverse is refused.
    dt.update(pedals(0, -1), 20 / 0.33, 20, STEP);
    spin(dt, 0.5, 0);
    expect(dt.gearbox.gear).toBe(NEUTRAL);
    dt.update(pedals(0, -1), 20 / 0.33, 20, STEP);
    expect(dt.gearbox.shifting).toBe(0);
    // From 3rd at 30 m/s, second is ~7500 rpm (allowed) but first ~11 700 rpm (refused).
    dt.gearbox.set(3);
    dt.update(pedals(0, -1), 30 / 0.33, 30, STEP);
    spin(dt, 0.5, 0, wheel(30 / 0.33), wheel(30 / 0.33));
    expect(dt.gearbox.gear).toBe(2);
    dt.update(pedals(0, -1), 30 / 0.33, 30, STEP);
    expect(dt.gearbox.shifting).toBe(0);
  });
});

describe('differential', () => {
  /**
   * Engine at 3000 rpm in first with the clutch fully in, pulling two wheels: the left one
   * gripping (its tyre pushes back 900 N·m), the right one in the air. Returns the drive
   * torques and wheel speeds after 0.1 s.
   */
  function splitWith(differential: DifferentialDef) {
    const dt = new Drivetrain({ ...KESTREL, differential });
    dt.engineOmega = 3000 / RPM_PER_RAD_S;
    const axle = dt.engineOmega / dt.gearbox.ratio();
    const left = wheel(axle);
    const right = wheel(axle);
    const out: DriveOut = { left: 0, right: 0 };
    let worstSplit = 0;
    for (let i = 0; i < 12 * SUBSTEPS; i++) {
      dt.clutch = 1;
      dt.throttle = 1;
      left.torque = -900;
      right.torque = 0;
      dt.substep(STEP / SUBSTEPS, left, right, out);
      worstSplit = Math.max(worstSplit, Math.abs(out.left - out.right));
    }
    return { out, left, right, worstSplit, input: Math.abs(dt.clutchTorque * dt.gearbox.ratio()) };
  }

  it('open: equal torque to both wheels, so the free wheel runs away', () => {
    const { out, left, right } = splitWith({ type: 'open', preload: 0, ramp: 0 });
    expect(out.left).toBeCloseTo(out.right, 6);
    expect(right.omega).toBeGreaterThan(left.omega + 5);
  });

  it('locked: both wheels at the same speed, the gripping wheel taking the torque', () => {
    const { out, left, right } = splitWith({ type: 'locked', preload: 0, ramp: 0 });
    expect(left.omega).toBeCloseTo(right.omega, 3);
    expect(out.left).toBeGreaterThan(out.right + 400);
  });

  it('limited-slip: moves torque to the gripping wheel, up to preload + ramp × input', () => {
    const lsd: DifferentialDef = { type: 'lsd', preload: 50, ramp: 0.3 };
    const { out, worstSplit, input } = splitWith(lsd);
    expect(out.left).toBeGreaterThan(out.right);
    // Left − right = twice the locking torque at most (it adds to one and takes from the other).
    expect(worstSplit).toBeLessThanOrEqual(2 * (lsd.preload + lsd.ramp * input) + 1);
    expect(worstSplit).toBeGreaterThan(2 * lsd.preload);
  });
});
