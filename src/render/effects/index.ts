// Every tyre and impact effect, fed from the simulation: skid marks and smoke from sliding
// tyres (dry), spray from tyres on a wet road, sparks from hard knocks. Reads the simulation;
// never writes to it.

import * as THREE from 'three';
import { TUNING } from '../../config';
import type { Simulation } from '../../sim';
import { wetness } from '../../track/weather';
import type { CarPose } from '../../vehicle/pose';
import { contactPoint, SkidMarks, slideAmount } from './skidMarks';
import { Smoke } from './smoke';
import { Sparks } from './sparks';

export class Effects {
  readonly skids = new SkidMarks();
  readonly smoke = new Smoke();
  readonly sparks = new Sparks();
  readonly spray = new Smoke(TUNING.effects.spray);
  private readonly point = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly keys: string[][] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.skids.mesh, this.smoke.points, this.sparks.points, this.spray.points);
  }

  /** After every physics step: sparks for its knocks (each step's contacts last only that step). */
  afterStep(sim: Simulation): void {
    for (const c of sim.contacts) this.sparks.knock(c);
  }

  /** Each frame: marks and smoke from every car drawn at `poses`, then move everything on by `dt`. */
  update(dt: number, sim: Simulation, poses: readonly CarPose[], camera: THREE.PerspectiveCamera, heightPx: number): void {
    const wet = wetness(sim.conditions);
    const P = TUNING.effects.spray;
    sim.cars.forEach((car, k) => {
      const pose = poses[k];
      // A wet road takes no rubber.
      if (wet === 0) this.skids.update(k, car, pose);
      const v = car.body.linvel();
      const speed = Math.hypot(v.x, v.z);
      this.keys[k] ??= car.wheels.map((_, i) => `${k}/${i}`);
      const spray = wet * Math.min(1, Math.max(0, (speed - P.minSpeed) / P.fullSpeed));
      car.wheels.forEach((w, i) => {
        // Wet tyres hardly smoke; they throw up water instead.
        const slide = slideAmount(w) * (1 - wet);
        const throws = w.contact ? spray : 0;
        const p = slide > 0 || throws > 0 ? contactPoint(car, pose, i, this.point, this.q) : this.point;
        this.smoke.emit(this.keys[k][i], p.x, p.y, p.z, v.x, v.z, slide, speed, dt);
        this.spray.emit(this.keys[k][i], p.x, p.y, p.z, v.x, v.z, throws, speed, dt);
      });
    });
    for (const fx of [this.smoke, this.sparks, this.spray]) fx.setScale(heightPx, camera.fov);
    this.smoke.update(dt);
    this.sparks.update(dt);
    this.spray.update(dt);
  }

  /** The cars jumped (a restart, a car put back): don't join their marks across the gap. */
  break(): void {
    this.skids.break();
  }
}
