# Milestone 4 plan: time trial and ghosts

## Status: proposed, waiting for your OK

Goal: a proper time trial. Each lap is split into three sectors with a live delta to your
best lap; your best lap per circuit and car is kept between visits and raced as a ghost;
any recorded lap can be watched back as a replay with trackside TV cameras.

## Scope decisions

- **Ghosts and replays are recorded transforms, not re-simulated `Controls`.** Recording
  `Controls` and re-running the car is smaller, but it only reproduces the lap if every
  floating-point operation does too: `Math.sin`, `Math.atan` and `Math.pow` aren't
  guaranteed bit-identical across browsers, and any tuning change (or a new build) would
  make every saved ghost drive off the road. Transforms play back exactly anywhere and
  cost nothing to draw. A lap at 30 frames per second is about 4,500 frames × 24 floats ≈
  430 KB, small enough for IndexedDB. The frames also hold speed, RPM, gear and pedals, for
  the replay HUD now and engine sound in M6.
- **Five-a-side's replay player is ported** (`Replay`: clips, speed, captions); its
  recorder becomes a per-lap recording here, because a whole lap is the unit.
- **The ghost is your best valid lap** on that circuit with that car. Invalid laps, and
  laps slower than the best, never replace it. The ghost is a translucent car that doesn't
  collide, timed from the moment you cross the line.
- **Saved bests are tied to the circuit's layout.** Each record stores a fingerprint of the
  built track (its length and sample count, plus a hash of the control points). If a
  circuit is edited, its old ghost and times are dropped rather than drawn off the road.
- **Sectors are three per circuit**, by default at a third and two thirds of the lap,
  moved per circuit onto straights where needed (`TrackDef.sectors`).
- **Delta to best is live**: the time at each track sample on your best lap is stored, so
  the current lap is compared at the same point on the track, not just at the sector
  lines.
- **Time trial session:** Backspace restarts from the grid (an out lap again); R still
  puts the car back on the track and voids the lap.
- **No online leaderboards** (no backend). Sharing ghosts can come with the online work in M7.

## Files

Simulation:

| File | Contents |
| --- | --- |
| `src/race/timing.ts` | Sector lines, sector times of the current lap, best sectors, time at each sample for the current lap |
| `src/race/recording.ts` | `LapRecorder` (frames at 30 Hz during a lap), `LapRecording`, `sampleRecording(rec, t, out)` (interpolated pose and HUD data), encode / decode to an `ArrayBuffer` |
| `src/race/session.ts` | `TimeTrial`: the timer, the recorder and the best lap together. On each lap: is it the new best, its recording, its delta profile. `restart()` |
| `src/track/track.ts` | `TrackDef.sectors?`, `trackFingerprint(track)` |
| `src/track/cameras.ts` | Trackside TV camera positions: outside the barriers, raised, each covering a stretch of track it can see (terrain line-of-sight checked) |

Presentation:

| File | Contents |
| --- | --- |
| `src/storage/bests.ts` | IndexedDB store of each circuit and car's best: recording, sector bests, delta profile, fingerprint. An in-memory fallback when IndexedDB is unavailable |
| `src/render/ghostView.ts` | The ghost car: the car view with translucent materials, drawn from the recording |
| `src/replay/replay.ts` | Ported player: play a recording at 0.25× to 2×, pause, scrub, then hand back to live |
| `src/render/tvCameras.ts` | Replay camera: cut to the TV camera covering the car, track it, zoom with distance |
| `src/ui/timingHud.ts` | Sector splits (green faster than best, yellow slower, purple new best), live delta, best lap |
| `src/main.ts`, `index.html` | Wiring, keys, replay overlay ("REPLAY", lap time, speed, controls hint) |

## Key data structures

```ts
interface LapRecording {
  version: 1;
  trackId: string;
  carName: string;
  fingerprint: string;
  lapTime: number;
  valid: boolean;
  sectors: number[];          // sector times
  frameDt: number;            // 1/30 s
  frames: Float32Array;       // FRAME_SIZE floats per frame
}
// Per frame: position (3), rotation (4), per wheel suspension length, steer, spin (12),
// speed, rpm, gear, throttle, brake (5): FRAME_SIZE = 24.

interface BestRecord {
  key: string;                // `${trackId}/${carName}`
  fingerprint: string;
  lap: LapRecording;
  bestSectors: number[];      // best of each sector over all valid laps, not necessarily one lap's
  timeAtSample: Float32Array; // best lap's elapsed time at each track sample, for the live delta
}
```

## Tests

| File | Asserts |
| --- | --- |
| `timing.test.ts` | Sector times add up to the lap time; best sectors kept across laps; the time-at-sample profile is increasing and ends at the lap time |
| `recording.test.ts` | Frames at 30 Hz; sampling between frames matches the simulation's own poses within 2 cm and 0.5°; wheel spin unwrapped; encode / decode round trip is exact |
| `session.test.ts` | A faster valid lap becomes the best (with its recording and delta profile); invalid or slower laps don't; the live delta is about zero when matching the best and grows when slower; restart gives an out lap |
| `cameras.test.ts` | Every TV camera stands outside the barriers; every track sample is seen by some camera within range with a clear line of sight over the terrain |
| `fingerprint.test.ts` | Same layout → same fingerprint; moving a control point changes it |

The storage itself (IndexedDB) is checked in the browser: set a best, reload, the ghost
is there.

## Commits, in order

1. Plan (this file).
2. Sectors and best sectors in the timer, the time-at-sample profile, `TrackDef.sectors`;
   the timing HUD with splits and live delta (against the best lap in this session). Tests.
3. Lap recordings: recorder, sampling, encode / decode, fingerprint. Tests.
4. Time trial session and the ghost car (session best only, no saving yet); G toggles the
   ghost; Backspace restarts. Tests.
5. Saving bests in IndexedDB, loaded at start, dropped if the layout changed.
6. Replays: the ported player, trackside TV cameras with line of sight, P for the last lap
   and Shift+P for the best, replay controls and overlay. Tests.
7. Docs, then playtest questions.

## Risks

- **IndexedDB in private windows** can refuse writes: the in-memory fallback keeps the
  session working; the HUD says bests won't be kept.
- **Replay camera cuts** can jump about on twisty sections; cameras cover overlapping
  stretches and a cut needs the car to be out of the current camera's stretch.

## Questions for you

1. Ghosts as recorded transforms rather than re-simulated `Controls`: all right? (Robust
   across browsers and tuning changes; ~430 KB per saved lap.)
2. Keys: G ghost on/off, P replay the last lap, Shift+P replay the best, Backspace restart.
   In a replay: Space pause, ←/→ scrub, 1/2/3/4 for 0.25×/0.5×/1×/2×, Esc back to driving.
3. Should the ghost be only your all-time best, or would you also like the option of
   racing your last lap's ghost?
