// Lap timing from the car's progress along the centreline. Pure simulation.
//
// The clock starts the first time the car crosses the start line (an out lap before that).
// A lap counts only if the car passed the far side of the circuit since the last crossing,
// so reversing back and forth over the line does nothing.
//
// Track limits: once all four wheels are off the track (beyond the kerbs, on grass or gravel)
// during a timed lap, that lap is invalid. It still shows its time but never counts as a best.

import { nearestSample, type Track } from '../track/track';

export class LapTimer {
  /** Track sample the car is nearest to. */
  index: number;
  /** Laps completed. */
  laps = 0;
  lastLap: number | null = null;
  bestLap: number | null = null;
  /** The lap in progress has gone beyond the track limits. */
  invalid = false;
  /** The last completed lap was within the track limits. */
  lastValid = true;
  /** Simulation time the current lap started, or null on the out lap. */
  private lapStart: number | null = null;
  private passedHalf = false;

  constructor(
    private readonly track: Track,
    x: number,
    z: number,
  ) {
    this.index = nearestSample(track, x, z);
  }

  /** Void the lap in progress (e.g. the car was put back on the track). */
  invalidate(): void {
    if (this.lapStart !== null) this.invalid = true;
  }

  /** Current lap's elapsed time (s), or null on the out lap. */
  current(time: number): number | null {
    return this.lapStart === null ? null : time - this.lapStart;
  }

  /**
   * Call every step with the car's position, the simulation time and whether all its wheels
   * are off the track. Returns true when a lap completes.
   */
  update(x: number, z: number, time: number, offTrack = false): boolean {
    if (offTrack && this.lapStart !== null) this.invalid = true;
    const n = this.track.samples.length;
    const prev = this.index;
    this.index = nearestSample(this.track, x, z, prev);
    const now = this.index;

    if (now > n * 0.4 && now < n * 0.6) this.passedHalf = true;
    const crossedForward = prev > n * 0.9 && now < n * 0.1;
    const crossedBackward = prev < n * 0.1 && now > n * 0.9;
    if (crossedBackward) {
      this.passedHalf = false;
      return false;
    }
    if (!crossedForward) return false;

    let completed = false;
    if (this.lapStart !== null && this.passedHalf) {
      const lap = time - this.lapStart;
      this.laps++;
      this.lastLap = lap;
      this.lastValid = !this.invalid;
      if (this.lastValid && (this.bestLap === null || lap < this.bestLap)) this.bestLap = lap;
      completed = true;
    }
    if (this.lapStart === null || this.passedHalf) {
      this.lapStart = time;
      this.invalid = false;
    }
    this.passedHalf = false;
    return completed;
  }
}

/** 83.456 → "1:23.456" */
export function formatLapTime(seconds: number | null): string {
  if (seconds === null) return '–:––.–––';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
