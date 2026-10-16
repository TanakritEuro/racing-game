// Skid marks: dark strips laid on the road under any tyre sliding past its peak slip. One
// mesh of quads used as a ring buffer: the oldest marks are overwritten, nothing is allocated
// once it exists. Reads the cars; never writes to them.

import * as THREE from 'three';
import { TUNING } from '../../config';
import type { Car, Wheel } from '../../vehicle/car';
import type { CarPose } from '../../vehicle/pose';

/** How far past its grip a tyre is: 0 while gripping, rising as it slides (1 = twice its peak). */
export function slideAmount(w: Wheel): number {
  if (!w.contact) return 0;
  if (w.locked) return 1;
  const angle = Math.abs(w.slipAngle) / w.tyre.peakSlipAngle;
  const ratio = Math.abs(w.slipRatio) / w.tyre.peakSlipRatio;
  return Math.max(0, Math.max(angle, ratio) / TUNING.effects.slideFrom - 1);
}

/** Where each wheel's tyre meets the road (world), for a car drawn at `pose`. */
export function contactPoint(car: Car, pose: CarPose, i: number, out: THREE.Vector3, q: THREE.Quaternion): THREE.Vector3 {
  const w = car.wheels[i];
  const m = w.mount;
  const r = pose.rotation;
  q.set(r.x, r.y, r.z, r.w);
  out.set(m.x, m.y - pose.wheels[i].suspensionLength - w.tyre.radius, m.z).applyQuaternion(q);
  out.x += pose.position.x;
  out.y += pose.position.y;
  out.z += pose.position.z;
  return out;
}

interface Trail {
  /** The last edge laid: its left and right ends, or null when not marking. */
  left: THREE.Vector3;
  right: THREE.Vector3;
  marking: boolean;
}

export class SkidMarks {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  /** The next quad to (over)write. */
  next = 0;
  private readonly positions: Float32Array;
  private readonly colours: Float32Array;
  private readonly trails = new Map<string, Trail>();
  private readonly point = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly left = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();

  constructor(capacity = TUNING.effects.skid.capacity) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 4 * 3);
    this.colours = new Float32Array(capacity * 4 * 4);
    const indices = new Uint32Array(capacity * 6);
    for (let k = 0; k < capacity; k++) indices.set([4 * k, 4 * k + 2, 4 * k + 1, 4 * k + 1, 4 * k + 2, 4 * k + 3], 6 * k);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colours, 4).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    // Bounds that never cull: the marks are wherever the cars have been.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    const material = new THREE.MeshBasicMaterial({
      color: 0x111111,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Lay marks under every sliding tyre of `car` (index `k`), drawn at `pose`. */
  update(k: number, car: Car, pose: CarPose): void {
    const S = TUNING.effects.skid;
    car.wheels.forEach((w, i) => {
      const key = `${k}/${i}`;
      let trail = this.trails.get(key);
      if (!trail) this.trails.set(key, (trail = { left: new THREE.Vector3(), right: new THREE.Vector3(), marking: false }));
      const slide = slideAmount(w);
      if (slide <= 0) {
        trail.marking = false;
        return;
      }
      const p = contactPoint(car, pose, i, this.point, this.q);
      // Across the tyre: the car's right on the road, the tread's width.
      this.up.set(1, 0, 0).applyQuaternion(this.q).multiplyScalar(w.tyre.width / 2);
      const lift = S.lift;
      const left = this.left.copy(p).sub(this.up);
      const right = this.right.copy(p).add(this.up);
      left.y += lift;
      right.y += lift;
      if (!trail.marking) {
        trail.left.copy(left);
        trail.right.copy(right);
        trail.marking = true;
        return;
      }
      const moved = trail.left.distanceTo(left);
      if (moved < S.step) return;
      // A jump (the car was put back on the track): start a new mark rather than join across.
      if (moved > S.maxStep) {
        trail.left.copy(left);
        trail.right.copy(right);
        return;
      }
      this.lay(trail.left, trail.right, left, right, Math.min(1, slide) * S.opacity);
      trail.left.copy(left);
      trail.right.copy(right);
    });
  }

  /** One quad from the edge (a0, a1) to the edge (b0, b1), `alpha` dark. */
  lay(a0: THREE.Vector3, a1: THREE.Vector3, b0: THREE.Vector3, b1: THREE.Vector3, alpha: number): void {
    const k = this.next;
    this.next = (this.next + 1) % this.capacity;
    [a0, a1, b0, b1].forEach((v, j) => {
      this.positions.set([v.x, v.y, v.z], (4 * k + j) * 3);
      this.colours.set([1, 1, 1, alpha], (4 * k + j) * 4);
    });
    const geometry = this.mesh.geometry;
    geometry.getAttribute('position').needsUpdate = true;
    geometry.getAttribute('color').needsUpdate = true;
  }

  /** Forget where every tyre was (after a restart or a teleport), keeping the marks. */
  break(): void {
    for (const t of this.trails.values()) t.marking = false;
  }
}
