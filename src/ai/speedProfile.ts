// The speed profile: the fastest the car can be at each sample of a racing line. The
// cornering limit at each sample comes from the line's curvature and the grip there
// (downforce, banking and crests change how hard the tyres are pressed into the road); a
// forward pass then limits acceleration out of each corner by the engine and the grip left
// over, and a backward pass limits braking into it. Both passes share the tyres' grip
// between turning and accelerating or braking (a friction circle). Pure maths.

import { TUNING } from '../config';
import { GRAVITY } from '../constants';
import { surfaceGrip } from '../track/weather';
import { fastMu, gripAt, type CarEnvelope } from './envelope';
import type { RacingLine } from './racingLine';

const G = -GRAVITY;

export interface ProfileOptions {
  /** Fraction of the envelope's grip to use (a driver's pace, 0–1). */
  pace?: number;
  /** Top speed allowed anywhere (m/s). */
  maxSpeed?: number;
  /** Samples where the line runs through standing water (1), on a wet track. */
  water?: Uint8Array | null;
  /** The road's grip at each sample against asphalt's (a stage's gravel), if it varies. */
  grip?: Float32Array | null;
}

/** The share of the wet road's grip left in standing water at speed s. */
function waterShare(s: number): number {
  return surfaceGrip('water', 1, s).grip / surfaceGrip('asphalt', 1, s).grip;
}

/** Speed (m/s) at each sample of `line` for a car with envelope `env`. */
export function speedProfile(line: RacingLine, env: CarEnvelope, { pace = 1, maxSpeed = TUNING.ai.maxSpeed, water = null, grip = null }: ProfileOptions = {}): Float32Array {
  const n = line.curvature.length;
  const lateralMu = env.lateralMu * pace;
  const brakingMu = env.brakingMu * pace;
  const v = new Float32Array(n);
  // Grip at sample i and speed s: the road's own (gravel on a stage), less in standing water, the less the faster.
  const muAt = (i: number, s: number, mu: number) => {
    const m = grip ? mu * grip[i] : mu;
    return water?.[i] ? m * waterShare(s) : m;
  };

  const F = TUNING.ai.envelope.fast;
  for (let i = 0; i < n; i++) {
    const road = grip ? lateralMu * grip[i] : lateralMu;
    v[i] = corneringLimit(line, env, i, road, maxSpeed);
    // Less of the grip in fast corners: settle on a speed the reduced grip can hold.
    for (let k = 0; k < 3 && v[i] > F.from; k++) v[i] = corneringLimit(line, env, i, fastMu(road, v[i]), maxSpeed);
    if (!water?.[i]) continue;
    // In water the grip depends on the speed: settle on a speed the water's grip can hold, and lift.
    for (let k = 0; k < 4; k++) v[i] = corneringLimit(line, env, i, muAt(i, v[i], lateralMu), maxSpeed);
    v[i] = Math.min(v[i], TUNING.ai.waterSpeed);
  }

  const step = (i: number) => {
    const j = (i + 1) % n;
    const d = line.distance[j] - line.distance[i];
    if (!line.closed) return Math.max(1e-3, d);
    return d > 0 ? d : d + line.length;
  };
  // Grip left for accelerating or braking at speed s at sample i, with the cornering it's
  // doing; `taper` gives up more of it the harder the car corners.
  const spare = (i: number, s: number, mu: number, taper = 0) => {
    const grip = gripAt(env, fastMu(muAt(i, s, mu), s), s, G + s * s * line.vertical[i]);
    const load = Math.min(1, (s * s * Math.abs(line.curvature[i])) / Math.max(grip, 1e-6));
    return grip * Math.sqrt(1 - load * load) * (1 - taper * load);
  };

  // A stage: from a standing start to the finish, nothing wrapping round.
  if (!line.closed) {
    v[0] = 0;
    for (let i = 0; i < n - 1; i++) {
      const s = v[i];
      const drive = Math.min(env.driveAccel(s), env.traction * spare(i, s, lateralMu));
      const a = drive - env.drag * s * s - env.rolling * G - G * line.grade[i];
      v[i + 1] = Math.min(v[i + 1], Math.sqrt(Math.max(0, s * s + 2 * a * step(i))));
    }
    for (let j = n - 1; j > 0; j--) {
      const i = j - 1;
      const s = v[j];
      const a = spare(j, s, brakingMu, TUNING.ai.envelope.trailBraking) + env.drag * s * s + env.rolling * G + G * line.grade[i];
      v[i] = Math.min(v[i], Math.sqrt(Math.max(0, s * s + 2 * Math.max(0, a) * step(i))));
    }
    return v;
  }
  // Start both passes from the slowest corner: nothing there can be any faster.
  let slowest = 0;
  for (let i = 1; i < n; i++) if (v[i] < v[slowest]) slowest = i;

  // Forward: accelerate out of each corner, as far as power and grip allow.
  for (let c = 0; c < n; c++) {
    const i = (slowest + c) % n;
    const j = (i + 1) % n;
    const s = v[i];
    const drive = Math.min(env.driveAccel(s), env.traction * spare(i, s, lateralMu));
    const a = drive - env.drag * s * s - env.rolling * G - G * line.grade[i];
    v[j] = Math.min(v[j], Math.sqrt(Math.max(0, s * s + 2 * a * step(i))));
  }
  // Backward: brake for each corner in time.
  for (let c = 0; c < n; c++) {
    const j = (slowest - c + n) % n;
    const i = (j - 1 + n) % n;
    const s = v[j];
    const a = spare(j, s, brakingMu, TUNING.ai.envelope.trailBraking) + env.drag * s * s + env.rolling * G + G * line.grade[i];
    v[i] = Math.min(v[i], Math.sqrt(Math.max(0, s * s + 2 * Math.max(0, a) * step(i))));
  }
  return v;
}

/**
 * The fastest the car can take sample i of the line with friction coefficient `mu`: in the
 * plane of the (banked) road, the sideways force needed must be within μ times the force
 * pressing the car into it. Both are linear in v².
 */
export function corneringLimit(line: RacingLine, env: CarEnvelope, i: number, mu: number, maxSpeed = TUNING.ai.maxSpeed): number {
  const k = Math.abs(line.curvature[i]);
  const into = Math.sign(line.curvature[i]) * line.tilt[i]; // sine of banking into the turn
  const sinB = Math.max(-0.5, Math.min(0.5, into));
  const cosB = Math.sqrt(1 - sinB * sinB);
  const kv = line.vertical[i];
  // sideways: v²·k·cosB − g·sinB ≤ μ·(g·cosB + v²·k·sinB + v²·kv + downforce·v²)
  const coeff = k * cosB - mu * (k * sinB + kv + env.corneringDownforce);
  const rhs = G * (sinB + mu * cosB);
  let limit = coeff > 1e-9 ? Math.sqrt(rhs / coeff) : maxSpeed;
  // Over a crest, not so fast that the car leaves the road.
  if (kv + env.downforce < 0) limit = Math.min(limit, Math.sqrt((G * cosB) / -(kv + env.downforce)));
  return Math.min(maxSpeed, limit);
}

/** The lap time the profile predicts (s). */
export function profileLapTime(line: RacingLine, profile: Float32Array): number {
  const n = profile.length;
  let t = 0;
  for (let i = 0; i < (line.closed ? n : n - 1); i++) {
    const j = (i + 1) % n;
    const d = (line.distance[j] - line.distance[i] + line.length) % line.length;
    t += (2 * d) / Math.max(0.5, profile[i] + profile[j]);
  }
  return t;
}
