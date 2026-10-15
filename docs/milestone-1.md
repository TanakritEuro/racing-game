# Milestone 1 plan: tyres and drivetrain

## Status: done

Measured by the tests: 0–100 km/h in 6.6 s, 240 km/h after 65 s on the long oval,
0.92 g on the 40 m skidpad with the fronts at their limit first, 43 m from 100 km/h at
the best pedal without locking (squeezed on over 0.3 s), 0.026 ms per car per step.

Where the build differs from the plan below:

- **Targets, deliberately:** lateral grip is 0.92 g, not "about 1 g": that is what a
  road car on μ 1.1 tyres pulls once load transfer is counted, and the car understeers
  at the limit (anti-roll bars in M2 are the balance tool). 0–100 is 6.6 s, not 6. The
  braking test squeezes the pedal on over 0.3 s and allows 45 m: a pedal step locks the
  fronts before the weight has come forward, which is right without ABS.
- **Brake bias is 62 % front**, the front axle's share of the load at ~1 g. 70 % left
  the rears idle; the fronts still lock first.
- **Load sensitivity is a power law,** μ = mu·(Fz/F0)^(−k): never negative, so it
  needs no clamp.
- **The drivetrain is one small solver,** not a viscous clutch. Clutch, differential and
  brakes on the driven wheels are torque-limited velocity constraints solved together
  each substep, so a locked clutch is rigid and a slipping one passes its capacity.
- **The automatic clutch** holds the engine near a throttle-dependent bite point at part
  throttle, and dumps at full throttle so launches spin the rears. The throttle is
  progressive (`throttleMap`: 75 % torque at half pedal); with a linear pedal the car
  barely pulled away at part throttle.
- **The automatic** upshifts at a point that rises with the throttle, and holds the gear
  when you lift, for engine braking into corners.
- **Automatic reverse needs a second press:** braking to a stop and holding the pedal
  keeps the car stopped (it would otherwise reverse down a slope); release and press
  again to reverse. Both modes start in first.
- **Keyboard steering lock** at speed is halved by 12 m/s rather than 22: at 100 km/h
  full lock is now ~10°, about what the car needs at the limit instead of 15°.
- **The ground is sized to the track** (it was a fixed 4 km square that the long test
  oval ran off).
- Extra tests: a lap of the test circuit, part-throttle launches without wheelspin,
  manual gearbox refusals, idling in neutral.

Goal: replace the placeholder car with the real model. Every wheel spins on its own,
slip builds up through relaxation lengths, Pacejka curves with load sensitivity and
combined slip make the forces, and an engine, clutch, gearbox and differential drive the
rear wheels. A `?telemetry` overlay shows what each tyre is doing. Numeric tests pin
the car's performance. The game stays drivable after every commit.

## Scope decisions

- **Traction control and ABS stay in M2**, where the roadmap puts them. M1 tests that a
  full-throttle launch spins the rear wheels and that a full-pedal stop locks the
  fronts. The "no wheelspin with TC on" half of the launch test comes with TC in M2.
- **Clutch is automatic for the keyboard.** `Controls` gains a `clutch` axis now, so
  gamepads (M2) and ghosts (M4) need no interface change, but the keyboard sends 0
  and an auto-clutch handles launches, shifts and stopping without stalling. The
  engine cannot stall in M1.
- **Gearbox:** automatic by default. **M** toggles manual, **E / Q** shift up / down.
  In automatic, holding brake at a standstill selects reverse as it does now. In
  manual, shift down through N to R when stopped.
- **One differential model** covers all three types: a locking torque between the two
  driven wheels capped at 0 (open), unlimited (locked) or preload + ramp × input
  torque (limited-slip). The default car has an LSD.
- **Suspension gets bump and rebound damping and a bump stop** now, because launches
  and lock-ups move the load around much more than the placeholder did. Anti-roll bars,
  Ackermann, downforce and the shape-cast stay in M2 / M3.
- **Slopes for the hill test come from tilting gravity**, not a sloped track: a flat
  road under gravity tilted by θ is the same problem as a road tilted by θ, and the
  track stays flat until M3.
- **Interpolated rendering stays out**; it's independent of the car model.

## Files

Simulation (no `three`, DOM or audio):

| File | Contents |
| --- | --- |
| `src/vehicle/carDef.ts` | `CarDef` type: every number about one car. `TUNING.car`, `.suspension`, `.engine`, `.brakes`, `.tyres` move here |
| `src/vehicle/cars.ts` | The invented default car `KESTREL` (a light rear-drive coupé), the only `CarDef` for now |
| `src/vehicle/tyre.ts` | Magic Formula, load sensitivity, combined slip. Pure functions on numbers, writing into a caller-owned result object |
| `src/vehicle/engine.ts` | Torque curve lookup, throttle/engine-braking blend, rev limiter, idle control |
| `src/vehicle/gearbox.ts` | Gear state, ratios, shift timing, auto-shift logic, auto-clutch |
| `src/vehicle/differential.ts` | Locking torque for open / locked / LSD |
| `src/vehicle/drivetrain.ts` | Couples engine → clutch → gearbox → differential → driven wheels; integrated inside the wheel substeps |
| `src/vehicle/car.ts` | Rewritten. Chassis body, suspension, per-wheel spin and slip states, substep loop, force application |
| `src/config.ts` | `TUNING` keeps what isn't the car: surfaces, keyboard steering, camera, `sim.wheelSubsteps`, low-speed damping |
| `src/sim.ts` | Takes a `CarDef`; `setGearboxMode()` command alongside `recover()` |

Presentation:

| File | Contents |
| --- | --- |
| `src/render/telemetry.ts` | `?telemetry` overlay (T also toggles): per-wheel load, κ, α, Fx, Fy, ω, surface, a friction-circle dot per wheel; RPM, gear, speed, pedals; 10 s scrolling graphs of speed, RPM, κ and α per wheel |
| `src/input.ts` | Shift keys (edge-triggered into one step's `shift`), M and T toggles |
| `src/main.ts`, `index.html` | HUD shows the real gear (R, N, 1–6) and a simple RPM bar. The proper rev counter is M6 |

## Key data structures

```ts
interface Controls {
  throttle: number;  // 0–1
  brake: number;     // 0–1
  steer: number;     // -1..1
  clutch: number;    // 0 = pedal up (engaged) .. 1 = pressed; combined with the auto-clutch
  shift: -1 | 0 | 1; // a shift request this step only
}

interface TyreDef {
  radius: number; inertia: number;              // m, kg·m² (wheel + tyre + brake disc)
  long: { B: number; C: number; E: number };    // Magic Formula shape, slip ratio
  lat:  { B: number; C: number; E: number };    // Magic Formula shape, slip angle (rad)
  mu: number;              // peak friction at nominalLoad
  nominalLoad: number;     // N
  loadSensitivity: number; // fraction of μ lost per nominalLoad of extra load
  relaxLong: number; relaxLat: number;          // relaxation lengths (m)
  rollingResistance: number;
}

interface CarDef {
  name: string;
  mass: number; halfExtents: Vec3; comHeightOffset: number;
  wheelbaseHalf: number; trackHalf: number; mountHeight: number;
  suspension: { restLength; stiffness; bump; rebound; bumpStop: { travel; stiffness } };
  tyres: { front: TyreDef; rear: TyreDef };
  engine: { torqueCurve: [rpm: number, nm: number][]; idleRpm; limiterRpm; inertia; friction: [rpm, nm][] };
  gearbox: { ratios: number[]; reverse; finalDrive; shiftTime; efficiency; upshiftRpm; downshiftRpm };
  clutch: { maxTorque: number; stiffness: number };
  differential: { type: 'open' | 'locked' | 'lsd'; preload: number; ramp: number };
  brakes: { maxTorque: number; frontBias: number };
  aero: { dragArea: number };
  drive: 'rwd';  // 'fwd' | 'awd' later are just different wiring in drivetrain.ts
}
```

`Wheel` keeps its current fields and gains `omega` (rad/s), `slipRatio` and
`slipAngle` (the relaxed values), `locked`, `driveTorque` and `brakeTorque`. The car
gains a read-only `drivetrain` state: `rpm`, `gear`, `mode`, `clutch` (engagement),
`shifting` (s left), `limiter`. Telemetry reads only these.

`KESTREL` targets: 1250 kg, 47 % front, 220 N·m at 5000 rpm, 150 kW at 7000, limiter
7500, six gears (3.30 2.10 1.55 1.20 1.00 0.82, final 4.10), 0.33 m wheels,
C_d·A 0.7. That gives about 6 s to 100 km/h, a 245 km/h top speed (drag-limited in
6th) and about 1 g of lateral grip.

## The model, per physics step (120 Hz)

1. **Suspension** (once per step, as now): raycast, spring, bump/rebound damping,
   bump stop → load `Fz`. Read each contact point's velocity → `v_long`, `v_lat`.
2. **Substeps** (`TUNING.sim.wheelSubsteps`, 8 → 960 Hz), chassis velocities frozen:
   - Engine torque from the curve × throttle, minus engine braking × (1 − throttle);
     the limiter cuts fuel above `limiterRpm`; idle control holds `idleRpm`.
   - Clutch: torque-limited viscous coupling, `T = clamp(k·Δω, ±maxTorque·engagement)`
     between the engine and the gearbox input (the diff's mean wheel speed × ratio).
   - Differential: splits the clutch torque × ratio equally, plus the locking torque
     moving drive from the faster wheel to the slower.
   - Brakes: a friction torque that can stop the wheel but never reverses it (if the
     brake could stop ω this substep, ω = 0 and the wheel is `locked`).
   - Slip with relaxation (Pacejka's first-order transient model):
     `σ dκ'/dt + |v_long| κ' = (ωr − v_long)`, and likewise for α' with `v_lat`.
     At standstill this integrates the slip *distance*, so the tyre acts like a stiff
     spring and holds the car with no creep. A low-speed damping term, fading out by
     `TUNING.sim.lowSpeedDampingFade` (≈ 3 m/s), stops that spring from ringing.
   - Tyre forces from κ' and α' (below); the longitudinal force feeds back into ω.
3. **Apply** the substep-averaged `Fx`, `Fy` at each contact point, plus aero drag.

Why substeps: a wheel's spin mode against its tyre's longitudinal stiffness rings at
about 35 Hz, which explicit integration at 120 Hz can't hold. The chassis modes are
much slower and stay at 120 Hz. Substepping is ~30 flops per wheel per substep.

**Tyre forces.** `F = D sin(C atan(Bx − E(Bx − atan Bx)))` with `D = μ(Fz)·Fz` and
`μ(Fz) = mu · (1 − loadSensitivity · (Fz − nominalLoad) / nominalLoad)` (clamped), so
grip per newton falls as load rises. **Combined slip** by normalised slip: divide κ'
and tan α' by their peak slips, take the length ρ of that vector, evaluate each curve
at ρ × its peak slip, and split the result by the vector's direction. Braking in a
corner then costs lateral grip, and the force direction stays smooth through the
whole slip range. Surface `grip` scales μ; surface `drag` adds rolling resistance.

## Tests

Headless, with numbers. Expected ranges are set for `KESTREL` and change deliberately.

| File | Asserts |
| --- | --- |
| `tyre.test.ts` | Zero slip → zero force; odd symmetry; pure-slip peaks at the expected slip and at `μ·Fz`; μ falls as load rises; at fixed α, Fy falls as κ grows; finite at zero load |
| `drivetrain.test.ts` | Torque curve interpolation; limiter holds RPM in neutral at full throttle; engine braking slows the car in gear; auto upshift at `upshiftRpm` and downshift on braking; a manual request shifts after `shiftTime`; open diff gives equal torque, locked equal speeds, LSD transfer ≤ preload + ramp × input |
| `car.test.ts` | Static loads sum to the weight (±1 %); 0–100 km/h in 5–7 s; top speed 230–255 km/h (long oval); 100–0 braking under 45 m; full pedal locks the fronts; launch: rear κ passes its peak in the first 0.5 s; skidpad (40 m radius, a test driver through `Controls`) holds 0.9–1.05 g; 10° slope with brake held moves under 1 cm in 10 s; idle in neutral at rest stays under 1 mm/s; reverse still works; barrier hits at 150 km/h stay finite and the car keeps its wheels down |
| `determinism.test.ts` | The same controls script gives a bit-identical car state after 30 s |
| `purity.test.ts` | Ported from five-a-side: no file in the simulation imports `three` or touches `window`, `document` or `Math.random` |

`helpers.ts` gains `createSim(trackDef?, carDef?)` and two test tracks: a 40 m radius
skidpad circle and a long oval (2 km straights) for top speed.

## Commits, in order

1. Plan (this file).
2. `CarDef` / `KESTREL` / `Controls.clutch` and `.shift`, `TUNING` split; test tracks,
   purity and determinism tests. Behaviour unchanged.
3. Telemetry overlay, on the placeholder, so every later step can be debugged with it.
4. `tyre.ts` and its tests (not wired in yet).
5. Wheel spin, relaxation, brake torque, substeps, Pacejka wired in; drive is still a
   simple torque at the rear wheels. Suspension damping split and bump stop. Load,
   slope, braking, lock-up and crash tests.
6. Engine, clutch, gearbox (auto and manual), differential; HUD gear and RPM, shift
   keys. Acceleration, top speed, launch, engine-braking and drivetrain tests.
7. Skidpad test and a tuning pass; update CLAUDE.md "Current state", README keys and
   this file's status with where the build differed.

Each commit passes `npm run build` and `npm test` and is pushed, which deploys it to
https://tanakriteuro.github.io/racing-game/. After 5, 6 and 7 I check the game in the
browser with telemetry on. At the end I'll ask you to playtest, with questions like:
can you hold a slide with the throttle? Does lifting mid-corner tighten the line? Is
the car too easy to lock up? Are the auto shifts at sensible points?

## Risks

- **Low-speed behaviour.** If the relaxation spring and its damping still jitter or
  creep at rest, the fallback is a "stopped" state per wheel below a few cm/s that
  pins κ' and α' until a force breaks it loose.
- **Clutch stiffness against substeps.** Engine inertia reflected through first gear
  is ~25 kg·m², so the coupling is stable, but in neutral or with the clutch pressed
  the engine alone is light. If it rings, the clutch becomes an implicit
  (closed-form) step instead.
- **Keyboard steering with a real limit.** Digital steering into a Pacejka curve that
  peaks at ~7° may feel twitchier than the placeholder. `halfLockSpeed` and the steer
  rates are retuned in commit 7; proper speed-sensitive assistance is M2.
- **Per-step cost.** The current per-wheel code allocates vectors. The rewrite keeps
  scratch vectors on the car so the substep loop allocates nothing; Rapier's ray and
  `velocityAtPoint` calls remain the only allocations per wheel per step.

## Questions for you

1. Is leaving traction control and ABS in M2 fine, with M1 only testing that wheelspin
   and lock-ups happen?
2. Do the `KESTREL` targets (1250 kg, 150 kW, rear drive, LSD, about 6 s to 100 km/h
   and 245 km/h) suit you as the reference car?
3. Keys: E / Q to shift, M for auto / manual, T for telemetry. Automatic by default?
