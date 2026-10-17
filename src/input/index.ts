// The player's driver: keyboard, gamepad and touch together → `Controls`, once per physics
// step. Pedals take whichever device presses hardest; the steering follows whichever device
// steered last (the stick positions the rack directly; the keys, the thumb and the tilt go
// through the assist).

import { KeyboardSteering } from '../drivers/steeringAssist';
import type { Car, Controls } from '../vehicle/car';
import { Gamepad, IDLE_PAD, type PadFrame } from './gamepad';
import { Keyboard } from './keyboard';
import { IDLE_TOUCH, TouchInput, type TouchFrame } from './touch';

/** Which device is steering. */
export type Steerer = 'keys' | 'pad' | 'touch';

/** The device steering now: one that is steering this moment takes over; otherwise the last one keeps it. */
export function whoSteers(last: Steerer, keys: number, pad: PadFrame, touch: TouchFrame): Steerer {
  if (pad.steering) return 'pad';
  if (touch.steering) return 'touch';
  if (keys !== 0) return 'keys';
  // Let go of the stick: it still has the wheel (where the stick left it). Let go of the thumb: back to the assist.
  return last === 'touch' ? 'keys' : last;
}

export class PlayerInput {
  readonly keyboard = new Keyboard();
  readonly gamepad = new Gamepad();
  readonly touch = new TouchInput();
  readonly steering = new KeyboardSteering();
  private pad: PadFrame = IDLE_PAD;
  private touchFrame: TouchFrame = IDLE_TOUCH;
  private steerer: Steerer = 'keys';

  /** Once a frame: read the gamepad and the touch controls. Returns their camera, reset and pause presses. */
  poll(): { camera: boolean; reset: boolean; pause: boolean } {
    this.pad = this.gamepad.poll();
    this.touchFrame = this.touch.poll();
    const t = this.touchFrame;
    return { camera: this.pad.camera || t.camera, reset: this.pad.reset || t.reset, pause: t.pause };
  }

  /** Once per physics step: this step's controls. */
  controls(car: Car, dt: number): Controls {
    const keys = this.keyboard.controls();
    const pad = this.pad;
    const touch = this.touchFrame;
    this.steerer = whoSteers(this.steerer, keys.steer, pad, touch);
    let steer: number;
    if (this.steerer === 'pad') {
      steer = pad.steer;
      // Hand back to the keys from where the stick left the wheel.
      this.steering.position = steer;
    } else steer = this.steering.update(this.steerer === 'touch' ? touch.steer : keys.steer, car, dt);
    const shifts = [this.keyboard.takeShift(), this.gamepad.takeShift(), this.touch.takeShift()];
    return {
      throttle: Math.max(keys.throttle, pad.throttle, touch.throttle),
      brake: Math.max(keys.brake, pad.brake, touch.brake),
      steer,
      clutch: 0,
      shift: shifts.find((s) => s !== 0) ?? 0,
      handbrake: Math.max(keys.handbrake, pad.handbrake, touch.handbrake),
    };
  }

  /** After the car is put back on the track: centre the steering. */
  reset(): void {
    this.steering.reset();
  }
}
