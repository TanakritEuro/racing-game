// A time-trial session: the lap timer, a recording of every lap, and the best lap's recording
// (the ghost). Pure simulation: call afterStep() after every Simulation.step().

import type { Simulation } from '../sim';
import { trackFingerprint } from '../track/track';
import type { Controls } from '../vehicle/car';
import { copyPose } from '../vehicle/pose';
import { createRecordedState, LapRecorder, type LapRecording } from './recording';
import type { ReferenceLap } from './timing';

/** What a step brought: nothing, a lap, or a lap that is the new best. */
export type LapEvent = 'lap' | 'best' | null;

export class TimeTrial {
  readonly fingerprint: string;
  /** The best valid lap's recording: the ghost. */
  ghost: LapRecording | null = null;
  /** The last completed lap's recording, valid or not (for replays). */
  lastLap: LapRecording | null = null;
  private readonly recorder = new LapRecorder();
  private readonly state = createRecordedState();
  private laps: number;
  /** When the lap being recorded started (simulation time), or null. */
  private recordingFrom: number | null = null;

  constructor(readonly sim: Simulation) {
    this.fingerprint = trackFingerprint(sim.track);
    this.laps = sim.timer.laps;
  }

  /** Seconds into the lap in progress (where the ghost should be), or null on an out lap. */
  get lapTime(): number | null {
    return this.sim.timer.current(this.sim.time);
  }

  /** Call after every simulation step with the controls it used. */
  afterStep(controls: Controls): LapEvent {
    const { sim } = this;
    const timer = sim.timer;
    let event: LapEvent = null;
    // A lap finished on this step: keep its recording; a new valid best becomes the ghost.
    if (timer.laps !== this.laps) {
      this.laps = timer.laps;
      if (this.recorder.active && timer.lastLap !== null && timer.lastSectors) {
        const rec = this.recorder.finish({
          trackId: sim.track.def.id,
          carName: sim.car.def.name,
          fingerprint: this.fingerprint,
          lapTime: timer.lastLap,
          valid: timer.lastValid,
          sectors: timer.lastSectors,
        });
        this.lastLap = rec;
        event = 'lap';
        if (rec.valid && timer.best?.time === rec.lapTime) {
          this.ghost = rec;
          event = 'best';
        }
      }
    }
    // A lap started on this step (from an out lap or straight after the last one): record it.
    const elapsed = timer.current(sim.time);
    const startedAt = elapsed === null ? null : sim.time - elapsed;
    if (startedAt !== null && (this.recordingFrom === null || Math.abs(startedAt - this.recordingFrom) > 1e-6)) {
      this.recorder.start();
      this.recordingFrom = startedAt;
    }
    this.capture(controls);
    return event;
  }

  /** Back to the grid for an out lap. The ghost and the bests are kept. */
  restart(): void {
    this.recorder.cancel();
    this.sim.restart();
    this.recordingFrom = null;
  }

  /** Race against a stored best: its recording becomes the ghost and the timer measures against it. */
  loadBest(rec: LapRecording, profile: Float32Array): void {
    if (rec.fingerprint !== this.fingerprint || !rec.valid) return;
    if (this.ghost && this.ghost.lapTime <= rec.lapTime) return;
    this.ghost = rec;
    const best: ReferenceLap = { time: rec.lapTime, sectors: rec.sectors, profile };
    this.sim.timer.setBest(best);
  }

  private capture(controls: Controls): void {
    const s = this.state;
    const car = this.sim.car;
    copyPose(this.sim.current, s.pose);
    s.speed = car.speed;
    s.rpm = car.drivetrain.rpm;
    s.gear = car.drivetrain.gearbox.nextGear;
    s.throttle = controls.throttle;
    s.brake = controls.brake;
    this.recorder.capture(s);
  }
}
