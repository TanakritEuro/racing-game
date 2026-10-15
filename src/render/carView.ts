import * as THREE from 'three';
import { TUNING } from '../config';
import type { Car } from '../vehicle/car';

/**
 * Placeholder car: boxes for the body and cabin, cylinders for wheels. Reads the car's
 * state; never writes to it. Milestone 6 swaps in a real model.
 */
export class CarView {
  readonly root = new THREE.Group();
  private readonly wheels: { pivot: THREE.Group; tyre: THREE.Mesh }[] = [];

  constructor(colour = 0xe0b020) {
    const C = TUNING.car;
    const h = C.halfExtents;
    const paint = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.35, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.4, metalness: 0.2 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(h.x * 2, h.y * 1.3, h.z * 2), paint);
    body.position.y = -h.y * 0.25;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(h.x * 1.6, h.y * 1.1, h.z * 0.95), dark);
    cabin.position.set(0, h.y * 0.85, h.z * 0.12);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(h.x * 1.9, 0.05, 0.35), dark);
    wing.position.set(0, h.y * 1.0, h.z * 0.92);
    for (const m of [body, cabin, wing]) {
      m.castShadow = true;
      this.root.add(m);
    }
    // Headlights at the front (-Z).
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
    for (const x of [-0.6, 0.6]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.1, 0.02), lightMat);
      l.position.set(x, 0, -h.z - 0.005);
      this.root.add(l);
    }

    const r = C.wheelRadius;
    const tyreGeo = new THREE.CylinderGeometry(r, r, 0.26, 20);
    tyreGeo.rotateZ(Math.PI / 2); // axle along X
    const rimGeo = new THREE.CylinderGeometry(r * 0.6, r * 0.6, 0.27, 6);
    rimGeo.rotateZ(Math.PI / 2);
    const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
    const rim = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.3, metalness: 0.8 });
    for (let i = 0; i < 4; i++) {
      const pivot = new THREE.Group();
      const tyre = new THREE.Mesh(tyreGeo, rubber);
      tyre.add(new THREE.Mesh(rimGeo, rim));
      tyre.castShadow = true;
      pivot.add(tyre);
      this.root.add(pivot);
      this.wheels.push({ pivot, tyre });
    }
  }

  update(car: Car): void {
    const p = car.position;
    const q = car.rotation;
    this.root.position.set(p.x, p.y, p.z);
    this.root.quaternion.set(q.x, q.y, q.z, q.w);
    car.wheels.forEach((w, i) => {
      const { pivot, tyre } = this.wheels[i];
      pivot.position.set(w.mount.x, w.mount.y - w.suspensionLength, w.mount.z);
      pivot.rotation.y = w.front ? -car.steerAngle : 0;
      // Rolling forward (-Z) turns the top of the wheel forward: negative rotation about +X.
      tyre.rotation.x = -w.spin;
    });
  }
}
