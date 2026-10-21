// The floodlight towers: a mast and a lamp head each, two instanced meshes for the lot, the lamps
// glowing once the lights are on. Presentation only; where they stand is `track/floodlights.ts`.

import * as THREE from 'three';
import type { Floodlight } from '../track/floodlights';
import type { Track } from '../track/track';

const MAST_RADIUS = 0.25;
const HEAD = { width: 3.2, height: 1.4, depth: 0.5 };

export class FloodlightView {
  readonly root = new THREE.Group();
  private readonly lamp: THREE.MeshStandardMaterial;

  constructor(lights: readonly Floodlight[], track: Track, ground: (x: number, z: number) => number) {
    const n = lights.length;
    const mastGeo = new THREE.CylinderGeometry(MAST_RADIUS * 0.7, MAST_RADIUS, 1, 8);
    mastGeo.translate(0, 0.5, 0);
    const masts = new THREE.InstancedMesh(mastGeo, new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.6, metalness: 0.5 }), n);
    this.lamp = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, emissive: 0xfff4dc, emissiveIntensity: 0, roughness: 0.4 });
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(HEAD.width, HEAD.height, HEAD.depth), this.lamp, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    lights.forEach((l, i) => {
      const base = ground(l.x, l.z);
      const height = l.y - base;
      m.compose(new THREE.Vector3(l.x, base, l.z), q.identity(), new THREE.Vector3(1, height, 1));
      masts.setMatrixAt(i, m);
      // The head faces the track at the sample it stands beside, tilted down towards it.
      const p = track.samples[l.sample];
      const yaw = Math.atan2(p.x - l.x, p.z - l.z);
      q.setFromAxisAngle(up, yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5));
      m.compose(new THREE.Vector3(l.x, l.y, l.z), q, new THREE.Vector3(1, 1, 1));
      heads.setMatrixAt(i, m);
    });
    masts.castShadow = true;
    this.root.add(masts, heads);
  }

  /** How much the lamps glow (0 off … 1 full). */
  setOn(on: number): void {
    this.lamp.emissiveIntensity = 2.5 * on;
  }
}
