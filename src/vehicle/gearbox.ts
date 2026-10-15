// The gearbox: ratios and the timing of a shift. Deciding when to shift (the automatic,
// or the driver's requests in manual) is the drivetrain's job.
//
// A shift takes `shiftTime`: for the first half the clutch is out and the old gear comes
// out; at the midpoint the new gear goes in; for the second half the clutch comes back in.

export interface GearboxDef {
  /** Forward gear ratios, first gear first. */
  ratios: readonly number[];
  reverse: number;
  finalDrive: number;
  /** Fraction of the engine's torque that reaches the wheels. */
  efficiency: number;
  /** Seconds from starting a shift to the clutch being fully back in. */
  shiftTime: number;
  /** The automatic shifts up at this RPM, from `light` (barely any throttle) to `full` (full throttle, or lifted off)... */
  upshiftRpm: { light: number; full: number };
  /** ...and down below this RPM, from `coast` (no throttle) to `full` (full throttle, i.e. kickdown). */
  downshiftRpm: { coast: number; full: number };
}

export type GearboxMode = 'auto' | 'manual';

/** Gear numbers: -1 reverse, 0 neutral, 1.. forward. */
export const REVERSE = -1;
export const NEUTRAL = 0;

export class Gearbox {
  gear = 1;
  mode: GearboxMode = 'auto';
  /** Seconds left of the current shift (0 = not shifting). */
  shifting = 0;
  /** Seconds since the last shift finished. */
  sinceShift = Infinity;
  private target = 1;

  constructor(readonly def: GearboxDef) {}

  get top(): number {
    return this.def.ratios.length;
  }

  /** The gear a shift in progress is going to (or the current gear). */
  get nextGear(): number {
    return this.shifting > 0 ? this.target : this.gear;
  }

  /** Overall ratio from engine to wheels for `gear`, including the final drive: negative in reverse, 0 in neutral. */
  ratio(gear = this.gear): number {
    if (gear === NEUTRAL) return 0;
    const box = gear === REVERSE ? -this.def.reverse : this.def.ratios[gear - 1];
    return box * this.def.finalDrive;
  }

  /** True while the old gear is coming out (first half of a shift). */
  get disengaging(): boolean {
    return this.shifting > this.def.shiftTime / 2;
  }

  /** How far the shift sequence lets the clutch in: 0 while changing gear, ramping back to 1. */
  get clutchAllowed(): number {
    if (this.shifting <= 0) return 1;
    if (this.disengaging) return 0;
    return 1 - this.shifting / (this.def.shiftTime / 2);
  }

  /** Start a shift to `gear`. Ignored mid-shift or for a gear that doesn't exist. */
  shiftTo(gear: number): boolean {
    if (this.shifting > 0 || gear === this.gear || gear < REVERSE || gear > this.top) return false;
    this.target = gear;
    this.shifting = this.def.shiftTime;
    return true;
  }

  /** Put it straight into `gear` with no shift (for resets). */
  set(gear: number): void {
    this.gear = this.target = gear;
    this.shifting = 0;
    this.sinceShift = Infinity;
  }

  update(dt: number): void {
    if (this.shifting <= 0) {
      this.sinceShift += dt;
      return;
    }
    const wasDisengaging = this.disengaging;
    this.shifting = Math.max(0, this.shifting - dt);
    if (wasDisengaging && !this.disengaging) this.gear = this.target;
    if (this.shifting === 0) {
      this.gear = this.target;
      this.sinceShift = 0;
    }
  }
}
