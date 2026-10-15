import type { TrackDef } from './track';

/**
 * Test circuit: about 1.4 km, with a long start/finish straight, a fast sweeper, a hairpin and an
 * S-section. Invented layout. The first point is the start line.
 */
export const TEST_CIRCUIT: TrackDef = {
  id: 'proving-ground',
  name: 'Proving Ground',
  width: 12,
  runoff: { width: 8, surface: 'grass' },
  points: [
    { x: 0, z: 0 },
    { x: 110, z: 0 },
    { x: 220, z: 0 },
    { x: 300, z: -40 },
    { x: 330, z: -120 },
    { x: 290, z: -200 },
    { x: 210, z: -210 },
    { x: 160, z: -160 },
    { x: 100, z: -180 },
    { x: 60, z: -260 },
    { x: -20, z: -290 },
    { x: -110, z: -260 },
    { x: -140, z: -180 },
    { x: -90, z: -120 },
    { x: -160, z: -60 },
    { x: -120, z: 0 },
  ],
};
