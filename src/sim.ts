// The whole simulation in one place: world, car and lap timer, advanced in fixed steps.
// Headless: tests drive it directly, and the browser game wraps it with input and rendering.

import { PHYSICS_STEP } from './constants';
import { createPhysics, type Physics } from './physics';
import { LapTimer } from './race/timing';
import { nearestSample, type Track } from './track/track';
import { Car, copyPose, createPose, poseOnTrack, type CarPose, type Controls } from './vehicle/car';
import type { CarDef } from './vehicle/carDef';
import { KESTREL } from './vehicle/cars';
import type { AidSettings } from './vehicle/aids';
import type { GearboxMode } from './vehicle/gearbox';

/** How far behind the start line the car starts (track samples are 2 m apart). */
const GRID_SAMPLES_BEHIND = 5;

export class Simulation {
  readonly physics: Physics;
  readonly car: Car;
  readonly timer: LapTimer;
  /** The car's pose before and after the last step, for drawing in between. */
  readonly previous: CarPose = createPose();
  readonly current: CarPose = createPose();
  /** Simulation time (s). */
  time = 0;
  steps = 0;

  constructor(
    readonly track: Track,
    carDef: CarDef = KESTREL,
  ) {
    this.physics = createPhysics(track);
    const n = track.samples.length;
    const grid = track.samples[n - GRID_SAMPLES_BEHIND];
    this.car = new Car(this.physics, poseOnTrack(grid), carDef);
    this.timer = new LapTimer(track, grid.x, grid.z);
    this.settlePose();
  }

  step(controls: Controls): void {
    copyPose(this.current, this.previous);
    this.car.update(controls, PHYSICS_STEP);
    this.physics.world.step();
    this.car.capturePose(this.current);
    this.time += PHYSICS_STEP;
    this.steps++;
    const p = this.car.position;
    this.timer.update(p.x, p.z, this.time, this.offTrack);
  }

  /**
   * Track limits: every wheel touching the ground is beyond the kerbs (on grass or gravel).
   * Kerbs count as track; a wheel in the air doesn't decide either way.
   */
  get offTrack(): boolean {
    const wheels = this.car.wheels;
    return wheels.some((w) => w.contact) && wheels.every((w) => !w.contact || w.surface === 'grass' || w.surface === 'gravel');
  }

  /** Put the car back on the track at the nearest point, facing the right way, stopped. Voids the lap. */
  recover(): void {
    this.timer.invalidate();
    const p = this.car.position;
    const i = nearestSample(this.track, p.x, p.z, this.timer.index);
    this.car.reset(poseOnTrack(this.track.samples[i]));
    this.settlePose();
  }

  /** Make both poses the car's pose now, so a teleport isn't drawn as a slide. */
  private settlePose(): void {
    this.car.capturePose(this.current);
    copyPose(this.current, this.previous);
  }

  /** Switch ABS and traction control on or off. */
  setAids(aids: AidSettings): void {
    this.car.aids = { ...aids };
  }

  /** Switch between the automatic and manual gearbox. */
  setGearboxMode(mode: GearboxMode): void {
    this.car.drivetrain.setMode(mode);
  }
}
