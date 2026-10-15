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
import { carEnvelope } from './ai/envelope';
import { racingLine } from './ai/racingLine';
import { speedProfile } from './ai/speedProfile';
import { createLineView } from './render/lineView';
import { bestKey, openBestStore } from './storage/bests';
import { CIRCUITS } from './track/circuits';
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
const sim = new Simulation(track);

const stage = createStage(canvas);
stage.scene.add(createTrackView(track, sim.physics.terrain));
if (circuit.scenery) stage.scene.add(createSceneryView(layoutScenery(track, sim.physics.terrain, circuit.scenery)));
const carView = new CarView(
  sim.car.def,
  sim.car.wheels.map((w) => w.mount),
);
stage.scene.add(carView.root);
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
const params = new URLSearchParams(location.search);
telemetry.visible = params.has('telemetry');
// ?line draws the AI's racing line, coloured by its target speed.
if (params.has('line')) {
  const line = racingLine(track, sim.car.def.halfExtents.x);
  stage.scene.add(createLineView(track, line, speedProfile(line, carEnvelope(sim.car.def))));
}
// ?debug exposes the simulation in the console, for poking at it while developing.
if (params.has('debug')) Object.assign(window, { sim, poseOnTrack, session: () => session, step: (c: Controls) => step(c), replay: () => replay });

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
    session.restart();
    input.reset();
    cameras.snap();
  }
  if (e.code === 'KeyM') settings.gearbox = settings.gearbox === 'auto' ? 'manual' : 'auto';
  if (['KeyC', 'KeyV', 'KeyZ', 'KeyX', 'KeyM', 'KeyG'].includes(e.code)) applySettings();
  if (e.code === 'KeyR') recover();
});

/** One physics step and what follows it. */
function step(c: Controls): void {
  controls = c;
  sim.step(c);
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
  ghost.update(session.ghost, t, settings.ghost && session.ghost !== rec);
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
    step(input.controls(sim.car, PHYSICS_STEP));
    accumulator -= PHYSICS_STEP;
  }

  // Draw the car the right fraction of the way into the step that hasn't happened yet.
  interpolatePose(sim.previous, sim.current, accumulator / PHYSICS_STEP, drawn);
  carView.update(drawn);
  // The ghost at the same moment between steps as the car is drawn.
  const lapTime = session.lapTime;
  ghost.update(session.ghost, lapTime === null ? null : lapTime - PHYSICS_STEP * (1 - accumulator / PHYSICS_STEP), settings.ghost);
  minimap.update(drawn);
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
