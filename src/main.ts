// Entry point: builds the simulation and the view, then runs fixed physics steps with
// variable-rate rendering. Everything that affects the result happens inside sim.step().

import { PHYSICS_STEP } from './constants';
import { PlayerInput } from './input';
import { initPhysics } from './physics';
import { CarView } from './render/carView';
import { CameraRig } from './render/cameras';
import { Minimap } from './render/minimap';
import { createStage, followSun } from './render/scene';
import { Telemetry } from './render/telemetry';
import { createSceneryView } from './render/scenery';
import { createTrackView } from './render/trackView';
import { layoutScenery } from './track/scenery';
import { loadSettings, saveSettings } from './settings';
import { TimeTrial, type LapEvent } from './race/session';
import { GhostView } from './render/ghostView';
import { Simulation } from './sim';
import { TimingHud } from './ui/timingHud';
import { createRecordedState, duration, sampleRecording, type LapRecording } from './race/recording';
import { formatLapTime } from './race/timing';
import { Replay, REPLAY_SPEEDS } from './replay/replay';
import { TvCameraView } from './render/tvCameras';
import { placeTvCameras } from './track/cameras';
import { circuitAi, createAiDriver } from './ai/driver';
import { speedProfile } from './ai/speedProfile';
import { createLineView } from './render/lineView';
import { bestKey, openBestStore } from './storage/bests';
import { CIRCUITS } from './track/circuits';
import { DEFAULT_RACE, Race, type RaceOptions } from './race/race';
import { DIFFICULTIES, type Difficulty } from './ai/skill';
import { RaceHud } from './ui/raceHud';
import { buildTrack } from './track/track';
import { NO_CONTROLS, poseOnTrack, type Controls } from './vehicle/car';
import { createPose, interpolatePose } from './vehicle/pose';
import { NEUTRAL, REVERSE } from './vehicle/gearbox';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const hud = {
  speed: document.querySelector<HTMLDivElement>('#speed')!,
  gear: document.querySelector<HTMLDivElement>('#gear')!,
  rpm: document.querySelector<HTMLDivElement>('#rpm-fill')!,
  abs: document.querySelector<HTMLSpanElement>('#abs-light')!,
  tc: document.querySelector<HTMLSpanElement>('#tc-light')!,
  assist: document.querySelector<HTMLSpanElement>('#assist-light')!,
};

const gearLabel = (gear: number) => (gear === REVERSE ? 'R' : gear === NEUTRAL ? 'N' : String(gear));

await initPhysics();
// The circuit: ?track=<id>, the first by default. N moves on to the next (until the M6 menus).
const circuit = CIRCUITS.find((c) => c.id === new URLSearchParams(location.search).get('track')) ?? CIRCUITS[0];
const track = buildTrack(circuit);
document.querySelector('#track-name')!.textContent = circuit.name.toUpperCase();
const params = new URLSearchParams(location.search);
// Race mode (?mode=race, Tab switches): ?difficulty=easy|medium|hard, ?opponents=0..7, ?laps=N.
const race = params.get('mode') === 'race' ? new Race(track, raceOptions(params)) : null;
const sim = race ? race.sim : new Simulation(track);

function raceOptions(p: URLSearchParams): RaceOptions {
  const int = (name: string, lo: number, hi: number, fallback: number) => {
    const v = Number.parseInt(p.get(name) ?? '', 10);
    return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
  };
  const difficulty = p.get('difficulty');
  return {
    opponents: int('opponents', 0, 7, DEFAULT_RACE.opponents),
    laps: int('laps', 1, 50, DEFAULT_RACE.laps),
    difficulty: DIFFICULTIES.includes(difficulty as Difficulty) ? (difficulty as Difficulty) : DEFAULT_RACE.difficulty,
    // A different race each time, unless ?seed= asks for a particular one.
    seed: int('seed', 1, 2 ** 30, 1 + Math.floor(Math.random() * 2 ** 30)),
  };
}

const stage = createStage(canvas);
stage.scene.add(createTrackView(track, sim.physics.terrain));
if (circuit.scenery) stage.scene.add(createSceneryView(layoutScenery(track, sim.physics.terrain, circuit.scenery)));
const carView = new CarView(
  sim.car.def,
  sim.car.wheels.map((w) => w.mount),
);
stage.scene.add(carView.root);
// The other cars, each in its own colour.
const AI_COLOURS = [0xd8342c, 0x2f6fd8, 0x2fa84f, 0xeeeeee, 0xf08a24, 0x8e44c8, 0x1fb5b0];
const others = sim.cars.slice(1).map((car, k) => {
  const view = new CarView(car.def, car.wheels.map((w) => w.mount), AI_COLOURS[k % AI_COLOURS.length]);
  stage.scene.add(view.root);
  return { view, drawn: createPose(), colour: `#${AI_COLOURS[k % AI_COLOURS.length].toString(16).padStart(6, '0')}` };
});
const raceHud = race ? new RaceHud(document.querySelector<HTMLDivElement>('#hud')!) : null;
const cameras = new CameraRig(stage.camera, sim.car.def);
const drawn = createPose();
const session = new TimeTrial(sim);
const ghost = new GhostView(
  sim.car.def,
  sim.car.wheels.map((w) => w.mount),
);
stage.scene.add(ghost.root);
const replay = new Replay();
const replayState = createRecordedState();
const tv = new TvCameraView(stage.camera, track, placeTvCameras(track, sim.physics.terrain));
const replayHud = {
  title: document.querySelector<HTMLDivElement>('#replay .r-title')!,
  time: document.querySelector<HTMLDivElement>('#replay .r-time')!,
};
const input = new PlayerInput();
const steering = input.steering;
let controls = NO_CONTROLS;
const telemetry = new Telemetry(document.body);
const timing = new TimingHud(document.querySelector<HTMLDivElement>('#timing')!);
const minimap = new Minimap(document.querySelector<HTMLDivElement>('#hud')!, track);
telemetry.visible = params.has('telemetry');
// ?line draws the AI's racing line, coloured by its target speed.
if (params.has('line')) {
  const { line, env } = circuitAi(track, sim.car.def);
  stage.scene.add(createLineView(track, line, speedProfile(line, env)));
}
// ?autopilot hands your car to the AI (for watching it, and checking it).
const autopilot = params.has('autopilot') ? createAiDriver(track, sim.car.def) : null;
// ?debug exposes the simulation in the console, for poking at it while developing.
if (params.has('debug')) Object.assign(window, { sim, race, poseOnTrack, session: () => session, step: (c: Controls) => step(c), replay: () => replay, autopilot });

// Bests from earlier visits: the ghost, the delta and the sector colours carry on from them.
const store = await openBestStore();
const key = bestKey(circuit.id, sim.car.def.name);
const stored = await store.load(key, session.fingerprint);
if (stored) session.loadBest(stored.lap, stored.timeAtSample, stored.bestSectors);
const NOT_KEPT = 'Bests are not kept in this browser';
if (!store.persistent) timing.note = NOT_KEPT;
let savedSectors = JSON.stringify(sim.timer.bestSectors);

/** After a lap: keep a new best lap, or a new best sector. */
function keepBests(event: LapEvent): void {
  // Race laps (in traffic, from a standing start) aren't time-trial bests.
  if (race) return;
  const bests = session.bests();
  const sectors = JSON.stringify(sim.timer.bestSectors);
  if (!bests || (event !== 'best' && sectors === savedSectors)) return;
  savedSectors = sectors;
  void store.save({ key, fingerprint: session.fingerprint, ...bests }).then((ok) => {
    if (!ok) timing.note = NOT_KEPT;
  });
}

// Settings: remembered between visits, applied to the simulation through its setters.
const settings = loadSettings();
function applySettings(): void {
  sim.setAids({ abs: settings.abs, tc: settings.tc });
  sim.setGearboxMode(settings.gearbox);
  steering.assist = settings.steeringAssist;
  if (cameras.mode !== settings.camera) cameras.setMode(settings.camera);
  saveSettings(settings);
}
applySettings();

window.addEventListener('keydown', (e) => {
  if (replay.active) {
    replayKey(e);
    return;
  }
  if (e.repeat) return;
  if (e.code === 'KeyP') {
    if (e.shiftKey) startReplay(session.ghost, 'BEST LAP');
    else startReplay(session.lastLap, 'LAST LAP');
  }
  if (e.code === 'KeyT') telemetry.toggle();
  if (e.code === 'KeyN') {
    const next = CIRCUITS[(CIRCUITS.indexOf(circuit) + 1) % CIRCUITS.length];
    params.set('track', next.id);
    location.search = params.toString();
  }
  if (e.code === 'KeyC') {
    cameras.cycle();
    settings.camera = cameras.mode;
  }
  if (e.code === 'KeyV') settings.steeringAssist = !settings.steeringAssist;
  if (e.code === 'KeyZ') settings.abs = !settings.abs;
  if (e.code === 'KeyX') settings.tc = !settings.tc;
  if (e.code === 'KeyG') settings.ghost = !settings.ghost;
  if (e.code === 'Backspace') {
    e.preventDefault();
    if (race) {
      race.restart();
      session.forgetLap();
    } else session.restart();
    input.reset();
    cameras.snap();
  }
  if (e.code === 'Tab') {
    e.preventDefault();
    if (race) params.delete('mode');
    else params.set('mode', 'race');
    location.search = params.toString();
  }
  if (e.code === 'KeyM') settings.gearbox = settings.gearbox === 'auto' ? 'manual' : 'auto';
  if (['KeyC', 'KeyV', 'KeyZ', 'KeyX', 'KeyM', 'KeyG'].includes(e.code)) applySettings();
  if (e.code === 'KeyR') recover();
});

/** One physics step and what follows it. */
function step(c: Controls): void {
  controls = c;
  if (race) race.step(c);
  else sim.step(c);
  const event = session.afterStep(c);
  if (event) keepBests(event);
}

/** Watch `rec` from the TV cameras; live driving waits until it ends. */
function startReplay(rec: LapRecording | null, caption: string): void {
  if (!rec) return;
  replay.play(rec, caption);
  document.body.classList.add('replaying');
}

function endReplay(): void {
  replay.stop();
  document.body.classList.remove('replaying');
  cameras.setMode(cameras.mode);
  input.reset();
}

function replayKey(e: KeyboardEvent): void {
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) replay.togglePause();
  }
  if (e.code === 'ArrowLeft') replay.scrub(-2);
  if (e.code === 'ArrowRight') replay.scrub(2);
  const speed = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
  if (speed >= 0) replay.speed = REPLAY_SPEEDS[speed];
  if (e.code === 'Escape' || (e.code === 'KeyP' && !e.repeat)) endReplay();
  if (e.code === 'KeyT' && !e.repeat) telemetry.toggle();
}

/** A frame of the replay: the recorded car (and the ghost beside it) from the TV cameras. */
function drawReplay(t: number, dt: number): void {
  const rec = replay.recording!;
  sampleRecording(rec, t, replayState);
  carView.update(replayState.pose);
  // Only your car is recorded: the others stay out of the replay.
  for (const o of others) o.view.root.visible = false;
  ghost.update(session.ghost, t, settings.ghost && !race && session.ghost !== rec);
  minimap.update(replayState.pose);
  tv.update(replayState.pose, dt, replay.jumped);
  replay.jumped = false;
  followSun(stage.sun, carView.root.position);
  const valid = rec.valid ? '' : '  (INVALID)';
  replayHud.title.textContent = `REPLAY · ${replay.caption} ${formatLapTime(rec.lapTime)}${valid}`;
  const state = replay.paused ? 'PAUSED' : `${replay.speed}×`;
  replayHud.time.textContent = `${formatLapTime(t)} / ${formatLapTime(duration(rec))}  ·  ${state}`;
  hud.speed.textContent = String(Math.round(Math.abs(replayState.speed) * 3.6));
  hud.gear.textContent = gearLabel(Math.round(replayState.gear));
  hud.rpm.style.width = `${Math.min(100, (replayState.rpm / sim.car.def.engine.limiterRpm) * 100)}%`;
}

function recover(): void {
  sim.recover();
  input.reset();
  cameras.snap();
}

function updateHud(): void {
  hud.speed.textContent = String(Math.round(Math.abs(sim.car.speed) * 3.6));
  const drivetrain = sim.car.drivetrain;
  hud.gear.textContent = `${gearLabel(drivetrain.gearbox.nextGear)} ${drivetrain.gearbox.mode === 'auto' ? 'AUTO' : 'MANUAL'}`;
  hud.rpm.style.width = `${Math.min(100, (drivetrain.rpm / sim.car.def.engine.limiterRpm) * 100)}%`;
  hud.rpm.classList.toggle('limit', drivetrain.rpm > sim.car.def.gearbox.upshiftRpm.full);
  // Dashboard lights: dim when off, lit when on, bright while working.
  const light = (el: HTMLElement, on: boolean, active: boolean) => {
    el.classList.toggle('on', on);
    el.classList.toggle('active', on && active);
  };
  light(hud.abs, sim.car.aids.abs, sim.car.absActive);
  light(hud.tc, sim.car.aids.tc, sim.car.tcActive);
  light(hud.assist, steering.assist, false);
  timing.update(sim.timer, sim.time);
  if (race) raceHud?.update(race);
}

let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  accumulator += dt;
  const pad = input.poll();
  if (pad.camera) {
    cameras.cycle();
    settings.camera = cameras.mode;
    saveSettings(settings);
  }
  if (replay.active) {
    // Live driving waits: no steps, and no catching up afterwards.
    accumulator = 0;
    const t = replay.update(dt);
    if (t === null) endReplay();
    else {
      drawReplay(t, dt);
      stage.renderer.render(stage.scene, stage.camera);
      requestAnimationFrame(frame);
      return;
    }
  }
  if (pad.reset) recover();
  while (accumulator >= PHYSICS_STEP) {
    if (autopilot) {
      race?.traffic.advise(0, autopilot, PHYSICS_STEP, sim.timer.laps < 1);
      step(autopilot.drive(sim.car, PHYSICS_STEP));
      if (autopilot.stuck) {
        recover();
        autopilot.recovered();
      }
    } else step(input.controls(sim.car, PHYSICS_STEP));
    accumulator -= PHYSICS_STEP;
  }

  // Draw the car the right fraction of the way into the step that hasn't happened yet.
  interpolatePose(sim.previous, sim.current, accumulator / PHYSICS_STEP, drawn);
  carView.update(drawn);
  others.forEach((o, k) => {
    const poses = sim.poses[k + 1];
    interpolatePose(poses.previous, poses.current, accumulator / PHYSICS_STEP, o.drawn);
    o.view.root.visible = true;
    o.view.update(o.drawn);
  });
  // The ghost at the same moment between steps as the car is drawn (not in a race).
  const lapTime = session.lapTime;
  ghost.update(session.ghost, lapTime === null ? null : lapTime - PHYSICS_STEP * (1 - accumulator / PHYSICS_STEP), settings.ghost && !race);
  minimap.update(
    drawn,
    others.map((o) => ({ x: o.drawn.position.x, z: o.drawn.position.z, colour: o.colour })),
  );
  cameras.update(drawn, dt);
  followSun(stage.sun, carView.root.position);
  updateHud();
  telemetry.update({
    time: sim.time,
    speed: sim.car.speed,
    wheels: sim.car.wheels,
    controls,
    rpm: sim.car.drivetrain.rpm,
    gear: `${gearLabel(sim.car.drivetrain.gearbox.nextGear)}  clutch ${sim.car.drivetrain.clutch.toFixed(2)}  tc ${sim.car.drivetrain.tcFactor.toFixed(2)}`,
  });
  stage.renderer.render(stage.scene, stage.camera);
  requestAnimationFrame(frame);
}

document.querySelector('#loading')?.remove();
requestAnimationFrame(frame);
