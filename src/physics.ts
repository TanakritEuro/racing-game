import RAPIER from '@dimforge/rapier3d-compat';
import { GRAVITY, PHYSICS_STEP } from './constants';
import { uprightAlong } from './math';
import { barrierOffset, barriers, road, strip } from './track/geometry';
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
}

export const BARRIER_HEIGHT = 1.0;
export const BARRIER_THICKNESS = 0.6;

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
  const add = (tag: SurfaceTag, desc: RAPIER.ColliderDesc) => tags.set(world.createCollider(desc).handle, tag);

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
  // Run-off from each road edge to the barrier.
  const edge = (p: { halfWidth: number }) => p.halfWidth;
  const outer = (p: Parameters<typeof barrierOffset>[1]) => barrierOffset(track, p);
  trimesh(track.def.runoff.surface, strip(track, edge, outer));
  trimesh(
    track.def.runoff.surface,
    strip(
      track,
      (p) => -outer(p),
      (p) => -edge(p),
    ),
  );

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
  return { world, tags, terrain };
}
