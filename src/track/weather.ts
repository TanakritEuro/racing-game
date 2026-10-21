// The weather: dry, damp or wet, fixed for a session. Its one number, the wetness (0–1), scales
// every surface's grip towards its wet value; standing water (puddles.ts) has a grip of its
// own that falls away with speed as the tyre starts to ride on the water (aquaplaning). Pure.

import { TUNING } from '../config';
import type { SurfaceTag } from '../physics';

export type Conditions = 'dry' | 'damp' | 'wet';

export const CONDITIONS: readonly Conditions[] = ['dry', 'damp', 'wet'];

/** How wet the track is (0 dry … 1 wet). */
export function wetness(conditions: Conditions): number {
  return TUNING.weather.wetness[conditions];
}

/** What a wheel gets from the surface under it: grip (multiplying the tyre's μ) and extra rolling drag (fraction of load). */
export interface SurfaceGrip {
  grip: number;
  drag: number;
  /** The tyre's curve stretched along slip (1 on a sealed surface; more on loose gravel: its peak comes later). */
  slip: number;
}

/**
 * The grip and drag of surface `tag` at `wetness`, for a car at `speed` (m/s, for
 * aquaplaning). Dry, exactly the surfaces' own numbers. Writes into `out`.
 */
export function surfaceGrip(tag: SurfaceTag | null, wet: number, speed: number, out: SurfaceGrip = { grip: 1, drag: 0, slip: 1 }): SurfaceGrip {
  const W = TUNING.weather;
  const base = tag === 'kerb' || tag === 'grass' || tag === 'gravel' || tag === 'dirt' ? tag : 'asphalt';
  const dry: { grip: number; drag: number; slip?: number } = TUNING.surfaces[base];
  out.grip = dry.grip * (1 - wet * (1 - W.wetGrip[base]));
  out.drag = dry.drag;
  out.slip = dry.slip ?? 1;
  if (tag === 'water' && wet > 0) {
    // Standing water: less grip even slowly, and above `from` the tyre starts to float.
    const A = W.water.aquaplane;
    const float = Math.min(1, Math.max(0, (Math.abs(speed) - A.from) / (A.to - A.from)));
    out.grip *= W.water.grip * (1 - float * (1 - A.grip));
    out.drag += W.water.drag;
  }
  return out;
}
