// Gamepad (standard mapping) → driving inputs. Analogue all the way: the left stick
// positions the steering rack directly (no assist smoothing), the triggers are the pedals.
//
//   left stick X  steer          RT  throttle        LT  brake
//   A             handbrake      RB  shift up        LB  shift down
//   Y             camera         View / Back  reset the car
//
// Ported from five-a-side: it reads a `PadState`, so tests can pass a plain object.

import { TUNING } from '../config';

/** The parts of a `Gamepad` this reads. */
export interface PadState {
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

/** Standard-mapping button indices. */
const A = 0;
const Y = 3;
const LB = 4;
const RB = 5;
const LT = 6;
const RT = 7;
const VIEW = 8;

/** One frame of a pad: held inputs, and buttons pressed since the last frame. */
export interface PadFrame {
  throttle: number;
  brake: number;
  handbrake: number;
  /** Steering position, −1..1 of full lock. */
  steer: number;
  /** The stick is out of its dead zone: the pad is steering. */
  steering: boolean;
  shift: -1 | 0 | 1;
  camera: boolean;
  reset: boolean;
}

export const IDLE_PAD: Readonly<PadFrame> = {
  throttle: 0,
  brake: 0,
  handbrake: 0,
  steer: 0,
  steering: false,
  shift: 0,
  camera: false,
  reset: false,
};

/** Past `deadZone`, rescale the rest of the travel to 0–1. */
function beyond(value: number, deadZone: number): number {
  const v = Math.abs(value);
  return v <= deadZone ? 0 : Math.min(1, (v - deadZone) / (1 - deadZone));
}

/** Stick X → steering position: a dead zone, then a response curve that is finer near the centre. */
export function stickSteer(x: number): number {
  const G = TUNING.gamepad;
  const travel = beyond(x, G.steerDeadZone);
  return travel === 0 ? 0 : Math.sign(x) * Math.pow(travel, G.steerCurve);
}

/** The pad's driving inputs this frame. `previous` is last frame's `pressed` per button, for edges. */
export function readPad(pad: PadState, previous: readonly boolean[]): PadFrame {
  const G = TUNING.gamepad;
  const value = (i: number) => pad.buttons[i]?.value ?? 0;
  const pressed = (i: number) => (pad.buttons[i]?.pressed ?? false) && !(previous[i] ?? false);
  const x = pad.axes[0] ?? 0;
  return {
    throttle: beyond(value(RT), G.triggerDeadZone),
    brake: beyond(value(LT), G.triggerDeadZone),
    handbrake: value(A),
    steer: stickSteer(x),
    steering: Math.abs(x) > G.steerDeadZone,
    shift: pressed(RB) ? 1 : pressed(LB) ? -1 : 0,
    camera: pressed(Y),
    reset: pressed(VIEW),
  };
}

/** The first connected gamepad, read once a frame. */
export class Gamepad {
  private last: boolean[] = [];
  /** A shift pressed since the last physics step took one. */
  private pendingShift: -1 | 0 | 1 = 0;

  poll(): PadFrame {
    const pad = typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()].find((p) => p?.connected) : null;
    if (!pad) {
      this.last = [];
      return IDLE_PAD;
    }
    const frame = readPad(pad, this.last);
    this.last = pad.buttons.map((b) => b.pressed);
    if (frame.shift !== 0) this.pendingShift = frame.shift;
    return frame;
  }

  /** The shift requested since the last call, if any; clears it. */
  takeShift(): -1 | 0 | 1 {
    const shift = this.pendingShift;
    this.pendingShift = 0;
    return shift;
  }
}
