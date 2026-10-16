// When to stop for tyres. A car on worn tyres loses time every lap (lap time grows roughly as
// one over the square root of its grip), more each lap as they wear on; a stop costs the time
// through the pit lane at the limit, slowing and the service. Of stopping at the end of this
// lap, of a later one, or not at all, pick the quickest: stop now if that's now (or if these
// tyres would go over the cliff before the next chance). The AI decides with it, and it calls
// the player's BOX. Pure.

import { TUNING } from '../config';
import type { PitLane } from '../track/pitLane';
import { wearGrip } from '../vehicle/wear';

export interface StopQuestion {
  /** The most worn tyre's wear now, and how much it wears a lap. */
  wear: number;
  perLap: number;
  /** Laps still to run after this one. */
  lapsLeft: number;
  /** A normal lap's time (s). */
  lapTime: number;
  /** What a stop costs (s). */
  stopCost: number;
}

/** Time lost over `laps` laps to tyres starting at `wear`, wearing `perLap` a lap (s). */
export function wearLoss(wear: number, perLap: number, laps: number, lapTime: number): number {
  let loss = 0;
  for (let j = 0; j < laps; j++) loss += lapTime * (1 / Math.sqrt(wearGrip(wear + perLap * (j + 0.5))) - 1);
  return loss;
}

export function shouldStop(q: StopQuestion): boolean {
  if (q.lapsLeft < 1 || q.perLap <= 0) return false;
  // Over the cliff before the next chance: stop now.
  if (q.wear + q.perLap * TUNING.ai.pits.cliffMargin >= TUNING.wear.cliff) return true;
  // The quickest of: stopping after this lap and j more on these tyres (j = 0 is now), or not at all.
  const never = wearLoss(q.wear, q.perLap, q.lapsLeft, q.lapTime);
  let best = never;
  let bestLap = q.lapsLeft;
  for (let j = 0; j < q.lapsLeft; j++) {
    const total = wearLoss(q.wear, q.perLap, j, q.lapTime) + q.stopCost + wearLoss(0, q.perLap, q.lapsLeft - j, q.lapTime);
    if (total < best) {
      best = total;
      bestLap = j;
    }
  }
  return bestLap === 0;
}

/** What a stop costs on `lane` (s), for a car averaging `pace` m/s round the lap. */
export function stopCost(lane: PitLane, pace: number): number {
  const P = TUNING.pits;
  return lane.length / P.limit - lane.length / Math.max(pace, P.limit) + P.service + TUNING.ai.pits.inAndOut;
}
