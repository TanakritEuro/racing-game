// Rally stages: open roads that end, the two stages and their rules, gravel as a road surface,
// pace notes, a run against the clock, and the rivals' times.

import { describe, expect, it } from 'vitest';
import { createAiDriver } from '../src/ai/driver';
import { rivalTimes } from '../src/ai/stageTimes';
import { TUNING } from '../src/config';
import { PHYSICS_STEP } from '../src/constants';
import { initPhysics } from '../src/physics';
import { TimeTrial } from '../src/race/session';
import { StageRun } from '../src/race/stage';
import { Simulation } from '../src/sim';
import { barriers, road, roadOf } from '../src/track/geometry';
import { noteText, paceNotes } from '../src/track/paceNotes';
import { HIGHTOR_PASS, KETTLE_WOOD, STAGES } from '../src/track/stages';
import { buildTrack, nearestSample, sampleIndex, type ControlPoint, type TrackDef } from '../src/track/track';
import { validateTrack } from '../src/track/validate';
import { controls, NO_CONTROLS } from '../src/vehicle/car';
import { KESTREL } from '../src/vehicle/cars';
import { createSim, run, runUntil, skidpadLimit } from './helpers';
import { LONG_OVAL, SKIDPAD } from './tracks';

/** A short test stage: straight east, then gentle bends north; gravel. */
const SHORT: TrackDef = {
  id: 'short-stage',
  name: 'Short stage',
  closed: false,
  surface: 'gravel',
  width: 8,
  runoff: { width: 4, surface: 'grass' },
  points: [
    { x: 0, z: 0 },
    { x: 300, z: 0 },
    { x: 600, z: 40 },
    { x: 850, z: 160 },
    { x: 1000, z: 380 },
    { x: 1050, z: 650 },
    { x: 1040, z: 950 },
    { x: 1000, z: 1250 },
  ],
};

/** Points round an arc (centre, radius, angles from +X towards +Z), ends excluded. */
function arc(cx: number, cz: number, r: number, a0: number, a1: number, count: number): ControlPoint[] {
  return Array.from({ length: count - 1 }, (_, k) => {
    const a = a0 + ((a1 - a0) * (k + 1)) / count;
    return { x: cx + r * Math.cos(a), z: cz + r * Math.sin(a) };
  });
}

describe('an open road', () => {
  const track = buildTrack(SHORT);
  const n = track.samples.length;

  it('runs from its start to its finish without wrapping round', () => {
    expect(track.closed).toBe(false);
    expect(track.samples[0].s).toBe(0);
    expect(track.samples[n - 1].s).toBeCloseTo(track.length, 6);
    expect(track.samples[0].x).toBeCloseTo(0, 6);
    expect(track.samples[n - 1].x).toBeCloseTo(1000, 6);
    expect(track.samples[n - 1].z).toBeCloseTo(1250, 6);
    // Held at its ends, not wrapped.
    expect(sampleIndex(track, -5)).toBe(0);
    expect(sampleIndex(track, n + 5)).toBe(n - 1);
    // Near the finish, the nearest sample is near the finish (not the start, 1.6 km away).
    expect(nearestSample(track, 1000, 1240, n - 3)).toBeGreaterThan(n - 10);
    expect(nearestSample(track, 0, 3, 2)).toBeLessThan(5);
  });

  it('builds a road, barriers and line that stop at the ends', () => {
    expect(road(track).indices.length).toBe((n - 1) * 6);
    for (const b of barriers(track)) expect(Math.hypot(b.centre.x - 500, b.centre.z - 600)).toBeLessThan(1100);
    // The road is gravel: one strip of it, none of asphalt.
    expect(roadOf(track, 'gravel')).toHaveLength(1);
    expect(roadOf(track, 'asphalt')).toHaveLength(0);
  });

  it('keeps every circuit exactly as it was', async () => {
    const { TEST_CIRCUIT } = await import('../src/track/circuits');
    const t = buildTrack(TEST_CIRCUIT);
    expect(t.closed).toBe(true);
    expect(road(t).indices.length).toBe(t.samples.length * 6);
    expect(t.samples.every((p) => p.surface === 'asphalt')).toBe(true);
  });
});

describe.each(STAGES.map((s) => [s.name, s] as const))('the stage %s', (_, def) => {
  it('keeps the stage rules, its start and finish well apart', () => {
    const track = buildTrack(def);
    expect(validateTrack(track)).toEqual([]);
    const a = track.samples[0];
    const b = track.samples[track.samples.length - 1];
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(500);
  });
});

describe('Hightor Pass', () => {
  it('climbs on tarmac and comes down on gravel', () => {
    const track = buildTrack(HIGHTOR_PASS);
    expect(track.samples[0].surface).toBe('asphalt');
    expect(track.samples[track.samples.length - 1].surface).toBe('gravel');
    expect(roadOf(track, 'asphalt').length).toBeGreaterThan(0);
    expect(roadOf(track, 'gravel').length).toBeGreaterThan(0);
    const top = Math.max(...track.samples.map((p) => p.y));
    expect(top).toBeGreaterThan(60);
  });
});

describe('gravel as a road surface', () => {
  const GRAVEL_PAD: TrackDef = { ...SKIDPAD, id: 'gravel-skidpad', surface: 'gravel' };

  it('corners less hard, gripping best further into a slide, and less again in the wet', async () => {
    const asphalt = await skidpadLimit(SKIDPAD, KESTREL);
    const gravel = await skidpadLimit(GRAVEL_PAD, KESTREL);
    const wet = await skidpadLimit(GRAVEL_PAD, KESTREL, 75, 'wet');
    expect(gravel.best).toBeLessThan(asphalt.best * 0.82);
    expect(gravel.best).toBeGreaterThan(asphalt.best * 0.65);
    expect(gravel.atBest.front).toBeGreaterThan(asphalt.atBest.front * 1.2);
    expect(wet.best).toBeLessThan(gravel.best * 0.8);
  }, 300_000);

  it('takes longer to stop', async () => {
    const stop = async (def: TrackDef) => {
      const c = await createSim(def, KESTREL);
      run(c, NO_CONTROLS, 1);
      runUntil(c, controls({ throttle: 1 }), () => c.car.speed > 100 / 3.6 + 0.5, 20);
      runUntil(c, NO_CONTROLS, () => c.car.speed < 100 / 3.6, 5);
      const from = { ...c.car.position };
      runUntil(c, controls({ brake: 1 }), () => c.car.speed < 0.05, 15);
      return Math.hypot(c.car.position.x - from.x, c.car.position.z - from.z);
    };
    const asphalt = await stop(LONG_OVAL);
    const gravel = await stop({ ...LONG_OVAL, id: 'gravel-oval', surface: 'gravel' });
    expect(gravel).toBeGreaterThan(asphalt * 1.25);
  }, 120_000);
});

describe('pace notes', () => {
  it('call a hairpin, a square left, a fast left and a crest, in order, with links and gaps', () => {
    // East 250 m; a hairpin right (r 15) back west; 40 m; a square left (r 35) south... then a fast left and a crest.
    const points: ControlPoint[] = [
      { x: 0, z: 0 },
      { x: 120, z: 0 },
      { x: 250, z: 0 },
      ...arc(250, 15, 15, -Math.PI / 2, Math.PI / 2, 6),
      { x: 250, z: 30 },
      { x: 215, z: 30 },
      ...arc(215, 65, 35, -Math.PI / 2, -Math.PI, 5),
      { x: 180, z: 65 },
      { x: 180, z: 200 },
      { x: 180, z: 330 },
      ...arc(360, 330, 180, Math.PI, Math.PI / 2 + 0.3, 6).map((p) => ({ ...p })),
      { x: 420, z: 520, y: 0 },
      { x: 520, z: 560, y: 8 },
      { x: 620, z: 600, y: 0 },
      { x: 720, z: 640, y: 0 },
    ];
    const track = buildTrack({ id: 'notes', name: 'Notes', closed: false, width: 7, runoff: { width: 3, surface: 'grass' }, points });
    const notes = paceNotes(track);
    const corners = notes.filter((x) => x.kind === 'corner');
    expect(corners[0].severity).toBe('hairpin');
    expect(corners[0].direction).toBe('right');
    expect(corners[1].direction).toBe('left');
    expect(corners[1].severity).toBeLessThanOrEqual(2);
    // The hairpin's exit runs straight into the square left.
    expect(corners[0].into).toBe(true);
    const fast = corners.find((c) => typeof c.severity === 'number' && c.severity >= 5 && c.direction === 'left');
    expect(fast).toBeDefined();
    expect(notes.some((x) => x.kind === 'crest' || x.crest)).toBe(true);
    // In order along the road, and said as a co-driver would.
    for (let i = 1; i < notes.length; i++) expect(notes[i].at).toBeGreaterThan(notes[i - 1].at);
    expect(noteText(corners[0])).toMatch(/^hairpin right/);
    expect(notes.some((x) => x.gap !== undefined && x.gap % 50 === 0)).toBe(true);
  });

  it('read Hightor Pass and Kettle Wood: hairpins up the pass, fast and crested in the woods', () => {
    const pass = paceNotes(buildTrack(HIGHTOR_PASS));
    expect(pass.filter((x) => x.severity === 'hairpin').length).toBeGreaterThanOrEqual(2);
    const wood = paceNotes(buildTrack(KETTLE_WOOD));
    expect(wood.length).toBeGreaterThan(20);
    expect(wood.some((x) => x.kind === 'crest' || x.crest)).toBe(true);
    expect(wood.filter((x) => x.severity === 'hairpin')).toHaveLength(0);
  });
});

describe('a stage run', () => {
  it('holds the car through the countdown, starts the clock at zero, splits, finishes and keeps the best', async () => {
    await initPhysics();
    const track = buildTrack(SHORT);
    const sim = new Simulation(track, KESTREL);
    const session = new TimeTrial(sim);
    const stage = new StageRun(sim);
    const start = { ...sim.car.position };
    // Flat out through the countdown: held.
    while (stage.phase === 'countdown') {
      stage.step(controls({ throttle: 1 }));
      session.afterStep(controls({ throttle: 1 }));
    }
    expect(Math.hypot(sim.car.position.x - start.x, sim.car.position.z - start.z)).toBeLessThan(0.3);
    expect(stage.clock).toBeCloseTo(0, 1);
    const ai = createAiDriver(track, KESTREL);
    let splits: number[] = [];
    for (let k = 0; k < 200 * 120 && stage.phase !== 'finished'; k++) {
      const c = ai.drive(sim.car, PHYSICS_STEP);
      stage.step(c);
      session.afterStep(c);
      splits = sim.timer.sectors.filter((s): s is number => s !== null);
    }
    expect(stage.phase).toBe('finished');
    expect(stage.result).toBeGreaterThan(30);
    expect(stage.result).toBe(sim.timer.lastLap);
    expect(splits.length).toBe(3);
    expect(splits.reduce((a, b) => a + b, 0)).toBeCloseTo(stage.result!, 3);
    // The run is kept: the ghost to beat next time.
    expect(session.ghost).not.toBeNull();
    expect(session.ghost!.lapTime).toBeCloseTo(stage.result!, 6);
  }, 120_000);

  it('adds a penalty for being put back on the road, and starts again from the line', async () => {
    await initPhysics();
    const sim = new Simulation(buildTrack(SHORT), KESTREL);
    const stage = new StageRun(sim);
    while (stage.phase === 'countdown') stage.step(NO_CONTROLS);
    for (let k = 0; k < 120 * 3; k++) stage.step(controls({ throttle: 1 }));
    const before = stage.clock!;
    stage.recover();
    expect(stage.penalties).toBe(TUNING.stage.penalty);
    expect(stage.clock! - before).toBeCloseTo(TUNING.stage.penalty, 3);
    stage.restart();
    expect(stage.phase).toBe('countdown');
    expect(stage.penalties).toBe(0);
    expect(stage.clock).toBeNull();
  });
});

describe('the rivals', () => {
  it('are spread by skill, fastest first, the same for the same seed; the AI at full pace runs among them', async () => {
    await initPhysics();
    const track = buildTrack(KETTLE_WOOD);
    const sim = new Simulation(track, KESTREL);
    const rivals = rivalTimes(track, KESTREL, 'hard', 'dry', 4, sim.timer.finish);
    expect(rivals).toHaveLength(7);
    for (let i = 1; i < rivals.length; i++) expect(rivals[i].time).toBeGreaterThanOrEqual(rivals[i - 1].time);
    expect(new Set(rivals.map((r) => r.driver)).size).toBe(7);
    expect(rivalTimes(track, KESTREL, 'hard', 'dry', 4, sim.timer.finish)).toEqual(rivals);
    // Easy rivals are slower; the wet slower still.
    const easy = rivalTimes(track, KESTREL, 'easy', 'dry', 4, sim.timer.finish);
    expect(easy[0].time).toBeGreaterThan(rivals[0].time);
    expect(rivalTimes(track, KESTREL, 'hard', 'wet', 4, sim.timer.finish)[0].time).toBeGreaterThan(rivals[0].time * 1.05);
    // The AI driving the stage flat out finishes among the hard rivals.
    const stage = new StageRun(sim);
    const ai = createAiDriver(track, KESTREL);
    for (let k = 0; k < 400 * 120 && stage.phase !== 'finished'; k++) {
      stage.step(stage.phase === 'countdown' ? NO_CONTROLS : ai.drive(sim.car, PHYSICS_STEP));
      if (ai.stuck) {
        stage.recover();
        ai.recovered();
      }
    }
    expect(stage.phase).toBe('finished');
    expect(stage.penalties).toBe(0);
    expect(stage.result!).toBeGreaterThan(rivals[0].time * 0.95);
    expect(stage.result!).toBeLessThan(rivals[6].time * 1.05);
  }, 300_000);
});
