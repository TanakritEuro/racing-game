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
  // Inside each corner, and on the outside of its exit.
  kerbs: [
    { from: 288, to: 328, side: 'left' },
    { from: 308, to: 348, side: 'right' },
    { from: 372, to: 416, side: 'left' },
    { from: 394, to: 436, side: 'right' },
    { from: 460, to: 596, side: 'left' },
    { from: 528, to: 616, side: 'right' },
    { from: 622, to: 734, side: 'right' },
    { from: 678, to: 754, side: 'left' },
    { from: 776, to: 822, side: 'left' },
    { from: 799, to: 842, side: 'right' },
    { from: 880, to: 892, side: 'left' },
    { from: 886, to: 912, side: 'right' },
    { from: 960, to: 1010, side: 'left' },
    { from: 985, to: 1030, side: 'right' },
    { from: 1038, to: 1098, side: 'left' },
    { from: 1068, to: 1118, side: 'right' },
    { from: 1128, to: 1178, side: 'right' },
    { from: 1153, to: 1198, side: 'left' },
    { from: 1222, to: 1350, side: 'left' },
    { from: 1286, to: 1370, side: 'right' },
  ],
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
