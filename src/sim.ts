// The whole simulation in one place: world, cars and lap timers, advanced in fixed steps.
// Headless: tests drive it directly, and the browser game wraps it with input and rendering.
//
// Car 0 is the player's; `car`, `timer`, `previous` and `current` are shorthands for it, so
// a one-car simulation (time trial, the vehicle tests) reads as it always has.

import { PHYSICS_STEP } from './constants';
import { createPhysics, type Physics } from './physics';
import { LapTimer } from './race/timing';
import { nearestSample, type Track, type TrackSample } from './track/track';
import { Car, poseOnTrack, type Controls, type Pose } from './vehicle/car';
import { copyPose, createPose, type CarPose } from './vehicle/pose';
import type { CarDef } from './vehicle/carDef';
import { KESTREL } from './vehicle/cars';
import type { AidSettings } from './vehicle/aids';
import type { GearboxMode } from './vehicle/gearbox';

/** The grid (track samples are 2 m apart). A lone car starts on the centreline, 10 m behind the line. */
const GRID = {
  /** Samples behind the line: a lone car, and the front of a race grid. */
  first: 5,
  /** Distance between rows (m), and how much further back the right-hand column stands (m). */
  row: 8,
  stagger: 4,
  /** Each column's distance from the centreline, as a fraction of the half-width. */
  across: 0.45,
};

export interface SimOptions {
  /** How many cars (default 1). Every car uses `carDef`. */
  cars?: number;
  /** Grid slot of each car (default: car i in slot i). Slot 0 is pole. */
  slots?: readonly number[];
}

/** One car's poses before and after the last step, for drawing in between. */
export interface CarPoses {
  previous: CarPose;
  current: CarPose;
}

export class Simulation {
  readonly physics: Physics;
  readonly cars: Car[] = [];
  readonly timers: LapTimer[] = [];
  readonly poses: CarPoses[] = [];
  /** Simulation time (s). */
  time = 0;
  steps = 0;
  private readonly slots: readonly number[];

  constructor(
    readonly track: Track,
    carDef: CarDef = KESTREL,
    options: SimOptions = {},
  ) {
    this.physics = createPhysics(track);
    const count = options.cars ?? 1;
    this.slots = options.slots ?? Array.from({ length: count }, (_, i) => i);
    for (let i = 0; i < count; i++) {
      const pose = this.gridPose(i);
      this.cars.push(new Car(this.physics, pose, carDef));
      this.timers.push(new LapTimer(track, pose.position.x, pose.position.z));
      this.poses.push({ previous: createPose(), current: createPose() });
      this.settlePose(i);
    }
  }

  /** The player's car, timer and poses. */
  get car(): Car {
    return this.cars[0];
  }
  get timer(): LapTimer {
    return this.timers[0];
  }
  get previous(): CarPose {
    return this.poses[0].previous;
  }
  get current(): CarPose {
    return this.poses[0].current;
  }

  /** Where car `i` starts: a lone car on the centreline; a field on a staggered two-by-two grid. */
  gridPose(i: number): Pose {
    const { samples } = this.track;
    const n = samples.length;
    const spacing = this.track.length / n;
    if (this.slots.length === 1) return poseOnTrack(samples[n - GRID.first]);
    const slot = this.slots[i];
    const right = slot % 2 === 1;
    const back = GRID.first * spacing + Math.floor(slot / 2) * GRID.row + (right ? GRID.stagger : 0);
    const p = samples[n - Math.round(back / spacing)];
    return offsetPose(p, (right ? -1 : 1) * GRID.across * p.halfWidth);
  }

  /** Back to the grid for an out lap; the best laps are kept. */
  restart(): void {
    this.cars.forEach((car, i) => {
      const pose = this.gridPose(i);
      car.reset(pose);
      this.timers[i].restart(pose.position.x, pose.position.z);
      this.settlePose(i);
    });
  }

  /** One fixed step: `controls` for the player alone, or one per car. */
  step(controls: Controls | readonly Controls[]): void {
    const list = Array.isArray(controls) ? (controls as readonly Controls[]) : null;
    this.cars.forEach((car, i) => {
      copyPose(this.poses[i].current, this.poses[i].previous);
      car.update(list ? list[i] : (controls as Controls), PHYSICS_STEP);
    });
    this.physics.world.step();
    this.time += PHYSICS_STEP;
    this.steps++;
    this.cars.forEach((car, i) => {
      car.capturePose(this.poses[i].current);
      const p = car.position;
      this.timers[i].update(p.x, p.z, this.time, this.isOffTrack(i));
    });
  }

  /**
   * Track limits: every wheel touching the ground is beyond the kerbs (on grass or gravel).
   * Kerbs count as track; a wheel in the air doesn't decide either way.
   */
  isOffTrack(i: number): boolean {
    const wheels = this.cars[i].wheels;
    return wheels.some((w) => w.contact) && wheels.every((w) => !w.contact || w.surface === 'grass' || w.surface === 'gravel');
  }

  /** The player's car is beyond the track limits. */
  get offTrack(): boolean {
    return this.isOffTrack(0);
  }

  /** Put car `i` back on the track at the nearest point, facing the right way, stopped. Voids the lap. */
  recover(i = 0): void {
    this.timers[i].invalidate();
    const p = this.cars[i].position;
    const k = nearestSample(this.track, p.x, p.z, this.timers[i].index);
    this.cars[i].reset(poseOnTrack(this.track.samples[k]));
    this.settlePose(i);
  }

  /** Make both of car `i`'s poses its pose now, so a teleport isn't drawn as a slide. */
  private settlePose(i: number): void {
    this.cars[i].capturePose(this.poses[i].current);
    copyPose(this.poses[i].current, this.poses[i].previous);
  }

  /** Switch ABS and traction control on or off (the player's car). */
  setAids(aids: AidSettings, i = 0): void {
    this.cars[i].aids = { ...aids };
  }

  /** Switch between the automatic and manual gearbox (the player's car). */
  setGearboxMode(mode: GearboxMode, i = 0): void {
    this.cars[i].drivetrain.setMode(mode);
  }
}

/** The pose at sample `p`, moved `offset` metres to the left across the banked road. */
function offsetPose(p: TrackSample, offset: number): Pose {
  const pose = poseOnTrack(p);
  pose.position.x += p.lx * offset;
  pose.position.y += p.ly * offset;
  pose.position.z += p.lz * offset;
  return pose;
}
