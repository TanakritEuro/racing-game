# Milestone 18 plan: rally stages

## Status: done

Closed without playtest answers; the questions (driving on gravel, the pace notes and the
voice, Hightor's tarmac and gravel, the rivals' times, the forest and dust) stay open.

Approved as written: rally stages, pace notes spoken by the browser's voice (off by default),
stages in the editor later.

Measured (headless): on gravel the Kestrel corners at 0.75 g on the skidpad (0.98 on asphalt),
its fronts gripping best at a larger slip angle (0.16 against 0.12 rad), stops from 100 km/h
in 56 m (39 m), and corners at 0.51 g on wet gravel. The AI drives both stages to the finish
in the Kestrel and the Osprey with nothing put back, its time among the hard rivals' (Kettle
Wood in the Kestrel ~150 s against rivals of 146–152 s). Every circuit builds, validates and
drives exactly as before. Pace notes for both stages: Kettle Wood fast (severity 4–6, two
crests called), Hightor Pass with its hairpins.

Checked in the browser: Rally in the start menu with the two stages; Kettle Wood in the
Osprey (the countdown, the gravel road through the forest, dust, the notes coming up, the
clock, splits, and at the flying finish 2:18.4, P1 against medium rivals); Hightor Pass in the
Finch (tarmac hairpins up, gravel over the top, the notes and splits). No console errors.

Where the build differs from the plan below:

- **No jump starts:** through the countdown the car is held on its brakes (you can rev it),
  as on a race grid. Held, a keyboard driver pressing W would otherwise always jump the start.
- **Hightor Pass is 4.7 km**, not ~6: three hairpins up (tarmac) and the plateau and
  descent on gravel.
- **Gravel tyre behaviour** is one number on the surface (`slip`): the tyre's curve is
  stretched along slip, so it grips best further into a slide and falls away more slowly;
  ABS and traction control aim for the stretched peak.
- **A stage has no track limits:** off the road is only slower; put back on it (R), the run
  takes a 10 s penalty rather than being voided.
- **The woods:** a `forest` option for scenery lines a stage with trees close behind its
  banks (the circuits' trees stay scattered).
- **One commit for the simulation side** (open roads, gravel, the stages, runs, notes and
  rivals) rather than three: they were built and tested together.

Every road today is a closed circuit of asphalt. This milestone adds rally: point-to-point
stages on loose surfaces, run one car at a time against the clock, with a co-driver reading
pace notes. Gravel changes how the car is driven: less grip, but grip that keeps building
with slip angle, so the car is steered as much with the throttle and a slide as with the
wheel. The physics model already has the pieces (slip angles, combined slip, surfaces); what
it needs is a loose surface with its own tyre behaviour, and roads that don't join up.

## Scope decisions

- **Open roads:** a `TrackDef` can be a stage (`closed: false`): the spline runs from a start
  to a finish, with no wrap-around. Everything that walks the samples (nearest sample,
  offsets, the strips and barriers, terrain, cameras, the racing line) learns where the road
  ends. Stages have no pit lane, laps, grid or race mode.
- **Two invented stages:**

  | Stage | Length | Character |
  | --- | --- | --- |
  | **Kettle Wood** | ~5 km | fast forest gravel, crests and long sweepers between the trees |
  | **Hightor Pass** | ~6 km | a mountain road: tarmac hairpins up the pass, gravel over the top and down |

  Narrow (6–8 m), banks and ditches instead of run-off and barriers in the woods, a wall on
  the drop side of the pass. Checked by `validateTrack` (rules for stages: width, grade up
  to 15 %, no overlap).
- **Gravel as a road surface:** less grip than asphalt (about 70 %), a tyre curve that peaks
  later and falls away less (the stones roll under the tread), more rolling drag, and in the
  wet much less. Dust thrown up behind the car; skid marks become ruts.
- **Running a stage:** a countdown at the start line, a timed run to the flying finish,
  three splits along the way, and a best time and ghost kept per stage and car (and weather).
  Going off the road costs time but doesn't stop the run; R puts the car back with a 10 s
  penalty.
- **Pace notes:** worked out from the road (each corner's direction and severity 1–6 by
  radius, hairpins, "into" for corners in quick succession, crests, "don't cut", "long"),
  shown on screen a few seconds before each corner, and spoken by the browser's speech
  voice if you turn it on (off by default).
- **Rival times:** each stage shows times for the seven AI drivers, worked out from each
  one's skill and the car's speed profile along the stage (no AI cars on the road: a stage
  is run alone). Your place among them after your run.
- **Rally setup:** a gravel setup for the car (softer, higher, the diff looser) offered in
  the garage as a starting point. The AWD Osprey is the obvious car, but every car can run.
- **The start menu:** a Rally mode beside Time trial and Race, with the stages as cards.
  Custom stages in the track editor are left for later (question 3).

## Files

Simulation:

| File | Contents |
| --- | --- |
| `src/track/track.ts`, `geometry.ts`, `terrain.ts` | `closed: false`: the spline clamped at its ends, samples that don't wrap, strips that stop |
| `src/track/stages.ts` | Kettle Wood and Hightor Pass |
| `src/track/validate.ts` | The rules for a stage |
| `src/track/paceNotes.ts` | Corners into notes: direction, severity, hairpins, crests, links. Pure |
| `src/vehicle/tyre.ts`, `config.ts` | A surface's tyre behaviour (peak slip, fall-off), gravel as a road surface |
| `src/race/stage.ts` | `StageRun`: countdown, splits, finish, penalties, the recording for the ghost |
| `src/ai/stageTimes.ts` | The AI's stage times from the speed profile and skills |

Presentation: `render/trackView.ts` (a gravel road, banks, the trees close in), `render/effects/`
(dust), `ui/paceNotesHud.ts` (the notes, and speech), `ui/stageHud.ts` (countdown, splits,
finish, the rivals), `ui/menu.ts` (Rally), `main.ts`.

## Tests

| File | Asserts |
| --- | --- |
| `track.test.ts` | An open track: no wrap at the ends, nearest sample and offsets right at the start and finish, a stage's length |
| `stages.test.ts` | Both stages keep the stage rules; the start and finish are clear of each other |
| `surfaces.test.ts` | On gravel: less lateral g on the skidpad, the peak at a larger slip angle, braking longer; wet gravel less again |
| `paceNotes.test.ts` | A test road's hairpin, square right, fast left and crest called as such, in order, with links |
| `stage.test.ts` | A run: the countdown, a jump start, splits in order, the finish time, a put-back penalty, the best kept |
| `stageTimes.test.ts` | The rivals' times spread by skill; the autopilot drives each stage to the finish within the rivals' range |

## Commits, in order

1. Plan (this file).
2. Open roads: the track, geometry and terrain, the stage rules. Tests.
3. Gravel as a road surface; the two stages. Tests.
4. Running a stage, pace notes, the rivals' times. Tests.
5. On screen: Rally mode, the gravel road and dust, the notes and stage HUD. Checked in the browser.
6. Docs, then playtest questions.

## Risks

- **Closed-circuit assumptions.** Much code walks the samples modulo their count (lookups,
  sweeps, cameras, the racing line). Each place gets an open-road path and a test; the
  circuits must come out exactly as before.
- **Gravel's feel.** The tyre curve on gravel decides whether sliding is fun or vague.
  Numbers in `TUNING` for your playtest.

## Questions for you

1. Rally stages (as proposed), or something else?
2. Pace notes spoken by the browser's voice (off by default), or on screen only?
3. Stages in the track editor now, or later?
