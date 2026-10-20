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
import { lateralOffset, nearestSample, type Track } from '../track/track';
import { puddles, puddleSpan } from '../track/puddles';
import { boxOffset, fastLaneOffset, laneAlong, laneOpen, type PitLane } from '../track/pitLane';
import type { PitState } from '../race/pits';
import { wearGrip } from '../vehicle/wear';
import { wetness, type Conditions } from '../track/weather';
import { controls, type Car, type Controls } from '../vehicle/car';
import { usableLock } from '../drivers/steeringAssist';
import type { CarDef } from '../vehicle/carDef';
import { carEnvelope, fastMu, gripAt, type CarEnvelope } from './envelope';
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
  /** Heading for the pits (set by the race's strategy): the lane, this car's pit state, and whether it has been served and is leaving. */
  pit: { lane: PitLane; state: PitState; leaving: boolean } | null = null;
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
    if (!Number.isFinite(this.aim)) this.aim = 0;
    // Pitting: the pit line instead of the racing line, no wander or mistakes.
    const pit = this.pit ? this.pitTarget(this.index) : null;
    const mistake = pit ? null : this.mistake;
    const offLine = clamp(this.aim + this.wander, line.right[this.index] - line.offset[this.index], line.left[this.index] - line.offset[this.index]);
    let aim = offLine + (mistake?.wide ?? 0);
    // On worn tyres it drives to the grip they have left (corner speed goes as √μ).
    let worn = 1;
    for (const w of car.wheels) worn = Math.min(worn, wearGrip(w.wear));
    const faster = (mistake?.speed ?? 1) * Math.sqrt(worn);

    // Steering, Stanley style, at the front axle: the line's own curvature (a moment ahead,
    // for the rack's lag), plus the heading error, plus the cross-track error, less any yaw
    // rate beyond what the line asks for (which damps a slide).
    const wheelbase = 2 * car.def.wheelbaseHalf;
    const ax = p.x + fx * car.def.wheelbaseHalf;
    const az = p.z + fz * car.def.wheelbaseHalf;
    const i = nearestSample(track, ax, az, this.index);
    const s = track.samples[i];
    if (pit) aim = ((this.pit ? this.pitTarget(i) : null)?.offset ?? pit.offset) - line.offset[i];
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
    // (Or when far off it: back on the road after a spin.)
    const crossTrackMax =
      Math.abs(across) > D.crossTrackMax.far
        ? D.crossTrackMax.fast
        : D.crossTrackMax.slow + (D.crossTrackMax.fast - D.crossTrackMax.slow) * clamp(v / D.crossTrackMax.speed, 0, 1);
    const wheelAngle =
      Math.atan(wheelbase * k) +
      D.headingGain * heading +
      clamp(Math.atan((D.crossTrackGain * across) / (v + D.crossTrackSoftening)), -crossTrackMax, crossTrackMax) +
      D.yawDamping * (v * k - yawRate);
    // No more lock than the front tyres can use at this speed: past their peak slip angle
    // they only scrub, and the car ploughs straight on. Catching a slide needs all of it.
    const sliding = Math.abs(car.bodySlipAngle) > D.slideAngle && v > 5;
    const lock = sliding ? 1 : usableLock(car, v);
    let steer = clamp(wheelAngle / car.def.steering.lock, -lock, lock);
    // Pointing the wrong way (after a spin): full lock round towards the line's direction.
    if (Math.abs(heading) > Math.PI / 2) steer = Math.sign(heading);

    // Speed: where the profile wants it a moment ahead, and what it takes to get there.
    const lead = Math.max(4, D.speedLead * v);
    const ahead = (this.index + Math.max(1, Math.round(lead / spacing))) % n;
    const offLineSpeed = pit ? pit.cap : this.offLineLimit(aim, faster, v, spacing);
    const here = Math.min(this.profile[this.index] * faster, this.speedCap, offLineSpeed);
    const target = Math.min(this.profile[ahead] * faster, this.speedCap, offLineSpeed);
    const accel = (target * target - v * v) / (2 * lead) + D.speedGain * (here - v);
    let throttle = 0;
    let brake = 0;
    if (accel >= 0) {
      const available = Math.max(0.5, this.env.driveAccel(v));
      throttle = clamp(D.cruiseThrottle + accel / available, 0, 1);
      // Cornering, only as much power as the driven tyres have grip to spare: past it a powerful
      // car slides its rear out (or a front-driven one runs wide) before the wheels spin enough
      // for traction control to notice.
      const env = this.env;
      const grip = gripAt(env, fastMu(env.lateralMu, v), v);
      const lateral = v * v * Math.abs(line.curvature[this.index]);
      const spare = env.traction * Math.sqrt(Math.max(0, grip * grip - lateral * lateral));
      throttle = Math.min(throttle, Math.max(D.cruiseThrottle, (spare + env.drag * v * v) / available));
    } else {
      // Drag and rolling resistance slow it a little without any brake.
      const coasting = this.env.drag * v * v + this.env.rolling * G;
      brake = clamp((-accel - coasting) / (this.env.brakingMu * G), 0, 1);
    }

    // A slide: off the brakes (they unload the rear and feed the slide), a steady gentle
    // throttle (lifting would too), and the steering catches it.
    if (sliding) {
      brake = 0;
      throttle = Math.min(throttle, D.slideThrottle);
    }

    // Stuck: barely moving, or off the road (in a gravel trap, beyond the run-off), for a while.
    const offRoad = !pit && Math.abs(lateralOffset(track, this.index, p.x, p.z)) > track.samples[this.index].halfWidth + D.stuck.offRoad;
    // Standing in its box isn't being stuck, and queueing in the lane takes a while.
    if (this.pit?.state.servicing !== null && this.pit?.state.servicing !== undefined) this.stuckFor = 0;
    else if (Math.abs(speed) < D.stuck.speed) this.stuckFor += this.pit?.state.inLane ? dt / D.stuck.inLane : dt;
    else if (offRoad) this.stuckFor += dt * (D.stuck.time / D.stuck.offRoadTime);
    else this.stuckFor = 0;
    this.stuck = this.stuckFor > D.stuck.time;

    return controls({ steer, throttle, brake });
  }

  /**
   * Off its line by `aim` (m, left), the corners ahead are tighter or wider than the line's:
   * the fastest it can be now and still brake in time for each of them at that offset.
   */
  private offLineLimit(aim: number, faster: number, v: number, spacing: number): number {
    const D = TUNING.ai.driver;
    if (Math.abs(aim) < 0.3) return Infinity;
    const { profile, line } = this;
    const n = profile.length;
    const brake = this.env.brakingMu * G * D.offLineBraking;
    const reach = Math.round(Math.max(D.offLineLook, (v * v) / (2 * brake)) / spacing);
    let limit = Infinity;
    for (let k = 0; k <= reach; k += 2) {
      const j = (this.index + k) % n;
      // A parallel path `aim` left of the line: radius 1/κ + aim turning right (κ > 0), 1/|κ| − aim turning left.
      const scale = Math.sqrt(clamp(1 + line.curvature[j] * aim, 0.25, 1));
      if (scale > 0.999) continue;
      const corner = profile[j] * faster * scale;
      limit = Math.min(limit, Math.sqrt(corner * corner + 2 * brake * k * spacing));
    }
    return limit;
  }

  /**
   * Where the pit line is at sample `i` (m left of the centreline) and how fast it may go there:
   * over to the road edge before the lane, along the lane's through lane at the limit, over
   * to its box and stopped there, and out again once served. Null when it isn't pitting here.
   */
  private pitTarget(i: number): { offset: number; cap: number } | null {
    const plan = this.pit!;
    const { lane, state } = plan;
    const A = TUNING.ai.pits;
    const P = TUNING.pits;
    const { track, line } = this;
    const n = track.samples.length;
    const spacing = track.length / n;
    const hw = track.samples[i].halfWidth;
    const u = laneAlong(track, lane, i);
    const limitAt = lane.taper * P.limitLine;
    const toLimit = (d: number) => Math.sqrt(P.limit * P.limit + 2 * A.brake * Math.max(0, d));
    if (u < 0) {
      if (plan.leaving) {
        // Out of the lane and back on the road: the stop is done.
        this.pit = null;
        return null;
      }
      const toEntry = ((lane.first - i + n) % n) * spacing;
      if (toEntry > A.approach) return null;
      // Over to the road edge on the lane's side, slowing to the limit by the entry (it swerves into the lane).
      const edge = lane.sign * (hw - 1.2);
      const f = 1 - toEntry / A.approach;
      return { offset: line.offset[i] + (edge - line.offset[i]) * f, cap: toLimit(toEntry) };
    }
    if (state.served) plan.leaving = true;
    // Not in the lane by the end of its entry (put back on the road beside it, say): not this time.
    if (!plan.leaving && !state.inLane && u > lane.taper * 0.9) {
      this.pit = null;
      return null;
    }
    const fast = fastLaneOffset();
    let across = Math.max(0.6, fast * laneOpen(lane, u));
    let cap = u <= lane.length - limitAt ? P.limit - 0.6 : Infinity;
    if (!plan.leaving) {
      const toBox = laneAlong(track, lane, lane.boxes[state.box]) - u;
      // Missed the box: carry on out.
      if (toBox < -P.boxLength) plan.leaving = true;
      else {
        across = fast + (boxOffset() - fast) * clamp(1 - toBox / A.boxRun, 0, 1);
        cap = Math.min(cap, Math.sqrt(2 * A.boxBrake * Math.max(0, toBox - 0.4)));
      }
    }
    return { offset: lane.sign * (hw + across), cap };
  }

  /** Back to the grid: forget where it was, traffic, mistakes and wander. */
  reset(): void {
    this.index = -1;
    this.pit = null;
    this.aim = 0;
    this.speedCap = Infinity;
    this.armed = true;
    this.recovered();
  }

  /** After the car was put back on the track: forget the stuck timer, any mistake and any pit stop it was making. */
  recovered(): void {
    this.pit = null;
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

/**
 * What every AI driver of one car on one circuit in one weather shares: the line (the same in
 * any weather), the car's envelope, and where the line runs through standing water (wet only).
 */
export interface CircuitAi {
  line: RacingLine;
  env: CarEnvelope;
  water: Uint8Array | null;
}

const prepared = new WeakMap<Track, Map<CarDef, Map<Conditions, CircuitAi>>>();

/** The racing line and envelope for `def` on `track` in `conditions`, computed once and kept. */
export function circuitAi(track: Track, def: CarDef, conditions: Conditions = 'dry'): CircuitAi {
  let byCar = prepared.get(track);
  if (!byCar) prepared.set(track, (byCar = new Map()));
  let byWeather = byCar.get(def);
  if (!byWeather) byCar.set(def, (byWeather = new Map()));
  let ai = byWeather.get(conditions);
  if (!ai) {
    const line = byWeather.values().next().value?.line ?? racingLine(track, def.halfExtents.x);
    const wet = wetness(conditions);
    ai = { line, env: carEnvelope(def, wet), water: wet >= 1 ? waterOnLine(track, line, def.halfExtents.x) : null };
    byWeather.set(conditions, ai);
  }
  return ai;
}

/** Samples where a car on `line` (half as wide as `halfWidth`) would be in standing water. */
function waterOnLine(track: Track, line: RacingLine, halfWidth: number): Uint8Array {
  const n = track.samples.length;
  const out = new Uint8Array(n);
  for (const p of puddles(track)) {
    for (let i = p.first; i !== p.last; i = (i + 1) % n) {
      const [a, b] = puddleSpan(p, track.samples[i]);
      const at = line.offset[i];
      if (at + halfWidth > a && at - halfWidth < b) out[i] = 1;
    }
  }
  return out;
}

/** A driver for `def` on `track` in `conditions` with `skill`, its mistakes drawn from `seed`. */
export function createAiDriver(track: Track, def: CarDef, skill: Skill = PERFECT, seed = 1, conditions: Conditions = 'dry'): AiDriver {
  const { line, env, water } = circuitAi(track, def, conditions);
  const profile = brakeEarlier(speedProfile(line, env, { pace: skill.pace, water }), skill.braking, track.length / track.samples.length);
  return new AiDriver(track, line, profile, env, skill, createRng(seed));
}
