import { describe, expect, it } from 'vitest';
import { frictionCoefficient, magicFormula, peakSlip, prepareTyre, tyreForces, type TyreForce } from '../src/vehicle/tyre';

const tyre = prepareTyre({
  long: { B: 18, C: 1.45, E: 0 },
  lat: { B: 14, C: 1.35, E: -0.5 },
  mu: 1.1,
  nominalLoad: 3000,
  loadSensitivity: 0.15,
});
const LOAD = 3000;
const out: TyreForce = { fx: 0, fy: 0 };
const deg = Math.PI / 180;

const fx = (kappa: number, alpha = 0, load = LOAD) => tyreForces(tyre, kappa, alpha, load, 1, out).fx;
const fy = (alpha: number, kappa = 0, load = LOAD) => tyreForces(tyre, kappa, alpha, load, 1, out).fy;

/** Slip in [0, max] where `f` is largest, and that value, by a fine scan. */
function scanPeak(f: (x: number) => number, max: number): { x: number; y: number } {
  let best = { x: 0, y: -Infinity };
  for (let i = 0; i <= 4000; i++) {
    const x = (i / 4000) * max;
    const y = f(x);
    if (y > best.y) best = { x, y };
  }
  return best;
}

describe('tyre model', () => {
  it('makes no force without slip or load', () => {
    expect(fx(0)).toBe(0);
    expect(fy(0)).toBe(0);
    expect(fx(0.1, 0.1, 0)).toBe(0);
    expect(fy(0.1, 0.1, -50)).toBe(0);
  });

  it('is odd-symmetric, drives forward on positive slip and pushes against the slide', () => {
    for (const k of [0.01, 0.08, 0.3, 1]) expect(fx(-k)).toBeCloseTo(-fx(k), 9);
    for (const a of [1, 5, 12, 40]) expect(fy(-a * deg)).toBeCloseTo(-fy(a * deg), 9);
    expect(fx(0.05)).toBeGreaterThan(0);
    expect(fy(3 * deg)).toBeLessThan(0);
  });

  it('peaks at the computed peak slip, at μ × load', () => {
    expect(magicFormula(peakSlip(tyre.long), tyre.long)).toBeCloseTo(1, 9);
    const long = scanPeak((k) => fx(k), 1);
    expect(long.x).toBeCloseTo(tyre.peakSlipRatio, 3);
    expect(long.y).toBeCloseTo(1.1 * LOAD, 0);
    const lat = scanPeak((a) => -fy(a), 0.6);
    expect(lat.x).toBeCloseTo(tyre.peakSlipAngle, 3);
    expect(lat.y).toBeCloseTo(1.1 * LOAD, 0);
    // Sensible peaks for a road tyre: about 10 % slip and 8°.
    expect(tyre.peakSlipRatio).toBeGreaterThan(0.08);
    expect(tyre.peakSlipRatio).toBeLessThan(0.13);
    expect(tyre.peakSlipAngle / deg).toBeGreaterThan(6);
    expect(tyre.peakSlipAngle / deg).toBeLessThan(10);
  });

  it('falls past the peak to a sliding force', () => {
    expect(fx(1) / (1.1 * LOAD)).toBeGreaterThan(0.7);
    expect(fx(1) / (1.1 * LOAD)).toBeLessThan(0.9);
    expect(-fy(60 * deg) / (1.1 * LOAD)).toBeGreaterThan(0.75);
    expect(-fy(60 * deg) / (1.1 * LOAD)).toBeLessThan(0.95);
  });

  it('starts with cornering stiffness B·C·D', () => {
    const a = 1e-5;
    expect(-fy(a) / a).toBeCloseTo(14 * 1.35 * 1.1 * LOAD, -2);
  });

  it('loses grip per newton as load rises', () => {
    let previous = Infinity;
    for (const load of [1000, 2000, 3000, 5000, 8000]) {
      const mu = -scanPeak((a) => -fy(a, 0, load), 0.6).y / -load;
      expect(mu).toBeLessThan(previous);
      expect(mu).toBeCloseTo(frictionCoefficient(tyre, load), 2);
      previous = mu;
    }
    // ...but total grip still rises with load.
    expect(-fy(tyre.peakSlipAngle, 0, 6000)).toBeGreaterThan(-fy(tyre.peakSlipAngle, 0, 3000));
  });

  it('costs lateral grip when the tyre also brakes or drives', () => {
    let previous = Infinity;
    for (const kappa of [0, 0.02, 0.05, 0.1, 0.3, 1]) {
      const lateral = -fy(4 * deg, -kappa);
      expect(lateral).toBeLessThan(previous);
      previous = lateral;
    }
    expect(-fy(4 * deg, -1)).toBeLessThan(0.5 * -fy(4 * deg, 0));
  });

  it('never exceeds the friction circle', () => {
    for (const kappa of [-1, -0.2, -0.1, 0, 0.05, 0.1, 0.5]) {
      for (const alpha of [0, 2, 5, 8, 15, 45]) {
        tyreForces(tyre, kappa, alpha * deg, LOAD, 1, out);
        expect(Math.hypot(out.fx, out.fy)).toBeLessThanOrEqual(1.1 * LOAD * (1 + 1e-9));
        expect(Number.isFinite(out.fx) && Number.isFinite(out.fy)).toBe(true);
      }
    }
  });

  it('scales with surface grip', () => {
    const asphalt = tyreForces(tyre, 0.05, 3 * deg, LOAD, 1, { fx: 0, fy: 0 });
    const grass = tyreForces(tyre, 0.05, 3 * deg, LOAD, 0.6, { fx: 0, fy: 0 });
    expect(grass.fx).toBeCloseTo(0.6 * asphalt.fx, 6);
    expect(grass.fy).toBeCloseTo(0.6 * asphalt.fy, 6);
  });
});
