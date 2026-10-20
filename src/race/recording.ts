// Lap recordings: the car's pose and a few readouts at 30 Hz, from the start line round to
// it again. Ghosts and replays play these back as recorded transforms (not re-simulated
// Controls), so they look the same in any browser and survive tuning changes. Pure data.

import { PHYSICS_STEP } from '../constants';
import { createPose, interpolatePose, type CarPose } from '../vehicle/pose';

/** Physics steps between recorded frames: 4 at 120 Hz, so 30 frames per second. */
export const RECORD_EVERY = 4;
export const FRAME_DT = RECORD_EVERY * PHYSICS_STEP;

/**
 * Floats per frame: position (3), rotation (4), each wheel's suspension length, steer and
 * spin (12), then speed, rpm, gear, throttle and brake (5).
 */
export const FRAME_SIZE = 24;
const READOUTS = 19;

export interface LapRecording {
  version: 1;
  trackId: string;
  carName: string;
  /** The built track's fingerprint: a recording from a different layout is no use. */
  fingerprint: string;
  lapTime: number;
  valid: boolean;
  sectors: [number, number, number];
  frameDt: number;
  frames: Float32Array;
}

/** What a recording says at a moment: the pose to draw and the readouts for a HUD. */
export interface RecordedState {
  pose: CarPose;
  /** Forward speed (m/s), engine rpm, gear (−1 R, 0 N, 1..), throttle and brake (0–1). */
  speed: number;
  rpm: number;
  gear: number;
  throttle: number;
  brake: number;
}

export function createRecordedState(): RecordedState {
  return { pose: createPose(), speed: 0, rpm: 0, gear: 0, throttle: 0, brake: 0 };
}

/** Collects frames over a lap: start it at the line, capture after every step, finish at the line. */
export class LapRecorder {
  private data = new Float32Array(FRAME_SIZE * 30 * 180);
  private count = 0;
  private steps = 0;
  private recording = false;

  get active(): boolean {
    return this.recording;
  }

  /** Begin a lap: the next capture is frame 0. */
  start(): void {
    this.count = 0;
    this.steps = 0;
    this.recording = true;
  }

  /** Stop without keeping anything (the car was reset, the session restarted). */
  cancel(): void {
    this.recording = false;
  }

  /** Call after every physics step; keeps every RECORD_EVERY-th. */
  capture(state: RecordedState): void {
    if (!this.recording) return;
    if (this.steps++ % RECORD_EVERY !== 0) return;
    if ((this.count + 1) * FRAME_SIZE > this.data.length) {
      const bigger = new Float32Array(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    writeFrame(this.data, this.count++, state);
  }

  /** The lap so far as a recording (a copy), and stop recording. */
  finish(meta: Omit<LapRecording, 'version' | 'frameDt' | 'frames'>): LapRecording {
    this.recording = false;
    return { version: 1, ...meta, frameDt: FRAME_DT, frames: this.data.slice(0, this.count * FRAME_SIZE) };
  }
}

/** Frame `k` of `data` (FRAME_SIZE floats a frame) from `s`. */
export function writeFrame(data: Float32Array, k: number, s: RecordedState): void {
  const o = k * FRAME_SIZE;
  const { position: p, rotation: q } = s.pose;
  data[o] = p.x;
  data[o + 1] = p.y;
  data[o + 2] = p.z;
  data[o + 3] = q.x;
  data[o + 4] = q.y;
  data[o + 5] = q.z;
  data[o + 6] = q.w;
  s.pose.wheels.forEach((w, i) => {
    data[o + 7 + i * 3] = w.suspensionLength;
    data[o + 8 + i * 3] = w.steer;
    data[o + 9 + i * 3] = w.spin;
  });
  data[o + READOUTS] = s.speed;
  data[o + READOUTS + 1] = s.rpm;
  data[o + READOUTS + 2] = s.gear;
  data[o + READOUTS + 3] = s.throttle;
  data[o + READOUTS + 4] = s.brake;
}

/** Frame `k` of a recording into `out`. */
export function readFrame(rec: LapRecording, k: number, out: RecordedState): void {
  readFrameData(rec.frames, k, out);
}

/** Frame `k` of `d` (FRAME_SIZE floats a frame) into `out`. */
export function readFrameData(d: Float32Array, k: number, out: RecordedState): void {
  const o = k * FRAME_SIZE;
  out.pose.position.x = d[o];
  out.pose.position.y = d[o + 1];
  out.pose.position.z = d[o + 2];
  out.pose.rotation.x = d[o + 3];
  out.pose.rotation.y = d[o + 4];
  out.pose.rotation.z = d[o + 5];
  out.pose.rotation.w = d[o + 6];
  out.pose.wheels.forEach((w, i) => {
    w.suspensionLength = d[o + 7 + i * 3];
    w.steer = d[o + 8 + i * 3];
    w.spin = d[o + 9 + i * 3];
  });
  out.speed = d[o + READOUTS];
  out.rpm = d[o + READOUTS + 1];
  out.gear = d[o + READOUTS + 2];
  out.throttle = d[o + READOUTS + 3];
  out.brake = d[o + READOUTS + 4];
}

export function frameCount(rec: LapRecording): number {
  return rec.frames.length / FRAME_SIZE;
}

/** Recorded length (s): from the first frame to the last. */
export function duration(rec: LapRecording): number {
  return (frameCount(rec) - 1) * rec.frameDt;
}

const scratchA = createRecordedState();
const scratchB = createRecordedState();

/** The recording at `t` seconds into the lap (held at its ends), blended between frames, into `out`. */
export function sampleRecording(rec: LapRecording, t: number, out: RecordedState): void {
  sampleFrames(rec.frames, frameCount(rec), rec.frameDt, t, out);
}

/** The first `count` frames of `data` at `t` seconds (held at their ends), blended between frames, into `out`. */
export function sampleFrames(data: Float32Array, count: number, frameDt: number, t: number, out: RecordedState): void {
  const last = count - 1;
  const f = Math.max(0, Math.min(last, t / frameDt));
  const k = Math.min(last - 1, Math.floor(f));
  if (last < 1) {
    readFrameData(data, 0, out);
    return;
  }
  readFrameData(data, k, scratchA);
  readFrameData(data, k + 1, scratchB);
  const a = f - k;
  interpolatePose(scratchA.pose, scratchB.pose, a, out.pose);
  const lerp = (x: number, y: number) => x + (y - x) * a;
  out.speed = lerp(scratchA.speed, scratchB.speed);
  out.rpm = lerp(scratchA.rpm, scratchB.rpm);
  out.gear = a < 0.5 ? scratchA.gear : scratchB.gear;
  out.throttle = lerp(scratchA.throttle, scratchB.throttle);
  out.brake = lerp(scratchA.brake, scratchB.brake);
}

/** A recording as bytes: a length-prefixed JSON header, padded to 4 bytes, then the frames. */
export function encodeRecording(rec: LapRecording): ArrayBuffer {
  const { frames, ...meta } = rec;
  const header = new TextEncoder().encode(JSON.stringify(meta));
  const headerEnd = 4 + header.length;
  const framesAt = Math.ceil(headerEnd / 4) * 4;
  const buffer = new ArrayBuffer(framesAt + frames.byteLength);
  new DataView(buffer).setUint32(0, header.length, true);
  new Uint8Array(buffer, 4, header.length).set(header);
  new Float32Array(buffer, framesAt, frames.length).set(frames);
  return buffer;
}

/** Bytes back into a recording, or null if they aren't one this version can read. */
export function decodeRecording(buffer: ArrayBuffer): LapRecording | null {
  try {
    const length = new DataView(buffer).getUint32(0, true);
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, length))) as Omit<LapRecording, 'frames'>;
    if (meta.version !== 1) return null;
    const framesAt = Math.ceil((4 + length) / 4) * 4;
    const frames = new Float32Array(buffer.slice(framesAt));
    if (frames.length % FRAME_SIZE !== 0) return null;
    return { ...meta, frames };
  } catch {
    return null;
  }
}
