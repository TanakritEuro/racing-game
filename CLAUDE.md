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

Milestones 1–17 (tyres and drivetrain, handling and controls, tracks, time trial and ghosts,
AI drivers, presentation, a championship, two-player online racing, car setup, weather, tyre
wear and pit stops, a track editor, touch controls, career mode, front- and all-wheel drive, race
replays, night racing) are done; **Milestone 18 (rally stages) is planned** (`docs/milestone-18.md`).

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

Race replays: every race records each car at 30 Hz and its moments (`race/raceRecording.ts`,
`race/raceMoments.ts`: passes, stops, spins, contacts, fastest laps, finishes). P in a race (or
the pause menu, or the championship standings) plays it back: a director (`replay/director.ts`)
follows moments and battles across the TV cameras, chase and onboard shots, or you pick the car
(the tower, ↑/↓) and camera (C); Q/E jump between moments on the timeline (`ui/replayHud.ts`).
Online too, once the race is over (each screen records every car by id).

Time of day (`track/timeOfDay.ts`): day, dusk, night, or dusk to night over a race, as a light
level; nothing in the simulation changes. Floodlight towers round every circuit
(`track/floodlights.ts`: every stretch lit to a minimum, more at corners and the grid), their
light baked into the track, terrain and scenery (`render/nightLight.ts`); the sky, sun and
fog (`render/lighting.ts`); towers (`render/floodlightView.ts`); every car's head, tail and
brake lights, and real headlights on the four cars nearest the camera (`render/carLights.ts`).
The start menu's Time row or `?time=`; championships draw it per round; online the host's.

Race mode (`?mode=race`, or Tab): up to seven AI opponents (`ai/`) on a staggered grid,
five red lights, positions, gaps and results (`race/race.ts`). Each circuit gets a
minimum-curvature racing line and a speed profile from the car's own envelope (grip,
downforce, power, braking, banking and crests). The AI drives the same car through the same
`Controls`: Stanley-style steering on the line, speed control on the profile, slide catching,
mistakes and a skill spread by difficulty (`?difficulty=easy|medium|hard`), and traffic
(following, passing where there is room, conceding, keeping a car's width). No
rubber-banding. `?opponents=0..7`, `?laps=N`, `?seed=N`.

Five cars (`vehicle/cars.ts`): Wren (light roadster), Finch (front-wheel-drive hot hatch),
Kestrel (the reference), Osprey (all-wheel-drive coupé) and Harrier (a powerful GT). A car's
`drivetrain.layout` is `rwd`, `fwd` or `awd`; all-wheel drive goes through a centre
differential with a torque split (`drivetrain.centre`) and a differential on each axle, all in
the drivetrain's substep solver. Traction control, the gearbox's speed, telemetry and the AI's
traction share follow the layout; an AWD car's setup has a centre split. Drawn with Kenney's CC0 Car Kit models fitted to each car and repainted
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

Online (`online/`, the start menu's Online, or `?online=host&track=&laps=&car=&opponents=&difficulty=`
and `?online=join&code=&car=`): two players over PeerJS (the link ported from five-a-side,
four-character room codes, heartbeats). Each browser simulates only its own cars (the guest
its car; the host its car and any AI opponents) and sends their states 30 times a second;
the other side's cars are kinematic proxies (`sim.addProxy`), placed from those states by
`RemoteCar` (interpolated, dead-reckoned, corrections eased; a ghost while stale). The guest
learns the host's clock from pings (`ClockSync`); `OnlineRace` (`online/session.ts`) steps
both simulations in time with it, puts the lights out on the same step, collects every
car's finishing time so both screens agree, and does rematches and leaving. No pausing
online; Enter asks for a rematch. Tests run two races over a loopback with latency and
jitter (`online/loopback.ts`).

Car setup (`vehicle/setup.ts`): eleven settings (springs and anti-roll bars at each end,
dampers, ride height, front and rear wing, brake bias, differential, gearing), each in clicks
(−5..5) around the car's own numbers; `applySetup` returns an adjusted `CarDef`, and
`setupReadout` the balance (front share of roll stiffness), downforce at 200 km/h, top speed
and brake bias. Saved per car and circuit (`storage/setups.ts`); the garage
(`ui/garage.ts`) opens from the start and pause menus. Only the player's car has a setup:
the simulation takes a `CarDef` per car (`SimOptions.defs`), and the AI drives the car as
designed. A best lap keeps the setup it was set with. `?setup=default` ignores the setup.

Weather (`track/weather.ts`): dry, damp or wet for a whole session; its wetness (0, 0.5,
1) scales every surface's grip towards its wet value (asphalt 72 %, painted kerbs 50 %).
When wet, water stands in the dips and along long flat stretches (`track/puddles.ts`, seeded
per circuit): colliders tagged `water`, where the tyre aquaplanes with speed. The AI's
envelope and speed profile follow the conditions (`circuitAi(track, def, conditions)`). On
screen (`render/weatherView.ts`): overcast sky and fog, rain round the camera, a darker
glossier road, puddles, spray (`effects`), rain and tyre-swish sounds (`audio/rainVoice.ts`).
Bests are kept per circuit, car and weather. Chosen in the start menu or `?weather=`; a
championship draws each round's; online the host's.

Tyre wear, fuel and pit stops: each tyre wears with the energy its contact patch dissipates
(`vehicle/wear.ts`; grip falls gently, then over a cliff at 80 %), at a race's rate (off,
normal, high; `?wear=`). Fuel burns with the engine's output and the car's mass follows; a
race fills the car for its distance. Every circuit has a pit lane along its start straight
(`track/pitLane.ts`: `TrackDef.pitLane`, the lane, wall and boxes as strips), a 60 km/h
limiter and a 5 s penalty, and a 4 s tyre change for a car that stops in its box
(`race/pits.ts`, in the simulation for every car). Once a lap the pit wall weighs each car's
tyres against the laps left (`ai/pitStrategy.ts`, `race/pitCalls.ts`): the AI stops on it,
and the player sees BOX on the tyre panel (`ui/tyresHud.ts`).

The track editor (`editor/`, start menu → Track editor, or `?editor`): a circuit drawn from
above (`mapView.ts`: handles to drag, click to add, pan and zoom; `panels.ts`: each point's
elevation, banking and width, the circuit's settings; `state.ts`: edits, undo and redo).
A drawn circuit (`track/custom.ts`: `CustomCircuit` → `TrackDef`, with kerbs, gravel, a pit
lane placed by `autoPitLane`, pits and a grandstand) is checked by `validateTrack`
(`track/validate.ts`, the rules every circuit keeps, the built-in ones too), saved in the
browser (`storage/customTracks.ts`), offered in the start menu, raced, shared as a link
(`share.ts`, `?share=`) and sent to an online guest in full.

Touch controls (`input/touch.ts`, `ui/touchControls.ts`), shown at the first touch: the left
half steers by the thumb's travel from where it landed (or by tilting the device, a setting),
through the same assist as the keys; analogue brake and accelerator by how far up they're
pressed, a handbrake, and buttons for pause, camera, put back and shifting. Full screen, the
screen kept awake, a notice to turn a phone sideways, the HUD smaller on a touch screen.
Graphics Auto / High / Low (`render/quality.ts`; Low on a phone): pixel ratio, antialiasing,
shadow map, trees, particles and rain.

Career (`race/career.ts`, start menu → Career, `?career`): a ladder of three series (Club Cup:
Wren, easy, dry; National Series: Kestrel, medium, weather, normal wear; Grand Championship:
Harrier, hard, longer races, high wear), each a championship season with its own rounds.
A top-three season opens the next series and its car; every round pays prize money, which
buys upgrades for your cars (`vehicle/upgrades.ts`: engine, tyres, weight, brakes, three levels;
your car only, like a setup). Saved in localStorage (`storage/career.ts`); the career screen
(`ui/careerScreen.ts`) shows the ladder, the season, money and the shop.

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
Tab race / time trial, U sound, Esc pause (online: the menu, the race goes on), Enter
rematch (online), T telemetry. Gamepad: left stick, RT/LT, A handbrake, RB/LB shift, Y
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
- `src/sim.ts` — `Simulation`: world, cars, lap timers, fixed `step(controls)`, `recover()`,
  `setGearboxMode()`, contacts, and proxies (other players' cars, moved to a given pose).
- `src/vehicle/car.ts` — chassis body, raycast suspension, the wheel substep loop (tyre
  forces, wheel spin, slip relaxation), force application, `Controls`.
- `src/vehicle/carDef.ts` — `CarDef`, every number about one car; `cars.ts` — the cars (`KESTREL`);
  `setup.ts` — setups: the settings, `applySetup`, `cleanSetup`, `setupReadout`.
- `src/vehicle/wear.ts` — tyre wear from dissipated energy, grip against wear, fuel burned.
- `src/vehicle/tyre.ts` — Magic Formula, load sensitivity, combined slip (pure functions).
- `src/vehicle/spin.ts` — wheel spin integration with friction torques that never reverse a wheel.
- `src/vehicle/steering.ts` — steering rack rate and Ackermann geometry.
- `src/vehicle/aids.ts` — ABS and traction control slip controllers.
- `src/drivers/steeringAssist.ts` — keyboard keys → steering position (assist on or off).
- `src/vehicle/engine.ts`, `gearbox.ts`, `differential.ts` — torque curve and engine braking;
  ratios and shift timing; locking torque for open / locked / limited-slip.
- `src/vehicle/drivetrain.ts` — automatic and manual shifting, automatic clutch, idle and
  limiter, and the substep solver coupling engine, clutch, diff, brakes and driven wheels
  (`substep` for two driven wheels, `substepAwd` for four through the centre differential).
- `src/track/validate.ts` — `validateTrack`: every circuit rule, each problem with where it is;
  `custom.ts` — custom circuits → `TrackDef`, `autoPitLane`, `cleanCustom`, templates.
- `src/editor/` — the track editor: `index.ts` (`openEditor`), `state.ts`, `mapView.ts`, `panels.ts`;
  `src/share.ts` — a custom circuit packed into a link and back.
- `src/track/pitLane.ts` — the pit lane: where it is, its edges, the lane strip, wall and boxes.
- `src/track/weather.ts` — conditions, wetness, `surfaceGrip` (wet grip, aquaplaning);
  `puddles.ts` — where water stands, and its strips.
- `src/track/` — `track.ts` (spline, samples and frames, side profiles, nearest sample,
  lateral offset), `geometry.ts` (strips and sweeps: road, kerbs, run-off, barriers),
  `terrain.ts` (heightfield), `cameras.ts` (replay TV camera posts and their stretches), `corners.ts` (corners from curvature, kerb and gravel
  placement), `scenery.ts` (seeded tree and building layout), `circuits.ts` (the circuits).
- `src/ai/` — `envelope.ts` (a car's grip, power and braking from its `CarDef`),
  `racingLine.ts` (minimum-curvature line), `speedProfile.ts` (cornering limits, forward and
  backward passes), `driver.ts` (`AiDriver`: steering, speed, slides, mistakes, recovery),
  `skill.ts` (difficulty and skills), `traffic.ts` (track positions, following, passing).
- `src/race/race.ts` — `Race`: grid, start lights, AI and traffic, positions, gaps, finish;
  `pits.ts` — the limiter, penalties and stops; `pitCalls.ts` — the pit wall's BOX calls.
- `src/ai/pitStrategy.ts` — when to stop: the time worn tyres lose against a stop's cost.
- `src/race/championship.ts` — `Season`: rounds, the field's skills, points, standings and
  tie-breaks, the grid, each round's race options (weather drawn or dry, the wear rate), JSON;
  `storage/season.ts` keeps it. `career.ts` — `Career`: the series, prizes, promotion,
  buying upgrades; `storage/career.ts` keeps it. `vehicle/upgrades.ts` — `applyUpgrades`, prices.
- `src/race/timing.ts` — lap timer, sectors, live delta, track limits and time formatting.
- `src/race/recording.ts` — lap recordings (30 Hz frames of pose and readouts), sampling
  between frames, encode / decode; `session.ts` — `TimeTrial`: records laps, keeps the
  best as the ghost, restarts, loads stored bests.
- `src/storage/bests.ts` — each circuit and car's best lap in IndexedDB (memory fallback), with
  the setup it was set with; `setups.ts` — each car's setup per circuit in localStorage;
  `customTracks.ts` — the custom circuits.
- `src/replay/replay.ts` — the replay player (a lap or a race: speed, pause, skip, moments, hand back
  to live); `director.ts` — the race replay's shots. `src/race/raceRecording.ts` — every car
  through a race, standings at any time; `raceMoments.ts` — the moments as they happen.
- `src/vehicle/pose.ts` — `CarPose` and interpolation between physics steps.
- `src/render/` — `scene.ts` (renderer, sky, sun), `trackView.ts`, `carView.ts`
  (placeholder car), `cameras.ts` (chase, bumper, hood), `tvCameras.ts` (replay camera),
  `ghostView.ts` (translucent ghost car), `lineView.ts` (`?line`), `telemetry.ts` (`?telemetry` overlay),
  `weatherView.ts` (sky, fog, rain),
  `terrainView.ts`, `scenery.ts`, `minimap.ts`.
- `src/ui/timingHud.ts` — lap, delta, sector splits, last and best; `raceHud.ts` —
  position, lap, gaps, start lights, results; `dashboard.ts` — rev counter, speed, gear, aid
  lights; `menu.ts` — start, pause and settings menus; `standings.ts` — championship
  standings between rounds; `garage.ts` — the setup screen; `tyresHud.ts` — tyres, fuel,
  the limiter light and BOX; `careerScreen.ts` — the career.
- `src/render/carModels.ts` — loads, fits and paints the car models; `render/effects/` —
  `skidMarks.ts`, `smoke.ts`, `sparks.ts` and `index.ts` (`Effects`).
- `src/audio/` — `sound.ts` (context, volume, knocks and pops), `carVoice.ts` (one car's
  engine, squeal, rumble and wind), `mix.ts` (pure: car state → voice parameters),
  `index.ts` (`GameAudio`), `rainVoice.ts` (rain and tyre swish).
- `scripts/prepare-cars.mjs` — copies the kit's models into `public/models/cars/`.
- `src/online/` — `link.ts` (PeerJS rooms, from five-a-side), `loopback.ts` (two linked ends
  in one process, with delay and jitter, for tests), `protocol.ts` (the messages, each checked
  on arrival; `PROTOCOL`), `clock.ts` (`ClockSync`), `state.ts` (a car's state packed for the
  wire), `remoteCar.ts` (`RemoteCar`: states → pose now), `session.ts` (handshakes and
  `OnlineRace`). All but `link.ts` are pure (the clock is passed in); `ui/onlinePanel.ts`
  shows the connecting screens and the status line over the race.
- `src/input/` — `keyboard.ts`, `gamepad.ts`, `touch.ts` (`TouchInput`: thumb, tilt, pedals,
  buttons), `index.ts` (`PlayerInput`: all three → `Controls`, `whoSteers`);
  `ui/touchControls.ts` — the on-screen controls; `render/quality.ts` — graphics High and Low.
- `src/settings.ts` — player settings in localStorage.
- `src/main.ts` — entry point and frame loop; `?track=<id>`, `?telemetry`, `?debug`
  (exposes `sim`, `race`, `online`, `session()`, `step(controls)`, `replay()`, `autopilot`,
  `effects`, `sound()` and `stage` in the console), `?line`, `?autopilot`, `?mode=race` and
  its options, `?season`, `?online`, `?setup=default`, `?weather=dry|damp|wet`, `?time=day|dusk|night|duskToNight`, `?wear=off|normal|high`, `?editor` (`=<id>` to edit one), `?share=`, `?career` (the next career round), `?menu=career`.
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
9. **Car setup.** A garage: springs, anti-roll bars, dampers, ride height, wings, brake
   bias, differential and gearing in clicks around each car's own values, saved per car
   and circuit; the AI keeps the stock car.
10. **Weather.** Dry, damp or wet: less grip per surface, slippery kerbs, standing water in
    the dips (aquaplaning), the AI driving to the conditions, rain, spray and a wet road on
    screen, bests per condition.
11. **Tyre wear, fuel and pit stops.** Tyres wearing with the work they do (and a cliff),
    fuel burning so the car lightens, a pit lane on every circuit with a limiter and boxes,
    automatic tyre changes, the AI choosing when to stop; a wear option for races.
12. **A track editor.** Draw a circuit from above (points with elevation, banking and width),
    checked live against the built-in circuits' rules, kerbs, gravel, a pit lane and scenery
    placed for you; saved in the browser, driven and raced, shared as a link, online.
13. **Touch controls.** Phones and tablets: thumb or tilt steering through the assist,
    analogue pedals, buttons, landscape and full screen, a small-screen layout, Low graphics.
14. **Career mode.** A ladder of three series (Wren, Kestrel, Harrier; easy, medium, hard
    rivals; longer races with weather and wear), promotion for the top three, prize money
    and upgrades for your cars.
15. **Front- and all-wheel drive.** The drivetrain's layout in a car's data (a centre
    differential with a torque split for AWD), two new cars (a FWD hot hatch and an AWD
    coupe), traction control, the gearbox and the AI's envelope following the layout.
16. **Race replays.** Every car recorded through the whole race with its moments (passes,
    stops, spins, finishes), played back as television: a director following the battles
    across the TV cameras and onboards, or driven by hand, with a timeline to jump between
    moments.
17. **Night racing.** Day, dusk and night (and dusk running into night over a race): the sky
    and light, floodlight towers on every circuit with their light baked into the track,
    headlights, tail and brake lights; rounds drawn under lights in championships.
18. **Rally stages.** Open, point-to-point roads; gravel as a road surface with its own tyre
    behaviour; two invented stages; runs against the clock with splits, pace notes and the
    AI's stage times; dust; a Rally mode.
