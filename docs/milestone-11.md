# Milestone 11 plan: tyre wear, fuel and pit stops

## Status: built, in playtesting

Approved as written: fuel burns without refuelling, stops are free choice, the championship
keeps its lengths with normal wear.

Measured (Kestrel, headless): the busiest tyre dissipates ~650 kJ a lap of Harrowmere, so a
9.7 MJ tyre life reaches the cliff in ~12 laps at the normal rate and 3–5 at high; a car on
95 %-worn tyres laps over 2 % slower; a slide wears tyres more than 20 times faster per metre
than rolling. Fuel: ~0.21 kg/km (about 1 kg a lap of Harrowmere). The pit limiter holds the
car under 61 km/h; a stop changes the tyres in 4 s; crossing the limit line too fast costs
5 s. A 10-lap race on Saltmarsh at high wear: every car stops once, nobody is put back on the
track, everyone finishes; a stop costs ~33 s there, spread over the lap in and the lap out.
Checked in the browser: the lane, wall, boxes and building; the tyre and fuel panel in a
race; the Tyre wear row and a race started from it.

Where the build differs from the plan below:

- **Every pit lane runs along the start straight**, in just before the line and out before the
  first corner, crossing the line in the lane: each circuit's last corner ends too close to the
  line for an entry earlier (Harrowmere's 50 m before it).
- **Bests are kept.** The run-off on the pit side was widened (Saltmarsh, Ridgeback and the
  Proving Ground), but the road didn't move, so the layouts' fingerprints are unchanged.
- **Less fuel than guessed:** ~10 kg over a 10-lap race, not 40, so the car lightens by a
  tenth or two a lap at most. A race starts with (laps + 1) × 0.25 kg per km. The test checks
  the burn and the mass following it, not the lap time.
- **The AI drives to its tyres' remaining grip** (its speeds scaled by √grip): without it, AI
  cars on worn tyres spun off where they used to be fine.
- **The strategy picks the best lap to stop on** (stopping now, on a later lap or not at all,
  whichever is quickest) rather than stopping as soon as a stop would pay, and stops with
  1.6 laps' wear in hand before the cliff. Stopping as soon as it paid sent cars in on lap 1.
- **The AI slows to the limit by the lane's entry**, not the limit line: swerving into the
  taper at speed on worn tyres spun cars into the barrier.
- **Stuck in the lane:** waiting counts at a third of the usual rate (it may be queueing). A
  car put back on the track forgets its stop, and one not in the lane by the end of the entry
  gives up this visit.
- **A stop costs ~33 s at Saltmarsh**, not 18–28: its lane is 390 m at 60 km/h. The strategy's
  estimate is calibrated to it.
- **The soak test runs four cars**, not a full field, to keep it under a minute.
- **The limiter works in every mode** (it's part of the circuit); time trial has no wear or
  fuel, so there's never a reason to stop there.

Races so far are sprints: every lap is driven on the same fresh tyres and the same fuel load,
so the only question is pace. This milestone makes a longer race a matter of strategy too.
Tyres wear with the work they do (sliding wears them fastest) and lose grip as they go;
fuel burns with the power used, so the car gets lighter and quicker through a race; and
each circuit gets a pit lane where you can stop for fresh tyres. When to stop, and how hard
to push the tyres in the meantime, become your choices, and the AI makes them too.

## Scope decisions

- **Tyre wear from the tyre's work.** Each tyre's wear grows with the energy it dissipates
  (its force times its sliding speed), so wheelspin, lock-ups and slides wear it far faster
  than smooth driving. Grip falls gently as it wears, then sharply past about 80 % (the
  cliff). It multiplies the tyre's μ, like the surface and the weather already do.
- **Wear rate is a race option:** off, normal or high. Calibrated on the Kestrel driving the
  AI's line: normal, a set lasts about 12 laps of Harrowmere; high, about 4. Time trial has
  no wear (every lap on fresh tyres, so laps stay comparable).
- **Fuel burns, and isn't added.** The car starts with the fuel the race needs plus a
  margin; it burns with the engine's power output, and the car's mass (and its centre of
  mass) follows. About 40 kg over a 10-lap race: the car ends a few tenths a lap quicker.
  No refuelling, so a stop is only for tyres (as in modern racing); no running dry either.
- **A pit lane on every circuit** (`TrackDef.pitLane`): entry before the start line, exit
  after it, on the side of the pit building. It's a strip of road beside the main road,
  joined to it by tapered entry and exit roads, with a pit wall (a barrier) between them
  along the boxes. One box per car in front of the building. Colliders and meshes come
  from the same strips, as the rest of the circuit's do.
- **The pit lane is speed-limited** (60 km/h): a limiter cuts the throttle in the lane, and
  crossing the line over the limit is a 5 s penalty. **A stop is automatic:** stop in your
  box and the crew changes all four tyres (about 4 s, the car on its brakes), then lets you
  go. The time a stop costs comes from the lane, the limiter and the service, as it should.
- **The AI chooses when to stop:** from its tyres' wear and the laps left, it stops when
  the lap time it is losing to wear would pay for a stop (and always before the cliff). It
  drives the lane like any other line: the pit line, the limiter, braking into its box.
  Traffic knows a car in the lane isn't racing.
- **On screen:** a tyre panel (each tyre's wear as a colour, green to red), a fuel gauge,
  the limiter light in the lane, a "BOX" call when the stop you'd want has come, and stops
  in the race table and results. The crew is a placeholder: the tyres simply change.
- **Online:** each side runs its own pit stops (its car is its own); the host's AI stop too.
  The wear option goes in the welcome (`PROTOCOL` 4). **Championship:** normal wear, and
  its rounds stay the length they are (so stops only matter if you destroy your tyres).

## Files

Simulation:

| File | Contents |
| --- | --- |
| `src/vehicle/wear.ts` | Tyre wear from dissipated energy, grip from wear (with the cliff). Pure |
| `src/vehicle/car.ts` | Each wheel's wear and its grip; fuel burned and the body's mass and centre of mass following; service (fresh tyres) |
| `src/vehicle/carDef.ts`, `cars.ts` | Fuel: tank, burn per kWh, where the tank sits; tyre wear rate |
| `src/track/track.ts`, `geometry.ts` | `TrackDef.pitLane` (entry, exit, side, width); the lane, its joins, the pit wall and boxes as strips |
| `src/track/circuits.ts` | A pit lane on each circuit; the pit building behind it |
| `src/physics.ts` | The pit lane's colliders and wall |
| `src/race/pits.ts` | Where a car is (in the lane, in a box), the limiter, penalties, stops and service. Pure |
| `src/race/race.ts` | Wear option, fuel for the race, pit stops counted, penalties added |
| `src/ai/pitStrategy.ts` | When to stop: the time lost to wear against a stop's cost |
| `src/ai/driver.ts`, `ai/traffic.ts` | Driving the pit line and stopping in the box; cars in the lane left alone |

Presentation:

| File | Contents |
| --- | --- |
| `src/render/trackView.ts`, `render/scenery.ts` | The pit lane, wall, boxes and the building behind them |
| `src/ui/tyresHud.ts` | Tyre wear, fuel, the limiter light, BOX |
| `src/ui/raceHud.ts` | Stops and penalties in the table and results |
| `src/ui/menu.ts`, `main.ts`, `online/` | Tyre wear (off, normal, high) for a race; `?wear=`; the host's choice online |

## Key data structures

```ts
interface PitLaneDef {
  side: Side;
  /** Where the entry road leaves the track (m before the line) and the exit road joins it (m after). */
  entry: number;
  exit: number;
  /** The lane's distance from the road edge (m) and its width (m). */
  offset: number;
  width: number;
}

interface WheelWear { wear: number /* 0 new … 1 gone */ }

interface PitState {
  inLane: boolean;
  box: number;                 // this car's box
  servicing: number | null;    // seconds of service left
  stops: number;
  penalty: number;             // seconds added at the flag
}
```

## Tests

| File | Asserts |
| --- | --- |
| `wear.test.ts` | Wear grows with dissipated energy (a slide wears far more than the same distance driven smoothly); grip falls gently then over the cliff; no wear when off |
| `wear.test.ts` (driving) | Laps of Harrowmere on the AI's line: a normal set lasts 10–14 laps before the cliff, a high one 3–5; a worn car is slower |
| `fuel.test.ts` | Fuel burns with power (more at full throttle), mass and lap time fall with it, never below empty |
| `circuits.test.ts` | Each pit lane joins the track at both ends, doesn't cross the track, fits its boxes, and its wall doesn't block the racing road |
| `pits.test.ts` | Driving the lane: the limiter holds 60 km/h, a stop in the box changes the tyres in ~4 s, a car over the limit gets 5 s; a stop costs 18–28 s depending on the circuit |
| `race.test.ts` (soak) | A 10-lap race with high wear: every AI car stops at least once, nobody gets stuck in the lane, everyone finishes |

## Commits, in order

1. Plan (this file).
2. Tyre wear and fuel in the vehicle model. Tests.
3. Pit lanes on every circuit: geometry, colliders, the wall, boxes, the building behind.
   Tests; checked in the browser.
4. Pit stops: the limiter, stopping in the box, service and penalties; the tyre and fuel
   panel. Tests; checked in the browser.
5. The AI's pit strategy and pit driving; stops in the race table. Soak tests.
6. The wear option in the menus, online and the championship.
7. Docs, then playtest questions.

## Risks

- **Fitting a pit lane into existing layouts.** The start straights were made for a grid,
  not a lane beside them, and the run-off on the pits side is 8–15 m wide. The lane (5 m)
  and wall fit in 10 m; where a circuit's run-off is narrower there, it gets wider (a small
  layout change: those circuits' bests are dropped, as their fingerprint changes).
- **AI in the pit lane**: entering, braking into its box and leaving are new manoeuvres,
  and a pile-up in the lane is the classic failure. The soak test runs a full field
  through it.
- **Calibrating wear.** Lap counts depend on driving style; the AI's line sets the numbers
  and your playtest will say whether they feel right.

## Questions for you

1. Tyre wear, fuel and pit stops next, or something else (a track editor, touch controls)?
2. Fuel: burns and makes the car lighter, no refuelling (as proposed), or refuelling at
   stops too (stops get longer and fuel strategy appears), or no fuel at all?
3. A compulsory stop in races with wear on (so strategy always matters), or free choice
   (as proposed)?
4. Championship: normal wear and its current race lengths (as proposed), or longer rounds
   so stops come into play?
