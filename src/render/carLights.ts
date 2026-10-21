// Car lamps at night: every car's headlamps and tail lights glow (the tail lights brighter on the
// brakes), and a few real spot lights, enough for the cars nearest the camera, throw light on
// the road ahead of them. The lamps sit on the model's nose and tail once it has loaded.
// Presentation only: reads poses and pedals, never the simulation.

import * as THREE from 'three';
import { TUNING } from '../config';
import type { CarDef } from '../vehicle/carDef';
import type { CarView } from './carView';

const LAMP = { width: 0.32, height: 0.11 };

/** One car's lamps. */
export class CarLamps {
  private readonly head = new THREE.MeshBasicMaterial({ color: TUNING.night.headlights.lampColour, toneMapped: false });
  private readonly tail = new THREE.MeshBasicMaterial({ color: TUNING.night.headlights.tailColour, toneMapped: false });
  private readonly lamps = new THREE.Group();
  /** The nose's lamp height and how far forward it is (car space), for the spot light. */
  readonly nose = new THREE.Vector3();

  constructor(
    readonly view: CarView,
    def: CarDef,
  ) {
    const h = def.halfExtents;
    this.place(new THREE.Box3(new THREE.Vector3(-h.x, -h.y, -h.z), new THREE.Vector3(h.x, h.y, h.z)));
    view.root.add(this.lamps);
    void view.ready.then((model) => {
      if (!model) return;
      this.place(new THREE.Box3().setFromObject(model.body));
    });
    this.lamps.visible = false;
  }

  /** Lamps at the corners of the body's box (car space: −Z forward). */
  private place(box: THREE.Box3): void {
    this.lamps.clear();
    const w = box.max.x - box.min.x;
    const y = box.min.y + 0.38 * (box.max.y - box.min.y);
    const geo = new THREE.PlaneGeometry(LAMP.width, LAMP.height);
    for (const side of [-1, 1]) {
      const head = new THREE.Mesh(geo, this.head);
      head.position.set(side * 0.33 * w, y, box.min.z - 0.01);
      head.rotation.y = Math.PI;
      const tail = new THREE.Mesh(geo, this.tail);
      tail.position.set(side * 0.36 * w, y + 0.05, box.max.z + 0.01);
      this.lamps.add(head, tail);
    }
    this.nose.set(0, y, box.min.z);
  }

  /** `on`: 0 off … 1 full; `brake`: the pedal (0–1). */
  update(on: number, brake: number): void {
    this.lamps.visible = on > 0.01;
    if (!this.lamps.visible) return;
    const H = TUNING.night.headlights;
    this.head.color.set(H.lampColour).multiplyScalar(0.4 + 1.2 * on);
    this.tail.color.set(H.tailColour).multiplyScalar(H.tail + H.brake * brake);
  }
}

/** A few real spot lights, given each frame to the cars nearest the camera. */
export class HeadlightPool {
  private readonly spots: THREE.SpotLight[] = [];
  private readonly order: number[] = [];
  private readonly at = new THREE.Vector3();

  constructor(scene: THREE.Scene, count: number) {
    const H = TUNING.night.headlights;
    for (let i = 0; i < count; i++) {
      const s = new THREE.SpotLight(H.lampColour, 0, H.distance, H.angle, H.penumbra, H.decay);
      s.castShadow = false;
      scene.add(s, s.target);
      this.spots.push(s);
    }
  }

  /** Light the road ahead of the `count` cars nearest `camera` (the ones that are showing); `on` 0 … 1. */
  update(cars: readonly CarLamps[], camera: THREE.Vector3, on: number): void {
    const H = TUNING.night.headlights;
    this.order.length = 0;
    for (let i = 0; i < cars.length; i++) if (cars[i].view.root.visible || i === 0) this.order.push(i);
    const dist = (i: number) => cars[i].view.root.position.distanceToSquared(camera);
    this.order.sort((a, b) => dist(a) - dist(b));
    this.spots.forEach((s, k) => {
      const car = cars[this.order[k]];
      // Lights stay in the scene (switching them in and out would rebuild every shader): off is dark.
      s.intensity = car && on > 0.01 ? H.intensity * on : 0;
      if (!car || s.intensity === 0) return;
      const root = car.view.root;
      root.updateMatrixWorld();
      s.position.copy(this.at.copy(car.nose).applyMatrix4(root.matrixWorld));
      s.target.position.copy(this.at.set(0, car.nose.y - H.drop, car.nose.z - H.aim).applyMatrix4(root.matrixWorld));
      s.target.updateMatrixWorld();
    });
  }
}
