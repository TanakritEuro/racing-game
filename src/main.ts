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
import { Effects } from './render/effects';
import { Dashboard } from './ui/dashboard';
import { Menu } from './ui/menu';
import { StandingsScreen } from './ui/standings';
import { finishingOrder, newSeason, nextRound, recordRound, roundRace, seasonOver, standings } from './race/championship';
import { loadSeason, saveSeason } from './storage/season';
import { GameAudio, type Listener } from './audio';
import { Sound } from './audio/sound';
import { placeTvCameras } from './track/cameras';
import { circuitAi, createAiDriver } from './ai/driver';
import { speedProfile } from './ai/speedProfile';
import { createLineView } from './render/lineView';
import { bestKey, openBestStore } from './storage/bests';
import { CIRCUITS } from './track/circuits';
import { DEFAULT_RACE, Race, type RaceOptions } from './race/race';
import { DIFFICULTIES, type Difficulty } from './ai/skill';
import { carName, RaceHud } from './ui/raceHud';
import { buildTrack, trackFingerprint } from './track/track';
import { NO_CONTROLS, poseOnTrack, type Controls } from './vehicle/car';
import { CARS, KESTREL } from './vehicle/cars';
import { createPose, interpolatePose } from './vehicle/pose';
import { NEUTRAL, REVERSE } from './vehicle/gearbox';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const dash = new Dashboard(document.querySelector<HTMLDivElement>('#dash')!);

const gearLabel = (gear: number) => (gear === REVERSE ? 'R' : gear === NEUTRAL ? 'N' : String(gear));

await initPhysics();
// The circuit: ?track=<id> (N moves on to the next), or the start menu's choice.
const params = new URLSearchParams(location.search);
// Settings: remembered between visits, applied to the simulation through its setters.
const settings = loadSettings();
// A link that names the circuit, car or mode starts straight away; otherwise the start menu
// opens over the last circuit and car picked there.
// A championship round (?season): the saved season's next round, on its circuit, in its car.
let season = loadSeason();
const seasonRound = params.has('season') && season && !seasonOver(season) ? roundRace(season) : null;
if (!seasonRound) season = null;
const fromUrl = seasonRound !== null || ['track', 'car', 'mode'].some((k) => params.has(k));
const circuit =
  CIRCUITS.find((c) => c.id === (seasonRound ? seasonRound.track : fromUrl ? params.get('track') : settings.start.track)) ?? CIRCUITS[0];
const track = buildTrack(circuit);
document.querySelector('#track-name')!.textContent = circuit.name.toUpperCase();
// Race mode (?mode=race, Tab switches): ?difficulty=easy|medium|hard, ?opponents=0..7, ?laps=N.
// The car: ?car=wren|kestrel|harrier (Kestrel by default). In a race everyone drives it.
const carId = season ? season.car.toLowerCase() : fromUrl ? params.get('car') : settings.start.car.toLowerCase();
const carDef = CARS.find((c) => c.name.toLowerCase() === carId) ?? KESTREL;
const race = seasonRound
  ? new Race(track, seasonRound.options, carDef)
  : params.get('mode') === 'race'
    ? new Race(track, raceOptions(params), carDef)
    : null;
/** This championship round's result has been recorded (it can't be run again). */
let recorded = false;
const sim = race ? race.sim : new Simulation(track, carDef);

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
  const view = new CarView(car.def, car.wheels.map((w) => w.mount), { colour: AI_COLOURS[k % AI_COLOURS.length] });
  stage.scene.add(view.root);
  return { view, drawn: createPose(), colour: `#${AI_COLOURS[k % AI_COLOURS.length].toString(16).padStart(6, '0')}` };
});
const raceHud = race ? new RaceHud(document.querySelector<HTMLDivElement>('#hud')!, season ? 'The championship standings follow when everyone has finished.' : undefined) : null;
const colourOf = (entry: number) => `#${(entry === 0 ? 0xe0b020 : AI_COLOURS[(entry - 1) % AI_COLOURS.length]).toString(16).padStart(6, '0')}`;
const standingsScreen = new StandingsScreen(
  document.body,
  {
    onNext: () => goTo({ season: '' }),
    onMenu: () => goTo({}),
  },
  carName,
  colourOf,
  (id) => CIRCUITS.find((c) => c.id === id)?.name ?? id,
);

/** Reload with these options (keeping the developer flags). */
function goTo(options: Record<string, string>): void {
  const p = new URLSearchParams(options);
  for (const k of ['debug', 'telemetry', 'line']) if (params.has(k)) p.set(k, '');
  location.search = p.toString();
}
const cameras = new CameraRig(stage.camera, sim.car.def);
// The bumper and hood cameras go where the car's model says (outside its bodywork).
void carView.ready.then((model) => model && cameras.setMounts(model.cameras));
const drawn = createPose();
const session = new TimeTrial(sim);
const ghost = new GhostView(
  sim.car.def,
  sim.car.wheels.map((w) => w.mount),
);
stage.scene.add(ghost.root);
const replay = new Replay();
const replayState = createRecordedState();
const effects = new Effects(stage.scene);
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
if (params.has('debug')) Object.assign(window, { sim, race, poseOnTrack, session: () => session, step: (c: Controls) => step(c), replay: () => replay, autopilot, effects, sound: () => sound, stage });

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

// Sound starts on the first key or click (browsers allow audio only after a gesture).
const sound = new Sound(settings.volume, settings.muted);
const audio = new GameAudio(sound);
const listener: Listener = { x: 0, y: 0, z: 0, rightX: 1, rightZ: 0 };
window.addEventListener('pointerdown', () => sound.unlock());
function applySettings(): void {
  sim.setAids({ abs: settings.abs, tc: settings.tc });
  sim.setGearboxMode(settings.gearbox);
  steering.assist = settings.steeringAssist;
  if (cameras.mode !== settings.camera) cameras.setMode(settings.camera);
  sound.setVolume(settings.volume);
  sound.setMuted(settings.muted);
  saveSettings(settings);
}
applySettings();

// The menus: start (when no link chose already), pause on Esc, settings.
const BLURBS: Record<string, string> = {
  harrowmere: 'fast and flowing',
  saltmarsh: 'tight, gravel at the hairpins',
  ridgeback: 'hilly, a banked carousel',
  'proving-ground': 'the flat test track',
};
const CAR_BLURBS: Record<string, string> = {
  Wren: 'Light roadster: forgiving, slower',
  Kestrel: 'Balanced coupé',
  Harrier: 'Heavy GT: fast, a handful',
};
const builtCircuits = CIRCUITS.map((c) => (c === circuit ? track : buildTrack(c)));
const menu = new Menu(
  document.body,
  {
    onStart(choice) {
      settings.start = choice;
      saveSettings(settings);
      if (choice.mode === 'season') {
        const current = loadSeason();
        if (current && !seasonOver(current) && !window.confirm(`Start a new championship? The one in progress (round ${nextRound(current) + 1} of ${current.rounds.length}) will be lost.`)) return;
        saveSeason(newSeason(1 + Math.floor(Math.random() * 2 ** 30), choice.difficulty, choice.car));
        goTo({ season: '' });
        return;
      }
      const p = new URLSearchParams();
      p.set('track', choice.track);
      p.set('car', choice.car.toLowerCase());
      if (choice.mode === 'race') {
        p.set('mode', 'race');
        p.set('difficulty', choice.difficulty);
        p.set('opponents', String(choice.opponents));
        p.set('laps', String(choice.laps));
      }
      for (const k of ['debug', 'telemetry', 'line']) if (params.has(k)) p.set(k, '');
      location.search = p.toString();
    },
    onResume() {
      menu.hide();
      input.reset();
      sound.suspend(false);
    },
    onRestart() {
      menu.hide();
      sound.suspend(false);
      restart();
    },
    onContinueSeason: () => goTo({ season: '' }),
    onQuit: () => goTo({}),
    onSettings: applySettings,
  },
  { ...settings.start },
  CIRCUITS.map((c, i) => ({
    id: c.id,
    name: c.name,
    length: builtCircuits[i].length / 1000,
    blurb: BLURBS[c.id] ?? '',
    outline: builtCircuits[i].samples.filter((_, k) => k % 8 === 0).map((s) => ({ x: s.x, z: s.z })),
  })),
  CARS.map((c) => ({
    name: c.name,
    blurb: CAR_BLURBS[c.name] ?? '',
    power: Math.max(...c.engine.torqueCurve.map(([rpm, nm]) => (rpm * nm * Math.PI) / 30)) / 1000,
    mass: c.mass,
  })),
  settings,
);
if (!fromUrl) menu.showStart();
// The championship in progress, for Continue.
{
  const saved = loadSeason();
  if (saved && !seasonOver(saved)) {
    const mine = standings(saved).findIndex((r) => r.entry === 0);
    menu.setSeason({
      round: nextRound(saved) + 1,
      rounds: saved.rounds.length,
      position: mine + 1,
      points: standings(saved)[mine].points,
      difficulty: saved.difficulty,
      car: saved.car,
    });
  }
}
// Each circuit's best with each car, for the circuit cards.
void Promise.all(
  CIRCUITS.flatMap((c, i) =>
    CARS.map(async (car) => {
      const best = await store.load(bestKey(c.id, car.name), trackFingerprint(builtCircuits[i]));
      return [`${c.id}/${car.name}`, best?.lap.lapTime ?? null] as const;
    }),
  ),
).then((rows) => {
  const bests = new Map(rows);
  menu.setBests((t, car) => bests.get(`${t}/${car}`) ?? null);
});

window.addEventListener('keydown', (e) => {
  sound.unlock();
  // The standings take the keys (their buttons go on).
  if (standingsScreen.open) return;
  // A menu takes the keys: Esc goes back a level.
  if (menu.open) {
    if (e.code === 'Escape') menu.back();
    return;
  }
  if (e.code === 'Escape' && !replay.active) {
    pauseGame();
    return;
  }
  if (e.code === 'KeyU' && !e.repeat) {
    settings.muted = !settings.muted;
    sound.setMuted(settings.muted);
    saveSettings(settings);
  }
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
    restart();
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
  effects.afterStep(sim);
  audio.knocks(sim.contacts, listener);
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
  carView.root.visible = true;
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
  audio.replay(sim.car.def, replayState.rpm, replayState.throttle);
  const def = sim.car.def;
  dash.update(
    {
      rpm: replayState.rpm,
      speed: Math.abs(replayState.speed) * 3.6,
      gear: gearLabel(Math.round(replayState.gear)),
      mode: 'REPLAY',
      limiter: def.engine.limiterRpm,
      upshift: def.gearbox.upshiftRpm.full,
      abs: [false, false],
      tc: [false, false],
      assist: false,
    },
    dt,
  );
}

/** Back to the grid (time trial) or the start of the race. */
function restart(): void {
  // A championship round that has counted can't be run again.
  if (season && recorded) return;
  if (race) {
    race.restart();
    session.forgetLap();
  } else session.restart();
  effects.break();
  input.reset();
  cameras.snap();
}

function pauseGame(): void {
  menu.showPause();
  sound.suspend(true);
}

function recover(): void {
  sim.recover();
  effects.break();
  input.reset();
  cameras.snap();
}

function updateHud(dt: number): void {
  const car = sim.car;
  const drivetrain = car.drivetrain;
  // Dashboard lights: dim when off, lit when on, bright while working.
  dash.update(
    {
      rpm: drivetrain.rpm,
      speed: Math.abs(car.speed) * 3.6,
      gear: gearLabel(drivetrain.gearbox.nextGear),
      mode: drivetrain.gearbox.mode === 'auto' ? 'AUTO' : 'MANUAL',
      limiter: car.def.engine.limiterRpm,
      upshift: car.def.gearbox.upshiftRpm.full,
      abs: [car.aids.abs, car.absActive],
      tc: [car.aids.tc, car.tcActive],
      assist: steering.assist,
    },
    dt,
  );
  timing.update(sim.timer, sim.time);
  if (race) raceHud?.update(race);
  // A championship round over: count it, save the season, and show the standings.
  if (season && race && race.phase === 'finished' && !recorded) {
    recorded = true;
    season = recordRound(season, finishingOrder(race.standings()));
    saveSeason(season);
    if (seasonOver(season)) menu.setSeason(null);
    document.body.classList.add('standings-up');
    standingsScreen.show(season);
  }
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
  // Paused, or the start menu: no steps (and no catching up afterwards); the scene is still drawn.
  if (menu.open) accumulator = 0;
  if (replay.active && !menu.open) {
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
  // From the bumper you see the road, not the inside of your own car.
  carView.root.visible = cameras.mode !== 'bumper';
  effects.update(
    dt,
    sim,
    [drawn, ...others.map((o) => o.drawn)],
    stage.camera,
    stage.renderer.domElement.height,
  );
  followSun(stage.sun, carView.root.position);
  // The listener is the camera.
  const cam = stage.camera;
  cam.updateMatrixWorld();
  const m = cam.matrixWorld.elements;
  const rl = Math.hypot(m[0], m[2]) || 1;
  listener.x = cam.position.x;
  listener.y = cam.position.y;
  listener.z = cam.position.z;
  listener.rightX = m[0] / rl;
  listener.rightZ = m[2] / rl;
  audio.update(sim, race ? race.controls : [controls], listener);
  updateHud(dt);
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
