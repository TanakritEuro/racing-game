import RAPIER from '@dimforge/rapier3d-compat';
import { GRAVITY, PHYSICS_STEP } from './constants';
import { uprightAlong } from './math';
import { barriers, kerbs, road, runoff } from './track/geometry';
import { buildTerrain, type Terrain } from './track/terrain';
import type { Track } from './track/track';

/** What a collider is: the wheels read the surface under them from this. */
export type SurfaceTag = 'asphalt' | 'kerb' | 'grass' | 'gravel' | 'barrier' | 'car';

export interface Physics {
  world: RAPIER.World;
  /** Collider handle → surface tag. */
  tags: Map<number, SurfaceTag>;
  /** The ground around the track (also drawn by the view). */
  terrain: Terrain;
  /** Contact force events from the cars' chassis, drained after every step. */
  events: RAPIER.EventQueue;
}

/**
 * Collision groups: (membership << 16) | filter. Everything collides with everything, but
 * membership tells wheels (which only look for GROUND) what they can stand on.
 */
const GROUND = 1;
const BARRIER = 2;
const CAR = 4;
const ALL = 0xffff;
const groups = (membership: number, filter: number) => ((membership << 16) | filter) >>> 0;
export const GROUND_GROUPS = groups(GROUND, ALL);
export const BARRIER_GROUPS = groups(BARRIER, ALL);
export const CAR_GROUPS = groups(CAR, ALL);
/** For a wheel's contact cast: only what a tyre can stand on. */
export const WHEEL_QUERY_GROUPS = groups(ALL, GROUND);

export const BARRIER_HEIGHT = 1.0;
export const BARRIER_THICKNESS = 0.6;

/**
 * A kinematic car body (the other player's car, moved to where it is reported to be): it
 * pushes the cars it meets and isn't pushed back. Tagged as a car for contacts.
 */
export function addKinematicCar(physics: Physics, half: { x: number; y: number; z: number }): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
  const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
  const collider = physics.world.createCollider(
    RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setFriction(0.3).setRestitution(0.1).setCollisionGroups(CAR_GROUPS),
    body,
  );
  physics.tags.set(collider.handle, 'car');
  return { body, collider };
}

/** Call once before creating any world (loads Rapier's WASM). */
export async function initPhysics(): Promise<void> {
  await RAPIER.init();
}

/** Terrain is a pure function of the track, and slow-ish to build: build it once per track. */
const terrains = new WeakMap<Track, Terrain>();
function terrainFor(track: Track): Terrain {
  let terrain = terrains.get(track);
  if (!terrain) {
    terrain = buildTerrain(track, track.def.terrain);
    terrains.set(track, terrain);
  }
  return terrain;
}

export function createPhysics(track: Track): Physics {
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = PHYSICS_STEP;
  const tags = new Map<number, SurfaceTag>();
  const add = (tag: SurfaceTag, desc: RAPIER.ColliderDesc) => {
    desc.setCollisionGroups(tag === 'barrier' ? BARRIER_GROUPS : GROUND_GROUPS);
    tags.set(world.createCollider(desc).handle, tag);
  };

  // The ground: a heightfield just under the run-off, rolling away into hills.
  const terrain = terrainFor(track);
  const { nx, nz, spacing } = terrain;
  add(
    'grass',
    RAPIER.ColliderDesc.heightfield(nz - 1, nx - 1, terrain.heights, { x: (nx - 1) * spacing, y: 1, z: (nz - 1) * spacing })
      .setTranslation(terrain.x0 + ((nx - 1) * spacing) / 2, 0, terrain.z0 + ((nz - 1) * spacing) / 2)
      .setFriction(0.5),
  );

  const trimesh = (tag: SurfaceTag, r: { positions: Float32Array; indices: Uint32Array }) =>
    add(tag, RAPIER.ColliderDesc.trimesh(r.positions, r.indices).setFriction(0.5));
  trimesh('asphalt', road(track));
  for (const k of kerbs(track)) trimesh('kerb', k);
  // Run-off from the kerbs (or road edges) to the barriers, grass or gravel.
  for (const surface of ['grass', 'gravel'] as const) for (const r of runoff(track, surface)) trimesh(surface, r);

  for (const b of barriers(track)) {
    // Upright boxes along the segment, their bottom edge on the run-off.
    const q = uprightAlong(b.dir);
    add(
      'barrier',
      RAPIER.ColliderDesc.cuboid(BARRIER_THICKNESS / 2, BARRIER_HEIGHT / 2, b.length / 2)
        .setTranslation(b.centre.x, b.centre.y + BARRIER_HEIGHT / 2, b.centre.z)
        .setRotation(q)
        .setRestitution(0.2)
        .setFriction(0.3),
    );
  }
  return { world, tags, terrain, events: new RAPIER.EventQueue(true) };
}
