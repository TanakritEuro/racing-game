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

Milestones 1–6 (tyres and drivetrain, handling and controls, tracks, time trial and ghosts,
AI drivers, presentation) and 7 (a championship) are done; **Milestone 8 (two-player online
racing) is planned** (`docs/milestone-8.md`).

Four circuits (`track/circuits.ts`): **Harrowmere** (4.6 km, fast and flowing, rolling
farmland), **Saltmarsh** (3.1 km, tight and technical, gravel at the hairpins),
**Ridgeback** (4.0 km, 40 m of climb, a banked carousel) and the flat 1.4 km Proving Ground
the vehicle tests use. Each is a spline through control points with elevation, banking and
width; the road, raised ridged kerbs (from the layout's corners), grass or gravel run-off
and barriers are 3D strips across each sample's banked frame, on a terrain heightfield that
rolls away into hills. Track limits (all four wheels off) invalidate a lap. Scenery (trees,
grandstands, pits), a minimap; `?track=<id>` or N picks the circuit. The car, `KESTREL`
(`vehicle/cars.ts`), is a Rapier rigid body with four wheels that each touch the ground
with three rays across the tread (`vehicle/car.ts`): per-axle suspension with
bump/rebound damping, bump stops and anti-roll bars; per-wheel spin; slip ratio and slip
angle with relaxation lengths; Pacejka tyres with load sensitivity and combined slip; a
steering rack with Ackermann geometry; downforce at each axle; and a rear-wheel-drive
drivetrain (engine torque curve, limiter, engine braking, six-speed gearbox, automatic or
manual, automatic clutch, limited-slip diff). Handbrake, ABS and traction control
(`vehicle/aids.ts`, on by default, toggleable). The wheel and drivetrain maths runs in 8
substeps per physics step. Grass has less grip and more drag. Lap timing (`race/timing.ts`)
with an out lap, last and best laps, three sectors per lap (best sectors purple, faster than
the best lap's green, slower yellow) and a live delta to the best lap measured at every track
sample. A time-trial session (`race/session.ts`) records every lap as transforms at 30 Hz
(`race/recording.ts`); the best valid lap is raced as a translucent ghost and kept per
circuit and car in IndexedDB (`storage/bests.ts`, dropped if the layout's fingerprint
changes; in memory if IndexedDB refuses). Replays of the last or best lap play from
trackside TV cameras placed with terrain line of sight (`track/cameras.ts`), at 0.25×–2×,
paused or skipped; live driving waits meanwhile.

Race mode (`?mode=race`, or Tab): up to seven AI opponents (`ai/`) on a staggered grid,
five red lights, positions, gaps and results (`race/race.ts`). Each circuit gets a
minimum-curvature racing line and a speed profile from the car's own envelope (grip,
downforce, power, braking, banking and crests). The AI drives the same car through the same
`Controls`: Stanley-style steering on the line, speed control on the profile, slide catching,
mistakes and a skill spread by difficulty (`?difficulty=easy|medium|hard`), and traffic
(following, passing where there is room, conceding, keeping a car's width). No
rubber-banding. `?opponents=0..7`, `?laps=N`, `?seed=N`.

Three cars (`vehicle/cars.ts`): Wren (light roadster), Kestrel (the reference) and Harrier
(a powerful GT), drawn with Kenney's CC0 Car Kit models fitted to each car and repainted
(`render/carModels.ts`, placeholder if they fail to load; `ASSETS.md`). Skid marks, tyre
smoke and sparks (`render/effects/`, pooled; sparks from the simulation's contact events,
`sim.contacts`). Synthesised sound (`audio/`): engines from RPM and throttle (yours and the
three nearest), tyre squeal, kerb rumble, wind, gearshift pops and knocks. A dashboard with a
rev counter and shift lights (`ui/dashboard.ts`). A start menu (mode, circuit, car, race
options), Esc for pause and settings (`ui/menu.ts`); a link with `?track`, `?car` or `?mode`
skips the menu.

A championship (`race/championship.ts`): four rounds (Proving Ground 5 laps, Saltmarsh,
Ridgeback and Harrowmere 3) against the same seven AI drivers, their skills drawn once per
season; points 10-8-6-5-4-3-2-1; round 1's grid with you mid-field, then reverse championship
order. Saved in localStorage (`storage/season.ts`); `?season` runs its next round; the
standings follow each round (`ui/standings.ts`).

Keyboard steering goes through an assist (`drivers/steeringAssist.ts`: speed-sensitive lock,
counter-steer help, toggleable); gamepads steer the rack directly with analogue triggers
(`input/`). Chase, bumper and hood cameras; the car is drawn interpolated between physics
steps. Settings are remembered in localStorage. `?telemetry` (or T) shows per-wheel load,
slip, forces, brake torque, ABS and friction circles, RPM, gear, clutch, TC, pedals and graphs.

Keys: W/S or arrows to accelerate and brake (brake to a stop, release, and press again to
reverse in automatic), A/D or arrows to steer, Space handbrake, E/Q to shift up/down, M
automatic/manual, Z ABS, X traction control, V steering assist, C camera, R to put the car
back on the track, Backspace restart from the grid, N next circuit, G ghost on/off, P replay
the last lap (Shift+P the best; in a replay Space pause, ←/→ skip 2 s, 1–4 speed, Esc back),
Tab race / time trial, U sound, Esc pause, T telemetry. Gamepad: left stick, RT/LT, A handbrake, RB/LB shift, Y
camera, View/Back reset.

Measured (tests): 0–100 km/h in ~6.5 s (aids on), ~235 km/h top speed, ~0.98 g on a 40 m
skidpad (mild understeer at the limit), ~39 m from 100 km/h stamping the brake with ABS.

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

1. **Suspension:** three rays across the tyre's tread from the mount down, the highest
   hit taken (rays within 3 mm averaged), so kerbs and bumps don't snag a single ray. Spring, bump/rebound damping, bump
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

A track is data (`TrackDef`): a closed centreline through control points (each with
elevation, banking and width), run-off, kerb and gravel spans, terrain and scenery.
`buildTrack` samples it every 2 m, each sample with a banked cross-section frame and a
profile of what lies beyond each edge; `track/geometry.ts` sweeps strips across those
frames into plain arrays used by **both** the colliders and the meshes, so what you see is
what the tyres drive on. Sample 0 is the start line. Nearest-sample lookups are 2D, so
layouts must not cross over themselves. `tests/circuits.test.ts` checks every circuit
(length, radius ≥ 12 m, grade ≤ 12 %, banking ≤ 12°, no overlaps, a straight start).

## Layout

- `src/constants.ts` — physical constants, `PHYSICS_STEP` (1/120 s).
- `src/config.ts` — `TUNING`: what isn't about one car (keyboard steering, transmission
  logic, drivetrain solver, tyre integration, surfaces, camera).
- `src/math.ts` — vectors, quaternion rotation, smoothing, seeded PRNG.
- `src/physics.ts` — Rapier world: terrain heightfield, road / kerb / run-off trimeshes,
  barriers, surface tags, collision groups (wheels only see ground).
- `src/sim.ts` — `Simulation`: world, car, lap timer, fixed `step(controls)`, `recover()`,
  `setGearboxMode()`.
- `src/vehicle/car.ts` — chassis body, raycast suspension, the wheel substep loop (tyre
  forces, wheel spin, slip relaxation), force application, `Controls`.
- `src/vehicle/carDef.ts` — `CarDef`, every number about one car; `cars.ts` — the cars (`KESTREL`).
- `src/vehicle/tyre.ts` — Magic Formula, load sensitivity, combined slip (pure functions).
- `src/vehicle/spin.ts` — wheel spin integration with friction torques that never reverse a wheel.
- `src/vehicle/steering.ts` — steering rack rate and Ackermann geometry.
- `src/vehicle/aids.ts` — ABS and traction control slip controllers.
- `src/drivers/steeringAssist.ts` — keyboard keys → steering position (assist on or off).
- `src/vehicle/engine.ts`, `gearbox.ts`, `differential.ts` — torque curve and engine braking;
  ratios and shift timing; locking torque for open / locked / limited-slip.
- `src/vehicle/drivetrain.ts` — automatic and manual shifting, automatic clutch, idle and
  limiter, and the substep solver coupling engine, clutch, diff, brakes and driven wheels.
- `src/track/` — `track.ts` (spline, samples and frames, side profiles, nearest sample,
  lateral offset), `geometry.ts` (strips and sweeps: road, kerbs, run-off, barriers),
  `terrain.ts` (heightfield), `cameras.ts` (replay TV camera posts and their stretches), `corners.ts` (corners from curvature, kerb and gravel
  placement), `scenery.ts` (seeded tree and building layout), `circuits.ts` (the circuits).
- `src/ai/` — `envelope.ts` (a car's grip, power and braking from its `CarDef`),
  `racingLine.ts` (minimum-curvature line), `speedProfile.ts` (cornering limits, forward and
  backward passes), `driver.ts` (`AiDriver`: steering, speed, slides, mistakes, recovery),
  `skill.ts` (difficulty and skills), `traffic.ts` (track positions, following, passing).
- `src/race/race.ts` — `Race`: grid, start lights, AI and traffic, positions, gaps, finish.
- `src/race/championship.ts` — `Season`: rounds, the field's skills, points, standings and
  tie-breaks, the grid, each round's race options, JSON; `storage/season.ts` keeps it.
- `src/race/timing.ts` — lap timer, sectors, live delta, track limits and time formatting.
- `src/race/recording.ts` — lap recordings (30 Hz frames of pose and readouts), sampling
  between frames, encode / decode; `session.ts` — `TimeTrial`: records laps, keeps the
  best as the ghost, restarts, loads stored bests.
- `src/storage/bests.ts` — each circuit and car's best lap in IndexedDB (memory fallback).
- `src/replay/replay.ts` — the replay player (speed, pause, skip, hand back to live).
- `src/vehicle/pose.ts` — `CarPose` and interpolation between physics steps.
- `src/render/` — `scene.ts` (renderer, sky, sun), `trackView.ts`, `carView.ts`
  (placeholder car), `cameras.ts` (chase, bumper, hood), `tvCameras.ts` (replay camera),
  `ghostView.ts` (translucent ghost car), `lineView.ts` (`?line`), `telemetry.ts` (`?telemetry` overlay),
  `terrainView.ts`, `scenery.ts`, `minimap.ts`.
- `src/ui/timingHud.ts` — lap, delta, sector splits, last and best; `raceHud.ts` —
  position, lap, gaps, start lights, results; `dashboard.ts` — rev counter, speed, gear, aid
  lights; `menu.ts` — start, pause and settings menus; `standings.ts` — championship
  standings between rounds.
- `src/render/carModels.ts` — loads, fits and paints the car models; `render/effects/` —
  `skidMarks.ts`, `smoke.ts`, `sparks.ts` and `index.ts` (`Effects`).
- `src/audio/` — `sound.ts` (context, volume, knocks and pops), `carVoice.ts` (one car's
  engine, squeal, rumble and wind), `mix.ts` (pure: car state → voice parameters),
  `index.ts` (`GameAudio`).
- `scripts/prepare-cars.mjs` — copies the kit's models into `public/models/cars/`.
- `src/input/` — `keyboard.ts`, `gamepad.ts`, `index.ts` (`PlayerInput`: both devices → `Controls`).
- `src/settings.ts` — player settings in localStorage.
- `src/main.ts` — entry point and frame loop; `?track=<id>`, `?telemetry`, `?debug`
  (exposes `sim`, `race`, `session()`, `step(controls)`, `replay()`, `autopilot`, `effects`,
  `sound()` and `stage` in the
  console), `?line`, `?autopilot`, `?mode=race` and its options.
- `tests/` — Vitest; `helpers.ts` makes a headless `Simulation`, runs it and has a
  line-following test driver (offset, curvature speed profile); `tracks.ts` has test-only
  layouts (skidpads, long oval, hill, kerbed oval, grass and gravel pads).

## Conventions

- Units are SI: metres, kilograms, seconds, newtons, radians. Speeds shown in km/h only in the HUD.
- World: +Y up, ground at y = 0. Car local frame: +X right, +Y up, **−Z forward**
  (Three.js convention). Positive steer is to the right.
- Physics runs at a fixed 120 Hz; rendering is variable-rate. The car is drawn interpolated
  between the last two physics states (`Simulation.previous` / `current`).
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
8. **Online.** Two-player racing over PeerJS: each player simulates their own car, the
   other appears as a proxy car; shared clock for the start; results agreed on both sides.
