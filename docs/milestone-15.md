# Milestone 15 plan: front- and all-wheel drive

## Status: done

Closed without playtest answers; the questions (the Finch on and off the power, the Osprey's
launch and stability, the wet, the centre split, the placeholder models) stay open.

Approved as written: two new cars, the career unchanged.

Measured (headless):

| Car | 0–100 km/h | Top speed | 100–0 | Skidpad | AI lap, Proving Ground |
| --- | --- | --- | --- | --- | --- |
| Finch (FWD) | 6.7 s | 236 km/h | 40.2 m | 0.96 g | 51.0 s |
| Osprey (AWD) | 3.9 s | 272 km/h | 37.6 m | 1.01 g | 48.7 s |

With traction control off the Finch spins only its fronts, and the Osprey is the quickest of
the five to 100 km/h. In the wet it loses the least: 3.9 → 4.5 s. Circling the skidpad at
~0.75 g and going to full throttle, the Finch's front slip angle grows against the rear's
(power understeer), the Kestrel's shrinks (it turns in), and the Osprey sits between them.
The AI laps all four circuits cleanly in both cars. Flying laps: Finch 102.1 / 90.5 / 102.7 /
51.0 s, Osprey 95.9 / 85.9 / 97.5 / 48.7 s (Harrowmere, Saltmarsh, Ridgeback, Proving Ground).
The Kestrel, Wren and Harrier measure as before.
Checked in the browser: the start menu's five car cards with their layouts; the Osprey on
the Proving Ground pulling away with 954 / 1567 N·m on each front / rear wheel (its 38 : 62
split) and drive torque on all four in the telemetry; the Finch driving its fronts only; the
Osprey's garage with its drive split and the centre split row. No console errors.

Where the build differs from the plan below:

- **The Osprey's centre differential is gentle:** limited-slip with a 25 N·m preload and a
  0.2 ramp, not a strong lock. With a strong one, and the AI counting on all four wheels'
  grip for drive, the Osprey spun in the Proving Ground's fast corner every lap. Either
  alone was fine. The AI now counts an LSD centre's traction between an open and a locked
  one's (`tractionShare`). Less power than planned (~260 kW, 440 N·m): at 300 kW it reached
  100 km/h in 3.6 s.
- **The Finch has a rear spoiler** and a softer rear anti-roll bar than first written (12 000
  against 17 000 N/m). Lifting at 210 km/h in Harrowmere's long bend, its light rear stepped
  out and the AI spun it every lap. It still tightens its line when you lift; less violently.
- **The AI keeps a margin in fast corners** (`TUNING.ai.envelope.fast`: up to 5 % of the grip,
  from 160 to 235 km/h) and counts downforce by the axle with the least of it for its share of
  the weight, at 60 % (`aeroCredit`). The Osprey (and the Harrier) took Harrowmere's 400 m
  bend at ~235 km/h right on the limit; on its bumps the loads swing ±25 % and the front
  washed out. The Kestrel's lap times barely moved (Harrowmere 104.0 s).
- **Traction control and the automatic clutch:** pulling away, the clutch now carries only
  what traction control leaves of the engine's torque, and it doesn't latch fully in while
  TC is cutting. TC-on launches spin less (Wren 4.8 → 3.3 m/s, Harrier 4.9 → 4.0), but
  not zero: the Finch's light front still spins ~8 m/s for a moment. The test asks for less
  than half the TC-off wheelspin, not none.
- **The Harrier at Harrowmere: the AI steered from its nose, not its path.** In the 400 m
  bend at ~228 km/h the Harrier corners with its nose ~3° into the turn, and the Stanley
  steering's heading term counted that as an error: it settled ~1 m wide of its line, and
  where the line runs out towards the edge the loaded outside rear dropped onto the grass
  (sample ~823) and the rear let go. At speed the heading error is now measured less the body
  slip the car has been cornering with (averaged over 0.6 s, at most 0.04 rad, faded in from
  40 to 55 m/s: `TUNING.ai.driver.slipTime`, `slipMax`, `slipSpeed`), so it holds the line; in
  a slide the average is forgotten and the slip counts in full. Both limits matter: at 0.08 the
  Harrier, drifting ~6° on the power out of the Proving Ground's fast corner, lost the
  counter-steer it needed and washed its fronts past their peak; and in slow S-bends the
  average from one corner lingered into the next and the Kestrels weaved and spun in the race
  test. The throttle's on/off hunting (0 ↔ 0.45 at the profile speed, coasting between `accel`
  = 0 and drag) was real but not the cause: smoothing it didn't stop the spin, and it made the
  hard field at the Proving Ground spin more often in traffic, so it stays as it was. The
  Harrier now laps every circuit cleanly (Harrowmere 96.1 s, Saltmarsh 86.9, Ridgeback 98.0,
  Proving Ground 49.0) and is in the soak tests with the Finch and Osprey; seven hard-skill
  Harriers lap Harrowmere with no recoveries (before: eight, and ten invalid laps).
- **The high-wear soak's own car is put back on the track** like the AI's, inside the same
  allowance of two. It spun on worn tyres at Saltmarsh's last corner and sat against the
  wall, since nothing recovered it.
- **Models:** the Finch is the kit's `suv` without the spare wheel on its tailgate, painted
  on its pale body colour (the usual rule picked its green trim); the Osprey is `race-future`.

Every car today is rear-wheel drive: `car.ts` drives wheels 2 and 3 through one
differential, and the AI's envelope assumes the rear axle puts the power down. The three
cars differ in weight, power, tyres and downforce, but they all behave the same way at the
limit on the throttle. This milestone makes the drivetrain's layout part of a car's data and
adds two cars that drive differently: a front-wheel-drive hot hatch that understeers on the
power and steps its tail out when you lift, and an all-wheel-drive car that launches and
leaves slow corners harder than anything else, most of all in the wet.

## Scope decisions

- **A layout per car** (`CarDef.drivetrain`): `rwd`, `fwd` or `awd`. Front- and
  rear-wheel drive use the existing solver on a different axle. All-wheel drive adds a
  **centre differential** between the axles with a fixed torque split (front share) and its
  own locking (open, locked or limited-slip, the same `DifferentialDef`), solved in the same
  substep loop as the clutch, the axle differentials and the brakes.
- **Everything that reads "the driven wheels" follows the layout:** traction control (the
  slip of any driven wheel), the automatic gearbox and clutch (the driven wheels' mean
  speed), the telemetry's drive torque per wheel, the AI's envelope (the share of the
  weight on the driven wheels, with load transfer under power: forward for FWD, against it
  for RWD, all of it for AWD), and the handbrake (it still locks the rears; on an AWD car the
  centre differential lets it, as a rally car's does).
- **The three existing cars don't change.** Their layout is `rwd` and every one of their
  measured numbers (launch, top speed, skidpad, braking) must come out as it does today.
- **Two new cars** (invented, in `vehicle/cars.ts`), drawn with models from the Car Kit
  already downloaded (no new download):

  | Car | Layout | Mass, front share | Power, torque | Character | Model |
  | --- | --- | --- | --- | --- | --- |
  | **Finch** | FWD, a front limited-slip diff | 1150 kg, 61 % | ~170 kW, 320 N·m | Nimble, understeers on the power, tightens or steps out when you lift; ~7 s to 100, ~220 km/h | `suv` (a short, tall hatch), repainted |
  | **Osprey** | AWD, 38:62 front:rear, limited-slip centre and rear | 1420 kg, 53 % | ~300 kW, 500 N·m | Rockets off the line and out of hairpins, heavy and stable; ~4.5 s to 100, ~255 km/h | `race-future` (low and wide), repainted |

- **Where they appear:** the time trial, quick races, the championship and online (the car
  menu has five cards, each with its layout: RWD, FWD, AWD). Bests, setups and ghosts are
  kept per car already. The AI can drive them in a quick race when you pick them (the field
  drives your car, as now). **The career is unchanged** (question 3).
- **Setup:** the existing differential setting tunes the driven axle's diff (on the Osprey,
  the rear one); a twelfth setting, **centre split** (front share ±2 % a click), shows only
  for an AWD car.
- **Online:** a guest on an older build doesn't know the new cars, so `PROTOCOL` goes to 6.

## Files

Simulation:

| File | Contents |
| --- | --- |
| `src/vehicle/carDef.ts` | `DrivetrainLayout` and `CarDef.drivetrain: { layout, centre?: { split, diff } }` |
| `src/vehicle/drivetrain.ts` | The substep solver for two or four driven wheels: the clutch onto the centre diff's carrier (or one axle's), the centre diff (split and locking), the axle diffs, the brakes |
| `src/vehicle/car.ts` | Driven wheels by layout; traction control, the gearbox's wheel speed and drive torque per wheel from them |
| `src/vehicle/cars.ts` | `FINCH`, `OSPREY`; `KESTREL`, `WREN`, `HARRIER` as `rwd` |
| `src/vehicle/setup.ts` | Centre split for AWD cars; the differential click on the driven axle |
| `src/ai/envelope.ts` | Traction by layout |
| `src/online/protocol.ts` | `PROTOCOL` 6 |

Presentation:

| File | Contents |
| --- | --- |
| `scripts/prepare-cars.mjs`, `render/carModels.ts`, `ASSETS.md` | The two models copied, fitted and painted; recorded |
| `src/ui/menu.ts`, `ui/garage.ts` | Five car cards with their layout; the centre split row |
| `src/render/telemetry.ts` | Drive torque on all four wheels; the centre split |

## Key data structures

```ts
type DrivetrainLayout = 'rwd' | 'fwd' | 'awd';

interface CarDef {
  // ...
  drivetrain: {
    layout: DrivetrainLayout;
    /** All-wheel drive: the front axle's share of the drive torque, and the centre diff's locking. */
    centre?: { split: number; diff: DifferentialDef };
  };
  /** The driven axle's differential (both axles' on AWD: front open unless given). */
  differential: DifferentialDef;
  frontDifferential?: DifferentialDef;
}
```

The centre differential is a planetary one: its carrier turns at `split·ω_front +
(1 − split)·ω_rear` (axle mean speeds), the clutch couples the engine to the carrier, and
the locking torque resists the axles turning at different speeds, with the drive split
`split : 1 − split` until it saturates.

## Tests

| File | Asserts |
| --- | --- |
| `drivetrain.test.ts` | Unit: an AWD solver with free wheels shares torque by the split; locked, the axles turn together; open, a wheel in the air spins and the others get nothing (the reason for LSDs); energy is not created. A FWD solver equals the RWD one on the other axle |
| `vehicle.test.ts` | Kestrel, Wren and Harrier measure as before (launch, top speed, skidpad, braking). Each new car: static loads sum to its weight, 0–100 and top speed in their ranges, braking, no NaNs into a barrier, holds on a slope |
| `layout.test.ts` | With TC off: the Finch spins its fronts on a launch, the Osprey launches with the least wheelspin and the quickest 0–100 of all five; with TC on, no wheelspin on any car. On the skidpad at the limit, adding throttle widens the Finch's line (power understeer) and tightens the Kestrel's; in the wet the Osprey leaves a hairpin fastest |
| `ai.test.ts` | The AI laps every circuit cleanly in the Finch and the Osprey within a target time range; its envelope's traction is higher for AWD than RWD than FWD on the same weights |
| `setup.test.ts` | Centre split applies only to an AWD car and moves its torque split |
| `online.test.ts` | A race over the loopback with the Osprey against the Finch |

## Commits, in order

1. Plan (this file).
2. The layout in `CarDef` and the generalised drivetrain solver; the existing cars as `rwd`,
   every vehicle test unchanged. Unit tests.
3. The Finch and the Osprey: data, tuning to their targets, layout tests, AI soak laps.
4. The models, the menu's car cards, the garage's centre split, telemetry, `PROTOCOL` 6.
   Checked in the browser.
5. Docs, then playtest questions.

## Risks

- **The AWD solver's stiffness.** A locked centre diff with two axle diffs is four wheels
  and an engine coupled by stiff constraints; the solver iterates as now, and if eight
  iterations don't converge the count goes up for AWD cars only (`TUNING.drivetrain`).
  Performance is checked with eight Ospreys on the grid.
- **FWD and the steering assist.** Drive through the steered wheels lowers the front's
  lateral grip under power; the keyboard assist's counter-steer help is built for a rear
  that slides. It may need a layout-aware tweak after your playtest.
- **The models.** `suv` and `race-future` are the closest the kit has to a hot hatch and a
  low AWD coupe; they're placeholders for character, as the others are.

## Questions for you

1. Front- and all-wheel drive (as proposed), or one of the other ideas instead: **night
   racing** (headlights, floodlit circuits, dusk races), **dirt and rally stages** (loose
   surfaces, point-to-point stages against the clock), or **whole-race replays** (the
   recording and TV cameras for a full race, every car)?
2. Two new cars (as proposed), or just the layouts, with a setting to turn an existing car
   into FWD or AWD?
3. Keep the career as it is (as proposed), or give it a fourth series in the new cars (say,
   a mixed-layout invitational)?
