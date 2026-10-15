# Milestone 2 plan: handling and controls

## Status: done

Closed without playtest answers; the questions (keyboard lock at speed, counter-steer
strength, gamepad steering at speed, camera placement) stay open, and tuning from them
lands whenever they come in.

Measured by the tests: 0.98 g on the skidpad with mild understeer (front 45 % of the
lateral load transfer), ~560 N downforce at 200 km/h, 0–100 km/h in 6.5 s with TC on
(6.9 s off, wheels spinning), 39 m from 100 km/h stamping the brake with ABS (no lock
above 3 m/s, and the car still steers), 0.028 ms per car per step.

Where the build differs from the plan below:

- **Bars:** 10 000 N/m front, 16 000 rear. Equal bars gave 0.96 g; moving roll stiffness
  rearward gained grip and kept the fronts reaching their limit first.
- **TC acts on the engine's drive torque, not the throttle,** so a cut never becomes
  engine braking (which, mid-slide, spun the car). It also needs a real slip speed
  (0.5 m/s) as well as the slip ratio: near a standstill a tiny difference is a big ratio.
- **Shifts sync on a slipping clutch.** After a gear change the clutch carries the
  engine's torque + 60 N·m until the revs match; snapping it in kicked the flywheel's
  energy into the wheels and spun them on the 1–2 shift. The flywheel is lighter
  (0.12 kg·m²) and engine braking stronger at high revs, closer to a real engine.
- **Gamepad steering is direct** (dead zone 0.08, curve 1.6), with no speed-sensitive
  lock, as planned; whether it needs some is a playtest question.
- The ABS test counts lock-ups above 3 m/s only (ABS stands down below 2 m/s so the car
  can stop); "steers under braking" is measured as sideways travel, since a car with all
  four wheels locked can rotate without changing course.
- Settings (aids, assist, gearbox, camera) are remembered in localStorage as planned; the
  ASSIST light joins ABS and TC on the dash.

Goal: the car handles like a tuned car and is good to drive on any input. Anti-roll
bars and downforce give the chassis a balance to tune; Ackermann steering, a handbrake,
and switchable ABS and traction control complete the car; keyboard steering gets
speed-sensitive lock and gentle counter-steer help; gamepads get analogue throttle,
brake and steering; and there are chase, bumper and hood cameras. Then rounds of
playtesting and tuning.

## Scope decisions

- **Driver aids are car systems, steering assistance is a driver.** ABS and TC live in
  the car (`vehicle/aids.ts`) and act on brake torque and throttle like real ones. The
  keyboard's steering assistance turns digital keys into a steering position
  (`drivers/steeringAssist.ts`). It reads the car's state but stays outside the car
  model, so the AI (M5) drives the same car through plain `Controls` with no extra grip.
  The assist is pure simulation code, run once per physics step, so a ghost that
  records `Controls` (M4) replays it exactly.
- **`Controls.steer` becomes a steering position** (−1..1 of full lock), and the car's
  steering rack has a maximum rate (`steering.rate`, rad/s of wheel angle). The
  keyboard's smoothing and speed-sensitive lock move into the assist; a gamepad's stick
  drives the rack directly (with a dead zone and a response curve).
- **Defaults: ABS on, TC on, steering assistance on, automatic gearbox, chase camera.**
  Each is toggled by a key and remembered in `localStorage` (presentation only: the
  simulation gets them as settings, like the gearbox mode).
- **Handling target: mild understeer at the limit,** with lift-off and power oversteer
  available to a driver who asks for them. The anti-roll bars are the tool. The
  skidpad test pins it.
- **TC also governs launches.** With TC on, the automatic clutch feeds in at full
  throttle instead of dumping (a throttle cut can't stop the flywheel's energy), so a
  keyboard launch no longer spins the rears.
- **Render interpolation comes in now.** The bumper and hood cameras make 120 Hz steps
  visible on 144 Hz displays, so the car (body, wheels, steer, suspension) is drawn
  between the last two physics states.
- **No stability control, no torque vectoring.** Shape-cast wheels, kerbs and track
  limits stay in M3.

## Files

Simulation:

| File | Contents |
| --- | --- |
| `src/vehicle/carDef.ts` | `suspension` per axle (`front`, `rear`), each with `antiRoll` (N/m); `aero.lift` per axle (C_L·A, negative = downforce); `steering: { lock, rate, ackermann }`; `brakes.handbrakeTorque`; `aids` (ABS and TC targets and rates); `cameras` (bumper and hood mounts) |
| `src/vehicle/car.ts` | Anti-roll forces, downforce at each axle, per-wheel steer angle (Ackermann), steering rack rate, handbrake on the rear wheels, ABS factor per wheel on brake torque |
| `src/vehicle/aids.ts` | ABS (per-wheel slip controller on brake torque) and TC (slip controller on the throttle, launch feed-in). Pure functions with their state in plain objects |
| `src/vehicle/drivetrain.ts` | TC throttle factor; the automatic clutch lets go when the handbrake is pulled; no launch dump with TC on |
| `src/drivers/steeringAssist.ts` | Keyboard → steering position: attack and return rates, speed-sensitive lock from the car's grip, counter-steer help |
| `src/sim.ts` | `setAids({ abs, tc })`, `snapshot()` of the previous state for interpolation |

Presentation:

| File | Contents |
| --- | --- |
| `src/input/keyboard.ts`, `src/input/gamepad.ts`, `src/input/index.ts` | `input.ts` splits; gamepad ported from five-a-side (`PadState` for tests); keyboard and gamepad merged, whichever moved last wins the steering |
| `src/render/cameras.ts` | Camera rig: chase (the current one), bumper and hood, C to cycle; per-mode field of view |
| `src/render/carView.ts` | Per-wheel steer angles; draws the interpolated pose |
| `src/main.ts`, `index.html` | Interpolation, aid toggles, HUD lights for ABS and TC (lit when on, bright while working), handbrake |

## Key data structures

```ts
interface Controls {
  throttle: number; brake: number; steer: number;   // steer: steering position, −1..1 of full lock
  clutch: number; shift: -1 | 0 | 1;
  handbrake: number;                                  // 0–1
}

interface AxleSuspension extends SuspensionDef { antiRoll: number }   // N/m of left–right travel difference
interface CarDef {
  …
  suspension: { front: AxleSuspension; rear: AxleSuspension };
  aero: { dragArea: number; lift: { front: number; rear: number } };   // C_L·A (m²) at each axle
  steering: { lock: number; rate: number; ackermann: number };         // rad, rad/s, 0 parallel – 1 full
  brakes: { maxTorque: number; frontBias: number; handbrakeTorque: number };
  aids: {
    abs: { slip: number; release: number; apply: number };  // target slip (× peak), rates per second
    tc: { slip: number; cut: number; restore: number };
  };
  cameras: { bumper: Vec3; hood: Vec3 };
}

interface SteeringAssistSettings { enabled: boolean }   // tuning in TUNING.keyboardSteering
```

`Wheel` gains `steer` (its own angle, for Ackermann and the view) and `absFactor`; the
car gains `aids: { abs, tc, absActive, tcActive }` for the HUD and telemetry.

**Anti-roll bar:** per axle, force `k·(compression_left − compression_right)` pushes
the more compressed side up and the other down, so roll stiffness (and the share of
lateral load transfer) can differ front to rear without changing ride.
**Downforce:** `½ρv²·C_L·A` at each axle's mount line, along the car's down axis.
**Ackermann:** each front wheel's angle from the turn centre on the rear axle line,
blended with parallel steer by `ackermann`.
**ABS:** while a wheel's relaxed slip ratio is past `abs.slip × peak`, its brake
factor falls at `release` per second, otherwise recovers at `apply`. **TC** does the
same on a throttle factor from the driven wheels' slip. Both run each substep, so they
cycle at tens of hertz the way real systems do, and show in the telemetry.
**Keyboard lock:** full keys give the wheel angle the front tyres can use at this speed
(geometric angle for the car's grip plus its peak slip angle, times a margin), not a
fixed fall-off. **Counter-steer help:** when the car's body slip angle grows, the
steering target moves against it by `counterSteer × β`, so lifting off the keys lets a
slide straighten; held keys still win.

## Tests

| File | Asserts |
| --- | --- |
| `car.test.ts` | Static loads unchanged by the bars; downforce at 200 km/h adds the expected load at each axle (±2 %); skidpad still 0.85–1.0 g, front lateral load-transfer share in the target range, understeer at the limit |
| `steering.test.ts` | Ackermann: inner wheel steers more, and with `ackermann: 1` both axes meet on the rear axle line; the rack never exceeds its rate |
| `aids.test.ts` | ABS: stamped brake from 100 km/h locks no wheel for more than 0.1 s, stops within 2 m of the best unlocked stop, and the car can change heading while braking. TC: full-throttle launch keeps rear slip under 1.3 × peak (over 2 × with TC off), 0–100 no more than 0.3 s slower |
| `handbrake.test.ts` | At 60 km/h the handbrake locks the rears, not the fronts; with steering it rotates the car (yaw rate over a threshold); it lets the automatic clutch go |
| `assist.test.ts` | Keyboard lock falls with speed and matches the usable angle; counter-steer opposes body slip; after a provoked slide, neutral keys with assist recover the car (yaw rate back near zero within 2 s) and without assist take longer |
| `gamepad.test.ts` | Dead zone, response curve, triggers to pedals, buttons to shift / handbrake edges, merge with the keyboard |
| `determinism.test.ts` | Still bit-identical, now with the aids and the assist in the loop |

## Commits, in order

1. Plan (this file).
2. Render interpolation and the camera rig (chase, bumper, hood; C cycles).
3. Per-axle suspension, anti-roll bars and downforce; balance retune; tests.
4. Steering: rack rate, Ackermann, per-wheel steer in the view; the keyboard assist
   (speed-sensitive lock, counter-steer); tests.
5. Handbrake, ABS and TC with toggles, HUD lights and telemetry; tests.
6. Gamepad input and the keyboard/gamepad merge; tests.
7. Tuning pass; CLAUDE.md, README and this file's status. Then playtest rounds: I'll
   ask specific questions, tune from your answers, and repeat until you're happy.

Each commit passes `npm run build` and `npm test`, is pushed and deploys. I check the
game in the browser after 2, 4, 5 and 6.

## Risks

- **ABS and TC chatter.** Bang-bang slip control at 960 Hz can buzz; if it does, the
  controllers become proportional on the slip error.
- **Assist fighting the driver.** Counter-steer help that's too strong feels like the
  car steering itself. It's off while the player steers into the slide and capped
  well below full lock; the strength is in `TUNING` for playtesting.
- **Interpolating the wheels.** Spin angles wrap; they're interpolated as deltas.

## Questions for you

1. Keys: Space for the handbrake, Z for ABS, X for TC, C for the camera, and V for the
   keyboard steering assist. Gamepad: left stick steers, RT/LT throttle and brake, A
   handbrake, RB/LB shift up/down, Y camera, View/Back resets the car. All right?
2. Aids default on (ABS, TC, steering assist) with keys to turn them off. Or off by
   default, for the purer feel?
3. Handling target: mild understeer at the limit, with oversteer when provoked. Or do
   you want it closer to neutral?
