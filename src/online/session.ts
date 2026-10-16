// An online race between two browsers. Each simulates only its own car and sends that car's
// state 30 times a second; the other car is a proxy in its simulation, placed where the other
// player's states say it is now (remoteCar.ts).
//
// The order of things:
//   1. Handshake (before either side builds the circuit): the guest says hello with its version
//      and car, the host answers with the circuit, the laps and its own car.
//   2. Each side builds its world and starts an `OnlineRace`; the host says it is ready. The
//      guest then times a dozen pings to learn the host's clock, and says it is ready too.
//   3. The host schedules the lights to go out at a moment on its clock. From then on both
//      simulations step in time with that clock, their steps falling at the same moments, so
//      both cars are released on the same step and both race times run from the same instant.
//   4. Each side times its own laps and reports its finishing time; both compare the same two
//      times, so both agree on the result.
//   5. Rematch (both ask, the host schedules new lights) or leave.
//
// The clock is passed in (seconds), so tests run two of these over a loopback on a virtual one.

import { TUNING } from '../config';
import { PHYSICS_STEP } from '../constants';
import { createRng } from '../math';
import type { Standing } from '../race/race';
import { Simulation } from '../sim';
import type { Track } from '../track/track';
import { restingPose, type Controls } from '../vehicle/car';
import type { CarDef } from '../vehicle/carDef';
import { createPose } from '../vehicle/pose';
import { ClockSync } from './clock';
import type { Link } from './link';
import { parseMessage, PROTOCOL, type Message } from './protocol';
import { RemoteCar } from './remoteCar';
import { createState, packState, unpackState, type CarState } from './state';

export type Role = 'host' | 'guest';

/** What the handshake agreed. */
export interface OnlineSetup {
  role: Role;
  /** Circuit id and laps (the host's choice). */
  track: string;
  laps: number;
  /** This player's car and the other's (car names). */
  mine: string;
  theirs: string;
  /** Messages that arrived after the handshake, before the race was built: the race reads them first. */
  inbox: Message[];
}

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
export function hostHandshake(link: Link, race: { track: string; laps: number; car: string }, cars: readonly string[]): Promise<OnlineSetup> {
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
      link.send({ type: 'welcome', track: race.track, laps: race.laps, car: race.car });
      resolve(buffered(link, { role: 'host', track: race.track, laps: race.laps, mine: race.car, theirs: m.car }));
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
        if (!tracks.includes(m.track) || !cars.includes(m.car)) {
          const reason = 'The host chose a circuit or car this version does not have: reload both pages.';
          link.send({ type: 'bye', reason });
          link.close();
          reject(new OnlineError(reason));
          return;
        }
        resolve(buffered(link, { role: 'guest', track: m.track, laps: m.laps, mine: car, theirs: m.car }));
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
  /** For the wait before the lights go out (the host draws it). */
  seed?: number;
}

/** Car 0 is this player's, car 1 the other's. */
const ME = 0;
const THEM = 1;

export class OnlineRace {
  readonly sim: Simulation;
  /** The other car's states, turned into where it is now. */
  readonly remote = new RemoteCar();
  /** The guest's estimate of the host's clock (the host's own offset stays 0). */
  readonly sync = new ClockSync();
  phase: OnlinePhase = 'waiting';
  /** Why the race ended early (the other player left, the line went quiet), or null. */
  closed: string | null = null;
  /** Race time each car took the flag (s), or null: this player's, then the other's. */
  readonly finishTimes: [number | null, number | null] = [null, null];
  /** The other car's best lap, as it reported at the flag. */
  theirBest: number | null = null;
  /** Who wants a rematch: this player, the other. */
  readonly rematch: [boolean, boolean] = [false, false];
  /** The moment the lights go out on the host's clock (s), or null before it is set. */
  outAt: number | null = null;
  /** This player's controls on the last step (held on the grid). */
  controls: Controls | null = null;

  private wait = 0;
  /** Clock time (host's once synced, local before) at simulation step 0. */
  private base: number;
  private synced: boolean;
  private theyAreReady = false;
  private pingsSent = 0;
  private nextPing = 0;
  private lastHeard: number;
  /** Clock time this player completed each lap. */
  private crossings: number[] = [];
  /** The first clock time each car reached each checkpoint, and the last checkpoint marked. */
  private readonly reached = [new Map<number, number>(), new Map<number, number>()];
  private readonly lastKey = [-Infinity, -Infinity];
  private readonly rng;
  private readonly proxyPose = createPose();
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
    // The host on pole, the guest beside it.
    const slots = setup.role === 'host' ? [0, 1] : [1, 0];
    this.sim = new Simulation(track, mine, { cars: 1, slots: [slots[0]], field: 2 });
    this.sim.addProxy(theirs, restingPose(theirs, this.sim.slotPose(slots[1])));
    this.rng = createRng(options.seed ?? 1);
    this.synced = setup.role === 'host';
    const now = options.clock();
    this.base = now;
    this.lastHeard = now;
    link.onMessage = (raw) => {
      const m = parseMessage(raw);
      if (m) this.receive(m);
    };
    link.onClose = (reason) => this.close(reason);
    for (const m of setup.inbox.splice(0)) this.receive(m);
    if (setup.role === 'host') link.send({ type: 'ready' });
  }

  /** On the grid: held on the brakes (revving allowed) until the lights go out. */
  get held(): boolean {
    return this.phase === 'waiting' || this.phase === 'lights';
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

  /** The other car's latest state (speed, RPM, throttle for the HUD and its sound), or null. */
  get theirs(): CarState | null {
    return this.remote.latest;
  }

  /**
   * Run the simulation up to the clock's time, asking `drive` for this player's controls each
   * step. Returns how far into the next step the clock is (0–1), for drawing in between.
   */
  advance(drive: () => Controls): number {
    this.talk();
    const C = TUNING.online;
    const behind = this.clockNow() - this.now;
    const due = Math.floor(behind / PHYSICS_STEP);
    const run = Math.min(due, Math.ceil(C.catchUp / PHYSICS_STEP));
    // Far behind (a hidden tab): skip the rest rather than race through it.
    this.base += (due - run) * PHYSICS_STEP;
    for (let k = 0; k < run; k++) this.step(drive());
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

  /** Both cars' places: finishers by time, then the rest by distance covered. Car 0 is this player's. */
  standings(): Standing[] {
    const length = this.track.length;
    const rows: Standing[] = [ME, THEM].map((car) => ({
      car,
      position: 0,
      laps: car === ME ? this.sim.timer.laps : (this.theirs?.laps ?? 0),
      progress: this.progress(car),
      gap: 0,
      lapsDown: 0,
      bestLap: car === ME ? this.sim.timer.bestLap : this.theirBest,
      finished: this.finishTimes[car] !== null,
      time: this.finishTimes[car],
    }));
    rows.sort((a, b) => {
      if (a.finished && b.finished) return a.time! - b.time!;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.progress - a.progress;
    });
    const [leader, other] = rows;
    leader.position = 1;
    other.position = 2;
    other.lapsDown = Math.max(0, Math.floor(leader.progress - other.progress));
    if (other.finished) other.gap = other.time! - leader.time!;
    else {
      // How long ago the leader was where the other car is now.
      const key = Math.floor((other.progress * length) / TUNING.online.checkpoint);
      const theirs = this.reached[other.car].get(key);
      const leaders = this.reached[leader.car].get(key);
      other.gap = theirs === undefined || leaders === undefined ? 0 : Math.max(0, theirs - leaders);
    }
    return rows;
  }

  /** One fixed step of this player's car, with the other's proxy where it is reported to be. */
  private step(input: Controls): void {
    const { sim } = this;
    const controls = this.held ? { ...input, brake: 1, handbrake: 1 } : input;
    // The proxy goes where the other car is at the end of this step.
    if (this.remote.sample(this.now + PHYSICS_STEP, this.proxyPose)) sim.setProxyPose(0, this.proxyPose);
    const laps = sim.timer.laps;
    sim.step(controls);
    this.controls = controls;
    const now = this.now;
    if (this.phase === 'lights' && this.outAt !== null && now >= this.outAt - 1e-6) this.phase = 'racing';
    // States go out once they can carry the host's time (the guest's after the sync).
    if (sim.steps % TUNING.online.stateEvery === 0 && this.synced && !this.closed) this.sendState();
    if (this.held) return;
    if (sim.timer.laps > laps) this.crossings.push(now);
    this.mark(ME, this.progress(ME), now);
    this.score();
  }

  /** The flag for this player, and the end of the race. */
  private score(): void {
    const outAt = this.outAt!;
    if (this.finishTimes[ME] === null) {
      // The race distance, or the next line after the other car took the flag (a lapped car).
      const theirsAt = this.finishTimes[THEM] === null ? null : outAt + this.finishTimes[THEM];
      const candidates = [this.crossings[this.setup.laps - 1], theirsAt === null ? undefined : this.crossings.find((t) => t > theirsAt)];
      const at = Math.min(...candidates.filter((t): t is number => t !== undefined));
      if (Number.isFinite(at)) {
        this.finishTimes[ME] = at - outAt;
        if (!this.closed) this.link.send({ type: 'finish', time: at - outAt, best: this.sim.timer.bestLap });
      }
    }
    const done = this.finishTimes.filter((t): t is number => t !== null);
    if (done.length === 2 || (done.length === 1 && this.now >= outAt + done[0] + TUNING.race.classifyAfter)) this.phase = 'finished';
  }

  /** Laps plus the fraction of the current one for car `car` (negative before the first line). */
  private progress(car: number): number {
    if (car === THEM) {
      const s = this.theirs;
      return s ? s.laps + s.distance / this.track.length : 0;
    }
    const timer = this.sim.timer;
    const fraction = timer.index / this.track.samples.length;
    if (timer.current(this.sim.time) === null) return fraction > 0.5 ? fraction - 1 : fraction;
    // Just across the line the timer has counted the lap before the position wraps: no jump back.
    return timer.laps + (fraction > 0.9 && timer.index < this.track.samples.length * 0.1 ? 0 : fraction);
  }

  /** Car `car` reached `progress` at clock time `at`: stamp the checkpoints up to there. */
  private mark(car: number, progress: number, at: number): void {
    const key = Math.floor((progress * this.track.length) / TUNING.online.checkpoint);
    const map = this.reached[car];
    for (let k = Math.max(key - 50, this.lastKey[car] + 1); k <= key; k++) if (!map.has(k)) map.set(k, at);
    this.lastKey[car] = Math.max(this.lastKey[car], key);
  }

  private sendState(): void {
    const { sim, state } = this;
    state.time = this.now;
    Object.assign(state.pose.position, sim.current.position);
    Object.assign(state.pose.rotation, sim.current.rotation);
    sim.current.wheels.forEach((w, i) => Object.assign(state.pose.wheels[i], w));
    const v = sim.car.body.linvel();
    const w = sim.car.body.angvel();
    state.velocity = { x: v.x, y: v.y, z: v.z };
    state.angular = { x: w.x, y: w.y, z: w.z };
    state.speed = sim.car.speed;
    state.rpm = sim.car.drivetrain.rpm;
    state.throttle = this.controls?.throttle ?? 0;
    state.laps = sim.timer.laps;
    state.distance = (this.progress(ME) - sim.timer.laps) * this.track.length;
    this.link.send({ type: 'state', car: 0, data: packState(state) }, 'frames');
  }

  /** The clock now: the host's (as well as this side knows it), or this side's own before the sync. */
  private clockNow(): number {
    const local = this.options.clock();
    return this.synced ? this.sync.toHost(local) : local;
  }

  /** What is due on the line: the guest's pings, and noticing a line gone quiet. */
  private talk(): void {
    if (this.closed) return;
    const C = TUNING.online;
    const local = this.options.clock();
    if (this.theyAreReady && local - this.lastHeard > C.quiet) {
      this.link.close();
      this.close('The connection to your opponent was lost.');
      return;
    }
    if (this.setup.role === 'guest' && this.theyAreReady && local >= this.nextPing) {
      this.link.send({ type: 'ping', t: local });
      this.pingsSent++;
      this.nextPing = local + (this.pingsSent < C.pings ? C.pingInterval : C.pingAfter);
    }
  }

  private receive(m: Message): void {
    if (this.closed) return;
    const local = this.options.clock();
    this.lastHeard = local;
    switch (m.type) {
      case 'ready':
        this.theyAreReady = true;
        // The guest is built and knows the host's clock: start.
        if (this.setup.role === 'host' && this.outAt === null) this.scheduleLights();
        break;
      case 'ping':
        this.link.send({ type: 'pong', t: m.t, at: this.clockNow() });
        break;
      case 'pong':
        // Every answer refines the host's clock (the steps follow it, a little faster or slower).
        this.sync.add(m.t, m.at, local);
        if (!this.synced && this.sync.samples.length >= TUNING.online.pings) {
          // From here the simulation keeps the host's time: same steps, same moment.
          const steps = this.sim.steps * PHYSICS_STEP;
          this.synced = true;
          this.base = this.sync.toHost(local) - steps;
          this.link.send({ type: 'ready' });
        }
        break;
      case 'lights':
        if (this.setup.role === 'guest') this.startLights(m.outAt, m.wait);
        break;
      case 'state': {
        if (m.car !== 0) break;
        const s = unpackState(m.data, this.incoming);
        if (!s) break;
        this.remote.receive(s);
        if (this.outAt !== null && s.time >= this.outAt) this.mark(THEM, s.laps + s.distance / this.track.length, s.time);
        break;
      }
      case 'finish':
        if (this.finishTimes[THEM] === null && !this.held) {
          this.finishTimes[THEM] = m.time;
          this.theirBest = m.best;
        }
        break;
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
      this.sim.timer.laps = 0;
      this.crossings = [];
      this.reached.forEach((r) => r.clear());
      this.lastKey.fill(-Infinity);
      this.finishTimes.fill(null);
      this.theirBest = null;
      this.rematch.fill(false);
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
