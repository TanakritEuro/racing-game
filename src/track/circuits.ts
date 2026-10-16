import { scaled, withCornerKerbs, withHairpinGravel } from './corners';
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
  scenery: { seed: 3, trees: 500, pits: { from: 40, to: 200, side: 'left' } },
  // A short straight: short tapers.
  pitLane: { side: 'left', entry: 40, exit: 190, taper: 60 },
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

const deg = Math.PI / 180;

/**
 * Harrowmere: fast and flowing over rolling farmland, about 4.5 km. Long straights, sweepers
 * taken flat out, gentle crests and wide grass run-off. Clockwise.
 */
export const HARROWMERE: TrackDef = withCornerKerbs(
  {
    id: 'harrowmere',
    name: 'Harrowmere',
    width: 13,
    runoff: { width: 15, surface: 'grass' },
    terrain: { hills: 12, seed: 7 },
    // The last corner ends just before the line: in after it, out before the first.
    pitLane: { side: 'left', entry: 40, exit: 680 },
    scenery: {
      seed: 7,
      trees: 1600,
      pits: { from: 150, to: 450, side: 'left' },
      grandstands: [
        { from: 120, to: 220, side: 'right' },
        { from: 300, to: 400, side: 'right' },
        { from: 1000, to: 1080, side: 'left' },
      ],
    },
    points: [
      { x: 0, z: 0, y: 0 },
      { x: 400, z: 0, y: 1 },
      { x: 800, z: 0, y: 3 },
      { x: 1100, z: 80, y: 6 },
      { x: 1250, z: 280, y: 9 },
      { x: 1280, z: 500, y: 7 },
      { x: 1200, z: 700, y: 3 },
      { x: 1050, z: 800, y: 0 },
      { x: 850, z: 780, y: -3 },
      { x: 700, z: 850, y: -6 },
      { x: 500, z: 830, y: -5 },
      { x: 320, z: 760, y: -3 },
      { x: 260, z: 620, y: 0 },
      { x: 380, z: 480, y: 3 },
      { x: 520, z: 420, y: 5 },
      { x: 600, z: 320, y: 6 },
      { x: 520, z: 230, y: 5 },
      { x: 300, z: 260, y: 3 },
      { x: 100, z: 330, y: 1 },
      { x: -120, z: 280, y: 0 },
      { x: -180, z: 130, y: -1 },
      { x: -120, z: 20, y: -1 },
    ],
  },
  150,
);

/**
 * Saltmarsh: tight and technical on flat coastal ground, about 3 km. A narrow 10 m road,
 * two hairpins and two chicanes, kerbs to ride, gravel traps where the braking is heaviest.
 * Clockwise.
 */
export const SALTMARSH: TrackDef = withHairpinGravel(
  withCornerKerbs(
    {
      id: 'saltmarsh',
      name: 'Saltmarsh',
      width: 10,
      runoff: { width: 10, surface: 'grass' },
      terrain: { hills: 1.5, seed: 11 },
      pitLane: { side: 'left', entry: 90, exit: 320, taper: 90 },
      scenery: {
        seed: 11,
        trees: 350,
        pits: { from: 20, to: 260, side: 'left' },
        grandstands: [
          { from: 40, to: 130, side: 'right' },
          { from: 420, to: 480, side: 'left' },
          { from: 1590, to: 1660, side: 'left' },
        ],
      },
      points: [
        { x: 150, z: 0 },
        { x: 350, z: 0 },
        { x: 520, z: 0 },
        // Hairpin 1, right, its exit leg splaying away south-west.
        { x: 575, z: 2 },
        { x: 600, z: 22 },
        { x: 592, z: 52 },
        { x: 555, z: 64 },
        { x: 450, z: 100 },
        // Chicane A: a jog left, then back to the west.
        { x: 385, z: 112 },
        { x: 350, z: 138 },
        { x: 300, z: 142 },
        { x: 220, z: 142 },
        { x: 172, z: 170 },
        { x: 155, z: 240 },
        { x: 155, z: 330 },
        { x: 185, z: 420 },
        { x: 280, z: 450 },
        // Chicane B: a jog right, then on east.
        { x: 365, z: 452 },
        { x: 400, z: 478 },
        { x: 445, z: 482 },
        { x: 540, z: 482 },
        // Hairpin 2, right, its exit leg splaying away west.
        { x: 595, z: 486 },
        { x: 625, z: 506 },
        { x: 622, z: 538 },
        { x: 590, z: 552 },
        { x: 480, z: 568 },
        { x: 300, z: 578 },
        { x: 60, z: 578 },
        { x: -50, z: 540 },
        { x: -100, z: 440 },
        { x: -115, z: 250 },
        { x: -100, z: 90 },
        { x: -50, z: 15 },
        { x: 20, z: 0 },
      ],
    },
    120,
  ),
);

/** The carousel's points: a right-hander around `centre` at `radius`, from angle `a0` to `a1` (degrees, clockwise from +X). */
function carousel(cx: number, cz: number, radius: number, a0: number, a1: number, step: number, y: (k: number) => number, bank: number) {
  const out = [];
  for (let a = a0, k = 0; a <= a1 + 1e-9; a += step, k++) out.push({ x: cx + radius * Math.cos(a * deg), z: cz + radius * Math.sin(a * deg), y: y(k), bank });
  return out;
}

/**
 * Ridgeback: hilly, about 4 km, with 40 m of climb. An uphill hairpin, a blind crest into a
 * left, a steep twisting descent and a banked carousel. Clockwise.
 */
export const RIDGEBACK: TrackDef = withHairpinGravel(
  withCornerKerbs(
    {
      id: 'ridgeback',
      name: 'Ridgeback',
      width: 12,
      runoff: { width: 12, surface: 'grass' },
      terrain: { hills: 25, seed: 23 },
      pitLane: { side: 'left', entry: 45, exit: 520 },
      scenery: {
        seed: 23,
        trees: 2600,
        pits: { from: 100, to: 400, side: 'left' },
        grandstands: [
          { from: 150, to: 260, side: 'right' },
          { from: 2300, to: 2420, side: 'left' },
        ],
      },
      points: scaled(1.2, [
        { x: 0, z: 0, y: 0 },
        { x: 300, z: 0, y: 2 },
        { x: 550, z: -10, y: 6 },
        { x: 750, z: 40, y: 12 },
        { x: 860, z: 170, y: 18 },
        { x: 885, z: 300, y: 23 },
        // The uphill hairpin, right, splaying away north-west.
        { x: 882, z: 360, y: 25 },
        { x: 858, z: 382, y: 26 },
        { x: 828, z: 368, y: 27 },
        { x: 790, z: 330, y: 29 },
        { x: 720, z: 270, y: 34 },
        // The blind crest, straight into a left.
        { x: 620, z: 215, y: 40 },
        { x: 545, z: 238, y: 38 },
        { x: 495, z: 320, y: 33 },
        // The twisting descent.
        { x: 520, z: 410, y: 27 },
        { x: 470, z: 480, y: 21 },
        { x: 500, z: 550, y: 16 },
        // The banked carousel.
        ...carousel(420, 640, 80, -20, 180, 40, (k) => 13 - k * 0.8, 10 * deg),
        { x: 330, z: 560, y: 8 },
        { x: 300, z: 470, y: 7 },
        { x: 200, z: 420, y: 5 },
        { x: 80, z: 440, y: 4 },
        { x: -40, z: 400, y: 3 },
        { x: -150, z: 300, y: 2 },
        { x: -200, z: 150, y: 1 },
        { x: -130, z: 30, y: 0 },
      ]),
    },
    150,
  ),
);

/** The circuits you can drive, in track-select order. */
export const CIRCUITS: readonly TrackDef[] = [HARROWMERE, SALTMARSH, RIDGEBACK, TEST_CIRCUIT];
