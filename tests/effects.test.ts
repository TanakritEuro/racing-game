import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { SkidMarks, slideAmount } from '../src/render/effects/skidMarks';
import { Smoke } from '../src/render/effects/smoke';
import { Sparks } from '../src/render/effects/sparks';
import { controls } from '../src/vehicle/car';
import { createSim, run } from './helpers';
import { LONG_OVAL } from './tracks';

describe('effects', () => {
  it('count a tyre as sliding only past its peak slip', async () => {
    const sim = await createSim(LONG_OVAL);
    const w = sim.car.wheels[2];
    run(sim, controls({ throttle: 0.3 }), 3);
    expect(slideAmount(w)).toBe(0);
    w.slipAngle = w.tyre.peakSlipAngle * 0.9;
    expect(slideAmount(w)).toBe(0);
    w.slipAngle = w.tyre.peakSlipAngle * TUNING.effects.slideFrom * 1.5;
    expect(slideAmount(w)).toBeCloseTo(0.5, 6);
    w.slipAngle = 0;
    w.locked = true;
    expect(slideAmount(w)).toBe(1);
    w.contact = false;
    expect(slideAmount(w)).toBe(0);
  });

  it('lay skid marks in a ring that overwrites the oldest', () => {
    const marks = new SkidMarks(10);
    const v = (x: number) => new THREE.Vector3(x, 0, 0);
    for (let k = 0; k < 25; k++) marks.lay(v(k), v(k + 0.2), v(k + 1), v(k + 1.2), 0.5);
    expect(marks.next).toBe(5);
    expect(marks.mesh.geometry.getAttribute('position').count).toBe(40);
  });

  it('never grow the smoke or spark pools', () => {
    const smoke = new Smoke(20);
    for (let k = 0; k < 100; k++) smoke.emit('car/0', 0, 0, 0, 10, 0, 1, 30, 0.1);
    expect(smoke.live).toBe(20);
    // Puffs fade away.
    for (let k = 0; k < 40; k++) smoke.update(0.1);
    expect(smoke.live).toBe(0);

    const sparks = new Sparks(15);
    const knock = { car: 0, against: 'barrier' as const, x: 0, y: 0, z: 0, impulse: 5000 };
    for (let k = 0; k < 5; k++) sparks.knock(knock);
    expect(sparks.live).toBe(15);
    for (let k = 0; k < 20; k++) sparks.update(0.05);
    expect(sparks.live).toBe(0);
  });

  it('throw more sparks for a harder knock, and none for a touch', () => {
    const sparks = new Sparks(400);
    sparks.knock({ car: 0, against: 'barrier', x: 0, y: 0, z: 0, impulse: 10 });
    expect(sparks.live).toBe(0);
    sparks.knock({ car: 0, against: 'barrier', x: 0, y: 0, z: 0, impulse: 200 });
    const light = sparks.live;
    sparks.knock({ car: 0, against: 'barrier', x: 0, y: 0, z: 0, impulse: 600 });
    expect(sparks.live - light).toBeGreaterThan(light);
  });
});
