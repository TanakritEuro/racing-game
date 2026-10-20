// Front-, rear- and all-wheel drive: which wheels drive, how each layout launches and how it
// behaves on the power in a corner, measured on the headless simulation.

import { describe, expect, it } from 'vitest';
import { carEnvelope, tractionShare } from '../src/ai/envelope';
import { controls, NO_CONTROLS } from '../src/vehicle/car';
import type { CarDef } from '../src/vehicle/carDef';
import { CARS, FINCH, KESTREL, OSPREY } from '../src/vehicle/cars';
import type { Conditions } from '../src/track/weather';
import { createSim, followLine, run, runUntil } from './helpers';
import { LONG_OVAL, SKIDPAD } from './tracks';

const KMH_100 = 100 / 3.6;

/** Each wheel's drive torque averaged over 2 s of steady part throttle at ~20 m/s. */
async function driveShares(def: CarDef): Promise<number[]> {
  const s = await createSim(LONG_OVAL, def);
  run(s, followLine(s, 20), 8);
  const sums = [0, 0, 0, 0];
  for (let i = 0; i < 240; i++) {
    s.step(followLine(s, 25, { maxThrottle: 0.4 })());
    s.car.wheels.forEach((w, k) => (sums[k] += w.driveTorque));
  }
  const total = sums.reduce((a, b) => a + b, 0);
  return sums.map((x) => x / total);
}

/** The most any wheel's surface ran ahead of the car in a 1.5 s full-throttle launch (m/s), per wheel. */
async function launchSpin(def: CarDef, tc: boolean): Promise<number[]> {
  const s = await createSim(LONG_OVAL, def);
  s.car.aids = { abs: true, tc };
  run(s, NO_CONTROLS, 1);
  const most = [0, 0, 0, 0];
  for (let i = 0; i < 180; i++) {
    s.step(controls({ throttle: 1 }));
    s.car.wheels.forEach((w, k) => (most[k] = Math.max(most[k], w.omega * w.tyre.radius - s.car.speed)));
  }
  return most;
}

async function zeroTo100(def: CarDef, tc: boolean, conditions: Conditions = 'dry'): Promise<number> {
  const s = await createSim(LONG_OVAL, def, conditions);
  s.car.aids = { abs: true, tc };
  run(s, NO_CONTROLS, 1);
  return runUntil(s, controls({ throttle: 1 }), () => s.car.speed > KMH_100, 20)!;
}

/**
 * Balance on the power: circling the skidpad at 17 m/s (~0.75 g), then full throttle for
 * 0.5 s with the steering held. Returns how much the front slip angle grew against the
 * rear's (rad): more than zero is understeer on the power, less is oversteer.
 */
async function powerBalance(def: CarDef): Promise<number> {
  const s = await createSim(SKIDPAD, def);
  const drive = followLine(s, 17, { maxThrottle: 0.5 });
  run(s, drive, 25);
  const balance = () => {
    const [fl, fr, rl, rr] = s.car.wheels;
    return Math.abs(fl.slipAngle + fr.slipAngle) / 2 - Math.abs(rl.slipAngle + rr.slipAngle) / 2;
  };
  let before = 0;
  for (let i = 0; i < 60; i++) {
    s.step(drive());
    before += balance() / 60;
  }
  const steer = drive().steer;
  let after = 0;
  for (let i = 0; i < 60; i++) {
    s.step(controls({ steer, throttle: 1 }));
    if (i >= 30) after += balance() / 30;
  }
  return after - before;
}

describe('the driven wheels', () => {
  it('rear, front or all four, as the layout says', async () => {
    const rwd = await driveShares(KESTREL);
    expect(rwd[0] + rwd[1]).toBeCloseTo(0, 6);
    const fwd = await driveShares(FINCH);
    expect(fwd[2] + fwd[3]).toBeCloseTo(0, 6);
    expect(fwd[0]).toBeGreaterThan(0.4);
    expect(fwd[1]).toBeGreaterThan(0.4);
    // All-wheel drive: an open centre differential divides the drive by its split...
    const split = OSPREY.drivetrain.centre!.split;
    const open = await driveShares({ ...OSPREY, drivetrain: { ...OSPREY.drivetrain, centre: { split, diff: { type: 'open', preload: 0, ramp: 0 } } } });
    expect(open[0] + open[1]).toBeCloseTo(split, 2);
    // ...and the Osprey's limited-slip one moves some of it between the axles, all four driving.
    for (const share of await driveShares(OSPREY)) expect(share).toBeGreaterThan(0.15);
  }, 120_000);

  it('gives the AI its traction by layout: all-wheel drive most, front-wheel drive least', () => {
    const same = (layout: 'rwd' | 'fwd'): CarDef => ({ ...OSPREY, drivetrain: { layout } });
    const awd = carEnvelope(OSPREY).traction;
    const rwd = carEnvelope(same('rwd')).traction;
    const fwd = carEnvelope(same('fwd')).traction;
    expect(awd).toBeGreaterThan(rwd);
    expect(rwd).toBeGreaterThan(fwd);
    // Open, locked and limited-slip centres: the limited-slip one in between.
    const centre = (type: 'open' | 'locked'): CarDef => ({ ...OSPREY, drivetrain: { ...OSPREY.drivetrain, centre: { split: 0.38, diff: { type, preload: 0, ramp: 0 } } } });
    const open = tractionShare(centre('open'), 0.53);
    expect(open).toBeLessThan(awd);
    expect(tractionShare(centre('locked'), 0.53)).toBe(1);
    expect(awd).toBeLessThan(1);
  });
});

describe('launches', () => {
  it('traction control off: the Finch spins its fronts only, and the Osprey is quickest to 100 km/h', async () => {
    const finch = await launchSpin(FINCH, false);
    expect(Math.min(finch[0], finch[1])).toBeGreaterThan(3);
    expect(Math.max(finch[2], finch[3])).toBeLessThan(0.5);
    const times = await Promise.all(CARS.map((def) => zeroTo100(def, false)));
    const osprey = times[CARS.indexOf(OSPREY)];
    for (const t of times) expect(osprey).toBeLessThanOrEqual(t);
  }, 300_000);

  it('traction control on: every car spins its driven wheels less than half as much', async () => {
    for (const def of CARS) {
      const off = Math.max(...(await launchSpin(def, false)));
      const on = Math.max(...(await launchSpin(def, true)));
      expect(on, def.name).toBeLessThan(off / 2);
    }
  }, 300_000);

  it('in the wet, all-wheel drive loses the least', async () => {
    const loss = async (def: CarDef) => (await zeroTo100(def, true, 'wet')) / (await zeroTo100(def, true));
    const losses = await Promise.all(CARS.map(loss));
    const osprey = losses[CARS.indexOf(OSPREY)];
    for (const l of losses) expect(osprey).toBeLessThanOrEqual(l);
  }, 300_000);
});

describe('on the power in a corner', () => {
  it('front-wheel drive understeers, rear-wheel drive turns in, all-wheel drive in between', async () => {
    const finch = await powerBalance(FINCH);
    const kestrel = await powerBalance(KESTREL);
    const osprey = await powerBalance(OSPREY);
    expect(finch).toBeGreaterThan(0.005);
    expect(kestrel).toBeLessThan(0);
    expect(osprey).toBeGreaterThan(kestrel);
    expect(osprey).toBeLessThan(finch);
  }, 300_000);
});
