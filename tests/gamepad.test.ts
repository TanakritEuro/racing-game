import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { readPad, stickSteer, type PadState } from '../src/input/gamepad';

/** A standard-mapping pad at rest, with `set` overriding axes and buttons. */
function pad(set: { axes?: number[]; buttons?: Record<number, number> } = {}): PadState {
  const buttons = Array.from({ length: 17 }, (_, i) => {
    const value = set.buttons?.[i] ?? 0;
    return { pressed: value > 0.5, value };
  });
  return { axes: set.axes ?? [0, 0, 0, 0], buttons };
}

describe('gamepad', () => {
  it('ignores the stick inside its dead zone and reaches full lock at full deflection', () => {
    const dz = TUNING.gamepad.steerDeadZone;
    expect(stickSteer(0)).toBe(0);
    expect(stickSteer(dz * 0.9)).toBe(0);
    expect(stickSteer(-dz * 0.9)).toBe(0);
    expect(stickSteer(1)).toBe(1);
    expect(stickSteer(-1)).toBe(-1);
  });

  it('steers finer near the centre, rising steadily and symmetrically', () => {
    let previous = 0;
    for (let x = 0.1; x <= 1.0001; x += 0.05) {
      const s = stickSteer(x);
      expect(s).toBeGreaterThan(previous);
      expect(stickSteer(-x)).toBeCloseTo(-s, 12);
      previous = s;
    }
    // Half deflection gives less than half lock with the curve.
    expect(stickSteer(0.5)).toBeLessThan(0.5);
  });

  it('maps the triggers to the pedals and A to the handbrake, analogue', () => {
    const frame = readPad(pad({ axes: [0.6, 0], buttons: { 7: 0.75, 6: 0.3, 0: 1 } }), []);
    const dz = TUNING.gamepad.triggerDeadZone;
    expect(frame.throttle).toBeCloseTo((0.75 - dz) / (1 - dz), 9);
    expect(frame.brake).toBeCloseTo((0.3 - dz) / (1 - dz), 9);
    expect(frame.handbrake).toBe(1);
    expect(frame.steer).toBeCloseTo(stickSteer(0.6), 12);
    expect(frame.steering).toBe(true);
    // A trigger barely resting off zero is ignored.
    expect(readPad(pad({ buttons: { 7: dz / 2 } }), []).throttle).toBe(0);
  });

  it('takes presses of the shift, camera and reset buttons once, not while held', () => {
    const held = pad({ buttons: { 5: 1, 3: 1, 8: 1 } });
    const first = readPad(held, []);
    expect(first.shift).toBe(1);
    expect(first.camera).toBe(true);
    expect(first.reset).toBe(true);
    const still = readPad(held, held.buttons.map((b) => b.pressed));
    expect(still.shift).toBe(0);
    expect(still.camera).toBe(false);
    expect(still.reset).toBe(false);
    expect(readPad(pad({ buttons: { 4: 1 } }), []).shift).toBe(-1);
  });

  it('is idle at rest', () => {
    const frame = readPad(pad(), []);
    expect(frame).toEqual({ throttle: 0, brake: 0, handbrake: 0, steer: 0, steering: false, shift: 0, camera: false, reset: false });
  });
});
