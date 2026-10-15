// The whole simulation in one place: world, car and lap timer, advanced in fixed steps.
// Headless: tests drive it directly, and the browser game wraps it with input and rendering.

import { PHYSICS_STEP } from './constants';
import { createPhysics, type Physics } from './physics';
import { LapTimer } from './race/timing';
import { nearestSample, type Track } from './track/track';
import { Car, poseOnTrack, type Controls } from './vehicle/car';

/** How far behind the start line the car starts (track samples are 2 m apart). */
const GRID_SAMPLES_BEHIND = 5;

export class Simulation {
  readonly physics: Physics;
  readonly car: Car;
  readonly timer: LapTimer;
  /** Simulation time (s). */
  time = 0;
  steps = 0;

  constructor(readonly track: Track) {
    this.physics = createPhysics(track);
    const n = track.samples.length;
    const grid = track.samples[n - GRID_SAMPLES_BEHIND];
    this.car = new Car(this.physics, poseOnTrack(grid));
    this.timer = new LapTimer(track, grid.x, grid.z);
  }

  step(controls: Controls): void {
    this.car.update(controls, PHYSICS_STEP);
    this.physics.world.step();
    this.time += PHYSICS_STEP;
    this.steps++;
    const p = this.car.position;
    this.timer.update(p.x, p.z, this.time);
  }

  /** Put the car back on the track at the nearest point, facing the right way, stopped. */
  recover(): void {
    const p = this.car.position;
    const i = nearestSample(this.track, p.x, p.z, this.timer.index);
    this.car.reset(poseOnTrack(this.track.samples[i]));
  }
}
