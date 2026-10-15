import RAPIER from '@dimforge/rapier3d-compat';
import { GRAVITY, PHYSICS_STEP } from './constants';
import { barriers, ribbon } from './track/geometry';
import type { Track } from './track/track';

/** What a collider is: the wheels read the surface under them from this. */
export type SurfaceTag = 'asphalt' | 'grass' | 'barrier' | 'car';

export interface Physics {
  world: RAPIER.World;
  /** Collider handle → surface tag. */
  tags: Map<number, SurfaceTag>;
}

export const BARRIER_HEIGHT = 1.0;
export const BARRIER_THICKNESS = 0.6;

/** Call once before creating any world (loads Rapier's WASM). */
export async function initPhysics(): Promise<void> {
  await RAPIER.init();
}

/** Margin of ground beyond the track's furthest point (m). */
const GROUND_MARGIN = 1000;

/** The ground: a rectangle covering the track with `GROUND_MARGIN` to spare. */
export function groundExtent(track: Track): { x: number; z: number; halfX: number; halfZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of track.samples) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return {
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    halfX: (maxX - minX) / 2 + GROUND_MARGIN,
    halfZ: (maxZ - minZ) / 2 + GROUND_MARGIN,
  };
}

export function createPhysics(track: Track): Physics {
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = PHYSICS_STEP;
  const tags = new Map<number, SurfaceTag>();
  const add = (tag: SurfaceTag, desc: RAPIER.ColliderDesc) => tags.set(world.createCollider(desc).handle, tag);

  // Grass everywhere around the track, its top 5 mm below the road so a wheel's ray hits the road first.
  const ground = groundExtent(track);
  add('grass', RAPIER.ColliderDesc.cuboid(ground.halfX, 0.5, ground.halfZ).setTranslation(ground.x, -0.505, ground.z).setFriction(0.5));

  const road = ribbon(track, -track.def.width / 2, track.def.width / 2);
  add('asphalt', RAPIER.ColliderDesc.trimesh(road.positions, road.indices).setFriction(0.5));

  for (const b of barriers(track)) {
    const q = { x: 0, y: Math.sin(b.yaw / 2), z: 0, w: Math.cos(b.yaw / 2) };
    add(
      'barrier',
      RAPIER.ColliderDesc.cuboid(BARRIER_THICKNESS / 2, BARRIER_HEIGHT / 2, b.length / 2)
        .setTranslation(b.x, BARRIER_HEIGHT / 2, b.z)
        .setRotation(q)
        .setRestitution(0.2)
        .setFriction(0.3),
    );
  }
  return { world, tags };
}
