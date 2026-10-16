# Milestone 9 plan: car setup (the garage)

## Status: built, in playtesting

Approved as written: car setup next, saved per car and circuit, the eleven settings, no
presets, one best lap per circuit and car whatever the setup.

Measured (Kestrel, headless): shorter gearing (+5) reaches 100 km/h sooner and tops out at
219 km/h on the limiter against 237 as designed; full wing against none presses the car down
several hundred newtons harder at 180 km/h and costs 10 km/h at the top; the stiffest rear
bar against the softest moves the skidpad's lateral load transfer rearward by more than 5
points; brake bias 10 points rearward locks the rears first with ABS off; the lowest, softest
car rides Ridgeback's crests without going through its bump stops.

Where the build differs from the plan below:

- **Gearing is 5 % a click**, not 3 %: at 3 % even the shortest gearing never reached the
  limiter, so it didn't lower the top speed. Longer gearing doesn't raise the top speed of
  a car that drag already limits (the Kestrel's); it only blunts the acceleration.
- **A wing click is 15 % of the car's own downforce**, so the Wren, a roadster with almost
  none, gains little from its wings. No setup turns downforce into lift.
- **The top-speed readout is "on a long straight"**: about 4 % above what the car reaches
  round the long oval's bends, within 1 % when the limiter decides it.
- **The wing test measures wheel load at 180 km/h**, not lateral g on a fast skidpad: the test
  skidpad is too slow for aero to show above the noise.
- **Where the garage opens:** the start menu (not for a championship, which visits every
  circuit, or for joining online, before the circuit is known) and the pause menu (not
  online, nor once a championship round has counted). From the pause menu a changed setup
  reloads the game at the grid with it; an offline race starts afresh (a new grid draw).
- **Fixed in passing:** a vehicle braking test now has a longer timeout; it timed out when
  the setup tests' long drives ran beside it.

The roadmap ended at Milestone 8, so this one is a proposal (other candidates are in
question 1). The game is built around real car physics, and every number about a car is
already data in its `CarDef`. A setup screen lets you change those numbers yourself and feel
the difference: springs, anti-roll bars, dampers, ride height, wings, brake bias, the
differential and the gearing. It is what makes a sim's handling something you can tune
towards your own driving, and the vehicle model already responds to every one of them.

## Scope decisions

- **A setup is a set of clicks, not raw numbers.** Each setting runs from −5 to +5 clicks
  around the car's own value (0 is the car as designed), each click a fixed step: for
  example ±6 % spring rate, ±10 % anti-roll bar, 1 % brake bias. Nobody has to know what
  26 000 N/m means, and a setup can't make the car undrivable or explode the physics.
- **`applySetup(def, setup)` returns a new `CarDef`** (pure). Nothing else in the vehicle
  model changes: the car is built from the adjusted data, as from any car's.
- **The settings** (eleven):

  | Setting | Changes | What you should feel |
  | --- | --- | --- |
  | Front / rear springs | spring rate per axle, dampers scaled with it | stiffer: sharper, less forgiving over kerbs and bumps |
  | Front / rear anti-roll bar | roll stiffness per axle | stiffer at one end: that end lets go first (front → understeer, rear → oversteer) |
  | Dampers | bump and rebound together | firmer: quicker response, more nervous over bumps |
  | Ride height | spring rest length (both axles) | lower: less roll, but bottoms out on crests and kerbs |
  | Front / rear wing | downforce at each axle, and drag with it | more: more grip in fast corners, lower top speed |
  | Brake bias | front share of the brake torque | rearward: the car rotates on the brakes, and can spin |
  | Differential | locking (preload and ramp) | more: better traction out of slow corners, more understeer on entry |
  | Gearing | final drive | shorter: quicker acceleration, lower top speed |

- **Your setup is yours alone.** The AI drives the car as designed (its racing line and
  speed profile come from the stock car), so the simulation learns to hold a different
  `CarDef` per car. Online, your setup stays in your browser; the other player sees your
  car's shape, which a setup doesn't change.
- **Saved per car and circuit** in localStorage, like a real team's setup sheet, with
  Reset to the car's default.
- **The garage shows numbers as you click:** the front's share of the roll stiffness
  (the balance), downforce at 200 km/h, top speed on gearing, and the brake bias. They're
  computed from the adjusted `CarDef` (pure), so you see what a click did before driving.
- **Opened from the start menu** (Setup, beside the car cards) **and the pause menu.** A
  changed setup takes effect from the grid: the game reloads, as the menus already do.
  Not mid-race online or in a championship round already running.
- **Best laps stay one per circuit and car**, whatever the setup: a better setup is part of
  a better lap. The setup a best was set with is stored beside it, so the garage can offer
  "load the setup of your best lap".

## Files

Simulation:

| File | Contents |
| --- | --- |
| `src/vehicle/setup.ts` | `Setup` (clicks per setting), `SETTINGS` (each setting's label, range and what it changes), `applySetup(def, setup)`, `cleanSetup(raw)` (anything unknown or out of range dropped), `setupReadout(def)` (balance, downforce, top speed on gearing) |
| `src/config.ts` | `TUNING.setup`: each click's size |
| `src/sim.ts` | `SimOptions.defs`: a `CarDef` per car (default: all the same) |
| `src/race/race.ts`, `race/championship.ts` | The player's car from their setup, the AI's as designed |

Presentation:

| File | Contents |
| --- | --- |
| `src/storage/setups.ts` | Setups per car and circuit in localStorage (memory if refused) |
| `src/storage/bests.ts` | The setup a best lap was set with, kept beside it |
| `src/ui/garage.ts` | The setup screen: a row per setting (−, clicks, +, what it does), the readout, Reset, Load the best lap's setup, Done |
| `src/ui/menu.ts`, `src/main.ts` | Setup buttons in the start and pause menus; the setup applied when the car is built; `?setup=default` ignores it |

## Key data structures

```ts
type SettingId = 'springsFront' | 'springsRear' | 'antiRollFront' | 'antiRollRear' | 'dampers'
  | 'rideHeight' | 'wingFront' | 'wingRear' | 'brakeBias' | 'diff' | 'gearing';

/** Clicks from the car's own value, −5..5; missing means 0. */
type Setup = Partial<Record<SettingId, number>>;

interface SettingDef {
  id: SettingId;
  label: string;
  /** What more of it does, in a few words ("more understeer", "lower top speed"). */
  more: string;
  apply(def: CarDef, clicks: number): void;   // on a copy
}

interface SetupReadout {
  frontRollShare: number;   // 0..1
  downforce200: number;     // N at 200 km/h
  topSpeed: number;         // m/s, where power meets drag in top gear, or the limiter
  brakeBias: number;        // front share
}
```

## Tests

| File | Asserts |
| --- | --- |
| `setup.test.ts` | The default setup gives back the car unchanged; clicks are clamped, unknown settings dropped; each setting moves its numbers the right way and nothing else |
| `setup.test.ts` (driving) | Measured, headless: shorter gearing reaches 100 km/h sooner and tops out lower; more wing gives more lateral g on a fast skidpad and a lower top speed; a stiffer rear bar moves the lateral load transfer rearward (the skidpad's front share falls); brake bias far rearward with ABS off locks the rears first; the lowest ride height still clears the Ridgeback crests without the chassis touching |
| `multicar.test.ts` | A race with the player's car set up differently: the AI's cars are the stock car |
| `setups.test.ts` | Storage round trip; a stored setup from an older version is cleaned, not trusted |

## Commits, in order

1. Plan (this file).
2. The setup model: `applySetup`, the readout, a `CarDef` per car in the simulation and
   races. Tests.
3. Setups stored per car and circuit; the garage screen from the start and pause menus;
   the setup a best lap was set with. Checked in the browser.
4. Docs, then playtest questions.

## Risks

- **Extreme combinations.** Every setting is clamped and the driving tests run the corners
  of the range, but a few combinations will be bad to drive. That's the point; Reset is
  one click away.
- **The ghost of a best lap set with another setup** may be faster or slower than you can
  manage now. It's still your lap; the garage can load the setup it was set with.

## Questions for you

1. Car setup next, or something else? Other candidates: **weather** (a wet track with less
   grip, rain and spray), **tyre wear, fuel and pit stops** (strategy in longer races and
   the championship), **a track editor** (draw your own circuit), or **touch controls**
   for phones and tablets.
2. Setups saved per car and circuit (as proposed), or one per car for every circuit?
3. The eleven settings: too many, too few, or right? And should there be presets (for
   example Stable / Balanced / Loose) as starting points?
4. One best lap per circuit and car whatever the setup (as proposed)?
