import { describe, expect, it } from 'vitest';
import type { Simulation } from '../src/sim';
import type { AidSettings } from '../src/vehicle/aids';
import { controls, NO_CONTROLS } from '../src/vehicle/car';
import { KESTREL } from '../src/vehicle/cars';
import { createSim, followLine, run, runUntil } from './helpers';
import { LONG_OVAL } from './tracks';

const KMH_100 = 100 / 3.6;
const flatDistance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(b.x - a.x, b.z - a.z);

async function simWith(aids: AidSettings): Promise<Simulation> {
  const s = await createSim(LONG_OVAL);
  s.car.aids = aids;
  return s;
}

interface Stop {
  distance: number;
  /** Longest run of steps with a wheel locked (s). */
  longestLock: number;
  frontsLocked: boolean;
  rearsLocked: boolean;
  /** How far the car ended up to the right of where it was heading when the brake went on (m). */
  sideways: number;
}

/** At 100 km/h on the oval, lift, then stamp on the brake (holding `steer`) to a stop. */
async function stampFrom100(aids: AidSettings, steer = 0, pedal = 1): Promise<Stop> {
  const s = await simWith(aids);
  runUntil(s, followLine(s, 40), () => s.car.speed > KMH_100 + 0.5, 20);
  runUntil(s, NO_CONTROLS, () => s.car.speed < KMH_100, 5);
  const from = s.car.position;
  const f0 = s.car.forward;
  const stop: Stop = { distance: 0, longestLock: 0, frontsLocked: false, rearsLocked: false, sideways: 0 };
  let run = 0;
  runUntil(
    s,
    controls({ brake: pedal, steer }),
    () => {
      const [fl, fr, rl, rr] = s.car.wheels;
      // Below a few m/s ABS stands down so the car can stop: count lock-ups above that.
      const anyLocked = s.car.speed > 3 && s.car.wheels.some((w) => w.locked);
      run = anyLocked ? run + 1 : 0;
      stop.longestLock = Math.max(stop.longestLock, run / 120);
      if (s.car.speed > 5 && fl.locked && fr.locked) stop.frontsLocked = true;
      if (s.car.speed > 5 && (rl.locked || rr.locked)) stop.rearsLocked = true;
      return s.car.speed < 0.05;
    },
    15,
  );
  stop.distance = flatDistance(from, s.car.position);
  // The car's right on the ground, at the start, is (−fz, fx).
  const to = s.car.position;
  stop.sideways = (to.x - from.x) * -f0.z + (to.z - from.z) * f0.x;
  return stop;
}

describe('ABS', () => {
  it('off: a stamped brake locks the fronts', async () => {
    const stop = await stampFrom100({ abs: false, tc: false });
    expect(stop.frontsLocked).toBe(true);
    expect(stop.distance).toBeLessThan(55);
  });

  it('on: a stamped brake locks nothing and stops about as well as the best unlocked pedal', async () => {
    const stop = await stampFrom100({ abs: true, tc: false });
    expect(stop.longestLock).toBeLessThan(0.1);
    expect(stop.frontsLocked).toBe(false);
    // car.test.ts finds ~43 m at the best pedal, squeezed on, without locking.
    expect(stop.distance).toBeLessThan(44);
    expect(stop.distance).toBeGreaterThan(34);
  });

  it('on: the car still steers under full braking', async () => {
    // Steering right while stamping on the brake: locked fronts slide straight on, ABS turns.
    const locked = await stampFrom100({ abs: false, tc: false }, 0.5);
    const abs = await stampFrom100({ abs: true, tc: false }, 0.5);
    expect(abs.sideways).toBeGreaterThan(5);
    expect(abs.sideways).toBeGreaterThan(2 * Math.abs(locked.sideways));
  });
});

describe('traction control', () => {
  /** Wheelspin on a launch: how much faster the rear tyres' surface ran than the car in the first 1.5 s (m/s). */
  async function launch(aids: AidSettings, throttle = 1): Promise<number> {
    const s = await simWith(aids);
    run(s, NO_CONTROLS, 1);
    let most = 0;
    for (let i = 0; i < 180; i++) {
      s.step(controls({ throttle }));
      for (const w of [s.car.wheels[2], s.car.wheels[3]]) most = Math.max(most, w.omega * w.tyre.radius - s.car.speed);
    }
    return most;
  }

  async function zeroTo100(aids: AidSettings): Promise<number> {
    const s = await simWith(aids);
    run(s, NO_CONTROLS, 1);
    return runUntil(s, controls({ throttle: 1 }), () => s.car.speed > KMH_100, 15)!;
  }

  it('off: a full-throttle launch dumps the clutch and spins the rears; part throttle does not', async () => {
    expect(await launch({ abs: true, tc: false })).toBeGreaterThan(3);
    expect(await launch({ abs: true, tc: false }, 0.5)).toBeLessThan(0.5);
  });

  it('on: a full-throttle launch barely spins the rears, and is no slower', async () => {
    expect(await launch({ abs: true, tc: true })).toBeLessThan(1.5);
    const off = await zeroTo100({ abs: true, tc: false });
    const on = await zeroTo100({ abs: true, tc: true });
    expect(on).toBeLessThan(off + 0.3);
  });

  it('on: cuts drive on a slippery surface, without ever adding engine braking', async () => {
    // Tyres with ice-like grip spin whatever the clutch does, so TC has to cut.
    const slippery = { ...KESTREL.tyres.rear, mu: 0.3 };
    const spin = async (tc: boolean) => {
      const s = await createSim(LONG_OVAL, { ...KESTREL, tyres: { front: slippery, rear: slippery } });
      s.car.aids = { abs: true, tc };
      run(s, NO_CONTROLS, 1);
      let cut = false;
      let most = 0;
      for (let i = 0; i < 360; i++) {
        s.step(controls({ throttle: 1 }));
        const d = s.car.drivetrain;
        if (d.tcFactor < 1) {
          cut = true;
          expect(d.clutchTorque).toBeGreaterThanOrEqual(-1);
        }
        if (i > 120) for (const w of [s.car.wheels[2], s.car.wheels[3]]) most = Math.max(most, w.omega * w.tyre.radius - s.car.speed);
      }
      return { cut, most };
    };
    const on = await spin(true);
    const off = await spin(false);
    expect(on.cut).toBe(true);
    expect(on.most).toBeLessThan(off.most / 2);
  });
});

describe('handbrake', () => {
  it('locks the rears, not the fronts, and lets the automatic clutch go', async () => {
    const s = await simWith({ abs: true, tc: true });
    runUntil(s, followLine(s, 20), () => s.car.speed > 60 / 3.6, 20);
    run(s, controls({ handbrake: 1 }), 0.3);
    const [fl, fr, rl, rr] = s.car.wheels;
    expect(rl.locked && rr.locked).toBe(true);
    expect(fl.locked || fr.locked).toBe(false);
    expect(s.car.drivetrain.clutch).toBe(0);
    expect(s.car.drivetrain.rpm).toBeGreaterThan(600);
  });

  it('swings the car round with steering', async () => {
    const s = await simWith({ abs: true, tc: true });
    runUntil(s, followLine(s, 20), () => s.car.speed > 60 / 3.6, 20);
    let fastest = 0;
    for (let i = 0; i < 120; i++) {
      s.step(controls({ handbrake: 1, steer: -0.6 }));
      fastest = Math.max(fastest, Math.abs(s.car.body.angvel().y));
    }
    // Far more rotation than the tyres allow in a grip turn at this speed (~0.6 rad/s at 1 g).
    expect(fastest).toBeGreaterThan(1);
  });
});
