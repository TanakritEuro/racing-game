// `?line`: the AI's racing line drawn on the road, coloured by its target speed (red slow,
// through yellow, to green fast). A debugging aid; reads the line, never writes to it.

import * as THREE from 'three';
import type { RacingLine } from '../ai/racingLine';
import type { Track } from '../track/track';

/** Ribbon half-width (m) and height above the road (m). */
const HALF_WIDTH = 0.18;
const LIFT = 0.04;

export function createLineView(track: Track, line: RacingLine, speed: Float32Array): THREE.Mesh {
  const n = track.samples.length;
  const positions = new Float32Array(n * 2 * 3);
  const colours = new Float32Array(n * 2 * 3);
  let lo = Infinity;
  let hi = 0;
  for (const s of speed) {
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  const colour = new THREE.Color();
  track.samples.forEach((p, i) => {
    for (const side of [0, 1]) {
      const across = side === 0 ? HALF_WIDTH : -HALF_WIDTH;
      const o = (i * 2 + side) * 3;
      positions[o] = line.x[i] + p.lx * across + p.ux * LIFT;
      positions[o + 1] = line.y[i] + p.ly * across + p.uy * LIFT;
      positions[o + 2] = line.z[i] + p.lz * across + p.uz * LIFT;
      const f = (speed[i] - lo) / Math.max(1, hi - lo);
      colour.setHSL(f / 3, 0.9, 0.5);
      colours.set([colour.r, colour.g, colour.b], o);
    }
  });
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
  return new THREE.Mesh(geometry, material);
}
