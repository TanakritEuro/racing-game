import { beforeEach, describe, expect, it } from 'vitest';
import type { Simulation } from '../src/sim';
import { controls, NO_CONTROLS } from '../src/vehicle/car';
import { KESTREL } from '../src/vehicle/cars';
import { createSim, followLine, run, runUntil, skidpadLimit } from './helpers';
import { BANKED_SKIDPAD, HILL, LONG_OVAL, SKIDPAD } from './tracks';
import { nearestSample } from '../src/track/track';
import { poseOnTrack } from '../src/vehicle/car';

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
  // The car's own braking: no ABS (aids.test.ts covers it).
  s.car.aids = { abs: false, tc: false };
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
    for (const w of car.wheels) expect(w.suspensionLength).toBeGreaterThan(KESTREL.suspension.front.bumpStop.length + 0.05);
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
    expect(t!).toBeGreaterThan(5.5);
    expect(t!).toBeLessThan(7.2);
  });

  it('reaches 230–255 km/h in top gear', async () => {
    const s = await createSim(LONG_OVAL);
    const driver = followLine(s, 100);
    run(s, driver, 65);
    expect(s.car.speed * 3.6).toBeGreaterThan(230);
    expect(s.car.speed * 3.6).toBeLessThan(255);
    expect(s.car.drivetrain.gearbox.gear).toBe(6);
  });

  it('shifts up near the shift point at full throttle and back down to first when stopping', async () => {
    const s = await createSim(LONG_OVAL);
    const driver = followLine(s, 100);
    const gb = s.car.drivetrain.gearbox;
    const shifts: { from: number; to: number; rpm: number }[] = [];
    for (let i = 0; i < 40 * 120; i++) {
      const before = gb.nextGear;
      s.step(driver());
      if (gb.nextGear !== before) shifts.push({ from: before, to: gb.nextGear, rpm: s.car.drivetrain.rpm });
    }
    expect(shifts.map((x) => x.to)).toEqual([2, 3, 4, 5, 6]);
    for (const x of shifts) {
      expect(x.rpm).toBeGreaterThan(KESTREL.gearbox.upshiftRpm.full - 400);
      expect(x.rpm).toBeLessThan(KESTREL.engine.limiterRpm);
    }
    runUntil(s, controls({ brake: 0.6 }), () => s.car.speed < 0.05, 30);
    run(s, controls({ brake: 0.6 }), 1);
    expect(gb.gear).toBe(1);
    expect(Math.abs(s.car.drivetrain.rpm - KESTREL.engine.idleRpm)).toBeLessThan(100);
  });

  it('slows faster with the engine braking than coasting with the clutch in', async () => {
    const decelFrom100 = async (clutch: number) => {
      const s = await createSim(LONG_OVAL);
      runUntil(s, followLine(s, 40), () => s.car.speed > KMH_100, 20);
      // Not mid-shift, in whatever gear it is in (2nd or 3rd).
      runUntil(s, followLine(s, 40), () => s.car.drivetrain.gearbox.shifting === 0, 1);
      expect(s.car.drivetrain.gearbox.gear).toBeGreaterThan(1);
      const v0 = s.car.speed;
      run(s, controls({ clutch }), 2);
      return (v0 - s.car.speed) / 2;
    };
    const engineBraking = await decelFrom100(0);
    const coasting = await decelFrom100(1);
    expect(engineBraking).toBeGreaterThan(coasting + 0.3);
    expect(coasting).toBeGreaterThan(0.3); // drag and rolling resistance alone
  });

  it('idles in neutral at rest without moving', () => {
    sim.setGearboxMode('manual');
    run(sim, controls({ shift: -1 }), 1 / 120);
    run(sim, NO_CONTROLS, 2);
    expect(sim.car.drivetrain.gearbox.gear).toBe(0);
    const from = sim.car.position;
    run(sim, NO_CONTROLS, 10);
    expect(flatDistance(from, sim.car.position)).toBeLessThan(0.001);
    expect(Math.abs(sim.car.drivetrain.rpm - KESTREL.engine.idleRpm)).toBeLessThan(60);
  });

  it('reverses in manual through neutral, at a standstill only', () => {
    sim.setGearboxMode('manual');
    run(sim, NO_CONTROLS, 1);
    run(sim, controls({ shift: -1 }), 1 / 120);
    run(sim, NO_CONTROLS, 0.5);
    run(sim, controls({ shift: -1 }), 1 / 120);
    run(sim, NO_CONTROLS, 0.5);
    expect(sim.car.reversing).toBe(true);
    run(sim, controls({ throttle: 0.5 }), 2);
    expect(sim.car.speed).toBeLessThan(-1);
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
  }, 300_000);

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

  it('holds 0.9–1.05 g on the skidpad, running out of front grip first', async () => {
    const { best, atBest, frontTransferShare } = await skidpadLimit(SKIDPAD);
    expect(best).toBeGreaterThan(0.9);
    expect(best).toBeLessThan(1.05);
    // The anti-roll bars put ~45 % of the lateral load transfer on the front axle...
    expect(frontTransferShare).toBeGreaterThan(0.4);
    expect(frontTransferShare).toBeLessThan(0.5);
    // ...and the car still understeers mildly at the limit: fronts at their peak slip angle, rears below.
    expect(atBest.front).toBeGreaterThan(atBest.rear * 1.2);
    expect(atBest.front).toBeGreaterThan(0.8 * atBest.peakSlipAngle);
  });

  it('corners harder on a 15° banked skidpad than a flat one', async () => {
    const flat = await skidpadLimit(SKIDPAD);
    // Ramped for longer: the banked circle holds well past the flat one's speeds.
    const banked = await skidpadLimit(BANKED_SKIDPAD, KESTREL, 140);
    // Banking turns part of the weight into cornering force: tan 15° ≈ 0.27 g more, less what load sensitivity takes back.
    expect(banked.best).toBeGreaterThan(flat.best + 0.15);
  });

  it('holds still with the brake on a real 10° road slope', async () => {
    const s = await createSim(HILL);
    // Mid-way up the climbing straight, facing uphill.
    const i = nearestSample(s.track, 200, 0);
    s.car.reset(poseOnTrack(s.track.samples[i]));
    run(s, controls({ brake: 1 }), 2);
    const from = s.car.position;
    run(s, controls({ brake: 1 }), 10);
    expect(flatDistance(from, s.car.position)).toBeLessThan(0.01);
    expect(Math.abs(from.y - s.car.position.y)).toBeLessThan(0.01);
    expect(s.car.reversing).toBe(false);
    // It really is on the slope: the car's nose points 10° up.
    expect(Math.asin(s.car.forward.y)).toBeCloseTo((10 * Math.PI) / 180, 1);
  });

  it('makes the expected downforce at each axle at 200 km/h', async () => {
    const cruise = async (lift: { front: number; rear: number }) => {
      const s = await createSim(LONG_OVAL, { ...KESTREL, aero: { ...KESTREL.aero, lift } });
      const driver = followLine(s, 200 / 3.6);
      run(s, driver, 30);
      const loads = { front: 0, rear: 0, speed: 0 };
      for (let i = 0; i < 120; i++) {
        s.step(driver());
        const [fl, fr, rl, rr] = s.car.wheels;
        loads.front += (fl.load + fr.load) / 120;
        loads.rear += (rl.load + rr.load) / 120;
        loads.speed += s.car.speed / 120;
      }
      return loads;
    };
    const lift = KESTREL.aero.lift;
    const withAero = await cruise(lift);
    const without = await cruise({ front: 0, rear: 0 });
    expect(withAero.speed * 3.6).toBeCloseTo(200, -1);
    const q = 0.5 * 1.2 * withAero.speed ** 2;
    expect(withAero.front - without.front).toBeCloseTo(-lift.front * q, -1.5);
    expect(withAero.rear - without.rear).toBeCloseTo(-lift.rear * q, -1.5);
    // All of it reaches the tyres: total load is the weight plus the downforce.
    const total = withAero.front + withAero.rear;
    expect(Math.abs(total - (WEIGHT - (lift.front + lift.rear) * q)) / total).toBeLessThan(0.02);
  });

  it('rolls less with its anti-roll bars', async () => {
    const roll = async (antiRoll: { front: number; rear: number }) => {
      const def = {
        ...KESTREL,
        suspension: {
          front: { ...KESTREL.suspension.front, antiRoll: antiRoll.front },
          rear: { ...KESTREL.suspension.rear, antiRoll: antiRoll.rear },
        },
      };
      const s = await createSim(SKIDPAD, def);
      run(s, followLine(s, 15, { maxThrottle: 0.4 }), 20);
      // Roll: the car's right axis tilting out of the horizontal.
      const q = s.car.rotation;
      return Math.abs(Math.asin(2 * (q.x * q.y + q.w * q.z)));
    };
    const withBars = await roll({ front: KESTREL.suspension.front.antiRoll, rear: KESTREL.suspension.rear.antiRoll });
    const without = await roll({ front: 0, rear: 0 });
    expect(withBars).toBeLessThan(0.75 * without);
    expect(without).toBeGreaterThan(0.01);
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

describe('bad input', () => {
  it('shrugs off a NaN control without its state going NaN', async () => {
    const s = await createSim();
    run(s, NO_CONTROLS, 1);
    s.step(controls({ throttle: Number.NaN, brake: Number.NaN, steer: Number.NaN }));
    run(s, controls({ throttle: 0.5 }), 2);
    for (const w of s.car.wheels) {
      expect(Number.isFinite(w.omega)).toBe(true);
      expect(Number.isFinite(w.steer)).toBe(true);
    }
    expect(s.car.speed).toBeGreaterThan(1);
  });
});
