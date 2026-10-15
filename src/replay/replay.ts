// The replay player (after five-a-side's): plays a lap recording at 0.25× to 2×, paused or
// scrubbed, then hands back to live driving. It only says how far into the recording to draw;
// the game draws the recorded car exactly as it draws the live one.

import { duration, type LapRecording } from '../race/recording';

/** Playback speeds on keys 1–4. */
export const REPLAY_SPEEDS = [0.25, 0.5, 1, 2] as const;
/** The last frame is held this long (s, real time) before handing back. */
const END_HOLD = 1.5;

export class Replay {
  recording: LapRecording | null = null;
  /** What is playing ("LAST LAP"). */
  caption = '';
  /** Seconds into the recording. */
  time = 0;
  speed = 1;
  paused = false;
  /** The playhead jumped (started, scrubbed): cut the camera rather than pan. */
  jumped = false;
  private held = 0;

  get active(): boolean {
    return this.recording !== null;
  }

  play(rec: LapRecording, caption: string): void {
    this.recording = rec;
    this.caption = caption;
    this.time = 0;
    this.speed = 1;
    this.paused = false;
    this.held = 0;
    this.jumped = true;
  }

  stop(): void {
    this.recording = null;
  }

  togglePause(): void {
    this.paused = !this.paused;
  }

  /** Jump `seconds` forward (or back, negative), within the recording. */
  scrub(seconds: number): void {
    if (!this.recording) return;
    this.time = Math.max(0, Math.min(duration(this.recording), this.time + seconds));
    this.held = 0;
    this.jumped = true;
  }

  /** Advance by `realDt` seconds of real time; the time to draw, or null once it has finished. */
  update(realDt: number): number | null {
    const rec = this.recording;
    if (!rec) return null;
    if (!this.paused) {
      const end = duration(rec);
      const next = this.time + realDt * this.speed;
      // Real time spent past the end counts towards the hold.
      if (next > end) this.held += Math.min(realDt, (next - end) / this.speed);
      this.time = Math.min(end, next);
      if (this.held > END_HOLD) {
        this.stop();
        return null;
      }
    }
    return this.time;
  }
}
