# Milestone 3 plan: tracks

## Status: built, in playtesting

Measured: the test driver (cornering at only 0.6 g) laps Harrowmere in 2:19, Saltmarsh in
2:05 and Ridgeback in 2:23, cleanly within the limits. A physics step with one car costs
0.19–0.27 ms, the car update 0.06–0.14 ms (12 rays), so nine cars fit in ~2 ms a frame.
Building a circuit (track, terrain, physics, scenery) takes 0.3–0.5 s.

Where the build differs from the plan below:

- **Wheels touch the ground with three rays across the tread, not a shape-cast.** A cylinder
  shape-cast put a 1 mm ripple at every 2 m mesh edge (Rapier's cast tolerance), a fake
  14 Hz buzz at 100 km/h. Taking the highest of three exact rays, with rays within 3 mm
  of it averaged (taking just the highest flipped between rays on rounding noise and set
  up a 12 Hz pitch wobble), gives the tyre its width without the noise.
- **Collision groups:** wheels only see ground (road, kerbs, run-off, terrain). A
  tyre-width contact otherwise climbed the barriers when the car slid along them.
- **Kerbs and gravel come from the layout:** `track/corners.ts` finds corners by curvature
  and puts kerbs inside each (and outside its exit), gravel outside each hairpin, so they
  follow the control points. The Proving Ground gained corner kerbs this way (its old
  painted strips are gone).
- **"Locked" means braked and turning under 5 % of road speed**, not exactly zero, which the
  drivetrain solver doesn't always reach.
- **Recovering the car (R) voids the lap**, so it can't be a shortcut.
- **Gravel really traps a rear-drive car:** its drag (0.3 g) exceeds the rears' traction on
  it, so the test eases onto gravel at speed and compares deceleration with grass.
- **`?debug`** exposes the simulation in the console (used to place the car for visual checks).
- The Ridgeback layout is scaled up 20 % to reach 4 km; Saltmarsh's start line sits 150 m
  into its straight.

Goal: real circuits. The road rises, falls and banks, changes width, and has kerbs you
can ride with a rumble you feel through the suspension. Run-off is grass or gravel,
leaving the track invalidates the lap, and there is scenery and a minimap. Three
invented circuits with different characters join the flat Proving Ground.

## Scope decisions

- **Everything you drive on is one 3D cross-section swept along the centreline.** Each
  sample has a frame (tangent, banked "left", banked up). Road, kerbs and run-off are
  strips across that frame, and the same arrays feed the trimesh colliders and the meshes,
  as now.
- **The ground becomes a terrain heightfield** (`track/terrain.ts`), shared by a Rapier
  `HeightField` collider and the ground mesh. Near the track it sits just under the
  run-off; further out it blends into gentle seeded hills. Barriers keep cars inside, and
  the terrain catches a car that gets over them.
- **Wheels touch the ground with a shape-cast** the width and radius of the tyre (a
  cylinder along the axle), not a ray, so a raised kerb can't snag one thin ray and drop the
  wheel. The contact normal is limited to 45° from the car's up, so a kerb's face bumps the
  tyre without throwing its force sideways.
- **Kerbs are raised and ridged.** About 4 cm high, with a sloped inner edge and ridges
  matching the red and white paint every 0.5 m, so the rumble is real suspension travel:
  visible in the telemetry now, audible once M6 adds sound.
- **Surfaces:** asphalt, kerb, grass, gravel. Gravel has low grip and very high rolling
  drag, so it stops a car quickly but not instantly.
- **Track limits: all four wheels beyond the kerbs** (on grass or gravel) invalidates the
  lap. The kerbs count as track. An invalid lap still shows its time but doesn't count
  as a best.
- **No crossovers or bridges.** Nearest-sample lookups stay 2D (x, z). A figure-eight
  would need a 3D search, which nothing needs yet.
- **Scenery is procedural low-poly** (trees, grandstands, a pit building), instanced and
  placed from a seeded PRNG. Real models come with the cars in M6.
- **Track select until the M6 menus:** `?track=<id>` and the N key to cycle. The game
  opens on the first of the new circuits; the Proving Ground stays for tests.

## Files

Simulation:

| File | Contents |
| --- | --- |
| `src/track/track.ts` | `TrackDef` v2 (below); samples gain `y`, `bank`, `halfWidth`, a 3D frame; spline through x/y/z, smooth interpolation of width and bank |
| `src/track/geometry.ts` | Cross-section strips in 3D: road, kerbs (raised, ridged), run-off by surface; barrier segments following height and slope |
| `src/track/terrain.ts` | Heightfield grid from the track (spatial hash for nearest samples), seeded hills far out |
| `src/track/circuits.ts` | The Proving Ground plus three new circuits (below) |
| `src/physics.ts` | Trimesh colliders per surface, the heightfield, 3D barriers; surface tags `asphalt` `kerb` `grass` `gravel` |
| `src/vehicle/car.ts` | Cylinder shape-cast per wheel (contact point, normal limited to 45°); reset to a 3D pose |
| `src/race/timing.ts` | Track limits: the lap is invalid once all four wheels are off; best laps only from valid laps |
| `src/sim.ts` | `poseOnTrack` in 3D (on the road, pitched and banked with it) |

Presentation:

| File | Contents |
| --- | --- |
| `src/render/trackView.ts` | Meshes from the 3D strips; kerb paint aligned to the ridges; gravel texture |
| `src/render/terrainView.ts` | Ground mesh from the heightfield |
| `src/render/scenery.ts` | Instanced trees, grandstands, pit building, from each circuit's scenery data |
| `src/render/minimap.ts` | 2D canvas: track outline, start line, car |
| `src/render/cameras.ts` | Chase camera follows the road's slope (smoothed car pitch), so crests and dips don't put it underground |
| `src/main.ts`, `index.html` | Track select, INVALID on the lap timer, track name |

## Key data structures

```ts
interface ControlPoint {
  x: number; z: number;
  y?: number;        // elevation (m), default 0
  bank?: number;     // road roll (rad), positive raises the left edge (for a right-hander)
  width?: number;    // road width here (m), default def.width
}

interface TrackDef {
  id: string; name: string;
  points: readonly ControlPoint[];
  width: number;                         // default road width
  runoff: { width: number; surface: 'grass' | 'gravel' };   // default run-off
  /** Spans by distance from the start line (m), each side separately. */
  kerbs: { from: number; to: number; side: 'left' | 'right' }[];
  gravel: { from: number; to: number; side: 'left' | 'right'; width?: number }[];
  scenery: { seed: number; trees: number; grandstands: Span[]; pits?: Span };
}

interface TrackSample {
  x, y, z, s;              // position, distance from the start line
  tx, ty, tz;              // unit tangent (3D)
  nx, nz;                  // ground-plane left normal (as now: for lateral offsets)
  lx, ly, lz; ux, uy, uz;  // banked left and up: the cross-section frame
  halfWidth: number; bank: number;
}
```

## The circuits (invented)

| Circuit | Character | Length | Notes |
| --- | --- | --- | --- |
| **Harrowmere** | Fast and flowing over rolling farmland | ~4.5 km | Long straights, sweepers taken at 180+ km/h, gentle crests, wide run-off, grass |
| **Saltmarsh** | Tight, technical, flat, coastal | ~3 km | Narrower (10 m), two hairpins and two chicanes, lots of kerbs to ride, gravel traps at the heavy-braking corners |
| **Ridgeback** | Hilly, with banking | ~4 km | 40 m of elevation change, a banked carousel, a blind crest into a left, a steep twisting descent, uphill hairpin |

Each passes the circuit checks below. The Proving Ground stays flat and unchanged, so
the vehicle tests keep their numbers.

## Tests

| File | Asserts |
| --- | --- |
| `track.test.ts` | Samples interpolate height, bank and width through the control points; frames orthonormal; the loop closes smoothly (no jump in height at the start line) |
| `geometry.test.ts` | Road edges at ±half-width along the banked left; kerbs raised by their profile, with ridges at the paint spacing; strips join edge to edge; no NaNs |
| `circuits.test.ts` | Per circuit: length in its range, tightest radius ≥ 12 m, grades ≤ 12 %, banking ≤ 12°, no part of the track and run-off overlapping another part, start straight ≥ 150 m, kerb and gravel spans on the track |
| `terrain.test.ts` | Terrain below the drivable surface everywhere within the barriers; smooth (bounded slope between neighbours) |
| `car.test.ts` | Static loads and the existing numbers unchanged on the flat Proving Ground; the car holds still with the brake on a real 10° road slope; a 15° banked skidpad gives more lateral grip than a flat one |
| `surfaces.test.ts` | Riding a kerb at 100 km/h: the load varies with the ridges, no snag (speed and yaw barely disturbed), wheels stay down; gravel at 80 km/h stops the car far sooner than grass |
| `timing.test.ts` | A lap with all four wheels cut across the grass is invalid; one with two wheels on the kerb is valid; best laps ignore invalid ones |
| `driver.test.ts` | The test driver (now with a curvature-aware speed) laps every circuit with no NaNs, and logs its lap times |

## Commits, in order

1. Plan (this file).
2. TrackDef v2 and 3D samples and frames; 3D road strips, barriers and poses; chase camera
   follows the slope; the Proving Ground unchanged. Tests.
3. Terrain heightfield for physics and view, replacing the ground box. Tests.
4. Shape-cast wheels; raised, ridged kerbs; gravel; the new surface tags. Tests.
5. Track limits and invalid laps; the minimap. Tests.
6. The three circuits, the circuit checks, track select, and the test driver lapping them all.
7. Scenery: trees, grandstands, pit buildings.
8. Performance check (shape-casts × 9 cars), tuning, docs. Then playtest questions.

Each commit passes `npm run build` and `npm test`, is pushed and deploys, and I check
it in the browser from commit 2 on.

## Risks

- **Shape-cast normals on kerb steps.** If the 45° limit still lets kerbs kick the car,
  the fallback is three rays across the tread, taking the highest hit.
- **Heightfield size and load time.** A 5 km circuit with 1 km of margin is ~100 k
  heights at 6 m spacing; building it uses a spatial hash, not a full search per point.
- **Designing the layouts by hand.** The circuit checks (overlap, radius, grade) catch
  geometry mistakes early. How the circuits drive is for your playtests.

## Questions for you

1. Do the three circuit characters suit you (fast and flowing, tight and technical,
   hilly and banked), and the names?
2. Track limits: all four wheels beyond the kerbs invalidates the lap. Stricter (any
   wheel), or more lenient?
3. Track select by `?track=` and the N key until the M6 menus. All right?
