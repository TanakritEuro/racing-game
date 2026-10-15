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

export function createPhysics(track: Track): Physics {
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = PHYSICS_STEP;
  const tags = new Map<number, SurfaceTag>();
  const add = (tag: SurfaceTag, desc: RAPIER.ColliderDesc) => tags.set(world.createCollider(desc).handle, tag);

  // Grass everywhere, its top 5 mm below the road so a wheel's ray hits the road first.
  add('grass', RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.505, 0).setFriction(0.5));

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
