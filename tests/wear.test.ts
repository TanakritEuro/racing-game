import { describe, expect, it } from 'vitest';
import { createAiDriver } from '../src/ai/driver';
import { PHYSICS_STEP } from '../src/constants';
import { initPhysics } from '../src/physics';
import { Simulation } from '../src/sim';
import { HARROWMERE } from '../src/track/circuits';
import { buildTrack } from '../src/track/track';
import { controls, NO_CONTROLS } from '../src/vehicle/car';
import { KESTREL } from '../src/vehicle/cars';
import { fuelBurned, patchPower, wearGrip, type WearRate } from '../src/vehicle/wear';
import { createSim, followLine, run, runUntil } from './helpers';
import { LONG_OVAL } from './tracks';

describe('tyre wear', () => {
  it('comes from the energy the contact patch dissipates', () => {
    expect(patchPower(3000, 0, 0, 0)).toBe(0);
    expect(patchPower(3000, -2000, -0.5, 0.25)).toBe(1500 + 500);
  });

  it('costs grip gently up to the cliff, then sharply', () => {
    expect(wearGrip(0)).toBe(1);
    expect(wearGrip(0.4)).toBeCloseTo(0.96, 9);
    expect(wearGrip(0.8)).toBeCloseTo(0.92, 9);
    expect(wearGrip(1)).toBeCloseTo(0.6, 9);
    for (let w = 0; w < 1; w += 0.05) expect(wearGrip(w + 0.05)).toBeLessThan(wearGrip(w));
  });

  it('is much faster in a slide than rolling the same distance', async () => {
    // Wheelspin (traction control off) from a standstill, against a steady cruise.
    const spin = await createSim(LONG_OVAL);
    spin.car.wearRate = 1;
    spin.car.aids = { abs: false, tc: false };
    run(spin, NO_CONTROLS, 1);
    const from = { ...spin.car.position };
    runUntil(spin, controls({ throttle: 1 }), () => Math.hypot(spin.car.position.x - from.x, spin.car.position.z - from.z) > 30, 10);
    const spun = (spin.car.wheels[2].wear + spin.car.wheels[3].wear) / 2 / 30;

    const cruise = await createSim(LONG_OVAL);
    cruise.car.wearRate = 1;
    const drive = followLine(cruise, 20);
    runUntil(cruise, drive, () => cruise.car.speed > 19.5, 20);
    const was = (cruise.car.wheels[2].wear + cruise.car.wheels[3].wear) / 2;
    const at = { ...cruise.car.position };
    runUntil(cruise, drive, () => Math.hypot(cruise.car.position.x - at.x, cruise.car.position.z - at.z) > 300, 30);
    const rolled = ((cruise.car.wheels[2].wear + cruise.car.wheels[3].wear) / 2 - was) / 300;
    expect(spun).toBeGreaterThan(20 * rolled);
  });

  it('is off unless asked for', async () => {
    const s = await createSim(LONG_OVAL);
    run(s, controls({ throttle: 1 }), 5);
    expect(s.car.wheels.every((w) => w.wear === 0)).toBe(true);
  });
});

describe('tyre wear on a lap', () => {
  /** Two laps of Harrowmere by the AI at `rate`: the most worn tyre's wear per lap, and the last lap's time. */
  async function laps(rate: WearRate, startWear = 0) {
    await initPhysics();
    const track = buildTrack(HARROWMERE);
    const sim = new Simulation(track, KESTREL, { wear: rate });
    for (const w of sim.car.wheels) w.wear = startWear;
    const ai = createAiDriver(track, KESTREL);
    let atLap1 = 0;
    for (let k = 0; k < 400 * 120 && sim.timer.laps < 2; k++) {
      sim.step(ai.drive(sim.car, PHYSICS_STEP));
      if (sim.timer.laps === 1 && atLap1 === 0) atLap1 = Math.max(...sim.car.wheels.map((w) => w.wear));
    }
    return { perLap: Math.max(...sim.car.wheels.map((w) => w.wear)) - atLap1, time: sim.timer.lastLap! };
  }

  it('lasts ~12 laps of Harrowmere at the normal rate, ~4 at high', async () => {
    const high = await laps('high');
    // To the cliff (80 % worn): 3–5 laps high, so 10–14 normal.
    expect(0.8 / high.perLap).toBeGreaterThan(3);
    expect(0.8 / high.perLap).toBeLessThan(5);
  }, 300_000);

  it('makes a worn car slower', async () => {
    const fresh = await laps('off');
    const worn = await laps('off', 0.95);
    expect(worn.time / fresh.time).toBeGreaterThan(1.02);
  }, 300_000);
});

describe('fuel', () => {
  it('burns with the engine’s output', () => {
    expect(fuelBurned(3.6e6, 0.35)).toBeCloseTo(0.35, 9);
    expect(fuelBurned(-5, 0.35)).toBe(0);
  });

  it('burns faster at full throttle, makes the car heavier, and never runs below empty', async () => {
    // (Rapier takes a new mass on its next step.)
    const s = await createSim(LONG_OVAL);
    s.step(NO_CONTROLS);
    const empty = s.car.body.mass();
    s.car.setFuel(40);
    s.step(NO_CONTROLS);
    expect(s.car.body.mass() - empty).toBeCloseTo(40, 3);
    run(s, controls({ throttle: 1 }), 10);
    const hard = 40 - s.car.fuel;
    const c = await createSim(LONG_OVAL);
    c.car.setFuel(40);
    run(c, followLine(c, 15), 10);
    const easy = 40 - c.car.fuel;
    expect(hard).toBeGreaterThan(3 * easy);
    expect(easy).toBeGreaterThan(0);
    // The mass follows the fuel burned.
    expect(Math.abs(s.car.body.mass() - (empty + s.car.fuel))).toBeLessThan(0.3);
    s.car.setFuel(0.01);
    run(s, controls({ throttle: 1 }), 3);
    s.step(NO_CONTROLS);
    expect(s.car.fuel).toBe(0);
    expect(Math.abs(s.car.body.mass() - empty)).toBeLessThan(1e-3);
    expect(Number.isFinite(s.car.speed)).toBe(true);
  });
});
