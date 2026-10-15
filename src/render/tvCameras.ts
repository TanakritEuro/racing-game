// The replay camera: from the trackside TV camera covering the car, turning to follow it and
// zooming so the car stays about the same size in frame. Cuts to the next camera as the car
// leaves a camera's stretch. Reads the drawn pose; never writes to the simulation.

import * as THREE from 'three';
import { TUNING } from '../config';
import { damp } from '../math';
import { covers, type TvCamera } from '../track/cameras';
import { nearestSample, type Track } from '../track/track';
import type { CarPose } from '../vehicle/pose';

const DEG = 180 / Math.PI;

export class TvCameraView {
  private current = 0;
  private index = 0;
  private readonly look = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private fov = TUNING.camera.tv.maxFov;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly track: Track,
    private readonly cameras: readonly TvCamera[],
  ) {}

  /** Follow the car at `pose`; `jump` after the playhead jumped (search the whole track, cut). */
  update(pose: CarPose, dt: number, jump: boolean): void {
    const C = TUNING.camera.tv;
    const p = pose.position;
    const n = this.track.samples.length;
    this.index = nearestSample(this.track, p.x, p.z, jump ? undefined : this.index);
    let cut = jump;
    if (!covers(this.cameras[this.current], this.index, n)) {
      // The next camera round the lap that covers the car.
      for (let k = 1; k <= this.cameras.length; k++) {
        const c = (this.current + k) % this.cameras.length;
        if (covers(this.cameras[c], this.index, n)) {
          this.current = c;
          break;
        }
      }
      cut = true;
    }
    const cam = this.cameras[this.current];
    this.camera.position.set(cam.x, cam.y, cam.z);
    this.target.set(p.x, p.y + C.aimHeight, p.z);
    const distance = this.camera.position.distanceTo(this.target);
    const fov = Math.min(C.maxFov, Math.max(C.minFov, 2 * Math.atan(C.framing / 2 / distance) * DEG));
    if (cut) {
      this.look.copy(this.target);
      this.fov = fov;
    } else {
      const k = damp(C.follow, dt);
      this.look.lerp(this.target, k);
      this.fov += (fov - this.fov) * k;
    }
    this.camera.lookAt(this.look);
    if (Math.abs(this.camera.fov - this.fov) > 1e-3 || this.camera.near !== C.near) {
      this.camera.fov = this.fov;
      this.camera.near = C.near;
      this.camera.updateProjectionMatrix();
    }
  }
}
