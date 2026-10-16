// Tyre smoke: soft grey puffs from sliding tyres, growing, rising and fading. A fixed pool of
// points drawn in one call with a small shader (size in metres, soft round edge), which the
// sparks share.

import * as THREE from 'three';
import { TUNING } from '../../config';

/** Points sized in metres (`aSize`), each with its own opacity (`aAlpha`): smoke and sparks. */
export const POINT_VERTEX = `
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

/** A soft round point in `uColour`. */
export const POINT_FRAGMENT = `
uniform vec3 uColour;
varying float vAlpha;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.3, r) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColour, a);
}`;

/** What a kind of puff is like: smoke, or spray (TUNING.effects). */
export interface PuffDef {
  colour: number;
  capacity: number;
  rate: number;
  minSpeed: number;
  life: number;
  size: number[];
  rise: number;
  opacity: number;
}

export class Smoke {
  readonly points: THREE.Points;
  readonly capacity: number;
  /** Puffs alive. */
  live = 0;
  private readonly positions: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly velocity: Float32Array;
  private readonly age: Float32Array;
  private readonly material: THREE.ShaderMaterial;
  /** Fractional puffs owed to each emitter between frames. */
  private readonly owed = new Map<string, number>();

  constructor(private readonly S: PuffDef = TUNING.effects.smoke) {
    const capacity = S.capacity;
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
      uniforms: { uScale: { value: 500 }, uColour: { value: new THREE.Color(S.colour) } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /** Pixels per metre at one metre away, for the camera's field of view and the canvas height. */
  setScale(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  /**
   * Smoke from emitter `key` (a car's wheel) at (x, y, z), sliding `slide` (0–1+) at `speed`
   * (m/s), moving (vx, vz), over `dt` seconds.
   */
  emit(key: string, x: number, y: number, z: number, vx: number, vz: number, slide: number, speed: number, dt: number): void {
    const { S } = this;
    if (slide <= 0 || speed < S.minSpeed) {
      this.owed.set(key, 0);
      return;
    }
    let owed = (this.owed.get(key) ?? 0) + S.rate * Math.min(1, slide) * dt;
    while (owed >= 1) {
      owed -= 1;
      this.spawn(x, y, z, vx * 0.3, vz * 0.3);
    }
    this.owed.set(key, owed);
  }

  /** One puff (if the pool is full, the oldest is reused). */
  spawn(x: number, y: number, z: number, vx: number, vz: number): void {
    const { S } = this;
    let k = this.live;
    if (k < this.capacity) this.live++;
    else {
      // Full: reuse the oldest.
      k = 0;
      for (let j = 1; j < this.capacity; j++) if (this.age[j] > this.age[k]) k = j;
    }
    this.positions.set([x + (Math.random() - 0.5) * 0.3, y + 0.15, z + (Math.random() - 0.5) * 0.3], k * 3);
    this.velocity.set([vx + (Math.random() - 0.5), S.rise * (0.5 + Math.random()), vz + (Math.random() - 0.5)], k * 3);
    this.age[k] = 0;
    this.sizes[k] = S.size[0];
    this.alphas[k] = S.opacity;
  }

  /** Age, move and fade every puff by `dt` seconds. */
  update(dt: number): void {
    const { S } = this;
    for (let k = 0; k < this.live; ) {
      this.age[k] += dt;
      const f = this.age[k] / S.life;
      if (f >= 1) {
        this.remove(k);
        continue;
      }
      for (let a = 0; a < 3; a++) this.positions[k * 3 + a] += this.velocity[k * 3 + a] * dt;
      this.velocity[k * 3] *= 1 - 1.5 * dt;
      this.velocity[k * 3 + 2] *= 1 - 1.5 * dt;
      this.sizes[k] = S.size[0] + (S.size[1] - S.size[0]) * Math.sqrt(f);
      this.alphas[k] = S.opacity * (1 - f) * (1 - f);
      k++;
    }
    const geometry = this.points.geometry;
    geometry.setDrawRange(0, this.live);
    for (const name of ['position', 'aSize', 'aAlpha']) geometry.getAttribute(name).needsUpdate = true;
  }

  /** Move the last live puff into slot k. */
  private remove(k: number): void {
    const last = --this.live;
    if (k === last) return;
    this.positions.copyWithin(k * 3, last * 3, last * 3 + 3);
    this.velocity.copyWithin(k * 3, last * 3, last * 3 + 3);
    this.age[k] = this.age[last];
    this.sizes[k] = this.sizes[last];
    this.alphas[k] = this.alphas[last];
  }
}
