import { describe, expect, it } from 'vitest';
import { initPhysics } from '../src/physics';
import { Race } from '../src/race/race';
import { RIDGEBACK, TEST_CIRCUIT } from '../src/track/circuits';
import { buildTrack } from '../src/track/track';
import { controls, NO_CONTROLS } from '../src/vehicle/car';
import type { CarDef } from '../src/vehicle/carDef';
import { KESTREL } from '../src/vehicle/cars';
import { applySetup, cleanSetup, SETTINGS, setupReadout, type SettingId, type Setup } from '../src/vehicle/setup';
import { createSim, followLine, run, runUntil, skidpadLimit } from './helpers';
import { LONG_OVAL, SKIDPAD } from './tracks';

const KMH_100 = 100 / 3.6;
const FULL_THROTTLE = controls({ throttle: 1 });

/** Every number in a car definition, by path. */
function numbers(value: unknown, path = '', out = new Map<string, number>()): Map<string, number> {
  if (typeof value === 'number') out.set(path, value);
  else if (typeof value === 'object' && value !== null) for (const [k, v] of Object.entries(value)) numbers(v, path ? `${path}.${k}` : k, out);
  return out;
}

/** The paths whose numbers differ between two cars. */
function changed(a: CarDef, b: CarDef): string[] {
  const x = numbers(a);
  const y = numbers(b);
  return [...x.keys()].filter((k) => x.get(k) !== y.get(k)).sort();
}

const TOUCHES: Record<SettingId, string[]> = {
  springsFront: ['suspension.front.bump', 'suspension.front.rebound', 'suspension.front.stiffness'],
  springsRear: ['suspension.rear.bump', 'suspension.rear.rebound', 'suspension.rear.stiffness'],
  antiRollFront: ['suspension.front.antiRoll'],
  antiRollRear: ['suspension.rear.antiRoll'],
  dampers: ['suspension.front.bump', 'suspension.front.rebound', 'suspension.rear.bump', 'suspension.rear.rebound'],
  rideHeight: ['suspension.front.restLength', 'suspension.rear.restLength'],
  wingFront: ['aero.dragArea', 'aero.lift.front'],
  wingRear: ['aero.dragArea', 'aero.lift.rear'],
  brakeBias: ['brakes.frontBias'],
  diff: ['differential.preload', 'differential.ramp'],
  gearing: ['gearbox.finalDrive'],
};

describe('a setup', () => {
  it('leaves the car as designed at zero clicks, and never changes the original', () => {
    expect(applySetup(KESTREL, {})).toBe(KESTREL);
    expect(applySetup(KESTREL, { gearing: 0, dampers: 0 })).toBe(KESTREL);
    const before = structuredClone(KESTREL);
    applySetup(KESTREL, { springsFront: 5, wingRear: -5, gearing: 3 });
    expect(KESTREL).toEqual(before);
  });

  it('drops what it does not know and keeps clicks whole and in range', () => {
    expect(cleanSetup({ gearing: 9, dampers: -7.6, diff: 1.4, nonsense: 3, wingFront: 'more', rideHeight: Number.NaN, brakeBias: 0 })).toEqual({
      gearing: 5,
      dampers: -5,
      diff: 1,
    });
    expect(cleanSetup(null)).toEqual({});
    expect(cleanSetup([1, 2])).toEqual({});
  });

  it('moves only its own numbers, each setting', () => {
    for (const s of SETTINGS) {
      expect(changed(KESTREL, applySetup(KESTREL, { [s.id]: 3 })), s.id).toEqual(TOUCHES[s.id]);
    }
  });

  it('moves the numbers the way its label says', () => {
    const stock = setupReadout(KESTREL);
    const with_ = (setup: Setup) => setupReadout(applySetup(KESTREL, setup));
    // The stock car: ~44 % of the roll stiffness at the front, ~560 N at 200 km/h, ~245 km/h.
    expect(stock.frontRollShare).toBeCloseTo(0.44, 2);
    expect(stock.downforce200).toBeGreaterThan(500);
    expect(stock.downforce200).toBeLessThan(600);
    expect(stock.topSpeed * 3.6).toBeGreaterThan(235);
    expect(stock.topSpeed * 3.6).toBeLessThan(260);
    expect(with_({ antiRollFront: 3 }).frontRollShare).toBeGreaterThan(stock.frontRollShare);
    expect(with_({ antiRollRear: 3 }).frontRollShare).toBeLessThan(stock.frontRollShare);
    expect(with_({ springsFront: 3 }).frontRollShare).toBeGreaterThan(stock.frontRollShare);
    const winged = with_({ wingFront: 5, wingRear: 5 });
    expect(winged.downforce200).toBeGreaterThan(stock.downforce200 * 1.5);
    expect(winged.topSpeed).toBeLessThan(stock.topSpeed);
    expect(with_({ wingFront: 5 }).downforceFront).toBeGreaterThan(stock.downforceFront);
    expect(with_({ gearing: 5 }).topSpeed).toBeLessThan(stock.topSpeed);
    expect(with_({ brakeBias: -5 }).brakeBias).toBeCloseTo(KESTREL.brakes.frontBias - 0.1, 9);
    // No wing on a car becomes lift.
    const bare = applySetup(KESTREL, { wingFront: -5, wingRear: -5 });
    expect(bare.aero.lift.front).toBeLessThanOrEqual(0);
    expect(bare.aero.lift.rear).toBeLessThanOrEqual(0);
  });
});

describe('a setup on the road', () => {
  it('shorter gearing reaches 100 km/h sooner and tops out lower (on the limiter)', async () => {
    const launch = async (setup: Setup) => {
      const s = await createSim(LONG_OVAL, applySetup(KESTREL, setup));
      run(s, NO_CONTROLS, 1);
      return runUntil(s, FULL_THROTTLE, () => s.car.speed > KMH_100, 15)!;
    };
    const top = async (setup: Setup) => {
      const s = await createSim(LONG_OVAL, applySetup(KESTREL, setup));
      run(s, followLine(s, 100), 65);
      return s.car.speed;
    };
    expect(await launch({ gearing: 5 })).toBeLessThan(await launch({ gearing: -5 }));
    expect(await top({ gearing: 5 })).toBeLessThan((await top({})) - 1);
  }, 120_000);

  it('more wing presses the car down harder at speed', async () => {
    const load = async (setup: Setup) => {
      const s = await createSim(LONG_OVAL, applySetup(KESTREL, setup));
      const drive = followLine(s, 50);
      runUntil(s, drive, () => s.car.speed > 49, 30);
      let sum = 0;
      for (let k = 0; k < 240; k++) {
        s.step(drive());
        sum += s.car.wheels.reduce((a, w) => a + w.load, 0);
      }
      return sum / 240 - KESTREL.mass * 9.81;
    };
    const more = await load({ wingFront: 5, wingRear: 5 });
    const less = await load({ wingFront: -5, wingRear: -5 });
    // ~950 N against ~140 N at 200 km/h: at 180 km/h, several hundred newtons apart.
    expect(more - less).toBeGreaterThan(400);
  }, 60_000);

  it('a stiffer rear anti-roll bar moves the lateral load transfer rearward', async () => {
    const soft = await skidpadLimit(SKIDPAD, applySetup(KESTREL, { antiRollRear: -5 }), 31);
    const stiff = await skidpadLimit(SKIDPAD, applySetup(KESTREL, { antiRollRear: 5 }), 31);
    expect(stiff.frontTransferShare).toBeLessThan(soft.frontTransferShare - 0.05);
  }, 120_000);

  it('brake bias far rearward locks the rears first (ABS off)', async () => {
    const stop = async (setup: Setup) => {
      const s = await createSim(LONG_OVAL, applySetup(KESTREL, setup));
      s.car.aids = { abs: false, tc: false };
      run(s, NO_CONTROLS, 1);
      runUntil(s, FULL_THROTTLE, () => s.car.speed > KMH_100, 15);
      let first: 'front' | 'rear' | null = null;
      let t = 0;
      // Squeezed on over half a second, as a driver does: the weight has time to move forward.
      runUntil(
        s,
        () => controls({ brake: Math.min(1, (t += 1 / 120) / 0.5) }),
        () => {
          const [fl, fr, rl, rr] = s.car.wheels;
          if (first === null && (rl.locked || rr.locked)) first = 'rear';
          if (first === null && (fl.locked || fr.locked)) first = 'front';
          return s.car.speed < 1;
        },
        10,
      );
      return first;
    };
    expect(await stop({ brakeBias: -5 })).toBe('rear');
    expect(await stop({})).toBe('front');
  }, 60_000);

  it('at the lowest ride height still rides the Ridgeback crests on its suspension', async () => {
    const s = await createSim(RIDGEBACK, applySetup(KESTREL, { rideHeight: -5, springsFront: -5, springsRear: -5 }));
    const drive = followLine(s, 45, { corners: true });
    let lowest = Infinity;
    for (let k = 0; k < 60 * 120; k++) {
      s.step(drive());
      for (const w of s.car.wheels) if (w.contact) lowest = Math.min(lowest, w.suspensionLength);
    }
    expect(Number.isFinite(s.car.position.x)).toBe(true);
    // Into the bump stop at worst, never through it to nothing.
    expect(lowest).toBeGreaterThan(0.05);
  }, 120_000);
});

describe('a race with a set-up car', () => {
  it('gives the player their car and the AI the car as designed', async () => {
    await initPhysics();
    const mine = applySetup(KESTREL, { gearing: 3, wingRear: 2 });
    const race = new Race(buildTrack(TEST_CIRCUIT), { opponents: 3, laps: 1, difficulty: 'easy', seed: 2 }, KESTREL, mine);
    expect(race.sim.cars[0].def).toBe(mine);
    for (const car of race.sim.cars.slice(1)) expect(car.def).toBe(KESTREL);
  });
});
