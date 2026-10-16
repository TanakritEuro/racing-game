# Milestone 10 plan: weather

## Status: done

Closed without playtest answers; the questions (how the wet feels, the kerbs, standing water
at speed and where it lies, the AI in the wet, the rain's look and frame rate) stay open.

Approved as written: weather next, conditions fixed per session, the same tyres in every
weather, championship weather drawn per round.

Measured (Kestrel, headless): on the skidpad 0.71 g wet against 0.89 g dry in the same 60 s
run (80 %); stopping from 100 km/h with ABS takes 1.47 times the dry distance; in standing
water the tyre has 25 % of the wet road's grip at 180 km/h and 83 % at 54 km/h. The AI laps
every circuit in the wet without getting stuck, 11–14 % slower than in the dry: Harrowmere
117.9 s, Saltmarsh 104.8 s, Ridgeback 120.6 s, Proving Ground 59.4 s. Checked in the browser:
the rain, the overcast sky, the darker road, spray behind the car through Harrowmere's first
puddle, the damp sky without rain, the Weather row and a wet start from the menu.

Where the build differs from the plan below:

- **Water also stands on long flat roads.** Dips alone gave puddles only at Harrowmere (two):
  Saltmarsh and the Proving Ground are flat, and Ridgeback's one deep dip is on the start
  straight. A flat road drains badly, so long flat stretches get a seeded puddle every
  800 m or so. Now Harrowmere and Saltmarsh have three each, the Proving Ground one, and
  Ridgeback none (it drains: it's never flat for long).
- **A dip's depth is measured over 150 m** either side (over 50 m none were deep enough).
- **Aquaplaning** starts at 72 km/h and is full by 162 km/h, leaving 30 % of the grip; the
  AI goes through standing water at 137 km/h at most.
- **Damp has no rain falling and no puddles**: a road drying after rain. Skid marks are
  only left on a dry road; wet tyres hardly smoke and they throw up spray instead.
- **The puddles sit 4 mm above the road**, not 1 mm, so the tread rays find them first.
- **The HUD shows the weather beside the circuit's name**, and the garage's "best lap's
  setup" is the best in the weather picked.
- **Not measured:** the frame cost of rain and spray. The in-app browser was drawing only a
  few frames a second, so there was nothing to compare. The rain is one draw call of 10 000
  vertices, and spray uses the pooled smoke shader; watch the frame rate in your playtest.

The roadmap's planned milestones are done, so this one is a proposal (other candidates are
in question 1). Rain is the biggest change you can make to how a car feels without touching
the car: the same tyres on a wet road have about three quarters of the grip, painted kerbs
turn to ice, and water standing in the dips can float a car off the road at speed. It works
through the tyre model's surface grip, which every wheel already reads, so the car, the AI
and the races all respond to it without special cases.

## Scope decisions

- **Three conditions: dry, damp and wet**, fixed for a session (time trial, race,
  championship round, online race). A condition is one number, *wetness* (0, 0.5, 1), and
  every effect is interpolated by it.
- **Grip per surface when fully wet**, as a share of its dry grip (multiplying the tyre's μ,
  as surfaces already do): asphalt 72 %, kerbs 50 % (painted and slippery), grass 75 %,
  gravel 90 %. Damp is half way. All in `TUNING.weather`.
- **Standing water in the dips.** When wet, each circuit gets puddles where the road is
  lowest (local minima of the elevation, seeded and placed like the kerbs, part of the
  road's width). They are thin colliders a millimetre above the road, tagged `water`, so the
  three tread rays find them like any surface. In water the tyre's grip falls with speed
  (aquaplaning: about a third of its grip above 160 km/h) and there's extra drag. Damp
  conditions have none.
- **The AI drives to the conditions:** its car envelope takes the wet grip, so its racing
  line's speed profile is slower where it should be, and it lifts for standing water. Its
  difficulty and mistakes are unchanged (no extra slips: the physics provides them).
- **What you see and hear:** rain falling round the camera (a few thousand streaks in a
  shader, moving with the camera), an overcast sky with closer fog, the road darker and
  glossier, puddles drawn as dark reflective patches, spray thrown up behind every car
  (from the smoke system, by speed), no skid marks on a wet road, and the hiss of rain and
  the swish of tyres through water instead of squeal.
- **Bests per condition:** a wet lap isn't comparable with a dry one, so the best lap, the
  ghost and the delta are kept per circuit, car *and* condition. Your setup stays per car and
  circuit (one setup for all weathers).
- **Choosing it:** a Weather row in the start menu (Dry, Damp, Wet) for time trial and race;
  `?weather=dry|damp|wet`. A championship draws each round's weather from its seed (one in
  four rounds wet, one in four damp). Online, the host chooses and the guest is told
  (`PROTOCOL` 3).

## Files

Simulation:

| File | Contents |
| --- | --- |
| `src/track/weather.ts` | `Conditions` (`'dry' | 'damp' | 'wet'`), `wetness(conditions)`, `surfaceGrip(tag, wetness, speed)` including aquaplaning. Pure |
| `src/track/puddles.ts` | Where water stands: the road's local low points, how far across, seeded; the strips to sweep into colliders and meshes |
| `src/physics.ts` | The `water` surface tag; puddle colliders when wet |
| `src/vehicle/car.ts` | Surface grip from the conditions (the car is told the wetness), not just the tag |
| `src/sim.ts` | `SimOptions.conditions` |
| `src/ai/envelope.ts`, `ai/speedProfile.ts`, `ai/driver.ts` | The envelope and speed profile for the conditions; the racing line stays the same, cached per car and conditions |
| `src/race/race.ts`, `race/championship.ts` | Conditions in `RaceOptions`; a season draws them per round |

Presentation:

| File | Contents |
| --- | --- |
| `src/render/weatherView.ts` | Rain, sky and fog, the road's wet look |
| `src/render/trackView.ts` | Puddles drawn |
| `src/render/effects/spray.ts` | Spray behind wheels on a wet road |
| `src/audio/` | Rain hiss and tyre swish in the wet |
| `src/storage/bests.ts` | Bests keyed by condition too (dry bests keep their old key) |
| `src/ui/menu.ts`, `main.ts`, `online/` | The Weather row, `?weather`, the host's choice sent to the guest |

## Key data structures

```ts
type Conditions = 'dry' | 'damp' | 'wet';

interface WeatherTuning {
  wetness: Record<Conditions, number>;           // 0, 0.5, 1
  wetGrip: Record<'asphalt' | 'kerb' | 'grass' | 'gravel', number>;
  water: { grip: number; drag: number;           // in a puddle, slow
           aquaplane: { from: number; to: number; grip: number } };  // m/s, and the grip left
  puddles: { minDepth: number; width: [number, number]; length: [number, number] };
}

interface Puddle { sample: number; length: number; from: number; to: number }  // along and across (m)
```

## Tests

| File | Asserts |
| --- | --- |
| `weather.test.ts` | Dry is the old grip exactly (every existing test unchanged); wet asphalt 72 %, kerbs 50 %; aquaplaning only in water and only at speed |
| `weather.test.ts` (driving) | Wet skidpad: lateral g about 0.72 of the dry (0.65–0.8 g); braking from 100 km/h with ABS takes about 1.35× the dry distance; a car through a puddle at 180 km/h loses most of its grip there, at 60 km/h hardly any; standing on a wet slope still doesn't creep |
| `puddles.test.ts` | Puddles only at low points, on the road, never on the start straight, the same for the same layout |
| `ai.test.ts` (soak) | The AI laps every circuit in the wet without getting stuck, 10–25 % slower than in the dry |
| `bests.test.ts` | Wet and dry bests kept apart; old dry records still found |
| `protocol.test.ts` | The welcome carries the conditions |

## Commits, in order

1. Plan (this file).
2. Conditions in the simulation: wet grip per surface, puddles and aquaplaning. Tests.
3. The AI in the wet: the envelope and speed profile for the conditions. Soak tests.
4. Weather on screen and in the speakers: rain, sky, wet road, puddles, spray, sounds.
   Checked in the browser.
5. Choosing it: the menu row and `?weather`, bests per condition, championship weather,
   online. Checked in the browser.
6. Docs, then playtest questions.

## Risks

- **Rain costs frames.** A few thousand streaks in one points draw call and spray from the
  pooled smoke should stay well inside the budget with eight cars; measured before and
  after.
- **Puddles placed by elevation** may land somewhere silly on a circuit (a dip mid-corner
  that ruins it). The placement test checks the obvious, and a circuit can list spots to
  avoid if your playtest finds one.

## Questions for you

1. Weather next, or something else? The other candidates: **tyre wear, fuel and pit stops**
   (strategy in longer races; it needs a pit lane built into every circuit), **a track
   editor** (draw your own circuit), or **touch controls** for phones and tablets.
2. Fixed conditions per session (as proposed), or rain that can start and stop during a
   race, with a drying line (a good deal more work)?
3. A choice of tyres (dry or wet, the wrong ones costing grip), or the same tyres in every
   weather (as proposed)?
4. Championship weather drawn per round (as proposed: one round in four wet, one damp), or
   always dry?
