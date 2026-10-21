// Every tyre and impact effect, fed from the simulation: skid marks and smoke from sliding
// tyres (dry), spray from tyres on a wet road, dust from a gravel road, sparks from hard knocks. Reads the simulation;
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
  readonly smoke: Smoke;
  readonly sparks = new Sparks();
  readonly spray: Smoke;
  readonly dust: Smoke;
  private readonly point = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly keys: string[][] = [];

  /** `particles`: the share of smoke and spray drawn (Graphics Low draws less). */
  constructor(scene: THREE.Scene, particles = 1) {
    const fewer = <T extends { capacity: number; rate: number }>(d: T): T => ({ ...d, capacity: Math.ceil(d.capacity * particles), rate: d.rate * particles });
    this.smoke = new Smoke(fewer(TUNING.effects.smoke));
    this.spray = new Smoke(fewer(TUNING.effects.spray));
    this.dust = new Smoke(fewer(TUNING.effects.dust));
    scene.add(this.skids.mesh, this.smoke.points, this.sparks.points, this.spray.points, this.dust.points);
  }

  /** After every physics step: sparks for its knocks (each step's contacts last only that step). */
  afterStep(sim: Simulation): void {
    for (const c of sim.contacts) this.sparks.knock(c);
  }

  /** Each frame: marks and smoke from every car drawn at `poses`, then move everything on by `dt`. */
  update(dt: number, sim: Simulation, poses: readonly CarPose[], camera: THREE.PerspectiveCamera, heightPx: number): void {
    const wet = wetness(sim.conditions);
    const P = TUNING.effects.spray;
    const D = TUNING.effects.dust;
    sim.cars.forEach((car, k) => {
      const pose = poses[k];
      // A wet road takes no rubber.
      if (wet === 0) this.skids.update(k, car, pose);
      const v = car.body.linvel();
      const speed = Math.hypot(v.x, v.z);
      this.keys[k] ??= car.wheels.map((_, i) => `${k}/${i}`);
      const spray = wet * Math.min(1, Math.max(0, (speed - P.minSpeed) / P.fullSpeed));
      // Dry gravel throws up dust; wet, it sticks.
      const dusty = (1 - wet) * Math.min(1, Math.max(0, (speed - D.minSpeed) / D.fullSpeed));
      car.wheels.forEach((w, i) => {
        const gravel = w.contact && w.surface === 'dirt';
        // Wet tyres hardly smoke; they throw up water instead. On gravel they throw up stones and dust.
        const slide = gravel ? 0 : slideAmount(w) * (1 - wet);
        const throws = w.contact ? spray : 0;
        const dust = gravel ? dusty + D.slide * slideAmount(w) * (1 - wet) : 0;
        const p = slide > 0 || throws > 0 || dust > 0 ? contactPoint(car, pose, i, this.point, this.q) : this.point;
        this.smoke.emit(this.keys[k][i], p.x, p.y, p.z, v.x, v.z, slide, speed, dt);
        this.spray.emit(this.keys[k][i], p.x, p.y, p.z, v.x, v.z, throws, speed, dt);
        this.dust.emit(this.keys[k][i], p.x, p.y, p.z, v.x, v.z, dust, speed, dt);
      });
    });
    for (const fx of [this.smoke, this.sparks, this.spray, this.dust]) fx.setScale(heightPx, camera.fov);
    this.smoke.update(dt);
    this.sparks.update(dt);
    this.spray.update(dt);
    this.dust.update(dt);
  }

  /** The cars jumped (a restart, a car put back): don't join their marks across the gap. */
  break(): void {
    this.skids.break();
  }
}
