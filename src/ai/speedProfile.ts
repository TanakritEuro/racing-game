// The speed profile: the fastest the car can be at each sample of a racing line. The
// cornering limit at each sample comes from the line's curvature and the grip there
// (downforce, banking and crests change how hard the tyres are pressed into the road); a
// forward pass then limits acceleration out of each corner by the engine and the grip left
// over, and a backward pass limits braking into it. Both passes share the tyres' grip
// between turning and accelerating or braking (a friction circle). Pure maths.

import { TUNING } from '../config';
import { GRAVITY } from '../constants';
import { gripAt, type CarEnvelope } from './envelope';
import type { RacingLine } from './racingLine';

const G = -GRAVITY;

export interface ProfileOptions {
  /** Fraction of the envelope's grip to use (a driver's pace, 0–1). */
  pace?: number;
  /** Top speed allowed anywhere (m/s). */
  maxSpeed?: number;
}

/** Speed (m/s) at each sample of `line` for a car with envelope `env`. */
export function speedProfile(line: RacingLine, env: CarEnvelope, { pace = 1, maxSpeed = TUNING.ai.maxSpeed }: ProfileOptions = {}): Float32Array {
  const n = line.curvature.length;
  const lateralMu = env.lateralMu * pace;
  const brakingMu = env.brakingMu * pace;
  const v = new Float32Array(n);

  for (let i = 0; i < n; i++) v[i] = corneringLimit(line, env, i, lateralMu, maxSpeed);

  const step = (i: number) => {
    const j = (i + 1) % n;
    const d = line.distance[j] - line.distance[i];
    return d > 0 ? d : d + line.length;
  };
  // Grip left for accelerating or braking at speed s at sample i, with the cornering it's doing.
  const spare = (i: number, s: number, mu: number) => {
    const grip = gripAt(env, mu, s, G + s * s * line.vertical[i]);
    const lateral = s * s * Math.abs(line.curvature[i]);
    return Math.sqrt(Math.max(0, grip * grip - lateral * lateral));
  };

  // Start both passes from the slowest corner: nothing there can be any faster.
  let slowest = 0;
  for (let i = 1; i < n; i++) if (v[i] < v[slowest]) slowest = i;

  // Forward: accelerate out of each corner, as far as power and grip allow.
  for (let c = 0; c < n; c++) {
    const i = (slowest + c) % n;
    const j = (i + 1) % n;
    const s = v[i];
    const drive = Math.min(env.driveForce(s) / env.mass, spare(i, s, lateralMu));
    const a = drive - env.drag * s * s - env.rolling * G - G * line.grade[i];
    v[j] = Math.min(v[j], Math.sqrt(Math.max(0, s * s + 2 * a * step(i))));
  }
  // Backward: brake for each corner in time.
  for (let c = 0; c < n; c++) {
    const j = (slowest - c + n) % n;
    const i = (j - 1 + n) % n;
    const s = v[j];
    const a = spare(j, s, brakingMu) + env.drag * s * s + env.rolling * G + G * line.grade[i];
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
  const coeff = k * cosB - mu * (k * sinB + kv + env.downforce);
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
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const d = (line.distance[j] - line.distance[i] + line.length) % line.length;
    t += (2 * d) / Math.max(0.5, profile[i] + profile[j]);
  }
  return t;
}
