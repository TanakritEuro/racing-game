// A run of a rally stage: a countdown with the car held on the line (rev it if you like: it
// goes at zero), the clock started at the countdown's zero, splits at a third and two thirds
// of the road, and the clock stopped at the flying finish. Put back
// on the road, the car takes a time penalty, not a void run. The lap timer does the timing and
// the time-trial session the recording and ghost, as on a circuit. Pure simulation.

import { TUNING } from '../config';
import type { Simulation } from '../sim';
import type { Controls } from '../vehicle/car';

export type StagePhase = 'countdown' | 'running' | 'finished';

export class StageRun {
  phase: StagePhase = 'countdown';
  /** Time penalties so far (s). */
  penalties = 0;
  /** The run's time (s, penalties included) once finished. */
  result: number | null = null;
  /** Simulation time the countdown began. */
  private countdownFrom: number;
  private laps: number;

  constructor(readonly sim: Simulation) {
    if (sim.track.closed) throw new Error('A stage run needs an open road');
    this.countdownFrom = sim.time;
    this.laps = sim.timer.laps;
  }

  /** Seconds to the start (counting down), or 0 once running. */
  get countdown(): number {
    return this.phase === 'countdown' ? Math.max(0, TUNING.stage.countdown - (this.sim.time - this.countdownFrom)) : 0;
  }

  /** The clock (s, penalties included), or null before the start. */
  get clock(): number | null {
    return this.phase === 'finished' ? this.result : this.sim.timer.current(this.sim.time);
  }

  /** One step with the driver's controls. In the countdown the car is held on its brakes (the engine may rev). */
  step(c: Controls): void {
    const { sim } = this;
    if (this.phase === 'countdown') {
      sim.step({ ...c, brake: 1, handbrake: 1 });
      if (sim.time - this.countdownFrom >= TUNING.stage.countdown) {
        this.phase = 'running';
        sim.timer.startLap(sim.time);
      }
      return;
    }
    sim.step(c);
    if (this.phase === 'running' && sim.timer.laps !== this.laps) {
      this.laps = sim.timer.laps;
      this.phase = 'finished';
      this.result = sim.timer.lastLap;
    }
  }

  /** Put the car back on the road (a time penalty), as R does. */
  recover(): void {
    this.sim.recover();
    if (this.phase !== 'running') return;
    this.penalties += TUNING.stage.penalty;
    this.sim.timer.addPenalty(TUNING.stage.penalty);
  }

  /** Back to the start line for another run (the bests are kept). */
  restart(): void {
    this.sim.restart();
    this.phase = 'countdown';
    this.countdownFrom = this.sim.time;
    this.penalties = 0;
    this.result = null;
    this.laps = this.sim.timer.laps;
  }
}
