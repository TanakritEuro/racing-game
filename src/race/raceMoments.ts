// The race's moments, noticed as they happen: the start, passes (a change of places that
// holds), pit stops, spins, cars put back on the track, hard contacts, fastest laps, the last
// lap and each car's finish. Read from the race after each racing step; written into its
// recording. Each car is read through a `WatchedCar`, so a race whose cars aren't all in its
// simulation (online: the other side's are proxies, known from their states) is watched the
// same way. Pure simulation.

import { TUNING } from '../config';
import type { Simulation } from '../sim';
import type { MomentKind, RaceRecorder } from './raceRecording';

/** One car as the watcher sees it on a step. */
export interface WatchedCar {
  /** Where it is (m). */
  x: number;
  z: number;
  /** Speed over the ground (m/s) and body slip angle (rad). */
  speed: number;
  slip: number;
  /** Laps completed, and the last one's time (s). */
  laps: number;
  lastLap: number | null;
  /** In the pit lane; stopped in its box with the crew at work. */
  inLane: boolean;
  servicing: boolean;
  /** How long ago (s) the speed, slip, laps and pit lane were so: 0, or a state's age when heard of from another browser. */
  age: number;
}

export function createWatchedCar(): WatchedCar {
  return { x: 0, z: 0, speed: 0, slip: 0, laps: 0, lastLap: null, inLane: false, servicing: false, age: 0 };
}

/** Simulated car `k` of `sim` into `out`. */
export function watchSimCar(sim: Simulation, k: number, out: WatchedCar): void {
  const car = sim.cars[k];
  const v = car.body.linvel();
  const timer = sim.timers[k];
  const pit = sim.pits?.state[k];
  out.x = car.position.x;
  out.z = car.position.z;
  out.speed = Math.hypot(v.x, v.z);
  out.slip = car.bodySlipAngle;
  out.laps = timer.laps;
  out.lastLap = timer.lastLap;
  out.inLane = pit?.inLane ?? false;
  out.servicing = pit ? pit.servicing !== null : false;
  out.age = 0;
}

/** What the watcher reads from a race. Cars are numbered as in its recording. */
export interface WatchedRace {
  readonly finishTimes: readonly (number | null)[];
  /** Race time (s since the lights went out), or null before. */
  readonly time: number | null;
  readonly laps: number;
  progressOf(car: number): number;
  /** Car `car` now, into `out`. */
  watch(car: number, out: WatchedCar): void;
  /** This step's hard knocks: which car, and how hard (N·s). */
  readonly knocks: readonly { readonly car: number; readonly impulse: number }[];
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
  /** Every car as seen this step. */
  private readonly seen: WatchedCar[];
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
    this.seen = Array.from({ length: cars }, createWatchedCar);
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
    const { seen } = this;
    const M = TUNING.replay.moments;
    let leaderLaps = 0;
    for (let k = 0; k < this.cars; k++) {
      race.watch(k, seen[k]);
      leaderLaps = Math.max(leaderLaps, seen[k].laps);
    }
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
      const car = seen[k];
      // Put back on the track: a jump no car could drive.
      if (!Number.isNaN(this.lastX[k]) && Math.hypot(car.x - this.lastX[k], car.z - this.lastZ[k]) > M.recoverJump) add('recovered', [k]);
      this.lastX[k] = car.x;
      this.lastZ[k] = car.z;
      // What it was doing when its readings were taken.
      const then = t - car.age;
      // A spin: travelling well off where it points, at speed.
      if (Math.abs(car.slip) > M.spin.angle && car.speed > M.spin.speed && t - this.lastSpin[k] > M.spin.gap) {
        this.lastSpin[k] = t;
        add('spin', [k], undefined, then);
      }
      // A pit stop, as the crew starts work.
      if (car.servicing && !this.servicing[k]) add('stop', [k], undefined, then);
      this.servicing[k] = car.servicing;
      // A lap done: the race's fastest so far (the standing first lap doesn't count).
      if (car.laps > this.lapsDone[k]) {
        this.lapsDone[k] = car.laps;
        const time = car.lastLap;
        if (car.laps >= 2 && time !== null && (this.best === null || time < this.best)) {
          this.best = time;
          add('fastestLap', [k], time, then);
        }
      }
      // The flag.
      if (!this.finished[k] && race.finishTimes[k] !== null) {
        this.finished[k] = true;
        add('finish', [k], this.finished.filter(Boolean).length);
      }
    }
    for (const c of race.knocks) {
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
    const { seen } = this;
    for (let i = 0; i < now.length; i++) {
      for (let j = i + 1; j < now.length; j++) {
        const passer = now[i];
        const passed = now[j];
        if (was.get(passer)! > was.get(passed)! && !seen[passed].inLane && !seen[passer].inLane) add('pass', [passer, passed], undefined, this.changeSince);
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
