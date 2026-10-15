// The AI driver: follows a racing line at the speeds of a speed profile, through the same
// `Controls` a player's gamepad produces. It reads its own car (position, heading, speed,
// slide) and never writes to it or to the physics. Pure simulation.
//
// Steering is Stanley-style, at the front axle: the angle the line's own curvature needs,
// plus corrections for the heading error and the distance off the line, less any yaw rate
// beyond what the line asks for (which damps a slide before it grows). Speed control feeds forward the
// acceleration or braking the profile asks for over the next stretch, plus a correction on
// the speed error; acceleration becomes throttle against what the engine can give at this
// speed, deceleration becomes brake pedal against what the tyres can give.

import { TUNING } from '../config';
import { GRAVITY } from '../constants';
import { clamp, createRng, type Rng } from '../math';
import { nearestSample, type Track } from '../track/track';
import { controls, type Car, type Controls } from '../vehicle/car';
import type { CarDef } from '../vehicle/carDef';
import { carEnvelope, type CarEnvelope } from './envelope';
import { racingLine, type RacingLine } from './racingLine';
import { speedProfile } from './speedProfile';
import { brakeEarlier, gaussian, PERFECT, type Skill } from './skill';

const G = -GRAVITY;

export class AiDriver {
  /** The track sample the car is nearest to. */
  index = -1;
  /** It has been stuck long enough to want putting back on the track. */
  stuck = false;
  private stuckFor = 0;
  /** Extra metres left of the racing line it is aiming for (set by traffic). */
  aim = 0;
  /** A cap on its target speed (m/s), e.g. following a slower car. */
  speedCap = Infinity;
  /** Mistakes made so far. */
  mistakesMade = 0;
  /** How far it has wandered off the line (m, left). */
  private wander = 0;
  /** A mistake in progress: until which sample, how much faster than it should, and how far wide. */
  private mistake: { until: number; speed: number; wide: number } | null = null;
  /** Ready to judge the next corner (it has finished the last). */
  private armed = true;

  constructor(
    readonly track: Track,
    readonly line: RacingLine,
    /** Target speed at each sample (m/s). */
    public profile: Float32Array,
    readonly env: CarEnvelope,
    readonly skill: Skill = PERFECT,
    private readonly rng: Rng = createRng(1),
  ) {}

  /** Controls for the next step of `car`. `dt` is the step (s). */
  drive(car: Car, dt: number): Controls {
    const D = TUNING.ai.driver;
    const { track, line } = this;
    const n = track.samples.length;
    const spacing = track.length / n;
    const p = car.position;
    this.index = nearestSample(track, p.x, p.z, this.index < 0 ? undefined : this.index);
    const f = car.forward;
    const fl = Math.hypot(f.x, f.z) || 1;
    const fx = f.x / fl;
    const fz = f.z / fl;
    const speed = car.speed;
    const v = Math.max(0, speed);

    // Skill: wandering off the line, and now and then a mistake at a corner.
    this.judge(dt, spacing);
    const mistake = this.mistake;
    const offLine = clamp(this.aim + this.wander, line.right[this.index] - line.offset[this.index], line.left[this.index] - line.offset[this.index]);
    const aim = offLine + (mistake?.wide ?? 0);
    const faster = mistake?.speed ?? 1;

    // Steering, Stanley style, at the front axle: the line's own curvature (a moment ahead,
    // for the rack's lag), plus the heading error, plus the cross-track error, less any yaw
    // rate beyond what the line asks for (which damps a slide).
    const wheelbase = 2 * car.def.wheelbaseHalf;
    const ax = p.x + fx * car.def.wheelbaseHalf;
    const az = p.z + fz * car.def.wheelbaseHalf;
    const i = nearestSample(track, ax, az, this.index);
    const s = track.samples[i];
    const lx = line.x[i] + s.nx * aim;
    const lz = line.z[i] + s.nz * aim;
    const tx = line.x[(i + 1) % n] - line.x[(i - 1 + n) % n];
    const tz = line.z[(i + 1) % n] - line.z[(i - 1 + n) % n];
    const tl = Math.hypot(tx, tz) || 1;
    // The line's heading relative to the car's, positive to the right; the car's right on the ground is (−fz, fx).
    const heading = Math.atan2((tx * -fz + tz * fx) / tl, (tx * fx + tz * fz) / tl);
    // How far left of the line the front axle is (the line's left is (tz, −tx)).
    const across = ((ax - lx) * tz - (az - lz) * tx) / tl;
    const k = line.curvature[(i + Math.round((D.feedForward * v) / spacing)) % n];
    const yawRate = -car.body.angvel().y; // positive turning right
    // Gentle at walking pace (joining the line from the grid), full strength at speed.
    const crossTrackMax = D.crossTrackMax.slow + (D.crossTrackMax.fast - D.crossTrackMax.slow) * clamp(v / D.crossTrackMax.speed, 0, 1);
    const wheelAngle =
      Math.atan(wheelbase * k) +
      D.headingGain * heading +
      clamp(Math.atan((D.crossTrackGain * across) / (v + D.crossTrackSoftening)), -crossTrackMax, crossTrackMax) +
      D.yawDamping * (v * k - yawRate);
    let steer = clamp(wheelAngle / car.def.steering.lock, -1, 1);
    // Pointing the wrong way (after a spin): full lock round towards the line's direction.
    if (Math.abs(heading) > Math.PI / 2) steer = Math.sign(heading);

    // Speed: where the profile wants it a moment ahead, and what it takes to get there.
    const lead = Math.max(4, D.speedLead * v);
    const ahead = (this.index + Math.max(1, Math.round(lead / spacing))) % n;
    const here = Math.min(this.profile[this.index] * faster, this.speedCap);
    const target = Math.min(this.profile[ahead] * faster, this.speedCap);
    const accel = (target * target - v * v) / (2 * lead) + D.speedGain * (here - v);
    let throttle = 0;
    let brake = 0;
    if (accel >= 0) {
      const available = Math.max(0.5, this.env.driveAccel(v));
      throttle = clamp(D.cruiseThrottle + accel / available, 0, 1);
    } else {
      // Drag and rolling resistance slow it a little without any brake.
      const coasting = this.env.drag * v * v + this.env.rolling * G;
      brake = clamp((-accel - coasting) / (this.env.brakingMu * G), 0, 1);
    }

    // A slide: off the brakes (they unload the rear and feed the slide), a steady gentle
    // throttle (lifting would too), and the steering catches it.
    if (Math.abs(car.bodySlipAngle) > D.slideAngle && v > 5) {
      brake = 0;
      throttle = Math.min(throttle, D.slideThrottle);
    }

    // Stuck: barely moving with the throttle down, for a while.
    if (Math.abs(speed) < D.stuck.speed) this.stuckFor += dt;
    else this.stuckFor = 0;
    this.stuck = this.stuckFor > D.stuck.time;

    return controls({ steer, throttle, brake });
  }

  /** After the car was put back on the track: forget the stuck timer and any mistake. */
  recovered(): void {
    this.stuckFor = 0;
    this.stuck = false;
    this.mistake = null;
    this.wander = 0;
  }

  /** The skill at work: the line wanders, and entering a corner it may make a mistake. */
  private judge(dt: number, spacing: number): void {
    const M = TUNING.ai.mistakes;
    const { skill, rng, profile, line } = this;
    const n = profile.length;
    const i = this.index;
    if (skill.precision > 0) {
      // A slowly varying offset with standard deviation `precision` (an Ornstein–Uhlenbeck process).
      const tau = M.wanderTime;
      this.wander += -(this.wander * dt) / tau + skill.precision * Math.sqrt((2 * dt) / tau) * gaussian(rng);
    }
    if (this.mistake && (this.mistake.until - i + n) % n > n / 2) this.mistake = null;
    // A corner ahead: the profile falls by `cornerDrop` within `lookahead`.
    const reach = Math.round(M.lookahead / spacing);
    let slowest = i;
    for (let k = 1; k <= reach; k++) {
      const j = (i + k) % n;
      if (profile[j] < profile[slowest]) slowest = j;
    }
    const drop = profile[i] - profile[slowest];
    if (drop < M.cornerDrop / 2) this.armed = true;
    if (!this.armed || drop < M.cornerDrop) return;
    this.armed = false;
    if (rng() >= skill.mistakes) return;
    this.mistakesMade++;
    const pick = (range: readonly number[]) => range[0] + (range[1] - range[0]) * rng();
    if (rng() < 0.5) {
      this.mistake = { until: (slowest + Math.round(M.overcook.length / spacing)) % n, speed: pick(M.overcook.factor), wide: 0 };
    } else {
      // The outside of the corner: left of a right-hander (positive curvature), right of a left-hander.
      const outside = line.curvature[slowest] > 0 ? 1 : -1;
      this.mistake = { until: (slowest + Math.round(M.wide.length / spacing)) % n, speed: 1, wide: outside * pick(M.wide.offset) };
    }
  }
}

/** What every AI driver of one car on one circuit shares: the line and the car's envelope. */
export interface CircuitAi {
  line: RacingLine;
  env: CarEnvelope;
}

const prepared = new WeakMap<Track, Map<CarDef, CircuitAi>>();

/** The racing line and envelope for `def` on `track`, computed once and kept. */
export function circuitAi(track: Track, def: CarDef): CircuitAi {
  let byCar = prepared.get(track);
  if (!byCar) prepared.set(track, (byCar = new Map()));
  let ai = byCar.get(def);
  if (!ai) byCar.set(def, (ai = { line: racingLine(track, def.halfExtents.x), env: carEnvelope(def) }));
  return ai;
}

/** A driver for `def` on `track` with `skill`, its mistakes drawn from `seed`. */
export function createAiDriver(track: Track, def: CarDef, skill: Skill = PERFECT, seed = 1): AiDriver {
  const { line, env } = circuitAi(track, def);
  const profile = brakeEarlier(speedProfile(line, env, { pace: skill.pace }), skill.braking, track.length / track.samples.length);
  return new AiDriver(track, line, profile, env, skill, createRng(seed));
}
