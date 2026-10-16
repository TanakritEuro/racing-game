// The pit wall's calls: once a lap, at the decision point before the pit entry, each car's
// tyres against the laps it has left (ai/pitStrategy.ts). A car that should stop gets the BOX
// call; an AI car acts on it by setting off for its box. Races and online races share it. Pure.

import { TUNING } from '../config';
import type { AiDriver } from '../ai/driver';
import { shouldStop, stopCost } from '../ai/pitStrategy';
import type { Simulation } from '../sim';
import { pitLane } from '../track/pitLane';

export class PitCalls {
  /** Each car should come in this lap. */
  readonly box: boolean[];
  /** Each car's wear at its last decision, and the lap it was made on. */
  private readonly log: { wear: number; lap: number }[];

  constructor(count: number) {
    this.box = Array.from({ length: count }, () => false);
    this.log = Array.from({ length: count }, () => ({ wear: 0, lap: -1 }));
  }

  /** Back to the grid: new tyres, no calls. */
  reset(): void {
    this.box.fill(false);
    for (const r of this.log) {
      r.wear = 0;
      r.lap = -1;
    }
  }

  /**
   * After a step: `laps` in the race, `finished[k]` car k has taken the flag, `drivers[k]` its
   * AI (or null for a player's car).
   */
  update(sim: Simulation, laps: number, finished: (k: number) => boolean, drivers: readonly (AiDriver | null | undefined)[]): void {
    const { track } = sim;
    const lane = pitLane(track);
    if (!lane || !sim.pits || sim.car.wearRate === 0) return;
    const A = TUNING.ai.pits;
    const n = track.samples.length;
    const spacing = track.length / n;
    sim.cars.forEach((car, k) => {
      const timer = sim.timers[k];
      const rec = this.log[k];
      const toEntry = ((lane.first - timer.index + n) % n) * spacing;
      // Past the entry: the call has been answered (or ignored).
      if (toEntry > A.decide + 50) this.box[k] = false;
      if (toEntry > A.decide || toEntry < A.decide - 40 || rec.lap === timer.laps || finished(k)) return;
      rec.lap = timer.laps;
      const wear = Math.max(...car.wheels.map((w) => w.wear));
      // Wear since the last lap's decision (the first time, since the start: about a lap).
      const perLap = Math.max(0, wear - rec.wear);
      rec.wear = wear;
      const lapTime = timer.lastLap ?? track.length / 45;
      const stop = shouldStop({ wear, perLap, lapsLeft: laps - (timer.laps + 1), lapTime, stopCost: stopCost(lane, track.length / lapTime) });
      this.box[k] = stop;
      const d = drivers[k];
      if (stop && d && !d.pit) d.pit = { lane, state: sim.pits!.state[k], leaving: false };
    });
  }
}
