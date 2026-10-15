import { describe, expect, it } from 'vitest';
import { KERB_HEIGHT, KERB_RIDGE, kerbs, runs } from '../src/track/geometry';
import { buildTrack, KERB_WIDTH, lateralOffset, nearestSample, type TrackDef } from '../src/track/track';
import { controls } from '../src/vehicle/car';
import { KESTREL } from '../src/vehicle/cars';
import { createSim, followLine, run, runUntil } from './helpers';
import { GRASS_PAD, GRAVEL_PAD, KERBED_OVAL } from './tracks';

describe('kerb geometry', () => {
  const track = buildTrack(KERBED_OVAL);

  it('raises the kerb along the right of its span, ridged under the red stripes', () => {
    const meshes = kerbs(track);
    expect(meshes.length).toBe(1);
    const k = meshes[0];
    let highest = 0;
    for (let v = 0; v < k.positions.length / 3; v++) {
      const x = k.positions[v * 3];
      const y = k.positions[v * 3 + 1];
      const z = k.positions[v * 3 + 2];
      expect(Number.isFinite(x + y + z)).toBe(true);
      highest = Math.max(highest, y);
      // On the right of the road, within the kerb's width of its edge.
      const i = nearestSample(track, x, z);
      const across = -lateralOffset(track, i, x, z);
      expect(across).toBeGreaterThan(track.samples[i].halfWidth - 0.3);
      expect(across).toBeLessThan(track.samples[i].halfWidth + KERB_WIDTH + 0.3);
    }
    expect(highest).toBeCloseTo(KERB_HEIGHT + KERB_RIDGE, 3);
  });

  it('finds runs, including one that wraps past the start line', () => {
    const wrapped = buildTrack({ ...KERBED_OVAL, kerbs: [{ from: track.length - 100, to: 200, side: 'left' }] });
    const r = runs(wrapped, (p) => p.left.kerb > 0);
    expect(r.length).toBe(1);
    const [first, last] = r[0];
    expect(wrapped.samples[first].s).toBeGreaterThan(track.length - 110);
    expect(wrapped.samples[last].s).toBeLessThan(210);
  });
});

describe('driving on surfaces', () => {
  /** Hold 100 km/h `offset` metres from the centreline on the kerbed straight; return what the wheels felt. */
  async function cruise(offset: number) {
    const s = await createSim(KERBED_OVAL);
    const driver = followLine(s, 100 / 3.6, { offset });
    runUntil(s, driver, () => s.car.speed > 100 / 3.6 - 0.5, 20);
    run(s, driver, 3);
    const loads: number[][] = [[], [], [], []];
    let yaw = 0;
    let index: number | undefined;
    let worstOffset = 0;
    let contact = true;
    const v0 = s.car.speed;
    for (let i = 0; i < 240; i++) {
      s.step(driver());
      s.car.wheels.forEach((w, k) => {
        loads[k].push(w.load);
        contact &&= w.contact;
      });
      yaw = Math.max(yaw, Math.abs(s.car.body.angvel().y));
      const p = s.car.position;
      index = nearestSample(s.track, p.x, p.z, index);
      worstOffset = Math.max(worstOffset, Math.abs(lateralOffset(s.track, index, p.x, p.z) - offset));
    }
    // Rumble: how much the load changes from one step to the next. The ridges pass at ~28 Hz
    // at this speed; the body's own motions are far slower and barely show.
    const spread = (xs: number[]) => Math.sqrt(xs.slice(1).reduce((a, x, i) => a + (x - xs[i]) ** 2, 0) / (xs.length - 1));
    return { surfaces: s.car.wheels.map((w) => w.surface), spread: loads.map(spread), yaw, worstOffset, contact, speedChange: s.car.speed - v0 };
  }

  it('rides the kerb with the rumble in the suspension, without snagging', async () => {
    // Right wheels on the middle of the kerb: road edge at −7.5 m, kerb to −8.5, wheels 0.8 m off the centre of the car.
    const onKerb = await cruise(-(7.5 + KERB_WIDTH / 2 - KESTREL.trackHalf));
    const onRoad = await cruise(-4);
    expect(onKerb.surfaces[1]).toBe('kerb');
    expect(onKerb.surfaces[3]).toBe('kerb');
    expect(onKerb.surfaces[0]).toBe('asphalt');
    expect(onKerb.contact).toBe(true);
    // The ridges shake the right-hand wheels' loads far more than the smooth road does.
    expect(onKerb.spread[1]).toBeGreaterThan(150);
    expect(onKerb.spread[1]).toBeGreaterThan(5 * onRoad.spread[1]);
    // No snag: the car holds its line and its speed as it does on the road.
    expect(onKerb.yaw).toBeLessThan(0.05);
    expect(onKerb.worstOffset).toBeLessThan(0.5);
    expect(Math.abs(onKerb.speedChange - onRoad.speedChange)).toBeLessThan(0.5);
  });

  /**
   * At 80 km/h on the road, ease 25 m right onto the run-off (a gentle lane change, so the car
   * doesn't spin) and coast: the deceleration over the first second with all four wheels on it (m/s²).
   */
  async function slowingOn(def: TrackDef): Promise<number> {
    const s = await createSim(def);
    runUntil(s, followLine(s, 30), () => s.car.speed > 80 / 3.6, 20);
    const ease = followLine(s, 0, { offset: -25, lookahead: 3, minLookahead: 60 });
    const coast = () => controls({ steer: ease().steer });
    expect(runUntil(s, coast, () => s.car.wheels.every((w) => w.surface === def.runoff.surface), 10)).not.toBeNull();
    const v0 = s.car.speed;
    run(s, coast, 1);
    return v0 - s.car.speed;
  }

  it('stops a car far sooner in gravel than on grass', async () => {
    const grass = await slowingOn(GRASS_PAD);
    const gravel = await slowingOn(GRAVEL_PAD);
    // Gravel's drag is ~0.3 g against grass's ~0.1 g.
    expect(gravel).toBeGreaterThan(2 * grass);
    expect(gravel).toBeGreaterThan(2.5);
  });
});
