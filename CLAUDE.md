# Racing

A 3D browser racing game built around **real car physics**: a tyre model, suspension,
weight transfer and a drivetrain that make the car feel like a car. It starts as time
trials on invented circuits, then gains ghosts, AI opponents and a race mode.

Built with Three.js (rendering), Rapier (rigid bodies and raycasts,
`@dimforge/rapier3d-compat`), TypeScript, Vite and Vitest. No backend.

Same author as `../penalty-shootout` and `../five-a-side` (both finished, same stack).
Their replay recorder, synthesised audio, menus, stats and online code can be ported;
read the relevant files there before writing something that already exists.

## Commands

- `npm install` — first-time setup
- `npm run dev` — dev server at http://localhost:5173 (hot reload)
- `npm run build` — typecheck + production build into `dist/`
- `npm run typecheck` — types only
- `npm test` — Vitest

Requires Node 20.19+ or 22.12+ (Vite 8).

## Current state

**Milestone 1 (tyres and drivetrain) is built and waiting for playtesting** (`docs/milestone-1.md`).

A 1.4 km test circuit (`track/circuits.ts`) is built from a spline: asphalt, kerbs, edge
lines, start line, grass run-off and tyre-wall barriers. The car, `KESTREL` (`vehicle/cars.ts`),
is a Rapier rigid body with four raycast wheels (`vehicle/car.ts`): suspension with
bump/rebound damping and bump stops; per-wheel spin; slip ratio and slip angle with
relaxation lengths; Pacejka tyres with load sensitivity and combined slip; and a
rear-wheel-drive drivetrain (engine torque curve, limiter, engine braking, six-speed
gearbox, automatic or manual, automatic clutch, limited-slip diff). The wheel and drivetrain
maths runs in 8 substeps per physics step. Wheels spin on full-throttle launches and lock
under a stamped brake: there is no traction control or ABS yet. Grass has less grip and
more drag. Lap timing (`race/timing.ts`) with an out lap, last and best laps. Chase camera.
`?telemetry` (or T) shows per-wheel load, slip, forces and friction circles, RPM, gear,
pedals and graphs.

Keys: W/S or arrows to accelerate and brake (brake to a stop, release, and press again to
reverse in automatic), A/D or arrows to steer, E/Q to shift up/down, M to switch between
automatic and manual, R to put the car back on the track, T for telemetry.

Measured (tests): 0–100 km/h in ~6.6 s, ~240 km/h top speed, ~0.92 g on a 40 m skidpad
(understeer at the limit), ~43 m from 100 km/h at the best pedal without locking.

## Architecture

The most important rule: **the simulation does not depend on the presentation.**

- **Simulation** (`sim.ts`, `physics.ts`, `vehicle/`, `track/`, `race/`, later `ai/`):
  pure TypeScript with no `three`, DOM, `window` or audio imports. It advances only in
  fixed steps of `PHYSICS_STEP` (120 Hz: tyre forces are stiff) through
  `Simulation.step(controls)`, and takes randomness from a seeded PRNG (`math.ts`).
  Tests drive it headless; ghosts and replays re-run it.
- **Presentation** (`render/`, `input.ts`, `main.ts`, later `ui/`, `audio/`): reads the
  simulation after each step and draws it. Never writes to it.
- **Drivers** produce `Controls` (throttle, brake, steer; later clutch, gear, handbrake).
  Keyboard, gamepad, ghosts and AI drivers all go through the same interface, so the AI
  drives exactly the car the player does, with no extra grip.

### Vehicle model (target for Milestones 1–2)

Per wheel, every step:

1. **Suspension:** raycast (later a shape-cast the width of the tyre, so kerbs and bumps
   don't snag a single ray) from the mount down. Spring, bump/rebound damping, bump
   stop. Load `Fz` comes from here, so weight transfer under braking, acceleration and
   cornering emerges on its own. Anti-roll bars per axle.
2. **Wheel spin dynamics:** each wheel has its own angular velocity `ω`, integrated from
   drive torque minus brake torque minus tyre force × radius over the wheel's inertia.
   This is what makes wheelspin, lock-ups, ABS and traction control possible.
3. **Slip:** slip ratio `κ = (ωr − v_long) / max(|v_long|, ε)` and slip angle
   `α = atan2(v_lat, |v_long|)`. Both blow up near standstill: use relaxation lengths
   (the slip builds up over a distance travelled), which is the standard fix for low-speed jitter.
4. **Tyre forces:** Pacejka "Magic Formula" curves for longitudinal and lateral force, with
   load sensitivity (grip per newton falls as load rises) and combined slip (friction
   ellipse or similar), so braking in a corner costs lateral grip. Surface grip from the
   surface tag under the wheel.
5. **Drivetrain:** engine torque curve over RPM, rev limiter, engine braking and inertia,
   gearbox with ratios and a final drive, clutch, automatic or manual shifting, and a
   differential (open, locked or limited-slip) splitting torque between the driven wheels.

The chassis gets aero drag and, later, downforce. Steering is Ackermann geometry with
speed-sensitive keyboard assistance; gamepads get analogue input. Put every number in
`TUNING` and make a car a data object so more cars are just more data.

References: Marco Monster, *Car Physics for Games*; Brian Beckman, *The Physics of
Racing* series; Hans Pacejka, *Tire and Vehicle Dynamics* (the Magic Formula).

### Tracks

A track is data (`TrackDef`): a closed centreline through control points, road width
and run-off. `buildTrack` samples it every 2 m; `track/geometry.ts` turns samples into
plain arrays used by **both** the colliders and the meshes, so what you see is what the
tyres drive on. Sample 0 is the start line. Elevation, banking and per-point width come
in Milestone 3.

## Layout

- `src/constants.ts` — physical constants, `PHYSICS_STEP` (1/120 s).
- `src/config.ts` — `TUNING`: what isn't about one car (keyboard steering, transmission
  logic, drivetrain solver, tyre integration, surfaces, camera).
- `src/math.ts` — vectors, quaternion rotation, smoothing, seeded PRNG.
- `src/physics.ts` — Rapier world: grass sized to the track, road trimesh, barriers, surface tags.
- `src/sim.ts` — `Simulation`: world, car, lap timer, fixed `step(controls)`, `recover()`,
  `setGearboxMode()`.
- `src/vehicle/car.ts` — chassis body, raycast suspension, the wheel substep loop (tyre
  forces, wheel spin, slip relaxation), force application, `Controls`.
- `src/vehicle/carDef.ts` — `CarDef`, every number about one car; `cars.ts` — the cars (`KESTREL`).
- `src/vehicle/tyre.ts` — Magic Formula, load sensitivity, combined slip (pure functions).
- `src/vehicle/spin.ts` — wheel spin integration with friction torques that never reverse a wheel.
- `src/vehicle/engine.ts`, `gearbox.ts`, `differential.ts` — torque curve and engine braking;
  ratios and shift timing; locking torque for open / locked / limited-slip.
- `src/vehicle/drivetrain.ts` — automatic and manual shifting, automatic clutch, idle and
  limiter, and the substep solver coupling engine, clutch, diff, brakes and driven wheels.
- `src/track/` — `track.ts` (spline, samples, nearest sample, lateral offset),
  `geometry.ts` (road ribbons, barrier segments), `circuits.ts` (track definitions).
- `src/race/timing.ts` — lap timer and time formatting.
- `src/render/` — `scene.ts` (renderer, sky, sun), `trackView.ts`, `carView.ts`
  (placeholder car), `chaseCamera.ts`, `telemetry.ts` (`?telemetry` overlay).
- `src/input.ts` — keyboard → `Controls`, shift requests.
- `src/main.ts` — entry point and frame loop.
- `tests/` — Vitest; `helpers.ts` makes a headless `Simulation`, runs it and has a
  line-following test driver; `tracks.ts` has test-only layouts (skidpad, long oval).

## Conventions

- Units are SI: metres, kilograms, seconds, newtons, radians. Speeds shown in km/h only in the HUD.
- World: +Y up, ground at y = 0. Car local frame: +X right, +Y up, **−Z forward**
  (Three.js convention). Positive steer is to the right.
- Physics runs at a fixed 120 Hz; rendering is variable-rate. Add interpolation between
  the last two physics states for the car's transform when the display rate isn't a
  multiple of 120 (there's none yet).
- Physics is the source of truth. Meshes copy transforms from the simulation.
- Simulation code takes randomness from a seeded PRNG passed in, never `Math.random`.
- Every tuning number goes in `TUNING` (or a car's data). No magic numbers in the model.
- Strict TypeScript. No `any` unless there is a comment explaining why.
- No real car makes, models, logos, sponsors or real circuit layouts. Invented only.

## Verifying changes

- Run `npm run build` and `npm test` after every change; both must pass.
- **Vehicle tests are numbers, not screenshots.** Keep tests that drive the headless
  simulation and check: static loads sum to the weight; 0–100 km/h time; top speed;
  braking distance from 100 km/h; steady-state lateral g on a skidpad (constant radius
  circle); no NaNs or explosions when hitting barriers at speed; standing still on a
  slope without creeping; wheelspin on a launch with traction control off and none with
  it on. Update the expected ranges deliberately when the car's data changes.
- Add a telemetry overlay (`?telemetry`): per wheel load, slip ratio, slip angle and
  force; RPM, gear, speed; and short scrolling graphs. Most handling bugs are obvious there
  and invisible from the chase camera.
- For visual or gameplay changes, run the dev server and look at it in a browser
  (screenshot if possible) before calling something done. Check the console for errors.
- Feel can't be judged by reading code. Ask me to playtest with specific questions
  (e.g. "does lifting off mid-corner tighten the line?", "can you catch a slide?").
- Performance budget: 60 fps on a laptop with eight AI cars. The vehicle model runs
  at 120 Hz for every car, so keep the per-wheel maths allocation-free once it settles.

## Roadmap

Work one milestone at a time and keep the game drivable at the end of each. Before
starting a milestone, write a short plan in `docs/milestone-N.md` (files, data
structures, tests) and check it with me.

1. **Tyres and drivetrain.** Wheel spin dynamics, slip ratio and angle with relaxation
   lengths, Pacejka curves with load sensitivity and combined slip, engine torque curve,
   gearbox (auto and manual), clutch, differential, engine braking. Telemetry overlay.
   The numeric vehicle tests above.
2. **Handling and controls.** Anti-roll bars, aero downforce, Ackermann steering,
   handbrake, ABS and traction control (toggleable), keyboard steering assistance
   (speed-sensitive lock, gentle counter-steer help), gamepad with analogue triggers
   and stick, chase / bumper / hood cameras. Several rounds of playtesting and tuning.
3. **Tracks.** Elevation and banking in `TrackDef` (the road is no longer flat, so the
   collider is a real 3D trimesh), per-point width, kerbs you can ride (raised, with
   rumble), gravel traps with high drag, track limits (lap invalidated off the road),
   scenery (instanced trees, grandstands, a pit building), a minimap, and three
   invented circuits with different character.
4. **Time trial and ghosts.** Sector times and deltas to best, a ghost of your best lap
   (record `Controls` per step and re-simulate, or record transforms, decide in the
   plan), saved per track and car in IndexedDB, replays with trackside TV cameras.
5. **AI drivers.** Compute a racing line per track (minimum curvature, then a speed
   profile from the car's grip limits with forward and backward passes), a driver
   that follows it (pure pursuit or Stanley steering, PID on speed) through the same
   `Controls` and car model, mistakes and difficulty, avoidance and overtaking, a
   standing start and a race mode with positions. Soak tests: AI laps every track
   cleanly within a target time range.
6. **Presentation.** Real car models (free CC0 / permissive kits, recorded in `ASSETS.md`),
   skid marks, tyre smoke, sparks off barriers, engine sound synthesised from RPM and
   load, tyre squeal from slip, wind, a dashboard HUD with a rev counter, menus, car and
   track select, settings.
7. **Championship or online (optional).** A short championship against the AI with
   points, or two-player online racing ported from the earlier games' PeerJS code.
