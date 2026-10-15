import * as THREE from 'three';
import { TUNING } from '../config';
import { damp } from '../math';
import type { Car } from '../vehicle/car';

/** Third-person camera behind the car, smoothed so it swings out a little in corners. */
export class ChaseCamera {
  private readonly position = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private initialised = false;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    camera.fov = TUNING.camera.fov;
    camera.updateProjectionMatrix();
  }

  update(car: Car, dt: number): void {
    const C = TUNING.camera;
    const p = car.position;
    const f = car.forward;
    // Follow the heading on the ground only, so the camera doesn't pitch with the body.
    const flat = new THREE.Vector3(f.x, 0, f.z).normalize();
    const target = new THREE.Vector3(p.x, p.y, p.z).addScaledVector(flat, -C.distance);
    target.y += C.height;
    const look = new THREE.Vector3(p.x, p.y + 0.6, p.z).addScaledVector(flat, C.lookAhead);

    if (!this.initialised) {
      this.position.copy(target);
      this.look.copy(look);
      this.initialised = true;
    }
    const k = damp(C.follow, dt);
    this.position.lerp(target, k);
    this.look.lerp(look, Math.min(1, k * 2));
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.look);
  }

  snap(): void {
    this.initialised = false;
  }
}
