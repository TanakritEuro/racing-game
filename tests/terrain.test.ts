import { describe, expect, it } from 'vitest';
import { barrierOffset, crossSection } from '../src/track/geometry';
import { buildTerrain, terrainHeight } from '../src/track/terrain';
import { buildTrack } from '../src/track/track';
import { BANKED_SKIDPAD, HILL, LONG_OVAL } from './tracks';

describe('terrain', () => {
  for (const def of [HILL, BANKED_SKIDPAD]) {
    const track = buildTrack(def);
    const terrain = buildTerrain(track, { hills: 8, seed: 3 });

    it(`${def.name}: lies under the road and run-off everywhere inside the barriers`, () => {
      for (const p of track.samples) {
        for (let k = -10; k <= 10; k++) {
          const q = crossSection(p, (k / 10) * barrierOffset(p, k >= 0 ? 'left' : 'right'));
          expect(terrainHeight(terrain, q.x, q.z)).toBeLessThan(q.y - 0.2);
        }
      }
    });

    it(`${def.name}: has no cliffs`, () => {
      const { nx, nz, spacing, heights } = terrain;
      let steepest = 0;
      for (let ix = 0; ix < nx - 1; ix++) {
        for (let iz = 0; iz < nz - 1; iz++) {
          const h = heights[iz + ix * nz];
          steepest = Math.max(steepest, Math.abs(heights[iz + (ix + 1) * nz] - h) / spacing, Math.abs(heights[iz + 1 + ix * nz] - h) / spacing);
        }
      }
      // Steeper than the road's own slope next to a climb is fine; a step is not.
      expect(steepest).toBeLessThan(1);
    });
  }

  it('is flat for a flat track with no hills, just under the road', () => {
    const terrain = buildTerrain(buildTrack(HILL), { hills: 0, seed: 1 });
    expect(terrain.heights.every(Number.isFinite)).toBe(true);
    const flat = buildTerrain(buildTrack({ ...HILL, points: HILL.points.map((p) => ({ ...p, y: 0 })) }));
    expect(flat.heights.every((h) => Math.abs(h + 0.7) < 1e-5)).toBe(true);
  });

  it('builds quickly even for a big track', () => {
    const start = performance.now();
    const t = buildTerrain(buildTrack(LONG_OVAL));
    expect(t.nx * t.nz).toBeGreaterThan(100_000);
    expect(performance.now() - start).toBeLessThan(3000);
  });
});
