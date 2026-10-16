// Tyre wear: a tyre wears with the energy it dissipates in its contact patch (its force times
// how fast the patch slides), so wheelspin, lock-ups and slides wear it far faster than the
// same distance driven smoothly. Its grip falls gently as it wears, then sharply past the
// cliff. Fuel: burned with the engine's output. Pure.

import { TUNING } from '../config';

export type WearRate = 'off' | 'normal' | 'high';

export const WEAR_RATES: readonly WearRate[] = ['off', 'normal', 'high'];

/** How many times the normal rate a tyre wears at `rate`. */
export function wearFactor(rate: WearRate): number {
  return TUNING.wear.rates[rate];
}

/**
 * Power dissipated in a contact patch (W): the longitudinal force against the patch's
 * sliding speed along the wheel (ωr − v), plus the lateral force against its sideways speed.
 */
export function patchPower(fx: number, fy: number, slideLong: number, slideLat: number): number {
  return Math.abs(fx * slideLong) + Math.abs(fy * slideLat);
}

/** The tyre's grip at `wear` (0 new … 1 worn out), as a share of a new tyre's. */
export function wearGrip(wear: number): number {
  const W = TUNING.wear;
  const w = Math.min(1, Math.max(0, wear));
  if (w <= W.cliff) return 1 - (W.drop * w) / W.cliff;
  return 1 - W.drop - W.beyond * (w - W.cliff);
}

/** Fuel burned (kg) for `energy` joules out of the engine at `burn` kg per kWh. */
export function fuelBurned(energy: number, burn: number): number {
  return (Math.max(0, energy) / 3.6e6) * burn;
}
