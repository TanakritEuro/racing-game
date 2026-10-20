// The race's moments, noticed as they happen: the start, passes (a change of places that
// holds), pit stops, spins, cars put back on the track, hard contacts, fastest laps, the last
// lap and each car's finish. Read from the race after each racing step; written into its
// recording. Pure simulation.

import { TUNING } from '../config';
import type { Simulation } from '../sim';
import type { MomentKind, RaceRecorder } from './raceRecording';

/** What the watcher reads from a race. */
export interface WatchedRace {
  readonly sim: Simulation;
  readonly finishTimes: readonly (number | null)[];
  /** Race time (s since the lights went out), or null before. */
  readonly time: number | null;
  readonly laps: number;
  progressOf(car: number): number;
}

export class MomentWatcher {
  /** The places as last confirmed (car indices, first to last). */
  private order: number[] = [];
  /** When the places first differed from `order` (race time), or null while they agree. */
  private changeSince: number | null = null;
  private readonly lastSpin: number[];
  private readonly lastContact: number[];
  private readonly servicing: boolean[];
  private readonly finished: boolean[];
  private readonly lapsDone: number[];
  private readonly lastX: number[];
  private readonly lastZ: number[];
  private best: number | null = null;
  private lastLapCalled = false;
  private started = false;

  constructor(
    private readonly recorder: RaceRecorder,
    private readonly cars: number,
  ) {
    this.lastSpin = new Array<number>(cars);
    this.lastContact = new Array<number>(cars);
    this.servicing = new Array<boolean>(cars);
    this.finished = new Array<boolean>(cars);
    this.lapsDone = new Array<number>(cars);
    this.lastX = new Array<number>(cars);
    this.lastZ = new Array<number>(cars);
    this.reset();
  }

  reset(): void {
    this.order = [];
    this.changeSince = null;
    this.lastSpin.fill(-Infinity);
    this.lastContact.fill(-Infinity);
    this.servicing.fill(false);
    this.finished.fill(false);
    this.lapsDone.fill(0);
    this.lastX.fill(NaN);
    this.lastZ.fill(NaN);
    this.best = null;
    this.lastLapCalled = false;
    this.started = false;
  }

  /** After a racing step. `places`: whether to look at the order this step (every recorded frame is enough). */
  afterStep(race: WatchedRace, places: boolean): void {
    const t = race.time;
    if (t === null) return;
    const { sim } = race;
    const M = TUNING.replay.moments;
    let leaderLaps = 0;
    for (const tm of sim.timers) leaderLaps = Math.max(leaderLaps, tm.laps);
    const lap = Math.min(race.laps, leaderLaps + 1);
    const add = (kind: MomentKind, cars: number[], value?: number, time = t) =>
      this.recorder.moment(value === undefined ? { kind, time, cars, lap } : { kind, time, cars, lap, value });

    if (!this.started) {
      this.started = true;
      add('start', []);
    }
    if (!this.lastLapCalled && race.laps > 1 && leaderLaps === race.laps - 1) {
      this.lastLapCalled = true;
      add('lastLap', []);
    }

    for (let k = 0; k < this.cars; k++) {
      const car = sim.cars[k];
      const p = car.position;
      // Put back on the track: a jump no car could drive.
      if (!Number.isNaN(this.lastX[k]) && Math.hypot(p.x - this.lastX[k], p.z - this.lastZ[k]) > M.recoverJump) add('recovered', [k]);
      this.lastX[k] = p.x;
      this.lastZ[k] = p.z;
      // A spin: travelling well off where it points, at speed.
      const v = car.body.linvel();
      if (Math.abs(car.bodySlipAngle) > M.spin.angle && Math.hypot(v.x, v.z) > M.spin.speed && t - this.lastSpin[k] > M.spin.gap) {
        this.lastSpin[k] = t;
        add('spin', [k]);
      }
      // A pit stop, as the crew starts work.
      const pit = sim.pits?.state[k];
      const servicing = pit ? pit.servicing !== null : false;
      if (servicing && !this.servicing[k]) add('stop', [k]);
      this.servicing[k] = servicing;
      // A lap done: the race's fastest so far (the standing first lap doesn't count).
      const timer = sim.timers[k];
      if (timer.laps > this.lapsDone[k]) {
        this.lapsDone[k] = timer.laps;
        const time = timer.lastLap;
        if (timer.laps >= 2 && time !== null && (this.best === null || time < this.best)) {
          this.best = time;
          add('fastestLap', [k], time);
        }
      }
      // The flag.
      if (!this.finished[k] && race.finishTimes[k] !== null) {
        this.finished[k] = true;
        add('finish', [k], this.finished.filter(Boolean).length);
      }
    }
    for (const c of sim.contacts) {
      if (c.impulse > M.contact.impulse && t - this.lastContact[c.car] > M.contact.gap) {
        this.lastContact[c.car] = t;
        add('contact', [c.car]);
      }
    }
    if (places) this.watchPlaces(race, t, add);
  }

  /** Passes: the places changed and stayed changed for `passHold`. */
  private watchPlaces(race: WatchedRace, t: number, add: (kind: MomentKind, cars: number[], value?: number, time?: number) => void): void {
    const now = this.places(race);
    if (this.order.length === 0) {
      this.order = now;
      return;
    }
    if (now.every((c, i) => c === this.order[i])) {
      this.changeSince = null;
      return;
    }
    this.changeSince ??= t;
    if (t - this.changeSince < TUNING.replay.moments.passHold) return;
    // Every car now ahead of one it was behind (and the change didn't come from a pit stop or a recovery).
    const was = new Map(this.order.map((c, i) => [c, i]));
    const pits = race.sim.pits?.state;
    for (let i = 0; i < now.length; i++) {
      for (let j = i + 1; j < now.length; j++) {
        const passer = now[i];
        const passed = now[j];
        if (was.get(passer)! > was.get(passed)! && !pits?.[passed]?.inLane && !pits?.[passer]?.inLane) add('pass', [passer, passed], undefined, this.changeSince);
      }
    }
    this.order = now;
    this.changeSince = null;
  }

  /** Car indices first to last: those who have finished in finishing order, then by progress. */
  private places(race: WatchedRace): number[] {
    const key = (k: number) => {
      const f = race.finishTimes[k];
      return f !== null ? 1e6 - f : race.progressOf(k);
    };
    return Array.from({ length: this.cars }, (_, k) => k).sort((a, b) => key(b) - key(a));
  }
}
