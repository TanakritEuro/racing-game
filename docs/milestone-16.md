# Milestone 16 plan: race replays

## Status: done

Closed without playtest answers; the questions (the director's choices, passes on the timeline,
the onboard and chase shots, the tower, watching mid-race) stay open. Online race replays are
being added in a session of their own.

Approved as written: the race just run kept in memory, whole-race replays (no highlights reel).

Measured (headless): a recording keeps each car within a frame of where the simulation had it
(under 5 cm); its standings match the race's own at every check and at the flag, gaps within
0.1 s. A car-minute costs ~180 KB (doubling buffers: at most twice that). In a real race the
watcher records passes as they hold (a slow car on pole is passed by the field, each pass on
the car it was made on), stops, spins, contacts, fastest laps and every finish in result order.

Checked in the browser: a 1-lap race at the Proving Ground with three AI cars, run to the flag
by the autopilot; P played the whole race. The standings tower changed with the playhead; the
timeline showed the moments; the director followed a battle from a TV camera. E jumped to just
before the winner's finish (a chase shot); clicking a car in the tower followed it ("your
choice"), and C switched it to a chase camera. Esc, then the pause menu's Watch replay, started
it again. No console errors. The onboard camera wasn't caught on screen: the in-app browser
draws too slowly to time a screenshot.

Where the build differs from the plan below:

- **Online races have no replay yet.** An online race (`OnlineRace`) keeps the other
  player's cars as proxies under their own numbering, outside the `Race` that records;
  recording them is a piece of its own. Left for later.
- **Picking a car:** click it in the tower, or ↑/↓ for the car ahead or behind (keys 1–4
  stay the playback speed); C cycles TV, chase and onboard for it; D hands back to the
  director. Skips are 5 s (the lap replay keeps 2 s).
- **In a race, P plays the race so far** (Shift+P still the best lap). The results' keys line
  says so; the championship standings have a *Watch the race* button, and come back after.
- **Gaps against the time before the recording began** (the grid) are extrapolated from the
  leader's first frames, so the start doesn't read as an eight-car battle.

Today a replay is one lap of one car: the time trial records your laps and plays the last
or best back from the trackside TV cameras. A race leaves nothing behind. When the flag
falls, the overtake you made three laps ago, the stop that won it and the rival who spun
at the hairpin are gone. This milestone records every car through the whole race and
plays it back as television: a director that follows the battles, cuts between the TV
cameras and onboards, and a timeline of the race's moments to jump between.

## Scope decisions

- **Every car, the whole race:** from the lights to the last car home, each car's pose and
  readouts at 30 Hz (the lap recordings' frame format, so ghosts, replays and the TV
  cameras keep working the same way). Eight cars for a 10-minute race is ~14 MB in memory,
  kept for the race just run (question 2).
- **The race's moments, recorded as they happen:** the start, every change of position (an
  overtake, and who on whom), pit stops, spins and cars put back on the track, contacts
  hard enough to throw sparks, fastest laps, the last lap and each car's finish.
- **Watch it:** *Watch replay* on the results screen, and from the pause menu mid-race
  (single player: the race waits, as the time trial's replays do). Online, after the race
  only: the race doesn't wait for anybody.
- **The director** (on by default): follows the closest battle near the front, cuts to a
  moment as it happens (a pass, a spin, a stop), comes back to you when nothing is going on,
  holds each shot at least a few seconds, and picks the TV camera that sees the car, or a
  chase or onboard shot when none does well.
- **Or drive the replay yourself:** pick the car (1–8, or click it in the standings tower),
  the camera (TV, chase, onboard), speed 0.25×–2×, pause, skip ±5 s, and jump to the
  previous or next moment (Q / E).
- **On screen during a replay:** REPLAY, the race clock and lap, the standings tower as it
  stood at that moment, the followed car's name, speed and gear, and a timeline along the
  bottom with the moments marked on it (click to jump).
- **Not in this milestone:** saving replays between visits or sharing them (question 2),
  highlight reels cut automatically (question 3).

## Files

Simulation and pure logic:

| File | Contents |
| --- | --- |
| `src/race/raceRecording.ts` | `RaceRecorder`: each car's frames from the lights, in growing chunks; `RaceMoment`s (kind, time, cars, lap); sampling any car at any time; the standings at a time (from the recorded positions). Pure |
| `src/race/race.ts` | Hands the recorder its moments: positions, stops, recoveries, finishes, fastest laps; contacts from `sim.contacts` |
| `src/replay/director.ts` | `Director`: at time t, which car and which shot, from the recording alone (battles by gap, moments by kind, the player as the fallback), with a minimum shot length and look-ahead to a moment's lead-in. Pure |
| `src/replay/replay.ts` | The player generalised from a lap to a race: duration, seek, speed, pause, the next and previous moment |

Presentation:

| File | Contents |
| --- | --- |
| `src/ui/replayHud.ts` | REPLAY, clock and lap, the standings tower at that time, the followed car, the timeline with its moments |
| `src/render/tvCameras.ts`, `cameras.ts` | TV, chase and onboard shots of any car, not just yours |
| `src/ui/raceHud.ts`, `menu.ts` | *Watch replay* on the results and in the pause menu |
| `src/main.ts` | Recording every race, the replay's frame loop (every car drawn from the recording), keys |

## Key data structures

```ts
type MomentKind = 'start' | 'pass' | 'stop' | 'spin' | 'recovered' | 'contact' | 'fastestLap' | 'lastLap' | 'finish';

interface RaceMoment {
  kind: MomentKind;
  time: number;                 // race time (s)
  cars: number[];               // who: [passer, passed], [the car], ...
  lap: number;
}

interface RaceRecording {
  version: 1;
  trackId: string;
  cars: { name: string; colour: number; player: boolean }[];
  frameDt: number;
  frames: Float32Array[];       // per car, FRAME_SIZE floats a frame (the lap recordings' layout)
  progress: Float32Array[];     // per car per frame: laps + distance along the lap (for standings and gaps)
  moments: RaceMoment[];
  duration: number;
}

interface Shot {
  car: number;
  camera: 'tv' | 'chase' | 'onboard';
  tv: number | null;            // which TV camera
  until: number;                // held at least until then
}
```

## Tests

| File | Asserts |
| --- | --- |
| `raceRecording.test.ts` | A 2-lap race with three AI cars: every car recorded from the lights to its finish; a sampled pose matches the simulation's at that step; the standings sampled at any time match the race's own; memory per car-minute within its budget |
| `raceMoments.test.ts` | A scripted pass (one car faster on the same line) gives one `pass` with the cars in order; a pit stop gives a `stop`; a car put back gives `recovered`; every car's `finish` in finishing order |
| `director.test.ts` | Follows a battle (two cars under 1 s apart) over a lone leader; cuts to a pass in time to show its lead-in; holds every shot its minimum; falls back to the player; a TV shot only from a camera that sees the car |
| `replay.test.ts` | Seek, speed and pause over a race recording; next and previous moment |

## Commits, in order

1. Plan (this file).
2. The race recording and its moments, recorded in every race. Tests.
3. The director and the replay player over a race. Tests.
4. On screen: watching from the results and the pause menu, the replay HUD and timeline,
   the shots of any car. Checked in the browser.
5. Docs, then playtest questions.

## Risks

- **Memory and frame time.** Eight cars at 30 Hz is ~23 KB a second; a long Grand
  Championship race (12 laps of the Proving Ground, ~11 minutes) is ~15 MB. The frames go
  into preallocated chunks, so recording allocates nothing per step. If it is too much on a
  phone, cars far from the camera can drop to 10 Hz.
- **The director's taste.** What makes good television is judgement; the rules start simple
  (battles, moments, you) with their numbers in `TUNING`, for your playtest to tune.

## Questions for you

1. Race replays (as proposed), or one of the other ideas instead: **night racing**
   (headlights, floodlit circuits, races into dusk) or **dirt and rally stages** (loose
   surfaces, point-to-point stages against the clock)?
2. Keep only the race just run (as proposed), or save the last few races' replays in the
   browser (and later share one as a file)?
3. Whole-race replays only (as proposed), or also an automatic highlights reel (a minute or
   two of the race's best moments)?
