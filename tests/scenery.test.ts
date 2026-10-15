import { describe, expect, it } from 'vitest';
import { CIRCUITS } from '../src/track/circuits';
import { barrierOffset } from '../src/track/geometry';
import { layoutScenery, TREE_CLEARANCE } from '../src/track/scenery';
import { buildTerrain, terrainHeight } from '../src/track/terrain';
import { buildTrack, nearestSample } from '../src/track/track';

describe.each(CIRCUITS.filter((c) => c.scenery).map((def) => [def.name, def] as const))('%s scenery', (_, def) => {
  const track = buildTrack(def);
  const terrain = buildTerrain(track, def.terrain);
  const scenery = def.scenery!;
  const layout = layoutScenery(track, terrain, scenery);

  it('plants about the trees asked for, all clear of the track and on the ground', () => {
    expect(layout.trees.length).toBeGreaterThan(scenery.trees * 0.4);
    expect(layout.trees.length).toBeLessThanOrEqual(Math.ceil(scenery.trees / 12) * 12);
    for (const t of layout.trees) {
      const p = track.samples[nearestSample(track, t.x, t.z)];
      // Beyond the nearer side's barrier at least, plus the clearance.
      const reach = Math.min(barrierOffset(p, 'left'), barrierOffset(p, 'right'));
      expect(Math.hypot(t.x - p.x, t.z - p.z)).toBeGreaterThan(reach + TREE_CLEARANCE - 0.01);
      expect(t.y).toBeCloseTo(terrainHeight(terrain, t.x, t.z), 6);
    }
  });

  it('stands its buildings behind the barriers, facing the track', () => {
    for (const b of [...layout.grandstands, ...(layout.pits ? [layout.pits] : [])]) {
      const p = track.samples[nearestSample(track, b.x, b.z)];
      const away = Math.hypot(b.x - p.x, b.z - p.z);
      expect(away).toBeGreaterThan(Math.min(barrierOffset(p, 'left'), barrierOffset(p, 'right')));
      // Facing: towards the nearest track point.
      expect((p.x - b.x) * b.fx + (p.z - b.z) * b.fz).toBeGreaterThan(0);
    }
    expect(layout.pits).not.toBeNull();
  });

  it('is the same every time', () => {
    expect(layoutScenery(track, terrain, scenery)).toEqual(layout);
  });
});
