// Every tyre and impact effect, fed from the simulation: skid marks and smoke from sliding
// tyres, sparks from hard knocks. Reads the simulation; never writes to it.

import * as THREE from 'three';
import type { Simulation } from '../../sim';
import type { CarPose } from '../../vehicle/pose';
import { contactPoint, SkidMarks, slideAmount } from './skidMarks';
import { Smoke } from './smoke';
import { Sparks } from './sparks';

export class Effects {
  readonly skids = new SkidMarks();
  readonly smoke = new Smoke();
  readonly sparks = new Sparks();
  private readonly point = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly keys: string[][] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.skids.mesh, this.smoke.points, this.sparks.points);
  }

  /** After every physics step: sparks for its knocks (each step's contacts last only that step). */
  afterStep(sim: Simulation): void {
    for (const c of sim.contacts) this.sparks.knock(c);
  }

  /** Each frame: marks and smoke from every car drawn at `poses`, then move everything on by `dt`. */
  update(dt: number, sim: Simulation, poses: readonly CarPose[], camera: THREE.PerspectiveCamera, heightPx: number): void {
    sim.cars.forEach((car, k) => {
      const pose = poses[k];
      this.skids.update(k, car, pose);
      const v = car.body.linvel();
      const speed = Math.hypot(v.x, v.z);
      this.keys[k] ??= car.wheels.map((_, i) => `${k}/${i}`);
      car.wheels.forEach((w, i) => {
        const slide = slideAmount(w);
        const p = slide > 0 ? contactPoint(car, pose, i, this.point, this.q) : this.point;
        this.smoke.emit(this.keys[k][i], p.x, p.y, p.z, v.x, v.z, slide, speed, dt);
      });
    });
    this.smoke.setScale(heightPx, camera.fov);
    this.sparks.setScale(heightPx, camera.fov);
    this.smoke.update(dt);
    this.sparks.update(dt);
  }

  /** The cars jumped (a restart, a car put back): don't join their marks across the gap. */
  break(): void {
    this.skids.break();
  }
}
