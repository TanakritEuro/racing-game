import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { puddles, puddleSpan } from '../src/track/puddles';
import { nearestSample } from '../src/track/track';
import { surfaceGrip, wetness, type Conditions } from '../src/track/weather';
import { controls, NO_CONTROLS, poseOnTrack } from '../src/vehicle/car';
import { createSim, followLine, run, runUntil, skidpadLimit } from './helpers';
import { HILL, LONG_OVAL, SKIDPAD } from './tracks';

const KMH_100 = 100 / 3.6;

describe('surface grip in the weather', () => {
  it('is the surfaces’ own grip exactly when dry', () => {
    for (const tag of ['asphalt', 'kerb', 'grass', 'gravel'] as const) {
      expect(surfaceGrip(tag, 0, 40)).toEqual(TUNING.surfaces[tag]);
    }
    // Water only stands on a wet road; dry, it is just road.
    expect(surfaceGrip('water', 0, 40)).toEqual(TUNING.surfaces.asphalt);
  });

  it('falls when wet, painted kerbs most, damp half way', () => {
    expect(surfaceGrip('asphalt', 1, 0).grip).toBeCloseTo(0.72, 9);
    expect(surfaceGrip('kerb', 1, 0).grip).toBeCloseTo(0.5, 9);
    expect(surfaceGrip('grass', 1, 0).grip).toBeCloseTo(TUNING.surfaces.grass.grip * 0.75, 9);
    expect(surfaceGrip('asphalt', wetness('damp'), 0).grip).toBeCloseTo(0.86, 9);
  });

  it('floats the tyre on standing water only at speed', () => {
    const road = surfaceGrip('asphalt', 1, 50).grip;
    expect(surfaceGrip('water', 1, 10).grip / road).toBeCloseTo(0.85, 9);
    expect(surfaceGrip('water', 1, 50).grip / road).toBeLessThan(0.3);
    expect(surfaceGrip('water', 1, 50).drag).toBeGreaterThan(0);
  });
});

describe('driving in the wet', () => {
  it('corners at about three quarters of the dry grip', async () => {
    const dry = await skidpadLimit(SKIDPAD, undefined, 60);
    const wet = await skidpadLimit(SKIDPAD, undefined, 60, 'wet');
    expect(wet.best).toBeGreaterThan(0.6);
    expect(wet.best).toBeLessThan(0.82);
    expect(wet.best / dry.best).toBeGreaterThan(0.65);
    expect(wet.best / dry.best).toBeLessThan(0.82);
  }, 180_000);

  it('takes about a third longer to stop from 100 km/h (ABS on)', async () => {
    const stop = async (conditions: Conditions) => {
      const s = await createSim(LONG_OVAL, undefined, conditions);
      run(s, NO_CONTROLS, 1);
      runUntil(s, controls({ throttle: 1 }), () => s.car.speed > KMH_100 + 0.5, 20);
      runUntil(s, NO_CONTROLS, () => s.car.speed < KMH_100, 5);
      const from = { ...s.car.position };
      runUntil(s, controls({ brake: 1 }), () => s.car.speed < 0.05, 15);
      return Math.hypot(s.car.position.x - from.x, s.car.position.z - from.z);
    };
    const ratio = (await stop('wet')) / (await stop('dry'));
    expect(ratio).toBeGreaterThan(1.2);
    expect(ratio).toBeLessThan(1.55);
  }, 120_000);

  it('loses most of its grip in standing water at speed, and little slowly', async () => {
    // The first puddle on the long oval's first straight, driven through its middle.
    const probe = await createSim(LONG_OVAL, undefined, 'wet');
    const { track } = probe;
    const n = track.samples.length;
    const pd = puddles(track).find((p) => track.samples[p.first].s > 1500 && track.samples[p.last].s < 4300)!;
    expect(pd).toBeDefined();
    const mid = track.samples[(pd.first + Math.floor(((pd.last - pd.first + n) % n) / 2)) % n];
    const [a, b] = puddleSpan(pd, mid);
    const through = async (speed: number) => {
      const s = await createSim(LONG_OVAL, undefined, 'wet');
      const drive = followLine(s, speed, { offset: (a + b) / 2 });
      // μ the road gives (grip limit per newton of load), on the wet road and in the water.
      let road = 0;
      let water = Infinity;
      runUntil(
        s,
        drive,
        () => {
          for (const w of s.car.wheels) {
            if (!w.contact || w.load < 1000) continue;
            if (w.surface === 'water') water = Math.min(water, w.gripLimit / w.load);
            else if (w.surface === 'asphalt') road = w.gripLimit / w.load;
          }
          return nearestSample(track, s.car.position.x, s.car.position.z) === pd.last;
        },
        120,
      );
      return water / road;
    };
    expect(await through(50)).toBeLessThan(0.4);
    expect(await through(15)).toBeGreaterThan(0.75);
  }, 180_000);

  it('still holds still with the brake on a wet 10° slope', async () => {
    const s = await createSim(HILL, undefined, 'wet');
    const i = nearestSample(s.track, 200, 0);
    s.car.reset(poseOnTrack(s.track.samples[i]));
    run(s, controls({ brake: 1 }), 2);
    const from = { ...s.car.position };
    run(s, controls({ brake: 1 }), 10);
    expect(Math.hypot(s.car.position.x - from.x, s.car.position.z - from.z)).toBeLessThan(0.01);
  });
});
