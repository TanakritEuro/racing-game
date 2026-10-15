// Tyre forces: Pacejka's Magic Formula for the shape of each force against slip, load
// sensitivity (grip per newton falls as the load rises) and combined slip (braking or
// driving in a corner costs lateral grip).
//
// Pure functions on numbers. `tyreForces` writes into a caller-owned object so the
// per-wheel, per-substep loop allocates nothing.

/** One Magic Formula curve: y = sin(C·atan(Bx − E(Bx − atan Bx))), peak 1 at the peak slip. */
export interface CurveDef {
  /** Stiffness factor: with C it sets the slope at zero slip (B·C per unit slip). */
  B: number;
  /** Shape factor (> 1): sets how far the force falls past the peak, to sin(C·π/2) when sliding. */
  C: number;
  /** Curvature factor (≤ 1): reshapes the curve around the peak. */
  E: number;
}

/** The tyre's force characteristics. A car's tyre data extends this. */
export interface TyreModel {
  /** Force against slip ratio (dimensionless). */
  long: CurveDef;
  /** Force against slip angle (rad). */
  lat: CurveDef;
  /** Peak friction coefficient at the nominal load. */
  mu: number;
  /** Load at which the peak friction is `mu` (N). */
  nominalLoad: number;
  /** Load sensitivity exponent k: μ = mu · (load / nominalLoad)^(−k). */
  loadSensitivity: number;
}

/** A `TyreModel` with its peak slips worked out once, ready for the per-step loop. */
export interface PreparedTyre extends TyreModel {
  /** Slip ratio and slip angle (rad) at which each curve peaks. */
  peakSlipRatio: number;
  peakSlipAngle: number;
}

export interface TyreForce {
  /** Along the wheel's heading, positive forward (N). */
  fx: number;
  /** Across it, positive to the wheel's right (N). */
  fy: number;
}

export function magicFormula(x: number, c: CurveDef): number {
  const bx = c.B * x;
  return Math.sin(c.C * Math.atan(bx - c.E * (bx - Math.atan(bx))));
}

/** The slip where the curve peaks: where C·atan(…) reaches π/2. Requires C > 1 and E ≤ 1. */
export function peakSlip(c: CurveDef): number {
  const target = Math.tan(Math.PI / (2 * c.C));
  const inner = (x: number) => c.B * x - c.E * (c.B * x - Math.atan(c.B * x));
  // `inner` rises monotonically for E ≤ 1: bracket, then bisect.
  let hi = 1 / c.B;
  while (inner(hi) < target) hi *= 2;
  let lo = 0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (inner(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function prepareTyre<T extends TyreModel>(model: T): T & PreparedTyre {
  return { ...model, peakSlipRatio: peakSlip(model.long), peakSlipAngle: peakSlip(model.lat) };
}

/** Peak friction coefficient at `load` (N): falls as the load rises. */
export function frictionCoefficient(t: TyreModel, load: number): number {
  return t.mu * Math.pow(load / t.nominalLoad, -t.loadSensitivity);
}

/** The most force the tyre can make at `load` on a surface with relative grip `grip`, in any direction (N). */
export function gripLimit(t: TyreModel, load: number, grip: number): number {
  return load > 0 ? grip * frictionCoefficient(t, load) * load : 0;
}

/**
 * Tyre forces for a slip ratio κ and slip angle α (rad) at `load` (N), on a surface with
 * relative grip `grip`. Positive κ (wheel turning faster than the ground passes) drives
 * forward; positive α (contact patch moving to the right) pushes left.
 *
 * Combined slip by normalised slip: each slip is divided by its peak slip, and the
 * length ρ of that vector decides how far along the curves the tyre is. Both curves are
 * evaluated at ρ and the force is split by the slip vector's direction, so the total
 * stays inside the friction circle and braking in a corner costs lateral grip.
 */
export function tyreForces(t: PreparedTyre, slipRatio: number, slipAngle: number, load: number, grip: number, out: TyreForce): TyreForce {
  out.fx = 0;
  out.fy = 0;
  if (load <= 0) return out;
  const sx = slipRatio / t.peakSlipRatio;
  const sy = slipAngle / t.peakSlipAngle;
  const rho = Math.hypot(sx, sy);
  if (rho < 1e-12) return out;
  const peak = gripLimit(t, load, grip);
  out.fx = (peak * magicFormula(rho * t.peakSlipRatio, t.long) * sx) / rho;
  out.fy = (-peak * magicFormula(rho * t.peakSlipAngle, t.lat) * sy) / rho;
  return out;
}
