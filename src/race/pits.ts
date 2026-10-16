// Pit stops, for every car on a circuit with a pit lane. In the lane past the limit line, a
// limiter cuts the throttle above the pit speed limit (a car that crosses the line too fast
// is given a time penalty); a car that stops in its box is held on its brakes while the crew
// changes its tyres, then let go. It reads where each car is and adjusts its controls before
// the step; nothing else about the car is touched. Pure simulation.

import { TUNING } from '../config';
import { boxOffset, laneAlong, laneEdges, type PitLane } from '../track/pitLane';
import { lateralOffset, nearestSample, type Track } from '../track/track';
import type { Car, Controls } from '../vehicle/car';

export interface PitState {
  /** In the pit lane (off the racing road, on the lane's side, along its stretch). */
  inLane: boolean;
  /** Past the limit lines: the limiter is on. */
  limited: boolean;
  /** This car's box (index into the lane's boxes). */
  box: number;
  /** Seconds of service left while stopped in the box, or null. */
  servicing: number | null;
  /** Stops made, and penalty seconds to add at the flag. */
  stops: number;
  penalty: number;
  /** Already penalised on this visit to the lane; served in the box on this visit. */
  caught: boolean;
  served: boolean;
  /** Nearest track sample (kept as a hint). */
  index: number;
}

export class PitStops {
  readonly state: PitState[];
  private readonly held: Controls = { throttle: 0, brake: 1, steer: 0, clutch: 0, shift: 0, handbrake: 1 };
  private readonly limited: Controls = { throttle: 0, brake: 0, steer: 0, clutch: 0, shift: 0, handbrake: 0 };

  /** `boxes[i]`: car i's box. */
  constructor(
    private readonly track: Track,
    private readonly lane: PitLane,
    boxes: readonly number[],
  ) {
    this.state = boxes.map((box) => ({ inLane: false, limited: false, box: box % lane.boxes.length, servicing: null, stops: 0, penalty: 0, caught: false, served: false, index: -1 }));
  }

  /** Before car `i`'s step: its controls as the pit lane allows them. */
  control(i: number, car: Car, wanted: Controls): Controls {
    const st = this.state[i];
    this.locate(st, car);
    if (st.servicing !== null) return this.held;
    if (st.limited && car.speed > TUNING.pits.limit - TUNING.pits.limiterBand && wanted.throttle > 0) {
      const c = this.limited;
      Object.assign(c, wanted);
      c.throttle = 0;
      return c;
    }
    return wanted;
  }

  /** After the step (`dt` seconds): penalties, and the stop in the box. */
  after(i: number, car: Car, dt: number): void {
    const P = TUNING.pits;
    const st = this.state[i];
    if (!st.inLane) {
      st.caught = st.served = false;
      st.servicing = null;
      return;
    }
    if (st.limited && !st.caught && car.speed > P.limit + P.tolerance) {
      st.caught = true;
      st.penalty += P.penalty;
    }
    if (st.servicing !== null) {
      st.servicing -= dt;
      if (st.servicing <= 0) {
        st.servicing = null;
        st.served = true;
        st.stops++;
        car.changeTyres();
      }
      return;
    }
    if (!st.served && Math.abs(car.speed) < P.stopSpeed && this.inBox(st, car)) st.servicing = P.service;
  }

  /** Car `i` was put back on the track, or the race restarted: out of the lane, nothing pending. */
  reset(i: number, clearRecord = false): void {
    const st = this.state[i];
    st.servicing = null;
    st.inLane = st.limited = st.caught = st.served = false;
    st.index = -1;
    if (clearRecord) st.stops = st.penalty = 0;
  }

  /** Where car `st` is along and across the road, and whether that's in the lane. */
  private locate(st: PitState, car: Car): void {
    const { track, lane } = this;
    const p = car.position;
    st.index = nearestSample(track, p.x, p.z, st.index < 0 ? undefined : st.index);
    const u = laneAlong(track, lane, st.index);
    const edges = laneEdges(track, lane, st.index);
    const beyond = lane.sign * lateralOffset(track, st.index, p.x, p.z) - track.samples[st.index].halfWidth;
    st.inLane = u >= 0 && edges !== null && beyond > Math.max(0.5, edges[0] - 1);
    const from = lane.taper * TUNING.pits.limitLine;
    st.limited = st.inLane && u >= from && u <= lane.length - from;
  }

  private inBox(st: PitState, car: Car): boolean {
    const { track, lane } = this;
    const P = TUNING.pits;
    const box = lane.boxes[st.box];
    const n = track.samples.length;
    const along = Math.abs(((st.index - box + n + n / 2) % n) - n / 2) * (track.length / n);
    const p = car.position;
    const beyond = lane.sign * lateralOffset(track, st.index, p.x, p.z) - track.samples[st.index].halfWidth;
    return along < P.boxLength / 2 && Math.abs(beyond - boxOffset()) < P.boxDepth / 2;
  }
}
