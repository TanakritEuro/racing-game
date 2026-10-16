// Sparks: small glowing points thrown off a barrier or another car on a hard knock, falling
// and fading in half a second. A fixed pool of points drawn in one call, added on top.

import * as THREE from 'three';
import { TUNING } from '../../config';
import type { Contact } from '../../sim';
import { POINT_FRAGMENT, POINT_VERTEX } from './smoke';

/** A spark's size (m). */
const SIZE = 0.14;

export class Sparks {
  readonly points: THREE.Points;
  readonly capacity: number;
  live = 0;
  private readonly positions: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly velocity: Float32Array;
  private readonly age: Float32Array;
  private readonly material: THREE.ShaderMaterial;

  constructor(capacity = TUNING.effects.sparks.capacity) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
    this.velocity = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: POINT_VERTEX,
      fragmentShader: POINT_FRAGMENT,
      uniforms: { uScale: { value: 500 }, uColour: { value: new THREE.Color(0xffb347) } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  /** Pixels per metre at one metre away (as `Smoke.setScale`). */
  setScale(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  /** Sparks for a knock: more the harder it was. */
  knock(c: Contact): void {
    const S = TUNING.effects.sparks;
    const n = Math.min(S.max, Math.round(c.impulse * S.perImpulse));
    for (let i = 0; i < n && this.live < this.capacity; i++) {
      const k = this.live++;
      const speed = S.speed[0] + Math.random() * (S.speed[1] - S.speed[0]);
      const a = Math.random() * Math.PI * 2;
      const up = 0.2 + Math.random() * 0.8;
      this.positions[k * 3] = c.x;
      this.positions[k * 3 + 1] = c.y + 0.2;
      this.positions[k * 3 + 2] = c.z;
      this.velocity[k * 3] = Math.cos(a) * speed * (1 - up * 0.5);
      this.velocity[k * 3 + 1] = up * speed * 0.6;
      this.velocity[k * 3 + 2] = Math.sin(a) * speed * (1 - up * 0.5);
      this.age[k] = Math.random() * 0.1;
    }
  }

  update(dt: number): void {
    const S = TUNING.effects.sparks;
    for (let k = 0; k < this.live; ) {
      this.age[k] += dt;
      if (this.age[k] >= S.life) {
        this.remove(k);
        continue;
      }
      this.velocity[k * 3 + 1] -= 9.81 * dt;
      for (let a = 0; a < 3; a++) this.positions[k * 3 + a] += this.velocity[k * 3 + a] * dt;
      const f = 1 - this.age[k] / S.life;
      this.sizes[k] = SIZE * (0.5 + 0.5 * f);
      this.alphas[k] = f;
      k++;
    }
    const geometry = this.points.geometry;
    geometry.setDrawRange(0, this.live);
    for (const name of ['position', 'aSize', 'aAlpha']) geometry.getAttribute(name).needsUpdate = true;
  }

  private remove(k: number): void {
    const last = --this.live;
    if (k === last) return;
    this.positions.copyWithin(k * 3, last * 3, last * 3 + 3);
    this.velocity.copyWithin(k * 3, last * 3, last * 3 + 3);
    this.age[k] = this.age[last];
  }
}
