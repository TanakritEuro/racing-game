import { describe, expect, it } from 'vitest';
import { PHYSICS_STEP } from '../src/constants';
import type { Contact } from '../src/sim';
import { controls, NO_CONTROLS, poseOnTrack } from '../src/vehicle/car';
import { KESTREL } from '../src/vehicle/cars';
import { createPose } from '../src/vehicle/pose';
import { createSim, run } from './helpers';

describe('proxy cars', () => {
  it('stop your car when you drive into one, which stays put', async () => {
    const sim = await createSim();
    const { samples } = sim.track;
    // A proxy parked 30 m up the road (above the car's ride height, as a car body is).
    const pose = poseOnTrack(samples[15]);
    pose.position.y += 0.6;
    const i = sim.addProxy(KESTREL, pose);
    const seen: Contact[] = [];
    for (let k = 0; k < 6 * 120; k++) {
      sim.step(controls({ throttle: 0.6 }));
      for (const c of sim.contacts) seen.push({ ...c });
    }
    expect(seen.some((c) => c.against === 'car' && c.car === 0)).toBe(true);
    // Stopped behind it, not through it.
    const p = sim.car.position;
    expect(Math.hypot(p.x - samples[15].x, p.z - samples[15].z)).toBeGreaterThan(3.5);
    expect(Math.abs(sim.car.speed)).toBeLessThan(3);
    // The proxy is where it was told to be.
    const q = sim.proxies[i].body.translation();
    expect(Math.hypot(q.x - pose.position.x, q.z - pose.position.z)).toBeLessThan(0.01);
  });

  it('push your car when it moves into it', async () => {
    const sim = await createSim();
    run(sim, NO_CONTROLS, 1);
    const start = { ...sim.car.position };
    const s = sim.track.samples[sim.track.samples.length - 5];
    // From 4 m to the left, sliding right across the car's spot at 3 m/s.
    const pose = poseOnTrack(s);
    pose.position.y = start.y;
    const target = createPose();
    Object.assign(target.position, pose.position);
    Object.assign(target.rotation, pose.rotation);
    const i = sim.addProxy(KESTREL, { rotation: pose.rotation, position: { x: pose.position.x + s.nx * 4, y: start.y, z: pose.position.z + s.nz * 4 } });
    for (let k = 0; k < 3 * 120; k++) {
      const off = 4 - 3 * (k * PHYSICS_STEP);
      target.position.x = s.x + s.nx * off;
      target.position.z = s.z + s.nz * off;
      sim.setProxyPose(i, target);
      sim.step(NO_CONTROLS);
    }
    const p = sim.car.position;
    expect(Math.hypot(p.x - start.x, p.z - start.z)).toBeGreaterThan(1);
  });
});
