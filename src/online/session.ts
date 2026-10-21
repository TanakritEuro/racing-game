// An online race between two browsers, and the host's AI opponents if it asked for them. Each
// browser simulates only its own cars (the guest its car; the host its car and the AI) and
// sends their states 30 times a second; the other browser's cars are proxies in its
// simulation, placed where their states say they are now (remoteCar.ts).
//
// The order of things:
//   1. Handshake (before either side builds the circuit): the guest says hello with its version
//      and car, the host answers with the circuit, the laps, the AI field and its own car.
//   2. Each side builds its world and starts an `OnlineRace`; the host says it is ready. The
//      guest then times a dozen pings to learn the host's clock, and says it is ready too.
//   3. The host schedules the lights to go out at a moment on its clock. From then on both
//      simulations step in time with that clock, their steps falling at the same moments, so
//      every car is released on the same step and all race times run from the same instant.
//   4. Each side times its own cars' laps and reports their finishing times; both sides rank
//      the same times, so both agree on the result.
//   5. Rematch (both ask, the host schedules new lights) or leave.
//
// Cars have the same ids on both screens' standings: 0 is this player's, 1 the other
// player's, 2 and up the AI's. On the wire, 0 is the host's and 1 the guest's.
//
// Each side records the race for its replay by car id, from the lights to the end: its own
// cars as simulated, the other side's as they are drawn here (the proxies) with the readouts
// their states carry, and the moments it can see (its own cars' contacts; everything else
// from the states too). The finishes come from the agreed finishing times.
//
// The clock is passed in (seconds), so tests run two of these over a loopback on a virtual one.

import { TUNING } from '../config';
import { PHYSICS_STEP } from '../constants';
import { createAiDriver, type AiDriver } from '../ai/driver';
import { fieldSkills, type Difficulty } from '../ai/skill';
import { Traffic, type Mover } from '../ai/traffic';
import { createRng } from '../math';
import type { Standing } from '../race/race';
import { Simulation } from '../sim';
import type { Track } from '../track/track';
import { controls as makeControls, restingPose, type Controls } from '../vehicle/car';
import type { CarDef } from '../vehicle/carDef';
import { createPose, type CarPose } from '../vehicle/pose';
import { ClockSync } from './clock';
import type { Link } from './link';
import { parseMessage, PROTOCOL, type Message } from './protocol';
import { RemoteCar } from './remoteCar';
import { createState, packState, unpackState, type CarState } from './state';
import type { Conditions } from '../track/weather';
import type { WearRate } from '../vehicle/wear';
import { customDef, type CustomCircuit } from '../track/custom';
import { buildTrack } from '../track/track';
import { validateTrack } from '../track/validate';
import { raceFuel } from '../race/race';
import { PitCalls } from '../race/pitCalls';
import { MomentWatcher, watchSimCar, type WatchedCar } from '../race/raceMoments';
import { RaceRecorder, type RaceRecording } from '../race/raceRecording';
import { createRecordedState, type RecordedState } from '../race/recording';
import { copyPose } from '../vehicle/pose';
import { dot, rotate } from '../math';
import { MAX_EXTRAPOLATION } from './remoteCar';

export type Role = 'host' | 'guest';

/** What the handshake agreed. */
export interface OnlineSetup {
  role: Role;
  /** Circuit id, laps and AI opponents (the host's choice). */
  track: string;
  laps: number;
  opponents: number;
  /** The weather and tyre wear (the host's choice). */
  conditions: Conditions;
  wear: WearRate;
  /** The circuit itself when it's a custom one (the guest may not have it). */
  custom: CustomCircuit | null;
  /** This player's car and the other's (car names). The AI drive the host's. */
  mine: string;
  theirs: string;
  /** Messages that arrived after the handshake, before the race was built: the race reads them first. */
  inbox: Message[];
}

/** The most AI opponents online (as offline). */
export const MAX_OPPONENTS = 7;

/** Why an online race couldn't start or carry on: shown to the player as it is. */
export class OnlineError extends Error {}

/** Keep what arrives until the race is built. */
function buffered(link: Link, setup: Omit<OnlineSetup, 'inbox'>): OnlineSetup {
  const inbox: Message[] = [];
  link.onMessage = (raw) => {
    const m = parseMessage(raw);
    if (m) inbox.push(m);
  };
  return { ...setup, inbox };
}

/**
 * The host's side: wait for the guest's hello and send it the race. `cars` are the car names
 * this version knows.
 */
export function hostHandshake(
  link: Link,
  race: { track: string; laps: number; car: string; opponents: number; conditions: Conditions; wear: WearRate; custom: CustomCircuit | null },
  cars: readonly string[],
): Promise<OnlineSetup> {
  return new Promise((resolve, reject) => {
    link.onClose = (reason) => reject(new OnlineError(reason));
    link.onMessage = (raw) => {
      const m = parseMessage(raw);
      if (m?.type !== 'hello') return;
      const problem =
        m.version !== PROTOCOL
          ? 'The other player has a different version of the game: reload both pages.'
          : !cars.includes(m.car)
            ? 'The other player chose a car this version does not have: reload both pages.'
            : null;
      if (problem) {
        link.send({ type: 'reject', reason: problem });
        link.close();
        reject(new OnlineError(problem));
        return;
      }
      const opponents = Math.max(0, Math.min(MAX_OPPONENTS, race.opponents));
      link.send({ type: 'welcome', track: race.track, laps: race.laps, car: race.car, opponents, conditions: race.conditions, wear: race.wear, custom: race.custom });
      resolve(buffered(link, { role: 'host', track: race.track, laps: race.laps, opponents, conditions: race.conditions, wear: race.wear, custom: race.custom, mine: race.car, theirs: m.car }));
    };
  });
}

/** The guest's side: say hello and wait for the race. `tracks` and `cars` are the ids this version knows. */
export function guestHandshake(link: Link, car: string, tracks: readonly string[], cars: readonly string[]): Promise<OnlineSetup> {
  return new Promise((resolve, reject) => {
    link.onClose = (reason) => reject(new OnlineError(reason));
    link.onMessage = (raw) => {
      const m = parseMessage(raw);
      if (m?.type === 'reject') {
        link.close();
        reject(new OnlineError(m.reason));
      } else if (m?.type === 'welcome') {
        // A custom circuit must keep the rules here too.
        const custom = m.custom && validateTrack(buildTrack(customDef(m.custom))).length === 0 ? m.custom : null;
        if ((!tracks.includes(m.track) && !custom) || !cars.includes(m.car)) {
          const reason = 'The host chose a circuit or car this version does not have: reload both pages.';
          link.send({ type: 'bye', reason });
          link.close();
          reject(new OnlineError(reason));
          return;
        }
        resolve(buffered(link, { role: 'guest', track: m.track, laps: m.laps, opponents: m.opponents, conditions: m.conditions, wear: m.wear, custom, mine: car, theirs: m.car }));
      }
    };
    link.send({ type: 'hello', version: PROTOCOL, car });
  });
}

/** Waiting for the other side (and the clock), the lights, racing, and after the flag. */
export type OnlinePhase = 'waiting' | 'lights' | 'racing' | 'finished';

export interface OnlineOptions {
  /** The clock (s): any steady one, such as performance.now() / 1000. */
  clock: () => number;
  /** For the wait before the lights go out and the AI's skills (the host draws them). */
  seed?: number;
  /** The AI's difficulty (the host's choice). */
  difficulty?: Difficulty;
  /** The host's car as designed, for its AI (`mine` may carry the player's setup). */
  stock?: CarDef;
}

/** This player's car, and the other player's. */
const ME = 0;
const THEM = 1;

/** An AI car on the grid. */
const HELD: Controls = makeControls({ brake: 1 });

/** A car's own right and forward (−Z). */
const RIGHT = { x: 1, y: 0, z: 0 };
const FORWARD = { x: 0, y: 0, z: -1 };

/** A simulated car (index into `sim.cars`) or a proxy (index into `sim.proxies`). */
type Where = { car: number; proxy?: undefined } | { proxy: number; car?: undefined };

export class OnlineRace {
  readonly sim: Simulation;
  /** Every car in the race: the two players and the AI. */
  readonly count: number;
  /** Each proxy's states, turned into where its car is now (proxy 0 is always the other player). */
  readonly remotes: RemoteCar[] = [];
  /** The guest's estimate of the host's clock (the host's own offset stays 0). */
  readonly sync = new ClockSync();
  /** The host's AI drivers (none on the guest, which only sees their cars). */
  readonly drivers: AiDriver[] = [];
  phase: OnlinePhase = 'waiting';
  /** Why the race ended early (the other player left, the link lost touch), or null. */
  closed: string | null = null;
  /** Race time each car took the flag (s), or null; by car id. */
  readonly finishTimes: (number | null)[];
  /** Who wants a rematch: this player, the other. */
  readonly rematch: [boolean, boolean] = [false, false];
  /** The moment the lights go out on the host's clock (s), or null before it is set. */
  outAt: number | null = null;
  /** The simulated cars' controls on the last step (this player's first, held on the grid). */
  controls: Controls[] = [];
  /** Every car through the race by id, and its moments, for the replay (cleared by a rematch). */
  readonly recorder: RaceRecorder;
  private readonly watcher: MomentWatcher;
  private readonly recorded: RecordedState[];
  private readonly progressNow: number[];
  private readonly knocksNow: { car: number; impulse: number }[] = [];

  private readonly traffic: Traffic | null = null;
  /** The pit wall's BOX calls for this side's cars (its AI act on their own). */
  private readonly pitWall: PitCalls;
  /** Traffic sees the simulated cars and the other player's. */
  private readonly movers: Mover[];
  /** Best laps the other side reported at the flag, by car id. */
  private readonly reportedBest: (number | null)[];
  private wait = 0;
  /** Clock time (host's once synced, local before) at simulation step 0. */
  private base: number;
  private synced: boolean;
  private theyAreReady = false;
  private pingsSent = 0;
  private nextPing = 0;
  /** Clock time each simulated car completed each lap. */
  private crossings: number[][];
  private readonly lapsBefore: number[];
  /** The first clock time each car reached each checkpoint, and the last checkpoint marked; by car id. */
  private readonly reached: Map<number, number>[];
  private readonly lastKey: number[];
  private readonly rng;
  private readonly proxyPose = createPose();
  /** Each proxy is solid (not a ghost while its states are stale). */
  private readonly proxySolid: boolean[] = [];
  private readonly state = createState();
  private readonly incoming = createState();

  constructor(
    readonly link: Link,
    readonly setup: OnlineSetup,
    readonly track: Track,
    mine: CarDef,
    theirs: CarDef,
    private readonly options: OnlineOptions,
  ) {
    const host = setup.role === 'host';
    const n = setup.opponents;
    this.count = 2 + n;
    // The two players together in the middle of the grid, the AI around them.
    const players = 2 * Math.round(n / 4);
    const slot = (entry: number) => (entry < 2 ? players + entry : entry - 2 < players ? entry - 2 : entry);
    const ai = Array.from({ length: n }, (_, k) => 2 + k);
    // The host simulates itself and the AI (in its car); the guest only itself.
    const own = host ? [0, ...ai] : [1];
    const proxies = host ? [1] : [0, ...ai];
    const stock = options.stock ?? mine;
    this.sim = new Simulation(track, stock, { cars: own.length, slots: own.map(slot), field: this.count, defs: [mine], conditions: setup.conditions, wear: setup.wear });
    this.pitWall = new PitCalls(own.length);
    this.refuel();
    for (const entry of proxies) {
      this.sim.addProxy(theirs, restingPose(theirs, this.sim.slotPose(slot(entry))));
      this.remotes.push(new RemoteCar());
      this.proxySolid.push(true);
    }
    this.rng = createRng(options.seed ?? 1);
    if (host && n > 0) {
      fieldSkills(options.difficulty ?? 'medium', n, this.rng).forEach((skill, k) => this.drivers.push(createAiDriver(track, stock, skill, (options.seed ?? 1) * 100 + k, setup.conditions)));
      const other = this.sim.proxies[0];
      const remote = this.remotes[0];
      this.movers = [
        ...this.sim.cars,
        {
          position: other.current.position,
          get speed() {
            return remote.latest?.speed ?? 0;
          },
        },
      ];
      this.traffic = new Traffic(track, this.movers, stock);
    } else this.movers = [];
    this.finishTimes = Array.from({ length: this.count }, () => null);
    this.reportedBest = Array.from({ length: this.count }, () => null);
    this.reached = Array.from({ length: this.count }, () => new Map());
    this.lastKey = Array.from({ length: this.count }, () => -Infinity);
    this.crossings = this.sim.cars.map(() => []);
    this.lapsBefore = this.sim.cars.map(() => 0);
    const ids = Array.from({ length: this.count }, (_, id) => id);
    this.recorder = new RaceRecorder(track.def.id, ids.map((id) => this.defOf(id).name), setup.laps);
    this.watcher = new MomentWatcher(this.recorder, this.count);
    this.recorded = ids.map(() => createRecordedState());
    this.progressNow = ids.map(() => 0);
    this.synced = host;
    this.base = options.clock();
    link.onMessage = (raw) => {
      const m = parseMessage(raw);
      if (m) this.receive(m);
    };
    link.onClose = (reason) => this.close(reason);
    for (const m of setup.inbox.splice(0)) this.receive(m);
    if (host) link.send({ type: 'ready' });
  }

  /** On the grid: held on the brakes (revving allowed) until the lights go out. */
  get held(): boolean {
    return this.phase === 'waiting' || this.phase === 'lights';
  }

  /** Laps in the race. */
  get laps(): number {
    return this.setup.laps;
  }

  /** The shared clock's time at the simulation's last step (s). */
  get now(): number {
    return this.base + this.sim.steps * PHYSICS_STEP;
  }

  /** Race time since the lights went out (s), or null before. */
  get time(): number | null {
    return this.outAt === null || this.held ? null : this.now - this.outAt;
  }

  /** Lights lit (0–5) during the countdown; 0 once they are out or before they are set. */
  get lights(): number {
    if (this.phase !== 'lights' || this.outAt === null) return 0;
    const L = TUNING.race.lights;
    const firstAt = this.outAt - this.wait - (L.count - 1) * L.interval;
    return Math.max(0, Math.min(L.count, Math.floor((this.now - firstAt) / L.interval) + 1));
  }

  /** The other player's latest state (speed, RPM, throttle for its sound), or null. */
  get theirs(): CarState | null {
    return this.remotes[0].latest;
  }

  /** Waiting for the other player: still syncing the clock (the guest), or for the lights. */
  get waitingFor(): 'player' | 'clock' | null {
    if (this.phase !== 'waiting') return null;
    return this.theyAreReady && !this.synced ? 'clock' : 'player';
  }

  /** This player should come in for tyres this lap. */
  get boxCall(): boolean {
    return this.pitWall.box[0];
  }

  /** Every car of this side's fuelled for the race, on fresh tyres. */
  private refuel(): void {
    this.pitWall.reset();
    for (const car of this.sim.cars) {
      car.setFuel(raceFuel(car.def, this.track, this.setup.laps));
      car.changeTyres();
    }
  }

  /** The car id of simulated car `k`, and of proxy `j`. */
  idOfCar(k: number): number {
    return k === 0 ? ME : 1 + k;
  }
  idOfProxy(j: number): number {
    return 1 + j;
  }

  /** Car `id`'s car. */
  defOf(id: number): CarDef {
    const where = this.where(id);
    return where.car === undefined ? this.sim.proxies[where.proxy].def : this.sim.cars[where.car].def;
  }

  /** The race can be watched again: it is over (the race doesn't wait for anybody) and was recorded. */
  get replayable(): boolean {
    return this.phase === 'finished' && this.recorder.frameCount >= 2;
  }

  /**
   * The race as recorded here. The finishes are the agreed finishing times in order (each side
   * hears of the other side's late, so not in the order it heard of them).
   */
  recording(): RaceRecording {
    const rec = this.recorder.recording();
    const finishers = this.finishTimes
      .map((time, car) => ({ time, car }))
      .filter((f): f is { time: number; car: number } => f.time !== null)
      .sort((a, b) => a.time - b.time);
    rec.moments = [
      ...rec.moments.filter((m) => m.kind !== 'finish'),
      ...finishers.map((f, i) => ({ kind: 'finish' as const, time: f.time, cars: [f.car], lap: this.setup.laps, value: i + 1 })),
    ].sort((a, b) => a.time - b.time);
    return rec;
  }

  /** Car `id` for the race's moments: this side's cars as simulated, the other side's from their states. */
  watch(id: number, out: WatchedCar): void {
    const where = this.where(id);
    if (where.car !== undefined) {
      watchSimCar(this.sim, where.car, out);
      return;
    }
    const at = this.sim.proxies[where.proxy].current.position;
    out.x = at.x;
    out.z = at.z;
    const s = this.remotes[where.proxy].latest;
    if (!s) {
      out.speed = out.slip = out.laps = out.age = 0;
      out.lastLap = null;
      out.inLane = out.servicing = false;
      return;
    }
    out.age = Math.max(0, this.now - s.time);
    // The body slip from the newest state: its velocity against where it points.
    const v = s.velocity;
    out.speed = Math.hypot(v.x, v.z);
    out.slip = Math.atan2(dot(v, rotate(s.pose.rotation, RIGHT)), dot(v, rotate(s.pose.rotation, FORWARD)));
    out.laps = s.laps;
    out.lastLap = s.lastLap;
    out.inLane = s.inLane;
    out.servicing = s.servicing;
  }

  /** This step's hard knocks on this side's cars, by car id. */
  get knocks(): readonly { car: number; impulse: number }[] {
    this.knocksNow.length = 0;
    for (const c of this.sim.contacts) this.knocksNow.push({ car: this.idOfCar(c.car), impulse: c.impulse });
    return this.knocksNow;
  }

  /** Car `id`'s laps plus the fraction of the current one (the other side's from their states, carried on to now). */
  progressOf(id: number): number {
    return this.progress(id);
  }

  /**
   * Run the simulation up to the clock's time, asking `drive` for this player's controls each
   * step (and calling `after` after each). Returns how far into the next step the clock is
   * (0–1), for drawing in between.
   */
  advance(drive: () => Controls, after?: () => void): number {
    this.talk();
    const C = TUNING.online;
    const behind = this.clockNow() - this.now;
    const due = Math.floor(behind / PHYSICS_STEP);
    const run = Math.min(due, Math.ceil(C.catchUp / PHYSICS_STEP));
    // Far behind (a hidden tab): skip the rest rather than race through it.
    this.base += (due - run) * PHYSICS_STEP;
    for (let k = 0; k < run; k++) {
      this.step(drive());
      after?.();
    }
    return Math.max(0, Math.min(1, (this.clockNow() - this.now) / PHYSICS_STEP));
  }

  /** Ask for another race on the same circuit (it starts when both have asked). */
  requestRematch(): void {
    if (this.phase !== 'finished' || this.closed || this.rematch[ME]) return;
    this.rematch[ME] = true;
    this.link.send({ type: 'rematch' });
    this.maybeRematch();
  }

  /** Leave the race and tell the other player. */
  leave(): void {
    if (this.closed) return;
    this.link.send({ type: 'bye', reason: 'Your opponent left the race.' });
    this.link.close();
    this.closed = 'You left the race.';
  }

  /** Every car's place: finishers in the order they took the flag, then the rest by distance covered. */
  standings(): Standing[] {
    const length = this.track.length;
    const rows: Standing[] = this.finishTimes.map((time, car) => {
      const where = this.where(car);
      const timer = where.car === undefined ? null : this.sim.timers[where.car];
      return {
        car,
        position: 0,
        laps: timer ? timer.laps : (this.remotes[where.proxy!].latest?.laps ?? 0),
        progress: this.progress(car),
        gap: 0,
        lapsDown: 0,
        bestLap: timer ? timer.bestLap : this.reportedBest[car],
        finished: time !== null,
        time,
        stops: where.car === undefined ? 0 : (this.sim.pits?.state[where.car].stops ?? 0),
        penalty: where.car === undefined ? 0 : (this.sim.pits?.state[where.car].penalty ?? 0),
      };
    });
    rows.sort((a, b) => {
      if (a.finished && b.finished) return a.time! - b.time!;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.progress - a.progress;
    });
    const leader = rows[0];
    rows.forEach((r, i) => {
      r.position = i + 1;
      if (i === 0) return;
      r.lapsDown = Math.max(0, Math.floor(leader.progress - r.progress));
      if (r.finished) r.gap = r.time! - leader.time!;
      else {
        // How long ago the leader was where this car is now.
        const key = Math.floor((r.progress * length) / TUNING.online.checkpoint);
        const mine = this.reached[r.car].get(key);
        const leaders = this.reached[leader.car].get(key);
        r.gap = mine === undefined || leaders === undefined ? 0 : Math.max(0, mine - leaders);
      }
    });
    return rows;
  }

  /** Where car `id` is in this simulation: a car of its own, or a proxy. */
  private where(id: number): Where {
    if (id === ME) return { car: 0 };
    if (id === THEM) return { proxy: 0 };
    return this.setup.role === 'host' ? { car: id - 1 } : { proxy: id - 1 };
  }

  /** Car id ↔ the id on the wire (the host's car is 0 there, the guest's 1). */
  private wire(id: number): number {
    return this.setup.role === 'guest' && id < 2 ? 1 - id : id;
  }

  /** One fixed step of this side's cars, with the other side's proxies where they are reported to be. */
  private step(input: Controls): void {
    const { sim, traffic } = this;
    const held = this.held;
    // The proxies go where their cars are at the end of this step.
    this.remotes.forEach((remote, j) => {
      if (remote.sample(this.now + PHYSICS_STEP, this.proxyPose)) sim.setProxyPose(j, this.proxyPose);
      this.updateProxySolid(j);
    });
    const all = [held ? { ...input, brake: 1, handbrake: 1 } : input];
    if (traffic) {
      traffic.update(this.movers);
      this.drivers.forEach((d, k) => {
        const i = 1 + k;
        if (held) all.push(HELD);
        else {
          traffic.advise(i, d, PHYSICS_STEP, sim.timers[i].laps < 1);
          all.push(d.drive(sim.cars[i], PHYSICS_STEP));
        }
      });
    }
    sim.timers.forEach((t, k) => (this.lapsBefore[k] = t.laps));
    sim.step(all);
    this.controls = all;
    this.drivers.forEach((d, k) => {
      if (d.stuck) {
        sim.recover(1 + k);
        d.recovered();
      }
    });
    const now = this.now;
    if (this.phase === 'lights' && this.outAt !== null && now >= this.outAt - 1e-6) this.phase = 'racing';
    // States go out once they can carry the host's time (the guest's after the sync).
    if (sim.steps % TUNING.online.stateEvery === 0 && this.synced && !this.closed) sim.cars.forEach((_, k) => this.sendState(k));
    if (!held) {
      this.pitWall.update(sim, this.setup.laps, (k) => this.finishTimes[this.idOfCar(k)] !== null, [null, ...this.drivers]);
      sim.timers.forEach((t, k) => {
        if (t.laps > this.lapsBefore[k]) this.crossings[k].push(now);
        const id = this.idOfCar(k);
        this.mark(id, this.progress(id), now);
      });
      this.score();
    }
    // From the lights going out (so frame 0 is race time 0) until the race is over.
    if (this.phase === 'racing') this.record();
  }

  /** The step into the recording: the moments it brought, and every car's frame. */
  private record(): void {
    const { recorder, recorded } = this;
    const due = recorder.due;
    this.watcher.afterStep(this, due);
    if (due) {
      for (let id = 0; id < this.count; id++) {
        const s = recorded[id];
        const where = this.where(id);
        if (where.car !== undefined) {
          const k = where.car;
          const car = this.sim.cars[k];
          copyPose(this.sim.poses[k].current, s.pose);
          s.speed = car.speed;
          s.rpm = car.drivetrain.rpm;
          s.gear = car.drivetrain.gearbox.nextGear;
          s.throttle = this.controls[k]?.throttle ?? 0;
          s.brake = this.controls[k]?.brake ?? 0;
        } else {
          // Where it is drawn, with what its newest state says.
          copyPose(this.sim.proxies[where.proxy].current, s.pose);
          const latest = this.remotes[where.proxy].latest;
          s.speed = latest?.speed ?? 0;
          s.rpm = latest?.rpm ?? 0;
          s.gear = latest?.gear ?? 0;
          s.throttle = latest?.throttle ?? 0;
          s.brake = latest?.brake ?? 0;
        }
        this.progressNow[id] = this.progress(id);
      }
    }
    recorder.capture(recorded, this.progressNow);
  }

  /** A ghost while its states are stale; solid again once fresh and clear of this side's cars. */
  private updateProxySolid(j: number): void {
    const C = TUNING.online;
    const latest = this.remotes[j].latest;
    const fresh = latest !== null && this.now - latest.time < C.stale;
    if (!fresh) this.proxySolid[j] = false;
    else if (!this.proxySolid[j]) {
      const b = this.sim.proxies[j].target.position;
      this.proxySolid[j] = this.sim.cars.every((car) => {
        const a = car.position;
        return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > C.clearance;
      });
    }
    this.sim.setProxySolid(j, this.proxySolid[j]);
  }

  /** The flag for this side's cars, and the end of the race. */
  private score(): void {
    const outAt = this.outAt!;
    // When the first car took the flag (clock time), if one has.
    let first = Infinity;
    for (const t of this.finishTimes) if (t !== null) first = Math.min(first, outAt + t);
    this.sim.timers.forEach((timer, k) => {
      const id = this.idOfCar(k);
      if (this.finishTimes[id] !== null) return;
      // The race distance, or the next line after the first car took the flag (a lapped car).
      const crossings = this.crossings[k];
      const at = Math.min(crossings[this.setup.laps - 1] ?? Infinity, crossings.find((t) => t > first) ?? Infinity);
      if (!Number.isFinite(at)) return;
      // Penalties are served at the flag.
      const time = at - outAt + (this.sim.pits?.state[k].penalty ?? 0);
      this.finishTimes[id] = time;
      first = Math.min(first, at);
      if (!this.closed) this.link.send({ type: 'finish', car: this.wire(id), time, best: timer.bestLap });
    });
    const all = this.finishTimes.every((t) => t !== null);
    if (all || this.now >= first + TUNING.race.classifyAfter) this.phase = 'finished';
  }

  /** Laps plus the fraction of the current one for car `id` (negative before the first line). */
  private progress(id: number): number {
    const where = this.where(id);
    if (where.proxy !== undefined) {
      const s = this.remotes[where.proxy].latest;
      if (!s) return 0;
      // On from the newest state at its speed to now, as the car is drawn (for a moment at most).
      const ahead = Math.max(0, Math.min(MAX_EXTRAPOLATION, this.now - s.time)) * s.speed;
      return s.laps + (s.distance + ahead) / this.track.length;
    }
    const timer = this.sim.timers[where.car];
    // Along the tangent from the nearest sample, finer than the 2 m samples (as the other side's are, carried on to now).
    const { samples, length } = this.track;
    const s = samples[timer.index];
    const p = this.sim.cars[where.car].position;
    const fraction = (timer.index * (length / samples.length) + (p.x - s.x) * s.tx + (p.z - s.z) * s.tz) / length;
    if (timer.current(this.sim.time) === null) return fraction > 0.5 ? fraction - 1 : fraction;
    // Just across the line the timer has counted the lap before the position wraps: no jump back.
    return timer.laps + (fraction > 0.9 && timer.index < this.track.samples.length * 0.1 ? 0 : fraction);
  }

  /** Car `id` reached `progress` at clock time `at`: stamp the checkpoints up to there. */
  private mark(id: number, progress: number, at: number): void {
    const key = Math.floor((progress * this.track.length) / TUNING.online.checkpoint);
    const map = this.reached[id];
    for (let k = Math.max(key - 50, this.lastKey[id] + 1); k <= key; k++) if (!map.has(k)) map.set(k, at);
    this.lastKey[id] = Math.max(this.lastKey[id], key);
  }

  /** Simulated car `k`'s state to the other side. */
  private sendState(k: number): void {
    const { sim, state } = this;
    const car = sim.cars[k];
    const pose: CarPose = sim.poses[k].current;
    const id = this.idOfCar(k);
    state.time = this.now;
    Object.assign(state.pose.position, pose.position);
    Object.assign(state.pose.rotation, pose.rotation);
    pose.wheels.forEach((w, i) => Object.assign(state.pose.wheels[i], w));
    const v = car.body.linvel();
    const w = car.body.angvel();
    state.velocity = { x: v.x, y: v.y, z: v.z };
    state.angular = { x: w.x, y: w.y, z: w.z };
    state.speed = car.speed;
    state.rpm = car.drivetrain.rpm;
    state.throttle = this.controls[k]?.throttle ?? 0;
    state.laps = sim.timers[k].laps;
    state.distance = (this.progress(id) - sim.timers[k].laps) * this.track.length;
    state.gear = car.drivetrain.gearbox.nextGear;
    state.brake = this.controls[k]?.brake ?? 0;
    state.lastLap = sim.timers[k].lastLap;
    const pit = sim.pits?.state[k];
    state.inLane = pit?.inLane ?? false;
    state.servicing = pit ? pit.servicing !== null : false;
    this.link.send({ type: 'state', car: this.wire(id), data: packState(state) }, 'frames');
  }

  /** The clock now: the host's (as well as this side knows it), or this side's own before the sync. */
  private clockNow(): number {
    const local = this.options.clock();
    return this.synced ? this.sync.toHost(local) : local;
  }

  /**
   * What is due on the line: the guest's pings and the host's lights. Only from `advance`, so
   * nothing starts before this side's frames are running. (A line gone quiet is the link's to
   * notice, from its heartbeats: a player whose tab is hidden sends no states, but is still there.)
   */
  private talk(): void {
    if (this.closed) return;
    const C = TUNING.online;
    const local = this.options.clock();
    if (this.setup.role === 'guest' && this.theyAreReady && local >= this.nextPing) {
      this.link.send({ type: 'ping', t: local });
      this.pingsSent++;
      this.nextPing = local + (this.pingsSent < C.pings ? C.pingInterval : C.pingAfter);
    }
    // The host: the guest is built and knows the host's clock, and so is this side: start.
    if (this.setup.role === 'host' && this.theyAreReady && this.outAt === null) this.scheduleLights();
  }

  private receive(m: Message): void {
    if (this.closed) return;
    const local = this.options.clock();
    switch (m.type) {
      case 'ready':
        this.theyAreReady = true;
        break;
      case 'ping':
        this.link.send({ type: 'pong', t: m.t, at: this.clockNow() });
        break;
      case 'pong':
        // Every answer refines the host's clock (the steps follow it, a little faster or slower).
        this.sync.add(m.t, m.at, local);
        if (!this.synced && this.sync.samples.length >= TUNING.online.pings) {
          // From here the simulation keeps the host's time: same steps, same moment.
          this.synced = true;
          this.base = this.sync.toHost(local) - this.sim.steps * PHYSICS_STEP;
          this.link.send({ type: 'ready' });
        }
        break;
      case 'lights':
        if (this.setup.role === 'guest') this.startLights(m.outAt, m.wait);
        break;
      case 'state': {
        const id = this.wire(m.car);
        if (id >= this.count) break;
        const where = this.where(id);
        if (where.proxy === undefined) break;
        const s = unpackState(m.data, this.incoming);
        if (!s) break;
        this.remotes[where.proxy].receive(s);
        if (this.outAt !== null && s.time >= this.outAt) this.mark(id, s.laps + s.distance / this.track.length, s.time);
        break;
      }
      case 'finish': {
        const id = this.wire(m.car);
        if (id >= this.count || this.where(id).proxy === undefined || this.finishTimes[id] !== null || this.held) break;
        this.finishTimes[id] = m.time;
        this.reportedBest[id] = m.best;
        break;
      }
      case 'rematch':
        if (this.phase === 'finished') {
          this.rematch[THEM] = true;
          this.maybeRematch();
        }
        break;
      case 'bye':
        this.link.close();
        this.close(m.reason);
        break;
      case 'hello':
      case 'welcome':
      case 'reject':
        break;
    }
  }

  /** The host: both want another race, so new lights. */
  private maybeRematch(): void {
    if (this.setup.role === 'host' && this.rematch[ME] && this.rematch[THEM]) this.scheduleLights();
  }

  /** The host: lights out after the countdown and a random wait, on a step of the shared clock. */
  private scheduleLights(): void {
    const L = TUNING.race.lights;
    const wait = L.wait[0] + (L.wait[1] - L.wait[0]) * this.rng();
    const lead = L.first + (L.count - 1) * L.interval + wait;
    const outAt = this.base + Math.ceil((this.clockNow() + lead - this.base) / PHYSICS_STEP) * PHYSICS_STEP;
    this.link.send({ type: 'lights', outAt, wait });
    this.startLights(outAt, wait);
  }

  /** Back to the grid (after a race) and count down to `outAt`. */
  private startLights(outAt: number, wait: number): void {
    if (this.phase !== 'waiting') {
      this.sim.restart();
      for (const t of this.sim.timers) t.laps = 0;
      this.refuel();
      this.drivers.forEach((d) => d.reset());
      this.traffic?.reset();
      this.crossings = this.sim.cars.map(() => []);
      this.reached.forEach((r) => r.clear());
      this.lastKey.fill(-Infinity);
      this.finishTimes.fill(null);
      this.reportedBest.fill(null);
      this.rematch.fill(false);
      this.recorder.reset();
      this.watcher.reset();
    }
    // Shift the steps by under half a step so one falls exactly on the lights going out.
    this.base = outAt - Math.round((outAt - this.base) / PHYSICS_STEP) * PHYSICS_STEP;
    this.outAt = outAt;
    this.wait = wait;
    this.phase = 'lights';
  }

  private close(reason: string): void {
    if (!this.closed) this.closed = reason;
  }
}
