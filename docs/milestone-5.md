# Milestone 5 plan: AI drivers

## Status: built, in playtesting

Approved as proposed: up to 7 opponents, 3 laps, you mid-grid; three difficulties with a
seeded spread and no rubber-banding; full contact, no penalties, every car held on its brakes
until the lights go out; mode and options by URL and Tab.

Measured: a hard AI's flying laps are about 1:46 at Harrowmere, 1:34 at Saltmarsh, 1:45 at
Ridgeback and 0:53 at the Proving Ground, within ~4 % of what its speed profile predicts.
Easy is 5–10 % slower. An eight-car race costs ~1 ms per physics step in the production
build (2–3 ms in the dev server), so ~2 ms of each 60 fps frame. A racing line takes
80–200 ms to compute when a circuit loads.

Where the build differs from the plan below:

- **Steering is Stanley-style, not pure pursuit.** Pure pursuit either weaved (short
  look-ahead) or cut every corner by a metre or two (long look-ahead). The driver now steers
  at the front axle: the angle the line's curvature needs, plus heading and cross-track
  corrections, less any yaw rate beyond the line's (which damps a slide early). It never uses
  more lock than the front tyres can use at that speed (the keyboard assist's `usableLock`),
  except when catching a slide.
- **The envelope is calibrated against the car.** Lateral and braking grip at 0.9 of the
  tyres' peak at the static load (the measured skidpad and ABS stops); the engine and wheels'
  rotating inertia (worth ~200 kg in first gear); 0.88 of the ideal acceleration for
  gearshifts; only the rear tyres' share of the grip to put power down; and braking that
  tapers off the harder the car is cornering. This car oversteers if it brakes hard at high
  cornering load, which had the first AI spinning on corner entry.
- **Sliding:** off the brakes, a steady gentle throttle, full lock allowed. Lifting made the
  rear-drive car spin.
- **Off the line, the corners tighten.** When traffic or a mistake puts the car off its line,
  it slows for the tighter (inside) path, looking far enough ahead to brake for it.
- **Traffic additions:** a car overlapping one slightly ahead concedes and drops in behind
  (two cars side by side into a hairpin otherwise squeezed each other into the gravel); a car
  stays a car's width away for 5 m after passing rather than cutting straight back across; a
  stopped or crashed car beside the road is driven round, never followed; traffic never
  sends a car off the road.
- **Stuck:** slower than 1.5 m/s for 5 s, or more than 3 m off the road for 8 s (a gravel
  trap, a wide run-off), and it is put back on the track; that lap is invalid.
- **On the grid** your car is held on the brakes and the handbrake, so you can rev without
  creeping. The AI doesn't drive until the lights go out.
- **Gaps** are timed at checkpoints every 20 m. The results table is provisional until
  everyone has finished; a car still running 90 s after the winner is classified where it is.
- **Race laps aren't time-trial bests** (they aren't saved, and the ghost is hidden in races).
  P replays your last race lap, without the other cars.
- **Debug options:** `?line` draws the racing line coloured by target speed; `?autopilot`
  hands your car to the AI (in either mode).
- Tests added beyond the plan: `skill.test.ts` (spread, determinism, mistakes);
  `traffic.test.ts` also runs a lap with eight cars.

Goal: race against up to seven AI cars. Each circuit gets a computed racing line and a
speed profile from the car's own grip, power and braking. The AI drives the same `KESTREL`
through the same `Controls` as you, with no extra grip. It makes mistakes depending on
difficulty, races in traffic (following, side by side, overtaking), and starts from a
standing grid. Time trial stays as it is; race mode is new.

## Scope decisions

- **Several cars in one simulation.** `Simulation` holds a list of cars, each with its own
  lap timer and before/after poses; the player is car 0, and `sim.car` / `sim.timer` stay
  as shorthands for it, so time trial and the tests don't change. `step()` takes one
  `Controls` per car. Cars collide with each other (their chassis boxes already do);
  wheels still only see the ground.
- **The AI lives in the simulation** (`src/ai/`, pure, seeded, covered by the purity test).
  An AI driver sees what a driver could see: its own car's state and where the other cars
  are on the track. It never touches the physics. Its output is a `Controls` like a
  gamepad's: analogue steering straight to the rack, throttle, brake, automatic gearbox,
  ABS and TC on.
- **Racing line: minimum curvature.** A lateral offset per track sample inside the usable
  road (road plus half a kerb, less half the car's width and a margin), found by iterative
  smoothing with the offset clamped to those bounds. That converges to the
  minimum-curvature line and takes well under a second per circuit. It's computed when a
  circuit loads, never stored. It is 2D, but the speed profile below accounts for
  elevation and banking.
- **Speed profile from the car's limits.** A performance envelope from `CarDef`: peak tyre
  grip at the static load (with load sensitivity), downforce and drag against speed, and
  the force at the wheels in the best gear from the torque curve. The maximum speed at
  each sample comes from the line's curvature, raised by banking and lowered over crests
  (vertical curvature changes the load). A forward pass limits acceleration by power and
  the grip left over; a backward pass limits braking. Both passes use a friction circle,
  so the AI trails off the brakes into a corner instead of braking and turning at once.
- **Following the line.** Steering is pure pursuit to a point ahead on the line (look-ahead
  grows with speed), plus a feed-forward term from the line's curvature. Speed is a PI
  controller on the profile's speed a little ahead, split into throttle and brake. If the
  car slides (yaw rate well beyond what the steering asks for), it lifts and steers
  straight. An AI that is stuck for 5 s (spun into gravel, against a barrier) is put back
  on the track like your R key, and that lap is invalid.
- **Difficulty, no rubber-banding.** Three levels: easy, medium and hard. Each sets a range
  of driver skills, spread across the field from a seeded PRNG so the field isn't a
  train. A skill is how much of the grip the profile uses (about 85–98 %), how early the
  driver brakes, how accurately it holds the line, how often it makes a mistake (a missed
  braking point, running wide, a snap of oversteer it has to catch) and how willing it is
  to try a pass. The AI never gets faster or slower depending on where you are.
- **Traffic.** Every AI driver tracks the cars near it in track coordinates (distance along
  the track and lateral offset). With a slower car ahead, it either matches its speed or
  takes an overtaking offset to the side with room, preferably on a straight or into a
  braking zone, then rejoins the line once clear. It keeps a car's width of space from a
  car alongside rather than turning into it, and it doesn't defend or block. All of this
  shifts the target offset and caps the target speed; steering and speed control stay as
  above.
- **Race mode.** A staggered two-by-two grid 8 m apart behind the start line, with you in
  the middle of the field by default. Five red lights come on one per second and go out
  after a seeded 0.2–3 s pause; until then every car's brakes are held. Positions come
  from laps completed plus the distance round the current lap. The race is 3 laps by
  default; when the leader finishes, everyone finishes their current lap, then a results
  table shows positions, total times, gaps and best laps. Track limits invalidate a lap
  for the best-lap column only; there are no penalties.
- **Presentation kept minimal until M6.** AI cars are the placeholder car in different
  colours. Race HUD: position (P3 / 8), lap (2 / 3), gaps to the cars ahead and behind,
  start lights, and the results table. Every car shows on the minimap. Picking the mode by
  URL and key until the M6 menus: `?mode=race`, `?difficulty=easy|medium|hard`,
  `?opponents=0..7`, `?laps=N`. Tab switches between time trial and race. The ghost is
  hidden in races; P still replays your last lap.

## Files

Simulation:

| File | Contents |
| --- | --- |
| `src/sim.ts` | `cars`, `timers` and poses per car; `step(controls[])` (`step(controls)` still works for one car); grid slots; `recover(car)` |
| `src/ai/envelope.ts` | `CarEnvelope` from a `CarDef`: grip (g) at speed with downforce, drive force at speed, drag, braking limit |
| `src/ai/racingLine.ts` | `RacingLine`: minimum-curvature offset per sample, the line's points, horizontal and vertical curvature, distance along it |
| `src/ai/speedProfile.ts` | Maximum speed per sample on a line for an envelope and a grip fraction, with forward (power) and backward (braking) passes on a friction circle |
| `src/ai/driver.ts` | `AiDriver`: pure-pursuit steering with feed-forward, PI speed control, slide catch, stuck recovery, mistakes; `drive(view) → Controls` |
| `src/ai/traffic.ts` | Track coordinates of every car each step; gaps, cars alongside, choosing an overtaking side and a speed cap |
| `src/ai/skill.ts` | `Skill`, difficulty presets, seeded spread across a field |
| `src/race/race.ts` | `Race`: grid, start lights, AI drivers, laps, positions, finish, results |

Presentation:

| File | Contents |
| --- | --- |
| `src/render/carView.ts` | Colour per car (already a parameter); a view per car |
| `src/render/minimap.ts` | A dot per car, yours highlighted |
| `src/ui/raceHud.ts` | Position, lap, gaps, start lights, results table |
| `src/render/lineView.ts` | `?line` debug overlay: the racing line on the road, coloured by target speed |
| `src/main.ts`, `index.html` | Mode, difficulty, opponents and laps from the URL; Tab; wiring |

## Key data structures

```ts
interface RacingLine {
  offset: Float32Array;     // per sample: metres left of the centreline (negative = right)
  x: Float32Array; y: Float32Array; z: Float32Array;  // the line's points
  curvature: Float32Array;  // horizontal, 1/m, signed (positive = turning left)
  vertical: Float32Array;   // 1/m, negative over a crest
  distance: Float32Array;   // along the line from the start line (m)
}

interface Skill {
  pace: number;        // fraction of the envelope's grip the speed profile uses (0.85–0.98)
  braking: number;     // extra margin before braking points (m)
  precision: number;   // how far it strays from the line (m, standard deviation)
  mistakes: number;    // chance of a mistake per corner
  aggression: number;  // 0–1: how small a gap it will go for
}

interface Standing {
  car: number;         // index into sim.cars
  position: number;
  laps: number;
  progress: number;    // laps + fraction of the current lap
  gapToLeader: number; // s
  bestLap: number | null;
  finished: boolean;
  totalTime: number | null;
}
```

## Tests

| File | Asserts |
| --- | --- |
| `multicar.test.ts` | Nine cars on the grid: static loads, nobody overlaps; two cars driven into each other: no NaNs or explosions; one step with nine cars is within a budget (loose, as it runs on CI) |
| `racingLine.test.ts` | On every circuit the line stays within the usable road; its total squared curvature is well below the centreline's; on the long oval it hugs the inside at the apex and runs out wide at entry and exit |
| `speedProfile.test.ts` | Corner speeds match the envelope (skidpad radius → ~0.98 g measured in M2); never accelerates or brakes harder than the envelope; braking zones end at the apex speed |
| `ai.test.ts` (soak) | On every circuit a hard AI laps 3 times cleanly (every lap valid, no recoveries, no barrier contact) within a target time range per circuit; easy is slower than hard; the same seed gives the same laps |
| `traffic.test.ts` | A faster AI behind a slower one on the Proving Ground passes it within 3 laps with no contact; two equal cars side by side through a corner keep a car's width apart |
| `race.test.ts` | Cars are held until the lights go out; positions follow progress; the race finishes after N laps with every car classified; 8 AI cars complete a 2-lap race on the Proving Ground with no car stuck |

Target lap times are set from the first measurements. The test driver (cornering at only
0.6 g) does Harrowmere in 2:19, Saltmarsh in 2:05 and Ridgeback in 2:23, so a hard AI
should be well under those. The soak tests are the slowest in the suite (several seconds
per circuit).

## Commits, in order

1. Plan (this file).
2. Several cars in the simulation: per-car timers and poses, `step(controls[])`, grid
   slots, car-to-car contact. A circuit check that the grid stands on a straight. Tests.
3. Car envelope, racing line and speed profile; the `?line` overlay. Tests.
4. The AI driver following the line on every circuit; soak tests and target times.
5. Skill, difficulty and mistakes. Tests.
6. Traffic: following, overtaking and side by side. Tests.
7. Race mode: grid, start lights, positions, finish and results; race HUD, minimap dots,
   AI colours; URL options and Tab. Tests.
8. Performance check with eight AI cars in the browser, tuning, docs. Then playtest
   questions.

Each commit passes `npm run build` and `npm test`, is pushed and deploys, and I check it in
the browser.

## Risks

- **The profile promising more grip than the car has** (load sensitivity, combined slip and
  weight transfer aren't in the envelope). The grip fraction in `Skill` covers part of it,
  and the soak tests calibrate a global factor so the hard AI sits just under the limit
  and stays on the road.
- **Turn 1 pile-ups.** Eight cars braking for the first corner. On lap 1 the AI brakes a
  little earlier and won't go for small gaps.
- **Performance.** Nine cars × 12 rays × 8 substeps at 120 Hz. M3 measured ~2 ms per step
  for nine cars, so about 4 ms of each 60 fps frame. The AI itself is cheap (one look-up
  and a few comparisons per car). Checked in the browser in commit 8.
- **Crests and the carousel on Ridgeback.** The vertical curvature and banking terms in the
  profile are what keep the AI from going light over the crest or underusing the banking.
  The soak test covers both.

## Questions for you

1. Race format: up to 7 AI opponents, 3 laps by default, you starting mid-grid. Would you
   rather start from the back, or from a random slot?
2. Three difficulty levels, a seeded spread of skills within each, and no rubber-banding.
   All right?
3. Full car-to-car contact and no penalties (track limits only cost the best-lap column).
   Should jump starts matter? I'd hold every car's brakes until the lights go out.
4. Mode and options by URL plus Tab (`?mode=race&difficulty=hard&opponents=7&laps=5`)
   until the M6 menus. All right?
