import { describe, expect, it } from 'vitest';
import { controls, NO_CONTROLS } from '../src/vehicle/car';
import type { CarDef } from '../src/vehicle/carDef';
import { KESTREL } from '../src/vehicle/cars';
import { applyUpgrades, noUpgrades, UPGRADE_KINDS, type Upgrades } from '../src/vehicle/upgrades';
import { createSim, run, runUntil, skidpadLimit } from './helpers';
import { LONG_OVAL, SKIDPAD } from './tracks';

/** Every number in a car definition, by path. */
function numbers(value: unknown, path = '', out = new Map<string, number>()): Map<string, number> {
  if (typeof value === 'number') out.set(path, value);
  else if (typeof value === 'object' && value !== null) for (const [k, v] of Object.entries(value)) numbers(v, path ? `${path}.${k}` : k, out);
  return out;
}

const changed = (a: CarDef, b: CarDef) => {
  const x = numbers(a);
  const y = numbers(b);
  return [...x.keys()].filter((k) => x.get(k) !== y.get(k));
};

const one = (kind: keyof Upgrades, level = 3): Upgrades => ({ ...noUpgrades(), [kind]: level });

describe('upgrades', () => {
  it('leave the car as designed when there are none, and never change the original', () => {
    expect(applyUpgrades(KESTREL, noUpgrades())).toBe(KESTREL);
    const before = structuredClone(KESTREL);
    applyUpgrades(KESTREL, { engine: 3, tyres: 3, weight: 3, brakes: 3 });
    expect(KESTREL).toEqual(before);
  });

  it('each change their own numbers, the right way', () => {
    const touches: Record<string, RegExp> = { engine: /^engine\.torqueCurve\.\d+\.1$/, tyres: /^tyres\.(front|rear)\.mu$/, weight: /^mass$/, brakes: /^brakes\.maxTorque$/ };
    for (const kind of UPGRADE_KINDS) {
      const up = applyUpgrades(KESTREL, one(kind));
      const c = changed(KESTREL, up);
      expect(c.length, kind).toBeGreaterThan(0);
      for (const path of c) expect(path, kind).toMatch(touches[kind]);
    }
    expect(applyUpgrades(KESTREL, one('engine')).engine.torqueCurve[3][1]).toBeCloseTo(KESTREL.engine.torqueCurve[3][1] * 1.12, 9);
    expect(applyUpgrades(KESTREL, one('weight')).mass).toBe(KESTREL.mass - 75);
  });

  it('on the road: the engine reaches 160 km/h sooner, the tyres corner harder', async () => {
    const launch = async (def: CarDef) => {
      const s = await createSim(LONG_OVAL, def);
      run(s, NO_CONTROLS, 1);
      return runUntil(s, controls({ throttle: 1 }), () => s.car.speed > 160 / 3.6, 30)!;
    };
    // (Off the line the car is limited by its traction, not its power: further up, the engine shows.)
    const stockTime = await launch(KESTREL);
    expect(await launch(applyUpgrades(KESTREL, one('engine')))).toBeLessThan(stockTime * 0.95);
    const stock = await skidpadLimit(SKIDPAD, KESTREL);
    const grippy = await skidpadLimit(SKIDPAD, applyUpgrades(KESTREL, one('tyres')));
    expect(grippy.best).toBeGreaterThan(stock.best * 1.02);
  }, 180_000);
});
