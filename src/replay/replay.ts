// The replay player (after five-a-side's): plays a lap recording or a whole race at 0.25× to
// 2×, paused, skipped or jumped from moment to moment, then hands back. It only says how far
// into the recording to draw; the game draws the recorded cars exactly as it draws live ones.

import { TUNING } from '../config';
import type { RaceMoment, RaceRecording } from '../race/raceRecording';
import { duration, type LapRecording } from '../race/recording';
import { jumpMoments } from './director';

/** Playback speeds on keys 1–4. */
export const REPLAY_SPEEDS = [0.25, 0.5, 1, 2] as const;
/** The last frame is held this long (s, real time) before handing back. */
const END_HOLD = 1.5;

export class Replay {
  /** A lap's recording, while one plays. */
  recording: LapRecording | null = null;
  /** A race's recording, while one plays. */
  race: RaceRecording | null = null;
  /** What is playing ("LAST LAP", "RACE"). */
  caption = '';
  /** Seconds into the recording. */
  time = 0;
  speed = 1;
  paused = false;
  /** The playhead jumped (started, scrubbed): cut the camera rather than pan. */
  jumped = false;
  private held = 0;
  private end = 0;
  private moments: RaceMoment[] = [];

  get active(): boolean {
    return this.recording !== null || this.race !== null;
  }

  /** How long the recording is (s). */
  get length(): number {
    return this.end;
  }

  play(rec: LapRecording, caption: string): void {
    this.start(caption, duration(rec));
    this.recording = rec;
  }

  playRace(rec: RaceRecording, caption: string): void {
    this.start(caption, rec.duration);
    this.race = rec;
    this.moments = jumpMoments(rec);
  }

  private start(caption: string, end: number): void {
    this.recording = null;
    this.race = null;
    this.moments = [];
    this.caption = caption;
    this.end = end;
    this.time = 0;
    this.speed = 1;
    this.paused = false;
    this.held = 0;
    this.jumped = true;
  }

  stop(): void {
    this.recording = null;
    this.race = null;
  }

  togglePause(): void {
    this.paused = !this.paused;
  }

  /** Jump `seconds` forward (or back, negative), within the recording. */
  scrub(seconds: number): void {
    this.seek(this.time + seconds);
  }

  /** Jump to `time` (s), within the recording. */
  seek(time: number): void {
    if (!this.active) return;
    this.time = Math.max(0, Math.min(this.end, time));
    this.held = 0;
    this.jumped = true;
  }

  /** A race: jump to just before the next moment after now (or the one before the one just shown). */
  nextMoment(): RaceMoment | null {
    const lead = TUNING.replay.jumpLead;
    const m = this.moments.find((x) => x.time - lead > this.time + 0.05) ?? null;
    if (m) this.seek(m.time - lead);
    return m;
  }

  previousMoment(): RaceMoment | null {
    const lead = TUNING.replay.jumpLead;
    // The moment being shown counts as the current one: go to the one before it.
    const before = this.moments.filter((x) => x.time - lead < this.time - 0.5);
    const m = before[before.length - 1] ?? null;
    if (m) this.seek(m.time - lead);
    return m;
  }

  /** The race's moments that can be jumped to. */
  get raceMoments(): readonly RaceMoment[] {
    return this.moments;
  }

  /** Advance by `realDt` seconds of real time; the time to draw, or null once it has finished. */
  update(realDt: number): number | null {
    if (!this.active) return null;
    if (!this.paused) {
      const next = this.time + realDt * this.speed;
      // Real time spent past the end counts towards the hold.
      if (next > this.end) this.held += Math.min(realDt, (next - this.end) / this.speed);
      this.time = Math.min(this.end, next);
      if (this.held > END_HOLD) {
        this.stop();
        return null;
      }
    }
    return this.time;
  }
}
