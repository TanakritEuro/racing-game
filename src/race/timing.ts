// Lap timing from the car's progress along the centreline. Pure simulation.
//
// The clock starts the first time the car crosses the start line (an out lap before that).
// A lap counts only if the car passed the far side of the circuit since the last crossing,
// so reversing back and forth over the line does nothing.
//
// Track limits: once all four wheels are off the track (beyond the kerbs, on grass or gravel)
// during a timed lap, that lap is invalid. It still shows its time but never counts as a best.
//
// Sectors and delta: each lap stamps the time it first reaches every track sample. Sector
// times come from those stamps at the sector lines, and the live delta compares the current
// lap with the best lap's stamp at the same point on the track.

import { nearestSample, type Track } from '../track/track';

/** Three sectors: times, or null while not yet run. */
export type Sectors = [number | null, number | null, number | null];

/** A lap to measure the current one against: its time, its sectors and its time at each sample. */
export interface ReferenceLap {
  time: number;
  sectors: [number, number, number];
  profile: Float32Array;
}

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
  /** Sample indices where sectors 1 and 2 end (sector 3 ends at the line). */
  readonly sectorEnds: [number, number];
  /** The current lap's sector times so far. */
  sectors: Sectors = [null, null, null];
  /** The last completed lap's sectors and time profile. */
  lastSectors: [number, number, number] | null = null;
  lastProfile: Float32Array | null = null;
  /** The best valid lap: time, sectors and profile (the ghost and the delta measure against it). */
  best: ReferenceLap | null = null;
  /** The best time in each sector over all valid laps (not necessarily from one lap). */
  bestSectors: Sectors = [null, null, null];

  /** Simulation time the current lap started, or null on the out lap. */
  private lapStart: number | null = null;
  private passedHalf = false;
  /** Elapsed time this lap at each sample reached, and the furthest sample reached. */
  private readonly profile: Float32Array;
  private reached = 0;
  private lastElapsed = 0;

  constructor(
    private readonly track: Track,
    x: number,
    z: number,
  ) {
    this.index = nearestSample(track, x, z);
    const n = track.samples.length;
    this.profile = new Float32Array(n);
    const ends = track.def.sectors ?? [track.length / 3, (2 * track.length) / 3];
    this.sectorEnds = [Math.round((ends[0] / track.length) * n), Math.round((ends[1] / track.length) * n)];
  }

  /** Void the lap in progress (e.g. the car was put back on the track). */
  invalidate(): void {
    if (this.lapStart !== null) this.invalid = true;
  }

  /** Current lap's elapsed time (s), or null on the out lap. */
  current(time: number): number | null {
    return this.lapStart === null ? null : time - this.lapStart;
  }

  /** Sectors completed in the current lap (0–2), or −1 on the out lap. */
  get sector(): number {
    if (this.lapStart === null) return -1;
    return this.sectors[1] !== null ? 2 : this.sectors[0] !== null ? 1 : 0;
  }

  /** How far ahead (−) or behind (+) the best lap at this point on the track (s), or null without one. */
  delta(time: number): number | null {
    const elapsed = this.current(time);
    if (elapsed === null || !this.best) return null;
    return elapsed - this.best.profile[this.reached];
  }

  /** Measure against `lap` from now on (a best loaded from storage), unless this session has a better one. */
  setBest(lap: ReferenceLap): void {
    if (this.best && this.best.time <= lap.time) return;
    this.best = lap;
    this.bestLap = lap.time;
    lap.sectors.forEach((t, k) => {
      const b = this.bestSectors[k];
      if (b === null || t < b) this.bestSectors[k] = t;
    });
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
    this.stamp(now, time);

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
      this.finishLap(lap);
      completed = true;
    }
    if (this.lapStart === null || this.passedHalf) {
      this.lapStart = time;
      this.invalid = false;
      this.sectors = [null, null, null];
      this.profile.fill(0);
      this.reached = 0;
      this.lastElapsed = 0;
    }
    this.passedHalf = false;
    return completed;
  }

  /** Stamp the time at every sample newly reached this lap, and close sectors as their lines pass. */
  private stamp(now: number, time: number): void {
    const elapsed = this.current(time);
    if (elapsed === null) return;
    const n = this.track.samples.length;
    // Only forward progress, and not the wrap past the line (finishLap handles that).
    if (now > this.reached && now - this.reached < n / 4) {
      const span = now - this.reached;
      for (let i = this.reached + 1; i <= now; i++) {
        this.profile[i] = this.lastElapsed + ((elapsed - this.lastElapsed) * (i - this.reached)) / span;
      }
      this.reached = now;
      const [e1, e2] = this.sectorEnds;
      if (this.sectors[0] === null && now >= e1) this.sectors[0] = this.profile[e1];
      if (this.sectors[1] === null && now >= e2) this.sectors[1] = this.profile[e2] - this.profile[e1];
    }
    this.lastElapsed = elapsed;
  }

  private finishLap(lap: number): void {
    const n = this.track.samples.length;
    const [e1, e2] = this.sectorEnds;
    // Samples skipped at the very end of the lap get the finishing time's share.
    for (let i = this.reached + 1; i < n; i++) this.profile[i] = this.profile[this.reached] + ((lap - this.profile[this.reached]) * (i - this.reached)) / (n - this.reached);
    const s1 = this.sectors[0] ?? this.profile[e1];
    const s2 = this.sectors[1] ?? this.profile[e2] - this.profile[e1];
    const sectors: [number, number, number] = [s1, s2, lap - s1 - s2];
    this.sectors = sectors;
    this.laps++;
    this.lastLap = lap;
    this.lastValid = !this.invalid;
    this.lastSectors = sectors;
    this.lastProfile = this.profile.slice();
    if (!this.lastValid) return;
    sectors.forEach((t, k) => {
      const b = this.bestSectors[k];
      if (b === null || t < b) this.bestSectors[k] = t;
    });
    if (this.best === null || lap < this.best.time) {
      this.best = { time: lap, sectors, profile: this.lastProfile };
      this.bestLap = lap;
    }
  }
}

/** 83.456 → "1:23.456" */
export function formatLapTime(seconds: number | null): string {
  if (seconds === null) return '–:––.–––';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

/** −0.234 → "−0.234", 1.5 → "+1.500" */
export function formatDelta(seconds: number): string {
  return `${seconds < 0 ? '−' : '+'}${Math.abs(seconds).toFixed(3)}`;
}
