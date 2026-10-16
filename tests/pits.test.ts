import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import type { Simulation } from '../src/sim';
import { HARROWMERE } from '../src/track/circuits';
import { boxOffset, fastLaneOffset, laneAlong, pitLane, type PitLane } from '../src/track/pitLane';
import { controls, NO_CONTROLS, poseOnTrack } from '../src/vehicle/car';
import { createSim, followLine, run, runUntil } from './helpers';

/** Put the car `beyond` metres past the road edge into the lane, `u` metres along it, at rest. */
function placeInLane(sim: Simulation, lane: PitLane, u: number, beyond: number): void {
  const { track } = sim;
  const n = track.samples.length;
  const s = track.samples[(lane.first + Math.round(u / (track.length / n))) % n];
  const pose = poseOnTrack(s);
  const off = lane.sign * (s.halfWidth + beyond);
  pose.position.x += s.lx * off;
  pose.position.y += s.ly * off;
  pose.position.z += s.lz * off;
  sim.car.reset(pose);
  sim.pits!.reset(0);
}

describe('pit stops', () => {
  it('limit the car to 60 km/h past the line, without a penalty', async () => {
    const sim = await createSim(HARROWMERE);
    const lane = pitLane(sim.track)!;
    placeInLane(sim, lane, lane.taper * TUNING.pits.limitLine + 5, fastLaneOffset());
    const drive = followLine(sim, 40, { offset: lane.sign * (sim.track.samples[0].halfWidth + fastLaneOffset()) });
    let fastest = 0;
    let limited = 0;
    runUntil(
      sim,
      drive,
      () => {
        const st = sim.pits!.state[0];
        if (st.limited) {
          limited++;
          fastest = Math.max(fastest, sim.car.speed);
        }
        return laneAlong(sim.track, lane, st.index) > lane.length - lane.taper;
      },
      60,
    );
    expect(limited).toBeGreaterThan(120 * 5);
    expect(fastest).toBeGreaterThan(TUNING.pits.limit - 1.5);
    expect(fastest).toBeLessThan(TUNING.pits.limit + TUNING.pits.tolerance);
    expect(sim.pits!.state[0].penalty).toBe(0);
  });

  it('penalise crossing the limit line too fast, once a visit', async () => {
    const sim = await createSim(HARROWMERE);
    const lane = pitLane(sim.track)!;
    placeInLane(sim, lane, lane.taper * 0.3, fastLaneOffset());
    run(sim, NO_CONTROLS, 0.5);
    const f = sim.car.forward;
    sim.car.body.setLinvel({ x: f.x * 30, y: 0, z: f.z * 30 }, true);
    run(sim, NO_CONTROLS, 4);
    expect(sim.pits!.state[0].penalty).toBe(TUNING.pits.penalty);
  });

  it('change the tyres in the box, holding the car meanwhile', async () => {
    const sim = await createSim(HARROWMERE);
    sim.car.wearRate = 1;
    const lane = pitLane(sim.track)!;
    const st = sim.pits!.state[0];
    placeInLane(sim, lane, laneAlong(sim.track, lane, lane.boxes[st.box]), boxOffset());
    for (const w of sim.car.wheels) w.wear = 0.6;
    run(sim, NO_CONTROLS, 0.5);
    expect(st.servicing).not.toBeNull();
    const at = { ...sim.car.position };
    // Flat out while the crew works: the car stays put.
    run(sim, controls({ throttle: 1 }), TUNING.pits.service - 0.6);
    expect(Math.hypot(sim.car.position.x - at.x, sim.car.position.z - at.z)).toBeLessThan(0.2);
    expect(sim.car.wheels.every((w) => w.wear > 0.59)).toBe(true);
    run(sim, NO_CONTROLS, 0.5);
    expect(sim.car.wheels.every((w) => w.wear < 1e-4)).toBe(true);
    expect(st.stops).toBe(1);
    expect(st.servicing).toBeNull();
    // Not again on the same visit.
    run(sim, NO_CONTROLS, 2);
    expect(st.stops).toBe(1);
    expect(st.servicing).toBeNull();
  });
});
