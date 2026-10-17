// Touch → driving inputs, for phones and tablets. The screen's controls (ui/touchControls.ts)
// tell this what fingers are doing; it keeps the state and turns it into a frame like the
// gamepad's:
//   - the thumb: put down anywhere on the left half, slid sideways; its travel from where it
//     landed is the steering (or, in tilt mode, the device's roll is);
//   - the pedals: analogue by how far up the pedal the finger presses;
//   - buttons: handbrake (held), camera, put back, pause, shift up and down (pressed).
// The mappings are pure functions; the class holds no DOM.

import { TUNING } from '../config';

export type SteerMode = 'thumb' | 'tilt';
export type Pedal = 'throttle' | 'brake' | 'handbrake';
export type TouchButton = 'camera' | 'reset' | 'pause' | 'up' | 'down';

export interface TouchFrame {
  /** Steering −1..1, and whether a thumb or the tilt is steering now. */
  steer: number;
  steering: boolean;
  throttle: number;
  brake: number;
  handbrake: number;
  camera: boolean;
  reset: boolean;
  pause: boolean;
}

export const IDLE_TOUCH: Readonly<TouchFrame> = { steer: 0, steering: false, throttle: 0, brake: 0, handbrake: 0, camera: false, reset: false, pause: false };

/** Past `dead`, rescale the rest up to `full` to 0–1 (signed). */
function travel(value: number, dead: number, full: number): number {
  const v = Math.abs(value);
  return v <= dead ? 0 : Math.sign(value) * Math.min(1, (v - dead) / (full - dead));
}

/** The thumb's travel from where it landed (px, positive right) → steering. */
export function thumbSteer(dx: number): number {
  const T = TUNING.touch;
  return travel(dx, T.thumbDead, T.thumbFull);
}

/** The device's roll (degrees, positive turned right like a wheel) → steering. */
export function tiltSteer(roll: number): number {
  const T = TUNING.touch;
  return travel(roll, T.tiltDead, T.tiltFull);
}

/** A pedal pressed `up` of the way up it (0 bottom … 1 top) → pressure: some at the bottom, full in the top half. */
export function pedalPressure(up: number): number {
  const T = TUNING.touch;
  return T.pedalFloor + (1 - T.pedalFloor) * Math.min(1, Math.max(0, up / T.pedalFull));
}

export class TouchInput {
  /** A finger has touched the controls (the device has a touch screen). */
  active = false;
  mode: SteerMode = 'thumb';
  private thumb: { id: number; x0: number; x: number } | null = null;
  private readonly pedals = new Map<number, { pedal: Pedal; value: number }>();
  private roll: number | null = null;
  private readonly pressed = new Set<TouchButton>();
  private pendingShift: -1 | 0 | 1 = 0;

  thumbDown(id: number, x: number): void {
    this.active = true;
    this.thumb = { id, x0: x, x };
  }

  thumbMove(id: number, x: number): void {
    if (this.thumb?.id === id) this.thumb.x = x;
  }

  /** A finger lifted (or cancelled): whatever it was doing stops. */
  up(id: number): void {
    if (this.thumb?.id === id) this.thumb = null;
    this.pedals.delete(id);
  }

  pedalDown(id: number, pedal: Pedal, up: number): void {
    this.active = true;
    this.pedals.set(id, { pedal, value: pedal === 'handbrake' ? 1 : pedalPressure(up) });
  }

  pedalMove(id: number, up: number): void {
    const p = this.pedals.get(id);
    if (p && p.pedal !== 'handbrake') p.value = pedalPressure(up);
  }

  press(button: TouchButton): void {
    this.active = true;
    if (button === 'up') this.pendingShift = 1;
    else if (button === 'down') this.pendingShift = -1;
    else this.pressed.add(button);
  }

  /** The device's roll (degrees), or null where it doesn't report one. */
  setRoll(roll: number | null): void {
    this.roll = roll;
  }

  /** Everything let go (the page lost focus). */
  release(): void {
    this.thumb = null;
    this.pedals.clear();
  }

  /** Once a frame: held inputs now, and buttons pressed since the last frame. */
  poll(): TouchFrame {
    if (!this.active) return IDLE_TOUCH;
    const held = (pedal: Pedal) => Math.max(0, ...[...this.pedals.values()].filter((p) => p.pedal === pedal).map((p) => p.value));
    const tilting = this.mode === 'tilt' && this.roll !== null;
    const frame: TouchFrame = {
      steer: tilting ? tiltSteer(this.roll!) : this.thumb ? thumbSteer(this.thumb.x - this.thumb.x0) : 0,
      steering: tilting || this.thumb !== null,
      throttle: held('throttle'),
      brake: held('brake'),
      handbrake: held('handbrake'),
      camera: this.pressed.has('camera'),
      reset: this.pressed.has('reset'),
      pause: this.pressed.has('pause'),
    };
    this.pressed.clear();
    return frame;
  }

  /** The shift requested since the last call, if any; clears it. */
  takeShift(): -1 | 0 | 1 {
    const shift = this.pendingShift;
    this.pendingShift = 0;
    return shift;
  }
}
