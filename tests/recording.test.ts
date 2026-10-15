import { describe, expect, it } from 'vitest';
import { PHYSICS_STEP } from '../src/constants';
import {
  createRecordedState,
  decodeRecording,
  duration,
  encodeRecording,
  FRAME_DT,
  frameCount,
  LapRecorder,
  sampleRecording,
  type LapRecording,
  type RecordedState,
} from '../src/race/recording';
import type { Simulation } from '../src/sim';
import { CIRCUITS, TEST_CIRCUIT } from '../src/track/circuits';
import { buildTrack, trackFingerprint } from '../src/track/track';
import { copyPose, createPose, type CarPose } from '../src/vehicle/pose';
import { createSim, followLine, run } from './helpers';

/** The simulation's state as a recorder sees it. */
function stateOf(sim: Simulation, out: RecordedState): RecordedState {
  copyPose(sim.current, out.pose);
  out.speed = sim.car.speed;
  out.rpm = sim.car.drivetrain.rpm;
  out.gear = sim.car.drivetrain.gearbox.gear;
  return out;
}

/** Drive 12 s round the Proving Ground's corners, recording, and keep the true pose at every step. */
async function recordDrive(): Promise<{ rec: LapRecording; truth: CarPose[] }> {
  const sim = await createSim();
  const driver = followLine(sim, 30, { corners: true });
  run(sim, driver, 20);
  const recorder = new LapRecorder();
  const state = createRecordedState();
  const truth: CarPose[] = [];
  recorder.start();
  for (let i = 0; i < 12 * 120; i++) {
    recorder.capture(stateOf(sim, state));
    const p = createPose();
    copyPose(sim.current, p);
    truth.push(p);
    sim.step(driver());
  }
  const rec = recorder.finish({ trackId: 'proving-ground', carName: 'Kestrel', fingerprint: 'x', lapTime: 12, valid: true, sectors: [4, 4, 4] });
  return { rec, truth };
}

describe('lap recordings', () => {
  it('keeps 30 frames a second', async () => {
    const { rec } = await recordDrive();
    expect(FRAME_DT).toBeCloseTo(1 / 30, 9);
    expect(frameCount(rec)).toBe(12 * 30);
    expect(duration(rec)).toBeCloseTo(12 - FRAME_DT, 6);
  });

  it('plays back between frames within 2 cm and half a degree of what happened', async () => {
    const { rec, truth } = await recordDrive();
    const out = createRecordedState();
    let worstMove = 0;
    let worstTurn = 0;
    let worstSpin = 0;
    for (let i = 0; i < truth.length - 4; i++) {
      sampleRecording(rec, i * PHYSICS_STEP, out);
      const a = out.pose;
      const b = truth[i];
      worstMove = Math.max(worstMove, Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z));
      const dot = Math.abs(a.rotation.x * b.rotation.x + a.rotation.y * b.rotation.y + a.rotation.z * b.rotation.z + a.rotation.w * b.rotation.w);
      worstTurn = Math.max(worstTurn, 2 * Math.acos(Math.min(1, dot)));
      worstSpin = Math.max(worstSpin, Math.abs(a.wheels[2].spin - b.wheels[2].spin));
    }
    expect(worstMove).toBeLessThan(0.02);
    expect(worstTurn).toBeLessThan((0.5 * Math.PI) / 180);
    // Wheel spin is stored unwrapped, so it blends straight through.
    expect(worstSpin).toBeLessThan(0.2);
  });

  it('holds its first and last frames outside the recording', async () => {
    const { rec, truth } = await recordDrive();
    const out = createRecordedState();
    sampleRecording(rec, -1, out);
    expect(out.pose.position.x).toBeCloseTo(truth[0].position.x, 3);
    sampleRecording(rec, 999, out);
    const last = createRecordedState();
    sampleRecording(rec, duration(rec), last);
    expect(out.pose.position).toEqual(last.pose.position);
  });

  it('encodes to bytes and back exactly', async () => {
    const { rec } = await recordDrive();
    const back = decodeRecording(encodeRecording(rec))!;
    expect(back).not.toBeNull();
    expect(back.frames).toEqual(rec.frames);
    const { frames: _a, ...metaA } = rec;
    const { frames: _b, ...metaB } = back;
    expect(metaB).toEqual(metaA);
  });

  it('refuses bytes that are not a recording it can read', () => {
    expect(decodeRecording(new ArrayBuffer(8))).toBeNull();
    const rec: LapRecording = { version: 1, trackId: 't', carName: 'c', fingerprint: 'f', lapTime: 1, valid: true, sectors: [1, 1, 1], frameDt: FRAME_DT, frames: new Float32Array(24) };
    const bytes = encodeRecording({ ...rec, version: 2 as 1 });
    expect(decodeRecording(bytes)).toBeNull();
  });
});

describe('track fingerprints', () => {
  it('are the same for the same layout and differ between circuits', () => {
    const prints = CIRCUITS.map((c) => trackFingerprint(buildTrack(c)));
    expect(new Set(prints).size).toBe(CIRCUITS.length);
    expect(trackFingerprint(buildTrack(TEST_CIRCUIT))).toBe(prints[CIRCUITS.indexOf(TEST_CIRCUIT)]);
  });

  it('change when a control point moves', () => {
    const moved = { ...TEST_CIRCUIT, points: TEST_CIRCUIT.points.map((p, i) => (i === 3 ? { ...p, x: p.x + 1 } : p)) };
    expect(trackFingerprint(buildTrack(moved))).not.toBe(trackFingerprint(buildTrack(TEST_CIRCUIT)));
  });
});
