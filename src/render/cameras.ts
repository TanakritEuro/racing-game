// The camera rig: a chase camera behind the car, and bumper and hood cameras fixed to it.
// C cycles through them. Reads the (interpolated) car pose; never writes to the simulation.

import * as THREE from 'three';
import { TUNING } from '../config';
import { damp } from '../math';
import type { CarPose } from '../vehicle/car';
import type { CarDef } from '../vehicle/carDef';

export type CameraMode = 'chase' | 'bumper' | 'hood';
export const CAMERA_MODES: readonly CameraMode[] = ['chase', 'bumper', 'hood'];

export class CameraRig {
  mode: CameraMode = 'chase';
  private readonly position = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly along = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private initialised = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly def: CarDef,
  ) {
    this.setMode('chase');
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    const C = TUNING.camera;
    this.camera.fov = C[mode].fov;
    this.camera.near = mode === 'chase' ? C.chase.near : C.inCarNear;
    this.camera.updateProjectionMatrix();
    this.snap();
  }

  cycle(): void {
    this.setMode(CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length]);
  }

  /** Jump straight to the target next frame (after a reset or a mode change). */
  snap(): void {
    this.initialised = false;
  }

  update(pose: CarPose, dt: number): void {
    const p = pose.position;
    const q = this.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
    if (this.mode !== 'chase') {
      // Fixed to the body: it pitches and rolls with the car.
      const mount = this.def.cameras[this.mode];
      this.camera.position.set(mount.x, mount.y, mount.z).applyQuaternion(q).add(this.target.set(p.x, p.y, p.z));
      this.camera.quaternion.copy(q);
      return;
    }

    const C = TUNING.camera.chase;
    // Follow the car's heading, including the road's slope (so a crest or a dip doesn't put
    // the camera in the ground), but not its roll.
    const along = this.along.set(0, 0, -1).applyQuaternion(q).normalize();
    this.target.set(p.x, p.y, p.z).addScaledVector(along, -C.distance);
    this.target.y += C.height;
    this.lookTarget.set(p.x, p.y + 0.6, p.z).addScaledVector(along, C.lookAhead);
    if (!this.initialised) {
      this.position.copy(this.target);
      this.look.copy(this.lookTarget);
      this.initialised = true;
    }
    const k = damp(C.follow, dt);
    this.position.lerp(this.target, k);
    this.look.lerp(this.lookTarget, Math.min(1, k * 2));
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.look);
  }
}
