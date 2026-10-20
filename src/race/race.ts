// A race: the player (car 0) and AI opponents from a staggered grid, a standing start on
// five red lights, positions from laps and distance, and a finish when the leader has done
// the laps and everyone else has completed the lap they were on. Pure simulation.

import { TUNING } from '../config';
import { PHYSICS_STEP } from '../constants';
import { createAiDriver, type AiDriver } from '../ai/driver';
import { fieldSkills, type Difficulty, type Skill } from '../ai/skill';
import { Traffic } from '../ai/traffic';
import { createRng } from '../math';
import { Simulation } from '../sim';
import type { Track } from '../track/track';
import { controls, type Controls } from '../vehicle/car';
import type { CarDef } from '../vehicle/carDef';
import { KESTREL } from '../vehicle/cars';
import type { Conditions } from '../track/weather';
import type { WearRate } from '../vehicle/wear';
import { PitCalls } from './pitCalls';
import { MomentWatcher } from './raceMoments';
import { RaceRecorder } from './raceRecording';
import { createRecordedState, type RecordedState } from './recording';
import { copyPose } from '../vehicle/pose';

export interface RaceOptions {
  /** AI cars (0–7). */
  opponents: number;
  laps: number;
  difficulty: Difficulty;
  seed: number;
  /** The player's grid slot (0 = pole); by default the middle of the field. */
  playerSlot?: number;
  /** A championship round: every car's grid slot and the AI's skills (null for the player), instead of drawing them. */
  slots?: readonly number[];
  skills?: readonly (Skill | null)[];
  /** The weather (default dry). */
  conditions?: Conditions;
  /** How fast tyres wear (default off). */
  wear?: WearRate;
}

/** Fuel for `laps` of `track` in `def` (kg), with its margin. */
export function raceFuel(def: CarDef, track: Track, laps: number): number {
  return ((laps + 1) * track.length * def.fuel.perKm) / 1000;
}

export const DEFAULT_RACE: Readonly<RaceOptions> = { opponents: 7, laps: 3, difficulty: 'medium', seed: 1 };

/** Invented drivers for the AI cars. */
export const AI_NAMES = ['Ada Brennan', 'Tomas Vile', 'Kit Okoro', 'Ines Lund', 'Raf Sorel', 'Mila Haskett', 'Juno Pell'];

export type RacePhase = 'lights' | 'racing' | 'finished';

export interface Standing {
  /** Index into `sim.cars` (0 is the player). */
  car: number;
  position: number;
  /** Laps completed. */
  laps: number;
  /** Laps completed plus the fraction of the current one (negative before the first line crossing). */
  progress: number;
  /** Seconds behind the leader (on the road, or at the flag), and whole laps behind. */
  gap: number;
  lapsDown: number;
  bestLap: number | null;
  finished: boolean;
  /** Race time at the flag (s), penalties included. */
  time: number | null;
  /** Pit stops made, and penalty seconds. */
  stops: number;
  penalty: number;
}

/** An AI car on the grid. */
const HELD: Controls = controls({ brake: 1 });

/** Distance between the checkpoints the gaps are timed at (m). */
const CHECKPOINT = 20;

export class Race {
  readonly sim: Simulation;
  /** One per car: null for the player. */
  readonly drivers: (AiDriver | null)[];
  readonly skills: (Skill | null)[];
  readonly traffic: Traffic;
  phase: RacePhase = 'lights';
  /** Simulation time the lights went out, or null before. */
  startTime: number | null = null;
  /** Race time each car took the flag (s), or null. */
  readonly finishTimes: (number | null)[];
  /** When the leader finished (simulation time), or null. */
  private leaderDone: number | null = null;
  private lightsOutAt: number;
  /** Every car's controls on the last step (for the sound of their engines). */
  controls: readonly Controls[] = [];
  /** AI cars put back on the track so far (stuck, spun into a gravel trap). */
  recoveries = 0;
  /** Every car through the race, and its moments, for the replay. */
  readonly recorder: RaceRecorder;
  private readonly watcher: MomentWatcher;
  private readonly states: RecordedState[];
  /** Simulation time the countdown began. */
  private gridTime = 0;
  /** Laps each car had done when the leader took the flag. */  /** The first time any car reached each checkpoint (simulation time). */
  private readonly checkpoints = new Map<number, number>();
  private readonly rng;

  /** `def`: the AI's car; `playerDef`: the player's (the same car with their setup). */
  constructor(
    readonly track: Track,
    readonly options: RaceOptions = DEFAULT_RACE,
    def: CarDef = KESTREL,
    playerDef: CarDef = def,
  ) {
    const count = 1 + Math.max(0, Math.min(AI_NAMES.length, options.opponents));
    const playerSlot = Math.min(count - 1, options.playerSlot ?? Math.floor(count / 2));
    // The player in their slot; the AI in the others, in order (unless a championship says).
    const slots = options.slots?.slice(0, count) ?? [playerSlot, ...Array.from({ length: count }, (_, s) => s).filter((s) => s !== playerSlot)];
    this.sim = new Simulation(track, def, { cars: count, slots, defs: [playerDef], conditions: options.conditions, wear: options.wear });
    this.pitWall = new PitCalls(count);
    this.refuel();
    this.rng = createRng(options.seed);
    const skills = fieldSkills(options.difficulty, count - 1, this.rng);
    this.skills = options.skills ? options.skills.slice(0, count).map((s, k) => (k === 0 ? null : s)) : [null, ...skills];
    this.drivers = this.skills.map((s, k) => (s ? createAiDriver(track, def, s, options.seed * 100 + k, options.conditions) : null));
    this.traffic = new Traffic(track, this.sim.cars, def);
    this.finishTimes = this.sim.cars.map(() => null);
    this.lightsOutAt = this.drawLightsOut();
    this.recorder = new RaceRecorder(track.def.id, this.sim.cars.map((c) => c.def.name), options.laps);
    this.watcher = new MomentWatcher(this.recorder, count);
    this.states = this.sim.cars.map(() => createRecordedState());
  }

  /** Laps in the race. */
  get laps(): number {
    return this.options.laps;
  }

  /** The pit wall's BOX calls (the AI acts on its own). */
  readonly pitWall: PitCalls;
  /** Each car should come in this lap. */
  get boxCalls(): readonly boolean[] {
    return this.pitWall.box;
  }

  /** Every car fuelled for the race, on fresh tyres. */
  private refuel(): void {
    this.pitWall.reset();
    for (const car of this.sim.cars) {
      car.setFuel(raceFuel(car.def, this.track, this.options.laps));
      car.changeTyres();
    }
  }

  /** Lights lit (0–5) during the countdown; 0 once they are out. */
  get lights(): number {
    if (this.phase !== 'lights') return 0;
    const L = TUNING.race.lights;
    return Math.max(0, Math.min(L.count, Math.floor((this.sim.time - this.gridTime - L.first) / L.interval) + 1));
  }

  /** Race time (s) since the lights went out, or null before. */
  get time(): number | null {
    return this.startTime === null ? null : this.sim.time - this.startTime;
  }

  /** Back to the grid, lights and all. */
  restart(): void {
    this.sim.restart();
    for (const t of this.sim.timers) t.laps = 0;
    this.refuel();
    this.gridTime = this.sim.time;
    this.drivers.forEach((d) => d?.reset());
    this.traffic.reset();
    this.phase = 'lights';
    this.startTime = null;
    this.leaderDone = null;
    this.finishTimes.fill(null);
    this.checkpoints.clear();
    this.lightsOutAt = this.drawLightsOut();
    this.recorder.reset();
    this.watcher.reset();
  }

  /** One step: the player's controls, the AI's own, and the race around them. */
  step(player: Controls): void {
    const { sim } = this;
    const held = this.phase === 'lights';
    this.traffic.update(sim.cars);
    const all = this.drivers.map((d, k) => {
      // On the grid every car is held on its brakes. The player may rev: the handbrake holds
      // the rear wheels too, and lets the clutch go.
      if (!d) return held ? { ...player, brake: 1, handbrake: 1 } : player;
      if (held) return HELD;
      this.traffic.advise(k, d, PHYSICS_STEP, sim.timers[k].laps < 1);
      return d.drive(sim.cars[k], PHYSICS_STEP);
    });
    sim.step(all);
    this.controls = all;
    if (this.phase === 'racing') this.pitWall.update(sim, this.options.laps, (k) => this.finishTimes[k] !== null, this.drivers);
    this.drivers.forEach((d, k) => {
      if (d?.stuck) {
        this.recoveries++;
        sim.recover(k);
        d.recovered();
      }
    });
    if (held && sim.time >= this.lightsOutAt) {
      this.phase = 'racing';
      this.startTime = sim.time;
    }
    if (this.phase === 'racing') {
      this.score();
      this.record();
    }
  }

  /** The step into the recording: the moments it brought, and every car's frame. */
  private record(): void {
    const { sim, recorder } = this;
    const due = recorder.due;
    this.watcher.afterStep(this, due);
    if (!due) {
      recorder.capture(this.states, this.progressNow);
      return;
    }
    sim.cars.forEach((car, k) => {
      const s = this.states[k];
      copyPose(sim.poses[k].current, s.pose);
      s.speed = car.speed;
      s.rpm = car.drivetrain.rpm;
      s.gear = car.drivetrain.gearbox.nextGear;
      s.throttle = this.controls[k]?.throttle ?? 0;
      s.brake = this.controls[k]?.brake ?? 0;
      this.progressNow[k] = this.progressOf(k);
    });
    recorder.capture(this.states, this.progressNow);
  }

  private readonly progressNow: number[] = [];

  /** Every car's place: finishers in the order they took the flag, then the rest by progress. */
  standings(): Standing[] {
    const { sim } = this;
    const now = sim.time;
    const rows = sim.cars.map((_, k) => {
      const timer = sim.timers[k];
      const progress = this.progressOf(k);
      return {
        car: k,
        position: 0,
        laps: timer.laps,
        progress,
        gap: 0,
        lapsDown: 0,
        bestLap: timer.bestLap,
        finished: this.finishTimes[k] !== null,
        time: this.finishTimes[k],
        stops: sim.pits?.state[k].stops ?? 0,
        penalty: sim.pits?.state[k].penalty ?? 0,
      };
    });
    rows.sort((a, b) => {
      if (a.finished && b.finished) return b.laps - a.laps || a.time! - b.time!;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.progress - a.progress;
    });
    const leader = rows[0];
    rows.forEach((r, i) => {
      r.position = i + 1;
      r.lapsDown = Math.max(0, Math.floor(leader.progress - r.progress));
      if (r.finished && leader.finished) r.gap = r.time! - leader.time!;
      else {
        // On the road: how long ago the leader was where this car is now.
        const at = this.checkpoints.get(Math.floor((r.progress * this.track.length) / CHECKPOINT));
        r.gap = at === undefined ? 0 : now - at;
      }
    });
    // Checkpoints are 20 m apart: measure from the leader's own reading, so the leader reads 0.
    if (!leader.finished) {
      const base = leader.gap;
      for (const r of rows) if (!r.finished) r.gap = Math.max(0, r.gap - base);
    }
    return rows;
  }

  /** Car `k`'s laps completed plus the fraction of the current lap (negative until the line). */
  progressOf(k: number): number {
    const timer = this.sim.timers[k];
    const pos = this.traffic.positions[k];
    const fraction = pos.distance / this.track.length;
    if (timer.current(this.sim.time) === null) return fraction > 0.5 ? fraction - 1 : fraction;
    // Just across the line the timer has counted the lap before the position wraps: no jump back.
    return timer.laps + (fraction > 0.9 && timer.index < this.track.samples.length * 0.1 ? 0 : fraction);
  }

  /** Checkpoints for the gaps, the flag, and classification. */
  private score(): void {
    const { sim, options } = this;
    const now = sim.time;
    sim.cars.forEach((_, k) => {
      const key = Math.floor((this.progressOf(k) * this.track.length) / CHECKPOINT);
      if (!this.checkpoints.has(key)) this.checkpoints.set(key, now);
      if (this.finishTimes[k] !== null) return;
      const laps = sim.timers[k].laps;
      // The leader takes the flag after the race distance; everyone else on their next line crossing.
      if (laps >= options.laps || (this.leaderDone !== null && laps > this.lapsAtLeaderFinish[k])) {
        // Penalties are served at the flag.
        this.finishTimes[k] = now - this.startTime! + (sim.pits?.state[k].penalty ?? 0);
        if (this.leaderDone === null) {
          this.leaderDone = now;
          this.lapsAtLeaderFinish = sim.timers.map((t) => t.laps);
        }
      }
    });
    const classifyAll = this.leaderDone !== null && now - this.leaderDone > TUNING.race.classifyAfter;
    if (this.finishTimes.every((t) => t !== null) || classifyAll) this.phase = 'finished';
  }

  private lapsAtLeaderFinish: number[] = [];

  /** When the lights will go out: all five lit, then a random wait. */
  private drawLightsOut(): number {
    const L = TUNING.race.lights;
    return this.gridTime + L.first + (L.count - 1) * L.interval + L.wait[0] + (L.wait[1] - L.wait[0]) * this.rng();
  }
}
