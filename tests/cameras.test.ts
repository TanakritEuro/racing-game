import { describe, expect, it } from 'vitest';
import { beyondBarriers, cameraSees, covers, placeTvCameras } from '../src/track/cameras';
import { CIRCUITS } from '../src/track/circuits';
import { buildTerrain } from '../src/track/terrain';
import { buildTrack } from '../src/track/track';

describe.each(CIRCUITS.map((c) => [c.name, c] as const))('TV cameras at %s', (_, circuit) => {
  const track = buildTrack(circuit);
  const terrain = buildTerrain(track, circuit.terrain);
  const cameras = placeTvCameras(track, terrain);
  const n = track.samples.length;

  it('stand beyond the barriers', () => {
    for (const c of cameras) expect(beyondBarriers(track, c.x, c.z, 1)).toBe(true);
  });

  it('cover every sample, each with the car in sight', () => {
    for (let i = 0; i < n; i++) {
      const c = cameras.find((cam) => covers(cam, i, n));
      expect(c, `sample ${i}`).toBeDefined();
      expect(cameraSees(c!, track.samples[i], terrain), `sample ${i}`).toBe(true);
    }
  });

  it('are a sensible number for the length', () => {
    // About one every 100–400 m: enough cuts to follow the car, not a cut every corner.
    expect(cameras.length).toBeGreaterThan(track.length / 400);
    expect(cameras.length).toBeLessThan(track.length / 80);
  });
});
