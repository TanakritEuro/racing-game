// Race recordings: every car's pose and readouts at 30 Hz from the lights going out to the
// end of the race (the lap recordings' frame layout), each car's progress (laps and the
// fraction of the current one), and the race's moments: passes, stops, spins, contacts,
// fastest laps, the last lap and the finishes. A replay plays these back as recorded
// transforms, every car at once. Pure data.

import { FRAME_DT, FRAME_SIZE, RECORD_EVERY, sampleFrames, writeFrame, type RecordedState } from './recording';

export type MomentKind = 'start' | 'pass' | 'stop' | 'spin' | 'recovered' | 'contact' | 'fastestLap' | 'lastLap' | 'finish';

export interface RaceMoment {
  kind: MomentKind;
  /** Race time (s since the lights went out). */
  time: number;
  /** Who: [passer, passed] for a pass, [the car] for the others (none for the start and the last lap). */
  cars: number[];
  /** The lap it happened on (laps the first car has completed, plus one). */
  lap: number;
  /** A finish: the place; a fastest lap: the time (s). */
  value?: number;
}

export interface RaceRecording {
  version: 1;
  trackId: string;
  /** Each car's model name, in the race's car order (0 is the player's). */
  cars: string[];
  laps: number;
  frameDt: number;
  /** Frames recorded per car (the same for every car). */
  count: number;
  /** Per car: FRAME_SIZE floats a frame. */
  frames: Float32Array[];
  /** Per car per frame: laps completed plus the fraction of the current lap. */
  progress: Float32Array[];
  moments: RaceMoment[];
  /** From the first frame to the last (s). */
  duration: number;
}

/** Frames of room to start with: a minute. */
const INITIAL = 30 * 60;

/** Collects every car's frames after each racing step; keeps every RECORD_EVERY-th. */
export class RaceRecorder {
  readonly moments: RaceMoment[] = [];
  private frames: Float32Array[];
  private progress: Float32Array[];
  private count = 0;
  private steps = 0;

  constructor(
    readonly trackId: string,
    readonly cars: readonly string[],
    readonly laps: number,
  ) {
    this.frames = cars.map(() => new Float32Array(INITIAL * FRAME_SIZE));
    this.progress = cars.map(() => new Float32Array(INITIAL));
  }

  /** Frames so far. */
  get frameCount(): number {
    return this.count;
  }

  /** Race time of the last frame (s). */
  get time(): number {
    return Math.max(0, this.count - 1) * FRAME_DT;
  }

  /** Back to nothing (the race restarted). */
  reset(): void {
    this.count = 0;
    this.steps = 0;
    this.moments.length = 0;
  }

  /** Whether the next `capture` keeps a frame. */
  get due(): boolean {
    return this.steps % RECORD_EVERY === 0;
  }

  /** After every racing step: each car's state and progress. */
  capture(states: readonly RecordedState[], progress: readonly number[]): void {
    if (this.steps++ % RECORD_EVERY !== 0) return;
    if (this.count >= this.progress[0].length) this.grow();
    for (let k = 0; k < this.cars.length; k++) {
      writeFrame(this.frames[k], this.count, states[k]);
      this.progress[k][this.count] = progress[k];
    }
    this.count++;
  }

  moment(m: RaceMoment): void {
    this.moments.push(m);
  }

  /** The race so far (the arrays are views, not copies: the recorder only ever adds frames after them). */
  recording(): RaceRecording {
    const n = this.count;
    return {
      version: 1,
      trackId: this.trackId,
      cars: [...this.cars],
      laps: this.laps,
      frameDt: FRAME_DT,
      count: n,
      frames: this.frames.map((f) => f.subarray(0, n * FRAME_SIZE)),
      progress: this.progress.map((p) => p.subarray(0, n)),
      moments: [...this.moments].sort((a, b) => a.time - b.time),
      duration: Math.max(0, n - 1) * FRAME_DT,
    };
  }

  private grow(): void {
    const size = this.progress[0].length * 2;
    this.frames = this.frames.map((f) => {
      const bigger = new Float32Array(size * FRAME_SIZE);
      bigger.set(f);
      return bigger;
    });
    this.progress = this.progress.map((p) => {
      const bigger = new Float32Array(size);
      bigger.set(p);
      return bigger;
    });
  }
}

/** Car `car` at race time `t` (held at the ends), blended between frames, into `out`. */
export function sampleCar(rec: RaceRecording, car: number, t: number, out: RecordedState): void {
  sampleFrames(rec.frames[car], rec.count, rec.frameDt, t, out);
}

/** Car `car`'s progress (laps plus the fraction of the current one) at race time `t`. */
export function progressAt(rec: RaceRecording, car: number, t: number): number {
  if (rec.count === 0) return 0;
  const f = Math.max(0, Math.min(rec.count - 1, t / rec.frameDt));
  const k = Math.min(rec.count - 2, Math.floor(f));
  const p = rec.progress[car];
  if (k < 0) return p[0];
  // Across a recovery the progress may jump; blending is still right to within a frame.
  return p[k] + (p[k + 1] - p[k]) * (f - k);
}

/**
 * The first race time (s) at which car `car` had reached `progress`, or null if it never did
 * (before the recording began: from its first frames' pace, so a negative time).
 */
export function timeAtProgress(rec: RaceRecording, car: number, progress: number): number | null {
  const p = rec.progress[car];
  // Progress only grows, bar a recovery's small step back: a binary search finds the first frame.
  let lo = 0;
  let hi = rec.count - 1;
  if (hi < 0 || p[hi] < progress) return null;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (p[mid] >= progress) hi = mid;
    else lo = mid + 1;
  }
  if (lo === 0) {
    const pace = rec.count > 1 ? (p[1] - p[0]) / rec.frameDt : 0;
    return pace > 0 ? Math.min(0, (progress - p[0]) / pace) : 0;
  }
  const a = p[lo - 1];
  const b = p[lo];
  return (lo - 1 + (b > a ? (progress - a) / (b - a) : 1)) * rec.frameDt;
}

export interface ReplayStanding {
  car: number;
  position: number;
  /** Laps completed and progress at the time. */
  laps: number;
  progress: number;
  /** Seconds behind the leader on the road (or at the flag). */
  gap: number;
  finished: boolean;
}

/** Every car's place at race time `t`: those who had finished by then in finishing order, then the rest by progress. */
export function standingsAt(rec: RaceRecording, t: number): ReplayStanding[] {
  const finishedAt = new Map<number, number>();
  for (const m of rec.moments) if (m.kind === 'finish' && m.time <= t) finishedAt.set(m.cars[0], m.time);
  const rows = rec.cars.map((_, car) => {
    const progress = progressAt(rec, car, t);
    return { car, position: 0, laps: Math.max(0, Math.floor(progress)), progress, gap: 0, finished: finishedAt.has(car) };
  });
  rows.sort((a, b) => {
    if (a.finished && b.finished) return finishedAt.get(a.car)! - finishedAt.get(b.car)!;
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return b.progress - a.progress;
  });
  const leader = rows[0];
  rows.forEach((r, i) => {
    r.position = i + 1;
    if (i === 0) return;
    if (r.finished) r.gap = finishedAt.get(r.car)! - finishedAt.get(leader.car)!;
    else {
      // How long ago the leader was where this car is now.
      const then = timeAtProgress(rec, leader.car, r.progress);
      r.gap = then === null ? 0 : Math.max(0, t - then);
    }
  });
  return rows;
}

/** Which track sample car `car` is nearest at race time `t`, from its progress. */
export function sampleIndexAt(rec: RaceRecording, car: number, t: number, samples: number): number {
  const p = progressAt(rec, car, t);
  const fraction = p - Math.floor(p);
  return Math.min(samples - 1, Math.floor(fraction * samples));
}
