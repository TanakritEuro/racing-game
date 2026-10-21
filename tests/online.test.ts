import { describe, expect, it } from 'vitest';
import { createAiDriver } from '../src/ai/driver';
import { PHYSICS_STEP } from '../src/constants';
import { loopback, type Loopback } from '../src/online/loopback';
import { parseMessage, type Message } from '../src/online/protocol';
import { guestHandshake, hostHandshake, OnlineError, OnlineRace, type OnlineSetup } from '../src/online/session';
import { cleanCustom, customId, ovalTemplate, type CustomCircuit } from '../src/track/custom';
import { initPhysics } from '../src/physics';
import { TEST_CIRCUIT } from '../src/track/circuits';
import { buildTrack, type Track } from '../src/track/track';
import { NO_CONTROLS, type Controls } from '../src/vehicle/car';
import type { CarDef } from '../src/vehicle/carDef';
import { CARS, FINCH, KESTREL, OSPREY, WREN } from '../src/vehicle/cars';
import type { Conditions } from '../src/track/weather';
import { progressAt, sampleCar, standingsAt, type RaceMoment, type RaceRecording } from '../src/race/raceRecording';
import { createRecordedState } from '../src/race/recording';

const NAMES = CARS.map((c) => c.name);
const TRACKS = [TEST_CIRCUIT.id];
/** The host's clock runs this far ahead of the guest's (s). */
const AHEAD = 3.7;
/** Frames every 2 ms of real time. */
const FRAME = 0.002;

let track: Track | null = null;

/** A host and a guest over a loopback with 50 ± 20 ms each way, on a shared virtual clock. */
async function pair(laps = 1, opponents = 0, conditions: Conditions = 'dry', hostCar: CarDef = KESTREL, guestCar: CarDef = WREN) {
  await initPhysics();
  track ??= buildTrack(TEST_CIRCUIT);
  const line = loopback({ delay: 0.05, jitter: 0.02, seed: 3 });
  const clock = { now: 0 };
  const host = hostHandshake(line.a, { track: TEST_CIRCUIT.id, laps, car: hostCar.name, opponents, conditions, time: 'night', wear: 'normal', custom: null }, NAMES);
  const guest = guestHandshake(line.b, guestCar.name, TRACKS, NAMES);
  await pump(line, clock, 0.3);
  const [hs, gs] = await Promise.all([host, guest]);
  expect(hs.theirs).toBe(guestCar.name);
  expect(gs.track).toBe(TEST_CIRCUIT.id);
  expect(gs.laps).toBe(laps);
  expect(gs.opponents).toBe(opponents);
  expect(gs.conditions).toBe(conditions);
  // The host's time of day too.
  expect(gs.time).toBe('night');
  expect(gs.wear).toBe('normal');
  const h = new OnlineRace(line.a, hs, track, hostCar, guestCar, { clock: () => clock.now + AHEAD, seed: 5, difficulty: 'hard' });
  // The guest takes a little longer to build its world.
  await pump(line, clock, 0.4);
  const g = new OnlineRace(line.b, gs, track, guestCar, hostCar, { clock: () => clock.now });
  return { line, clock, h, g };
}

/** Let `seconds` of real time pass on the line alone (the handshake: no races yet). */
async function pump(line: Loopback, clock: { now: number }, seconds: number): Promise<void> {
  const end = clock.now + seconds;
  while (clock.now < end) {
    clock.now += 0.01;
    line.advance(clock.now);
    await Promise.resolve();
  }
}

/** An AI at the wheel of an online race's car; `late` seconds slow away from the lights. */
function aiFor(race: OnlineRace, def: CarDef, late = 0): () => Controls {
  const ai = createAiDriver(race.track, def);
  return () => {
    if (race.held || (race.time ?? 0) < late) return NO_CONTROLS;
    const c = ai.drive(race.sim.car, PHYSICS_STEP);
    if (ai.stuck) {
      race.sim.recover();
      ai.recovered();
    }
    return c;
  };
}

describe('an online race', () => {
  it('starts both cars together, runs a whole race and agrees on the result, then a rematch', async () => {
    const { line, clock, h, g } = await pair(1);
    const hDrive = aiFor(h, KESTREL);
    const gDrive = aiFor(g, WREN, 2);
    const out: (number | null)[] = [null, null];
    let worst = 0;
    let compared = 0;
    while (clock.now < 200 && !(h.phase === 'finished' && g.phase === 'finished')) {
      clock.now += FRAME;
      line.advance(clock.now);
      h.advance(hDrive);
      g.advance(gDrive);
      if (out[0] === null && h.phase === 'racing') out[0] = clock.now;
      if (out[1] === null && g.phase === 'racing') out[1] = clock.now;
      // Where each side shows the other car, against where it really is, at the same step.
      if (h.phase === 'racing' && Math.abs(h.now - g.now) < 1e-4) {
        const shown = h.sim.proxies[0].current.position;
        const real = g.sim.current.position;
        worst = Math.max(worst, Math.hypot(shown.x - real.x, shown.y - real.y, shown.z - real.z));
        compared++;
      }
    }
    expect(h.closed).toBeNull();
    expect(g.closed).toBeNull();
    // Both were synced to one clock: the lights went out within 10 ms of each other.
    expect(h.outAt).toBe(g.outAt);
    expect(Math.abs(out[0]! - out[1]!)).toBeLessThan(0.01);
    // A whole race, the same two times on both sides, the same winner.
    expect(h.phase).toBe('finished');
    expect(g.phase).toBe('finished');
    expect(h.finishTimes[0]).toBeGreaterThan(40);
    expect(h.finishTimes).toEqual([g.finishTimes[1], g.finishTimes[0]]);
    expect(g.finishTimes[0]! - h.finishTimes[0]!).toBeGreaterThan(1);
    expect(h.standings()[0].car).toBe(0);
    expect(g.standings()[0].car).toBe(1);
    expect(g.standings()[1].gap).toBeCloseTo(g.finishTimes[0]! - g.finishTimes[1]!, 6);
    // The other car is shown where it is.
    expect(compared).toBeGreaterThan(1000);
    expect(worst).toBeLessThan(1);

    // Both ask for a rematch: back to the grid, new lights, laps from zero.
    h.requestRematch();
    expect(h.phase).toBe('finished');
    g.requestRematch();
    const until = clock.now + 0.5;
    while (clock.now < until) {
      clock.now += FRAME;
      line.advance(clock.now);
      h.advance(hDrive);
      g.advance(gDrive);
    }
    for (const r of [h, g]) {
      expect(r.phase).toBe('lights');
      expect(r.sim.timer.laps).toBe(0);
      expect(r.finishTimes).toEqual([null, null]);
      // The last race's recording is gone with it.
      expect(r.recorder.frameCount).toBe(0);
      expect(r.replayable).toBe(false);
    }
    expect(h.outAt).toBe(g.outAt);
  }, 240_000);

  it('runs AI opponents on the host, seen by the guest where the host has them, with one result and one recording', async () => {
    const { line, clock, h, g } = await pair(2, 3);
    expect(h.count).toBe(5);
    expect(g.count).toBe(5);
    expect(h.drivers.length).toBe(3);
    expect(g.drivers.length).toBe(0);
    expect(g.sim.proxies.length).toBe(4);
    const hDrive = aiFor(h, KESTREL);
    const gDrive = aiFor(g, WREN, 1);
    const errors: number[] = [];
    while (clock.now < 300 && !(h.phase === 'finished' && g.phase === 'finished')) {
      clock.now += FRAME;
      line.advance(clock.now);
      h.advance(hDrive);
      g.advance(gDrive);
      // The AI on the guest's screen, against the host's own cars, at the same step.
      if (h.phase === 'racing' && Math.abs(h.now - g.now) < 1e-4) {
        for (let k = 1; k <= 3; k++) {
          const shown = g.sim.proxies[k].current.position;
          const real = h.sim.cars[k].position;
          errors.push(Math.hypot(shown.x - real.x, shown.z - real.z));
        }
      }
    }
    expect(h.phase).toBe('finished');
    expect(g.phase).toBe('finished');
    // Close all the time, but for a moment after an AI car is put back on the track (the
    // guest sees the jump on its next state).
    errors.sort((a, b) => a - b);
    expect(errors[Math.floor(errors.length * 0.99)]).toBeLessThan(0.5);
    // Every car's time the same on both screens (the two players swap ids), and the same order.
    const swap = (id: number) => (id < 2 ? 1 - id : id);
    expect(g.finishTimes).toEqual(h.finishTimes.map((_, id) => h.finishTimes[swap(id)]));
    expect(h.finishTimes.every((t) => t !== null)).toBe(true);
    expect(g.standings().map((r) => swap(r.car))).toEqual(h.standings().map((r) => r.car));

    // Both sides recorded the race by car id from the lights (frame 0 at race time 0 on both)
    // until it was over, with every car's car.
    const hr = h.recording();
    const gr = g.recording();
    expect(h.replayable && g.replayable).toBe(true);
    expect(gr.cars).toEqual(hr.cars.map((_, id) => hr.cars[swap(id)]));
    expect(Math.abs(hr.count - gr.count)).toBeLessThan(30);
    // The same finishes, in the order of the result.
    const moments = (rec: RaceRecording, kind: RaceMoment['kind'], id: (car: number) => number) => rec.moments.filter((m) => m.kind === kind).map((m) => ({ ...m, cars: m.cars.map(id) }));
    const mine = (c: number) => c;
    expect(moments(gr, 'finish', swap)).toEqual(moments(hr, 'finish', mine));
    expect(moments(hr, 'finish', mine).map((m) => m.cars[0])).toEqual(h.standings().map((r) => r.car));
    // The same fastest laps, within a frame or two; the same passes, from much the same moment
    // (a pass is timed from when the places first changed, which side by side can be a few frames apart).
    for (const [kind, within] of [
      ['fastestLap', 2.5 * hr.frameDt],
      ['pass', 0.2],
    ] as const) {
      const ours = moments(hr, kind, mine);
      const theirs = moments(gr, kind, swap);
      expect(theirs.map((m) => m.cars)).toEqual(ours.map((m) => m.cars));
      theirs.forEach((m, i) => expect(Math.abs(m.time - ours[i].time)).toBeLessThan(within));
    }
    expect(moments(hr, 'pass', mine).length).toBeGreaterThan(0);
    expect(moments(hr, 'fastestLap', mine).length).toBeGreaterThan(0);
    // The places all through the race: the same at every frame, or within a frame or two of it
    // (bar cars side by side, within a metre: the other side knows a car to a few tenths).
    const order = (rec: RaceRecording, t: number, id: (car: number) => number) => standingsAt(rec, t).map((r) => id(r.car));
    const same = (x: number[], y: number[]) => x.join() === y.join();
    const frames = Math.min(hr.count, gr.count);
    let differ = 0;
    for (let k = 0; k < frames; k++) {
      const t = k * hr.frameDt;
      const ours = order(hr, t, mine);
      const theirs = order(gr, t, swap);
      if (same(ours, theirs)) continue;
      differ++;
      if ([-2, -1, 1, 2].some((d) => same(order(gr, t + d * gr.frameDt, swap), ours))) continue;
      for (let i = 0; i < theirs.length; i++)
        for (let j = i + 1; j < theirs.length; j++)
          if (ours.indexOf(theirs[i]) > ours.indexOf(theirs[j])) expect(Math.abs(progressAt(hr, theirs[i], t) - progressAt(hr, theirs[j], t)) * track!.length).toBeLessThan(1);
    }
    expect(differ).toBeLessThan(frames * 0.01);
    // Every car where the other side has it too.
    const a = createRecordedState();
    const b = createRecordedState();
    const apart: number[] = [];
    for (let k = 0; k < frames; k += 3)
      for (let id = 0; id < hr.cars.length; id++) {
        sampleCar(hr, id, k * hr.frameDt, a);
        sampleCar(gr, swap(id), k * gr.frameDt, b);
        apart.push(Math.hypot(a.pose.position.x - b.pose.position.x, a.pose.position.z - b.pose.position.z));
      }
    apart.sort((x, y) => x - y);
    expect(apart[Math.floor(apart.length * 0.99)]).toBeLessThan(0.5);
  }, 300_000);

  it('makes the other car a ghost while its states are stale, and solid again once clear', async () => {
    const { line, clock, h, g } = await pair();
    const run = (seconds: number, guest = true) => {
      const end = clock.now + seconds;
      while (clock.now < end) {
        clock.now += 0.01;
        line.advance(clock.now);
        h.advance(() => NO_CONTROLS);
        if (guest) g.advance(() => NO_CONTROLS);
      }
    };
    const solid = () => h.sim.proxies[0].collider.isEnabled();
    run(3);
    expect(solid()).toBe(true);
    // The guest's tab stops running frames: no more states.
    run(1, false);
    expect(solid()).toBe(false);
    // Back, but where the host's car is (as after being put back on the track): still a ghost.
    g.sim.car.reset(h.sim.gridPose(0));
    run(1);
    expect(solid()).toBe(false);
    // Once it is clear (moved away up the road), solid again.
    const s = g.sim.track.samples[40];
    g.sim.car.reset({ position: { x: s.x, y: s.y, z: s.z }, rotation: g.sim.current.rotation });
    run(1);
    expect(solid()).toBe(true);
  }, 60_000);

  it('ends on both sides when one leaves, or when the line goes quiet', async () => {
    for (const how of ['leave', 'cut'] as const) {
      const { line, clock, h, g } = await pair();
      const run = (seconds: number) => {
        const end = clock.now + seconds;
        while (clock.now < end) {
          clock.now += 0.01;
          line.advance(clock.now);
          h.advance(() => NO_CONTROLS);
          g.advance(() => NO_CONTROLS);
        }
      };
      run(2);
      expect(h.phase).toBe('lights');
      expect(g.phase).toBe('lights');
      if (how === 'leave') {
        g.leave();
        run(0.5);
      } else {
        line.cut();
        run(5);
        expect(h.closed).toBeNull();
        run(1.5);
      }
      expect(h.closed).not.toBeNull();
      expect(g.closed).not.toBeNull();
    }
  }, 60_000);

  it('races an all-wheel-drive Osprey against a front-wheel-drive Finch, each shown where it is', async () => {
    const { line, clock, h, g } = await pair(1, 0, 'dry', OSPREY, FINCH);
    expect(h.sim.car.def.drivetrain.layout).toBe('awd');
    expect(g.sim.car.def.drivetrain.layout).toBe('fwd');
    const hDrive = aiFor(h, OSPREY);
    const gDrive = aiFor(g, FINCH);
    let worst = 0;
    while (clock.now < 30) {
      clock.now += FRAME;
      line.advance(clock.now);
      h.advance(hDrive);
      g.advance(gDrive);
      if (h.phase === 'racing' && Math.abs(h.now - g.now) < 1e-4) {
        for (const [shown, real] of [
          [h.sim.proxies[0].current.position, g.sim.current.position],
          [g.sim.proxies[0].current.position, h.sim.current.position],
        ]) worst = Math.max(worst, Math.hypot(shown.x - real.x, shown.y - real.y, shown.z - real.z));
      }
    }
    expect(h.closed).toBeNull();
    expect(h.phase).toBe('racing');
    // Both away and lapping: the Osprey ahead after its launch.
    expect(h.sim.car.speed).toBeGreaterThan(20);
    expect(g.sim.car.speed).toBeGreaterThan(20);
    expect(h.standings()[0].car).toBe(0);
    expect(worst).toBeLessThan(1);
  }, 240_000);

  it('races in the host’s weather on both sides', async () => {
    const { h, g } = await pair(1, 2, 'wet');
    expect(h.sim.conditions).toBe('wet');
    expect(g.sim.conditions).toBe('wet');
    expect(h.drivers.length).toBe(2);
    // Tyres wear (the host chose normal) and every car carries the race's fuel.
    for (const car of [...h.sim.cars, ...g.sim.cars]) {
      expect(car.wearRate).toBe(1);
      expect(car.fuel).toBeGreaterThan(0);
    }
  });

  it('sends the guest a custom circuit it does not have, and refuses one that breaks the rules', async () => {
    const shake = async (custom: CustomCircuit) => {
      const line = loopback({ delay: 0.02 });
      const clock = { now: 0 };
      const id = customId(custom);
      const host = hostHandshake(line.a, { track: id, laps: 2, car: 'Kestrel', opponents: 0, conditions: 'dry', time: 'day', wear: 'off', custom }, NAMES);
      // The guest knows only the built-in circuits.
      const guest = guestHandshake(line.b, 'Wren', TRACKS, NAMES).then(
        (s) => s,
        (e: unknown) => e,
      );
      await pump(line, clock, 0.3);
      void host.catch(() => {});
      return guest;
    };
    const good = cleanCustom(ovalTemplate('Ours'))!;
    const got = (await shake(good)) as OnlineSetup;
    expect(got.custom).toEqual(good);
    expect(got.track).toBe(customId(good));
    // Squashed until it overlaps itself: still a circuit's shape, but not a circuit.
    const bad = cleanCustom({ ...good, points: good.points.map((p) => ({ ...p, z: p.z * 0.12 })) })!;
    expect(await shake(bad)).toBeInstanceOf(OnlineError);
  });

  it('turns away a guest with another version', async () => {
    const line = loopback({ delay: 0.02 });
    const clock = { now: 0 };
    const host = hostHandshake(line.a, { track: TEST_CIRCUIT.id, laps: 3, car: 'Kestrel', opponents: 0, conditions: 'dry', time: 'day', wear: 'off', custom: null }, NAMES);
    const heard: (Message | null)[] = [];
    line.b.onMessage = (raw) => heard.push(parseMessage(raw));
    line.b.send({ type: 'hello', version: 0, car: 'Wren' });
    const failed = host.then(
      () => null,
      (e: unknown) => e,
    );
    await pump(line, clock, 0.2);
    expect(await failed).toBeInstanceOf(OnlineError);
    expect(heard[0]?.type).toBe('reject');
  });
});
