// The drivetrain: engine → clutch → gearbox → differential → the driven wheels (the rear or
// front pair, or all four through a centre differential: `CarDef.drivetrain`).
//
// Once per physics step `update` makes the decisions: the automatic's gear choice or the
// driver's shift requests, the automatic reverse, how far the automatic clutch is in,
// idle control and the rev limiter. Then, inside the car's wheel substeps, `substep`
// integrates the engine and the driven wheels together. Three couplings join them, each
// a velocity constraint with a torque limit, solved by a few Gauss-Seidel passes:
//   clutch:       engine speed = gearbox input speed, up to the clutch's torque capacity
//   differential: left wheel speed = right wheel speed, up to its locking torque
//   brakes:       wheel speed = 0, up to the brake (and rolling resistance) torque
// (All-wheel drive adds a fourth, the centre differential: front axle speed = rear axle speed,
// up to its locking torque.)
// So a locked clutch is rigid (the engine's inertia joins the wheels'), a slipping one
// passes exactly its capacity, and brakes stop wheels without ever reversing them.

import { TUNING } from '../config';
import { clamp } from '../math';
import type { CarDef } from './carDef';
import { lockingTorque } from './differential';
import { engineTorque, RPM_PER_RAD_S } from './engine';
import { Gearbox, NEUTRAL, REVERSE, type GearboxMode } from './gearbox';
import type { SpinBody } from './spin';

export interface ClutchDef {
  /** Torque the clutch can carry fully engaged (N·m). */
  maxTorque: number;
  /** The automatic clutch comes in at most this fast while pulling away (fraction per second)... */
  engageRate: number;
  /** ...holding the engine near this RPM at full throttle (proportionally less at part throttle). */
  launchRpm: number;
}

/** Drive torque each driven wheel got this substep (N·m). */
export interface DriveOut {
  left: number;
  right: number;
}

type DrivetrainCar = Pick<CarDef, 'engine' | 'gearbox' | 'clutch' | 'differential' | 'drivetrain'>;

export class Drivetrain {
  readonly gearbox: Gearbox;
  /** Engine speed (rad/s). */
  engineOmega = 0;
  /** Clutch engagement this step (0–1): the automatic clutch, the pedal and the shift together. */
  clutch = 0;
  /** Throttle the engine gets this step, after shifts, idle control and the limiter. */
  throttle = 0;
  /** The rev limiter is cutting the fuel. */
  limiter = false;
  /** Traction control is on (set by the car): launches feed the clutch in rather than dump it. */
  tractionControl = false;
  /** Traction control's share of the engine's drive torque (1 = all of it), set by the car each substep. */
  tcFactor = 1;
  /** Torque the engine sent through the clutch in the last substep (N·m; negative when engine braking). */
  clutchTorque = 0;
  /** The pedals after the automatic's reverse swap (in reverse, brake drives and throttle brakes). */
  drivePedal = 0;
  brakePedal = 0;

  /** The automatic clutch has caught up and stays fully in. */
  private latched = false;
  private autoClutch = 0;
  /** A full-throttle launch has reached its bite point and dumped the clutch. */
  private dumped = false;
  /** A gear has just gone in and the clutch is still bringing the engine to speed. */
  private syncing = false;
  /** Reverse can be selected: the brake has been released since the car stopped. */
  private reverseArmed = false;

  constructor(private readonly def: DrivetrainCar) {
    this.gearbox = new Gearbox(def.gearbox);
    this.reset();
  }

  get rpm(): number {
    return this.engineOmega * RPM_PER_RAD_S;
  }

  /** Engine idling, in first, clutch out. */
  reset(): void {
    this.engineOmega = this.def.engine.idleRpm / RPM_PER_RAD_S;
    this.gearbox.set(1);
    this.clutch = this.autoClutch = this.clutchTorque = this.throttle = 0;
    this.tcFactor = 1;
    this.latched = this.limiter = this.reverseArmed = this.dumped = this.syncing = false;
  }

  setMode(mode: GearboxMode): void {
    const gb = this.gearbox;
    if (mode === gb.mode) return;
    gb.mode = mode;
    if (mode === 'auto' && gb.shifting === 0 && gb.gear === NEUTRAL) gb.set(1);
  }

  /**
   * Once per physics step. `axleOmega` is the driven wheels' mean angular velocity and
   * `speed` the car's forward speed (m/s).
   */
  update(
    controls: { throttle: number; brake: number; clutch: number; shift: number; handbrake: number },
    axleOmega: number,
    speed: number,
    dt: number,
  ): void {
    const gb = this.gearbox;
    const T = TUNING.transmission;
    const E = this.def.engine;
    const G = this.def.gearbox;
    const rpm = this.rpm;
    const inputRpmIn = (gear: number) => Math.abs(axleOmega * gb.ratio(gear)) * RPM_PER_RAD_S;

    // Automatic reverse: brake from a standstill selects it, throttle leaves it.
    const stopped = Math.abs(speed) < T.reverseBelow;
    if (!stopped) this.reverseArmed = false;
    else if (controls.brake === 0) this.reverseArmed = true;
    if (gb.mode === 'auto') {
      if (gb.nextGear !== REVERSE && stopped && this.reverseArmed && controls.brake > 0 && controls.throttle === 0) gb.shiftTo(REVERSE);
      else if (gb.nextGear === REVERSE && controls.throttle > 0 && controls.brake === 0 && speed > -T.reverseBelow) gb.shiftTo(1);
    }
    const swap = gb.mode === 'auto' && gb.nextGear === REVERSE;
    this.drivePedal = swap ? controls.brake : controls.throttle;
    this.brakePedal = swap ? controls.throttle : controls.brake;

    // Manual: the driver's requests, refusing reverse on the move and over-revving downshifts.
    if (gb.mode === 'manual' && controls.shift !== 0) {
      const to = gb.gear + controls.shift;
      const reverseOk = to !== REVERSE || Math.abs(speed) < T.reverseShiftBelow;
      const revsOk = to < 1 || inputRpmIn(to) < E.limiterRpm + T.overRevMargin;
      if (reverseOk && revsOk) gb.shiftTo(to);
    }

    // Automatic: up at a shift point that rises with the throttle, down when the revs drop
    // (later with more throttle, i.e. kickdown). Off the throttle it holds the gear for
    // engine braking into a corner, shifting up only at the full-throttle point.
    if (gb.mode === 'auto' && gb.shifting === 0 && gb.gear >= 1 && gb.sinceShift > T.shiftPause) {
      const input = inputRpmIn(gb.gear);
      const p = this.drivePedal;
      const upAt = p === 0 ? G.upshiftRpm.full : G.upshiftRpm.light + (G.upshiftRpm.full - G.upshiftRpm.light) * p;
      const downAt = G.downshiftRpm.coast + (G.downshiftRpm.full - G.downshiftRpm.coast) * p;
      if (input > upAt && gb.gear < gb.top) gb.shiftTo(gb.gear + 1);
      else if (gb.gear > 1 && input < downAt && inputRpmIn(gb.gear - 1) < upAt - T.downshiftMargin) gb.shiftTo(gb.gear - 1);
    }
    const gearBefore = gb.gear;
    gb.update(dt);
    // A new gear is in: the clutch has to bring the engine to the gearbox's speed.
    if (gb.gear !== gearBefore && gb.gear !== NEUTRAL) this.syncing = true;

    // Automatic clutch: slips while pulling away (more revs, more clutch), then latches fully in
    // once the gearbox has caught up with the engine, and lets go before the engine would stall.
    const inputOmega = axleOmega * gb.ratio();
    const inputRpm = Math.abs(inputOmega) * RPM_PER_RAD_S;
    if (gb.gear === NEUTRAL) {
      this.latched = false;
      this.autoClutch = 0;
    } else if (this.latched) {
      if (inputRpm < E.idleRpm + T.unlatchAboveIdle) this.latched = false;
    } else {
      // Pulling away: the clutch carries the engine's torque (what traction control leaves of
      // it), plus more the further the revs are above a bite point set by the throttle, so the
      // engine holds near the bite point while the car gathers speed. At (nearly) full throttle it is dumped instead:
      // held out until the revs reach the bite point, then snapped in, so the flywheel's
      // energy spins the wheels (traction control's job to tame, in Milestone 2). Off the
      // throttle it lets go.
      const C = this.def.clutch;
      const p = this.drivePedal;
      const bite = E.idleRpm + p * (C.launchRpm - E.idleRpm);
      const launching = p >= T.launchDumpPedal && !this.tractionControl;
      if (!launching) this.dumped = false;
      else if (rpm >= bite) this.dumped = true;
      const target = launching
        ? this.dumped
          ? 1
          : 0
        : clamp((engineTorque(E, rpm, p) * this.tcFactor + T.biteGain * p * (rpm - bite)) / C.maxTorque, 0, 1);
      this.autoClutch = p === 0 ? 0 : Math.min(target, this.autoClutch + C.engageRate * dt);
      const slipRpm = Math.abs(this.engineOmega - inputOmega) * RPM_PER_RAD_S;
      // Not while traction control is cutting: latched onto spinning wheels, the flywheel keeps them spinning.
      if (slipRpm < T.latchSlipRpm && inputRpm > E.idleRpm + T.latchAboveIdle && this.tcFactor === 1) this.latched = true;
    }
    if (this.latched) this.autoClutch = 1;
    // Pulling the handbrake dips the clutch, as a driver would, so the engine keeps running.
    if (controls.handbrake > T.handbrakeClutch) {
      this.latched = false;
      this.autoClutch = 0;
    }
    this.clutch = Math.min(this.autoClutch, 1 - clamp(controls.clutch, 0, 1)) * gb.clutchAllowed;
    // After a shift, the clutch slips at a set torque while the revs come into step, as an
    // automated gearbox's does: the engine's own torque plus `shiftSyncTorque`. The rest of
    // the speed difference goes into heat instead of kicking the driven wheels.
    if (this.syncing) {
      const slipRpm = Math.abs(this.engineOmega - inputOmega) * RPM_PER_RAD_S;
      if (slipRpm < T.latchSlipRpm || gb.gear === NEUTRAL) this.syncing = false;
      else {
        const carry = Math.abs(engineTorque(E, rpm, this.drivePedal)) + T.shiftSyncTorque;
        this.clutch = Math.min(this.clutch, carry / this.def.clutch.maxTorque);
      }
    }

    // Throttle: cut while the old gear comes out (blipped to match revs on a downshift),
    // held up at idle, cut by the limiter.
    let throttle = this.drivePedal;
    if (gb.disengaging) {
      const next = gb.nextGear;
      const down = Math.abs(gb.ratio(next)) > Math.abs(gb.ratio(gb.gear)) && next !== NEUTRAL;
      throttle = down ? clamp((inputRpmIn(next) - rpm) * T.revMatchGain, 0, 1) : 0;
    }
    const D = TUNING.drivetrain;
    if (rpm < E.idleRpm) throttle = Math.max(throttle, clamp((E.idleRpm - rpm) * D.idleGain, 0, 1));
    if (rpm > E.limiterRpm) this.limiter = true;
    else if (rpm < E.limiterRpm - D.limiterHysteresis) this.limiter = false;
    this.throttle = this.limiter ? 0 : throttle;
  }

  /**
   * Advance the engine and the driven wheels by `h` seconds. Each wheel's `torque` is the
   * tyre's reaction this substep and its `friction` the brake and rolling resistance.
   */
  substep(h: number, left: SpinBody, right: SpinBody, out: DriveOut): void {
    const E = this.def.engine;
    const ratio = this.gearbox.ratio();
    const capClutch = ratio === 0 ? 0 : this.clutch * this.def.clutch.maxTorque * h;

    let torque = engineTorque(E, this.rpm, this.throttle);
    // Traction control takes away drive, but never turns it into engine braking.
    if (torque > 0) torque *= this.tcFactor;
    // Gearbox losses take a share of the drive torque while the clutch is in.
    if (torque > 0) torque *= 1 - (1 - this.def.gearbox.efficiency) * this.clutch;
    let we = this.engineOmega + (h * torque) / E.inertia;
    let wl = left.omega + (h * left.torque) / left.inertia;
    let wr = right.omega + (h * right.torque) / right.inertia;

    const iE = 1 / E.inertia;
    const iL = 1 / left.inertia;
    const iR = 1 / right.inertia;
    const half = ratio / 2;
    const massClutch = 1 / (iE + half * half * (iL + iR));
    const massDiff = 1 / (iL + iR);
    const capDiff = lockingTorque(this.def.differential, this.clutchTorque * ratio) * h;
    const capLeft = left.friction * h;
    const capRight = right.friction * h;

    let clutch = 0;
    let diff = 0;
    let brakeLeft = 0;
    let brakeRight = 0;
    for (let k = 0; k < TUNING.drivetrain.solverIterations; k++) {
      if (capClutch > 0) {
        const previous = clutch;
        clutch = clamp(clutch - massClutch * (we - half * (wl + wr)), -capClutch, capClutch);
        const d = clutch - previous;
        we += d * iE;
        wl -= d * half * iL;
        wr -= d * half * iR;
      }
      if (capDiff > 0) {
        const previous = diff;
        diff = clamp(diff - massDiff * (wl - wr), -capDiff, capDiff);
        const d = diff - previous;
        wl += d * iL;
        wr -= d * iR;
      }
      if (capLeft > 0) {
        const previous = brakeLeft;
        brakeLeft = clamp(brakeLeft - left.inertia * wl, -capLeft, capLeft);
        wl += (brakeLeft - previous) * iL;
      }
      if (capRight > 0) {
        const previous = brakeRight;
        brakeRight = clamp(brakeRight - right.inertia * wr, -capRight, capRight);
        wr += (brakeRight - previous) * iR;
      }
    }

    this.engineOmega = Math.max(0, we);
    left.omega = wl;
    right.omega = wr;
    this.clutchTorque = -clutch / h;
    out.left = (-clutch * half + diff) / h;
    out.right = (-clutch * half - diff) / h;
  }

  /**
   * All-wheel drive: as `substep`, with the engine driving all four wheels through a centre
   * differential. Its carrier turns at `split·front + (1 − split)·rear` (each axle's mean
   * speed), so the clutch's torque divides `split : 1 − split` between the axles, and its
   * locking resists the axles turning at different speeds. Each axle then has its own
   * differential, as a two-wheel-drive car's.
   */
  substepAwd(h: number, fl: SpinBody, fr: SpinBody, rl: SpinBody, rr: SpinBody, front: DriveOut, rear: DriveOut): void {
    const E = this.def.engine;
    const centre = this.def.drivetrain.centre;
    const split = centre ? centre.split : 0.5;
    const ratio = this.gearbox.ratio();
    const capClutch = ratio === 0 ? 0 : this.clutch * this.def.clutch.maxTorque * h;

    let torque = engineTorque(E, this.rpm, this.throttle);
    if (torque > 0) torque *= this.tcFactor;
    if (torque > 0) torque *= 1 - (1 - this.def.gearbox.efficiency) * this.clutch;
    let we = this.engineOmega + (h * torque) / E.inertia;
    const wheels = this.awd;
    wheels[0] = fl;
    wheels[1] = fr;
    wheels[2] = rl;
    wheels[3] = rr;
    const w = this.awdOmega;
    const inv = this.awdInverse;
    for (let i = 0; i < 4; i++) {
      const b = wheels[i];
      w[i] = b.omega + (h * b.torque) / b.inertia;
      inv[i] = 1 / b.inertia;
    }

    const iE = 1 / E.inertia;
    // The clutch's lever on each wheel: half its axle's share of the gearbox output.
    const jF = (ratio * split) / 2;
    const jR = (ratio * (1 - split)) / 2;
    const massClutch = 1 / (iE + jF * jF * (inv[0] + inv[1]) + jR * jR * (inv[2] + inv[3]));
    const massCentre = 4 / (inv[0] + inv[1] + inv[2] + inv[3]);
    const massFront = 1 / (inv[0] + inv[1]);
    const massRear = 1 / (inv[2] + inv[3]);
    const input = this.clutchTorque * ratio;
    const capCentre = centre ? lockingTorque(centre.diff, input) * h : 0;
    const capFront = this.def.drivetrain.front ? lockingTorque(this.def.drivetrain.front, input * split) * h : 0;
    const capRear = lockingTorque(this.def.differential, input * (1 - split)) * h;
    const cap = this.awdBrakeCap;
    const brake = this.awdBrake;
    for (let i = 0; i < 4; i++) {
      cap[i] = wheels[i].friction * h;
      brake[i] = 0;
    }

    let clutch = 0;
    let mid = 0;
    let diffF = 0;
    let diffR = 0;
    for (let k = 0; k < TUNING.drivetrain.solverIterations; k++) {
      if (capClutch > 0) {
        const previous = clutch;
        clutch = clamp(clutch - massClutch * (we - jF * (w[0] + w[1]) - jR * (w[2] + w[3])), -capClutch, capClutch);
        const d = clutch - previous;
        we += d * iE;
        w[0] -= d * jF * inv[0];
        w[1] -= d * jF * inv[1];
        w[2] -= d * jR * inv[2];
        w[3] -= d * jR * inv[3];
      }
      if (capCentre > 0) {
        const previous = mid;
        mid = clamp(mid - massCentre * ((w[0] + w[1] - w[2] - w[3]) / 2), -capCentre, capCentre);
        const d = (mid - previous) / 2;
        w[0] += d * inv[0];
        w[1] += d * inv[1];
        w[2] -= d * inv[2];
        w[3] -= d * inv[3];
      }
      if (capFront > 0) {
        const previous = diffF;
        diffF = clamp(diffF - massFront * (w[0] - w[1]), -capFront, capFront);
        const d = diffF - previous;
        w[0] += d * inv[0];
        w[1] -= d * inv[1];
      }
      if (capRear > 0) {
        const previous = diffR;
        diffR = clamp(diffR - massRear * (w[2] - w[3]), -capRear, capRear);
        const d = diffR - previous;
        w[2] += d * inv[2];
        w[3] -= d * inv[3];
      }
      for (let i = 0; i < 4; i++) {
        if (cap[i] <= 0) continue;
        const previous = brake[i];
        brake[i] = clamp(brake[i] - wheels[i].inertia * w[i], -cap[i], cap[i]);
        w[i] += (brake[i] - previous) * inv[i];
      }
    }

    this.engineOmega = Math.max(0, we);
    for (let i = 0; i < 4; i++) wheels[i].omega = w[i];
    this.clutchTorque = -clutch / h;
    front.left = (-clutch * jF + mid / 2 + diffF) / h;
    front.right = (-clutch * jF + mid / 2 - diffF) / h;
    rear.left = (-clutch * jR - mid / 2 + diffR) / h;
    rear.right = (-clutch * jR - mid / 2 - diffR) / h;
  }

  /** The speed the gearbox's output turns at (rad/s), from the driven wheels'. */
  outputOmega(fl: number, fr: number, rl: number, rr: number): number {
    const D = this.def.drivetrain;
    if (D.layout === 'rwd') return (rl + rr) / 2;
    if (D.layout === 'fwd') return (fl + fr) / 2;
    const split = D.centre ? D.centre.split : 0.5;
    return (split * (fl + fr) + (1 - split) * (rl + rr)) / 2;
  }

  // All-wheel drive's scratch, so the substep allocates nothing.
  private readonly awd: SpinBody[] = [];
  private readonly awdOmega = new Float64Array(4);
  private readonly awdInverse = new Float64Array(4);
  private readonly awdBrakeCap = new Float64Array(4);
  private readonly awdBrake = new Float64Array(4);
}
