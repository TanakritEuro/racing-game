import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { whoSteers } from '../src/input';
import { IDLE_PAD } from '../src/input/gamepad';
import { IDLE_TOUCH, pedalPressure, thumbSteer, tiltSteer, TouchInput } from '../src/input/touch';
import { KeyboardSteering, usableLock } from '../src/drivers/steeringAssist';
import { createSim } from './helpers';

describe('touch steering', () => {
  it('ignores a twitch of the thumb, reaches full at its full travel, and is symmetric', () => {
    const T = TUNING.touch;
    expect(thumbSteer(0)).toBe(0);
    expect(thumbSteer(T.thumbDead - 1)).toBe(0);
    expect(thumbSteer(T.thumbFull)).toBe(1);
    expect(thumbSteer(-T.thumbFull * 3)).toBe(-1);
    for (let dx = 10; dx < 70; dx += 10) {
      expect(thumbSteer(dx)).toBeGreaterThan(thumbSteer(dx - 10));
      expect(thumbSteer(-dx)).toBeCloseTo(-thumbSteer(dx), 12);
    }
  });

  it('turns the device like a wheel: a dead zone, then full at 30°', () => {
    expect(tiltSteer(2)).toBe(0);
    expect(tiltSteer(15)).toBeGreaterThan(0.4);
    expect(tiltSteer(15)).toBeLessThan(0.5);
    expect(tiltSteer(-45)).toBe(-1);
  });

  it('presses a pedal harder further up it: some at the bottom, full in the top half', () => {
    expect(pedalPressure(0)).toBeCloseTo(TUNING.touch.pedalFloor, 12);
    expect(pedalPressure(0.25)).toBeGreaterThan(pedalPressure(0.1));
    expect(pedalPressure(0.5)).toBe(1);
    expect(pedalPressure(0.9)).toBe(1);
  });
});

describe('touch input', () => {
  it('steers by the thumb’s travel from where it landed, and stops when it lifts', () => {
    const t = new TouchInput();
    expect(t.poll()).toBe(IDLE_TOUCH);
    t.thumbDown(1, 200);
    t.thumbMove(1, 270);
    expect(t.poll()).toMatchObject({ steer: 1, steering: true });
    t.thumbMove(1, 165);
    expect(t.poll().steer).toBeLessThan(-0.4);
    t.up(1);
    expect(t.poll()).toMatchObject({ steer: 0, steering: false });
  });

  it('holds pedals per finger, the hardest press of each, and buttons once', () => {
    const t = new TouchInput();
    t.pedalDown(2, 'throttle', 0.1);
    t.pedalDown(3, 'brake', 0.8);
    t.pedalDown(4, 'handbrake', 0);
    t.press('camera');
    t.press('up');
    const f = t.poll();
    expect(f.throttle).toBeCloseTo(pedalPressure(0.1), 12);
    expect(f.brake).toBe(1);
    expect(f.handbrake).toBe(1);
    expect(f.camera).toBe(true);
    expect(t.poll().camera).toBe(false);
    expect(t.takeShift()).toBe(1);
    expect(t.takeShift()).toBe(0);
    t.pedalMove(2, 0.7);
    expect(t.poll().throttle).toBe(1);
    t.release();
    expect(t.poll()).toMatchObject({ throttle: 0, brake: 0, handbrake: 0 });
  });

  it('steers by the tilt in tilt mode, whatever the thumb does', () => {
    const t = new TouchInput();
    t.mode = 'tilt';
    t.setRoll(-30);
    t.thumbDown(1, 0);
    t.thumbMove(1, 100);
    expect(t.poll()).toMatchObject({ steer: -1, steering: true });
  });
});

describe('touch with keyboard and gamepad', () => {
  it('lets the device steering now take the wheel, and hands a lifted thumb back to the assist', () => {
    const thumb = { ...IDLE_TOUCH, steering: true, steer: 0.5 };
    const stick = { ...IDLE_PAD, steering: true, steer: -0.3 };
    expect(whoSteers('keys', 0, IDLE_PAD, thumb)).toBe('touch');
    expect(whoSteers('touch', 0, stick, thumb)).toBe('pad');
    expect(whoSteers('touch', 1, IDLE_PAD, IDLE_TOUCH)).toBe('keys');
    expect(whoSteers('touch', 0, IDLE_PAD, IDLE_TOUCH)).toBe('keys');
    expect(whoSteers('pad', 0, IDLE_PAD, IDLE_TOUCH)).toBe('pad');
  });

  it('puts the thumb through the assist: full travel at speed is the lock the tyres can use', async () => {
    const sim = await createSim();
    const steering = new KeyboardSteering();
    // At standstill, full thumb travel is full lock; at speed (the assist's limit) much less.
    for (let k = 0; k < 120; k++) steering.update(1, sim.car, 1 / 120);
    expect(steering.position).toBeGreaterThan(0.95);
    sim.car.body.setLinvel({ x: sim.car.forward.x * 40, y: 0, z: sim.car.forward.z * 40 }, true);
    for (let k = 0; k < 360; k++) steering.update(1, sim.car, 1 / 120);
    expect(steering.position).toBeCloseTo(usableLock(sim.car, 40), 1);
    expect(steering.position).toBeLessThan(0.4);
  });
});
