import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { initPhysics } from '../src/physics';
import { Simulation } from '../src/sim';
import { beyondBarriers } from '../src/track/cameras';
import { CIRCUITS } from '../src/track/circuits';
import { customDef, ovalTemplate } from '../src/track/custom';
import { FloodlightField, lightNeeded, placeFloodlights, sampleLight } from '../src/track/floodlights';
import { terrainHeight } from '../src/track/terrain';
import { buildTrack } from '../src/track/track';

const F = TUNING.night.floodlights;
const all = [...CIRCUITS.map((c) => [c.name, c] as const), ['a custom oval', customDef(ovalTemplate('Night oval'))] as const];

describe.each(all)('floodlights at %s', (_, def) => {
  it('light every stretch of road to its minimum, from towers beyond the barriers', async () => {
    await initPhysics();
    const track = buildTrack(def);
    const terrain = new Simulation(track).physics.terrain;
    const towers = placeFloodlights(track, terrain);
    const field = new FloodlightField(towers);
    for (const t of towers) {
      expect(beyondBarriers(track, t.x, t.z)).toBe(true);
      expect(t.y - terrainHeight(terrain, t.x, t.z)).toBeGreaterThanOrEqual(F.height - 1e-6);
    }
    let corners = 0;
    track.samples.forEach((p, i) => {
      const need = lightNeeded(track, i);
      if (need > F.min) corners++;
      expect(sampleLight(field, p)).toBeGreaterThanOrEqual(need - 1e-6);
    });
    // Corners and the grid get more, and there are some.
    expect(corners).toBeGreaterThan(0);
    // A tower every 40-100 m or so: enough, not a forest.
    const perKm = towers.length / (track.length / 1000);
    expect(perKm).toBeGreaterThan(8);
    expect(perKm).toBeLessThan(25);
  }, 60_000);
});
