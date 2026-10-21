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
import { sampleCar, standingsAt, type RaceRecording } from './race/raceRecording';
import { Director, type Shot, type ShotCamera } from './replay/director';
import { ReplayHud } from './ui/replayHud';
import { lightLevel, parseTimeOfDay, type TimeOfDay } from './track/timeOfDay';
import { FloodlightField, placeFloodlights } from './track/floodlights';
import { terrainHeight } from './track/terrain';
import { bakeFloodlight } from './render/nightLight';
import { Lighting } from './render/lighting';
import { FloodlightView } from './render/floodlightView';
import { CarLamps, HeadlightPool } from './render/carLights';
import { SUN_OFFSET } from './render/scene';
import { formatLapTime } from './race/timing';
import { Replay, REPLAY_SPEEDS } from './replay/replay';
import { TvCameraView } from './render/tvCameras';
import { Effects } from './render/effects';
import { Dashboard } from './ui/dashboard';
import { Menu } from './ui/menu';
import { StandingsScreen } from './ui/standings';
import { finishingOrder, newSeason, nextRound, recordRound, roundRace, seasonOver, standings } from './race/championship';
import { loadSeason, saveSeason } from './storage/season';
import { loadCareer, saveCareer } from './storage/career';
import { buyUpgrade, newCareer, recordCareerRound, SERIES, startSeries } from './race/career';
import { applyUpgrades, noUpgrades } from './vehicle/upgrades';
import { CareerScreen } from './ui/careerScreen';
import { TUNING } from './config';
import { GameAudio, type Listener } from './audio';
import { Sound } from './audio/sound';
import { placeTvCameras } from './track/cameras';
import { circuitAi, createAiDriver } from './ai/driver';
import { speedProfile } from './ai/speedProfile';
import { createLineView } from './render/lineView';
import { bestKey, openBestStore } from './storage/bests';
import { CIRCUITS } from './track/circuits';
import { CustomTrackStore } from './storage/customTracks';
import { customDef } from './track/custom';
import { unpackCircuit } from './share';
import type { TrackDef } from './track/track';
import { AI_NAMES, DEFAULT_RACE, Race, type RaceOptions } from './race/race';
import { DIFFICULTIES, type Difficulty } from './ai/skill';
import { carName, RaceHud } from './ui/raceHud';
import { buildTrack, trackFingerprint } from './track/track';
import { NO_CONTROLS, poseOnTrack, wheelMounts, type Controls } from './vehicle/car';
import { cleanRoomCode, joinRoom, openRoom, type Link } from './online/link';
import { guestHandshake, hostHandshake, OnlineError, OnlineRace, type OnlineSetup } from './online/session';
import { OnlinePanel } from './ui/onlinePanel';
import { WeatherView } from './render/weatherView';
import { TyresHud } from './ui/tyresHud';
import { TouchControls } from './ui/touchControls';
import { quality, thin } from './render/quality';
import { WEAR_RATES } from './vehicle/wear';
import { CONDITIONS, wetness, type Conditions } from './track/weather';
import { Garage } from './ui/garage';
import { SetupStore } from './storage/setups';
import { applySetup, cleanSetup, type Setup } from './vehicle/setup';
import { CARS, KESTREL } from './vehicle/cars';
import type { CarDef } from './vehicle/carDef';
import { copyPose, createPose, interpolatePose } from './vehicle/pose';
import { NEUTRAL, REVERSE } from './vehicle/gearbox';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const dash = new Dashboard(document.querySelector<HTMLDivElement>('#dash')!);

const gearLabel = (gear: number) => (gear === REVERSE ? 'R' : gear === NEUTRAL ? 'N' : String(gear));

await initPhysics();
// The circuit: ?track=<id> (N moves on to the next), or the start menu's choice.
const params = new URLSearchParams(location.search);
// Settings: remembered between visits, applied to the simulation through its setters.
const settings = loadSettings();
// The track editor (?editor, or ?editor=<id> to edit a saved circuit; a shared link, ?share=,
// opens its circuit there to drive and keep): its own screen, no game.
if (params.has('editor') || params.has('share')) {
  document.querySelector('#loading')?.remove();
  const { openEditor } = await import('./editor');
  const shared = params.has('share') ? unpackCircuit(params.get('share') ?? '') : null;
  if (params.has('share') && !shared) {
    window.alert('That link is not a circuit (it may have been cut short).');
    goTo({});
  }
  openEditor(document.body, {
    id: params.get('editor') || null,
    circuit: shared,
    drive: (id) => goTo({ track: id, car: settings.start.car.toLowerCase(), from: 'editor' }),
    quit: () => goTo({}),
  });
  await new Promise(() => {});
}
// Circuits drawn in the editor, kept in this browser.
const customTracks = new CustomTrackStore();
/** Every circuit on offer: the built-in ones, then the custom ones. */
const ALL_CIRCUITS: TrackDef[] = [...CIRCUITS, ...customTracks.list().map(customDef)];
/** A circuit by id: built-in, or one of the custom circuits kept here. */
function findCircuit(id: string | null): TrackDef | null {
  if (!id) return null;
  const builtIn = CIRCUITS.find((c) => c.id === id);
  if (builtIn) return builtIn;
  const custom = customTracks.get(id);
  return custom ? customDef(custom) : null;
}
// A link that names the circuit, car or mode starts straight away; otherwise the start menu
// opens over the last circuit and car picked there.
// Online (?online=host&track=&laps=&car=&opponents=&difficulty=, or ?online=join&code=ABCD&car=):
// connect first; the host's choice of circuit, laps and AI field comes back from the handshake.
const onlinePanel = params.has('online') ? new OnlinePanel(document.body) : null;
const connected = onlinePanel ? await connect(params.get('online') === 'join') : null;
// A career round (?career): its season's next round, in your car with its upgrades.
let career = connected || !params.has('career') ? null : loadCareer();
if (career && seasonOver(career.season)) career = null;
// A championship round (?season): the saved season's next round, on its circuit, in its car.
let season = connected ? null : career ? career.season : loadSeason();
const seasonRound = (params.has('season') || career) && season && !seasonOver(season) ? roundRace(season) : null;
if (!seasonRound) season = null;
const fromUrl = seasonRound !== null || connected !== null || ['track', 'car', 'mode'].some((k) => params.has(k));
const circuit =
  (connected?.setup.custom ? customDef(connected.setup.custom) : null) ??
  findCircuit(connected ? connected.setup.track : seasonRound ? seasonRound.track : fromUrl ? params.get('track') : settings.start.track) ??
  CIRCUITS[0];
const track = buildTrack(circuit);
document.querySelector('#track-name')!.textContent = circuit.name.toUpperCase();
// Race mode (?mode=race, Tab switches): ?difficulty=easy|medium|hard, ?opponents=0..7, ?laps=N.
// The car: ?car=wren|kestrel|harrier (Kestrel by default). In a race everyone drives it, the
// player with their setup for this circuit (?setup=default: as designed), the AI as designed.
const carId = connected ? connected.setup.mine.toLowerCase() : season ? season.car.toLowerCase() : fromUrl ? params.get('car')?.toLowerCase() : settings.start.car.toLowerCase();
const carDef = CARS.find((c) => c.name.toLowerCase() === carId) ?? KESTREL;
const setups = new SetupStore();
const setup: Setup = params.get('setup') === 'default' ? {} : setups.load(circuit.id, carDef.name);
// In a career, your car also carries its upgrades.
const playerDef = applyUpgrades(applySetup(carDef, setup), career?.garage[carDef.name] ?? noUpgrades());
// The weather: the host's online, the round's in a championship, else ?weather=dry|damp|wet.
const conditions: Conditions = connected ? connected.setup.conditions : seasonRound ? (seasonRound.options.conditions ?? 'dry') : linkConditions(params);
const wet = wetness(conditions);
// The time of day: the round's in a championship, else ?time=day|dusk|night|duskToNight.
// Online, the host's.
const timeOfDay: TimeOfDay = connected ? connected.setup.time : seasonRound ? (seasonRound.options.time ?? 'day') : (parseTimeOfDay(params.get('time')) ?? 'day');
const race = connected
  ? null
  : seasonRound
    ? new Race(track, { ...seasonRound.options, conditions }, carDef, playerDef)
    : params.get('mode') === 'race'
      ? new Race(track, raceOptions(params), carDef, playerDef)
      : null;
/** This championship round's result has been recorded (it can't be run again). */
let recorded = false;
/** The championship standings after this round, to come back to after watching it (null until then). */
let showStandings: (() => void) | null = null;
const online = connected
  ? new OnlineRace(connected.link, connected.setup, track, playerDef, CARS.find((c) => c.name === connected.setup.theirs) ?? KESTREL, {
      clock: () => performance.now() / 1000,
      seed: 1 + Math.floor(Math.random() * 2 ** 30),
      difficulty: raceOptions(params).difficulty,
      stock: carDef,
    })
  : null;
const sim = online ? online.sim : race ? race.sim : new Simulation(track, playerDef, { conditions });

/** Open or join a room and agree the race; on failure, say why and offer the way back. */
async function connect(joining: boolean): Promise<{ link: Link; setup: OnlineSetup }> {
  const panel = onlinePanel!;
  const back = { label: 'Back to menu', onClick: () => goTo({}) };
  document.querySelector('#loading')?.remove();
  const names = CARS.map((c) => c.name);
  const car = (CARS.find((c) => c.name.toLowerCase() === params.get('car')?.toLowerCase()) ?? KESTREL).name;
  try {
    if (!joining) {
      panel.show('Online race', 'Opening a room…', { buttons: [back] });
      const room = await openRoom();
      panel.show('Your room code', 'Give the other player this code. Waiting for them to join…', {
        code: room.code,
        buttons: [
          {
            label: 'Cancel',
            onClick: () => {
              room.cancel();
              goTo({});
            },
          },
        ],
      });
      const link = await room.guest;
      panel.show('Online race', 'Connected: setting up the race…');
      const { laps, opponents, conditions, wear } = raceOptions(params, 0);
      const trackId = (findCircuit(params.get('track')) ?? CIRCUITS[0]).id;
      // A custom circuit goes to the guest in full.
      const custom = customTracks.get(trackId);
      return { link, setup: await hostHandshake(link, { track: trackId, laps, car, opponents, conditions: conditions ?? 'dry', time: parseTimeOfDay(params.get('time')) ?? 'day', wear: wear ?? 'off', custom }, names) };
    }
    const code = cleanRoomCode(params.get('code') ?? '');
    if (!code) throw new OnlineError('That is not a room code: it is four letters and digits, as the host sees it.');
    panel.show('Online race', `Joining room ${code}…`, { buttons: [back] });
    const link = await joinRoom(code);
    panel.show('Online race', 'Connected: setting up the race…');
    return { link, setup: await guestHandshake(link, car, CIRCUITS.map((c) => c.id), names) };
  } catch (e) {
    panel.show('Could not connect', e instanceof Error ? e.message : String(e), { buttons: [back] });
    // Nothing more to build: the way on is the button.
    return new Promise(() => {});
  }
}

/** A race from the link's ?opponents=, ?laps=, ?difficulty= and ?seed= (`opponents` by default). */
function raceOptions(p: URLSearchParams, opponents = DEFAULT_RACE.opponents): RaceOptions {
  const int = (name: string, lo: number, hi: number, fallback: number) => {
    const v = Number.parseInt(p.get(name) ?? '', 10);
    return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
  };
  const difficulty = p.get('difficulty');
  return {
    opponents: int('opponents', 0, 7, opponents),
    laps: int('laps', 1, 50, DEFAULT_RACE.laps),
    difficulty: DIFFICULTIES.includes(difficulty as Difficulty) ? (difficulty as Difficulty) : DEFAULT_RACE.difficulty,
    // A different race each time, unless ?seed= asks for a particular one.
    seed: int('seed', 1, 2 ** 30, 1 + Math.floor(Math.random() * 2 ** 30)),
    conditions: linkConditions(p),
    wear: WEAR_RATES.find((w) => w === p.get('wear')) ?? 'off',
  };
}

/** The weather a link asks for (?weather=), dry if none. */
function linkConditions(p: URLSearchParams): Conditions {
  return CONDITIONS.find((c) => c === p.get('weather')) ?? 'dry';
}

// What's drawn: High, or Low on a phone (or as chosen). A change takes a reload.
const graphics = quality(settings.graphics);
const graphicsChosen = settings.graphics;
const stage = createStage(canvas, graphics);
const trackView = createTrackView(track, sim.physics.terrain, wet);
stage.scene.add(trackView);
const weatherView = new WeatherView(stage, wet, graphics.rain);
const sceneryView = circuit.scenery
  ? (() => {
      const layout = layoutScenery(track, sim.physics.terrain, circuit.scenery);
      return createSceneryView({ ...layout, trees: thin(layout.trees, graphics.trees) });
    })()
  : null;
if (sceneryView) stage.scene.add(sceneryView);
// The time of day: the sky and light (after the weather has set the day's), and after dark the
// floodlight towers with their light baked into the track and scenery.
const lighting = new Lighting(stage, SUN_OFFSET);
const dark = timeOfDay !== 'day';
const towers = dark ? placeFloodlights(track, sim.physics.terrain) : [];
const floodField = dark ? new FloodlightField(towers) : null;
const floodView = floodField ? new FloodlightView(towers, track, (x, z) => terrainHeight(sim.physics.terrain, x, z)) : null;
if (floodField && floodView) {
  bakeFloodlight(trackView, floodField);
  if (sceneryView) bakeFloodlight(sceneryView, floodField);
  stage.scene.add(floodView.root);
}
const carView = new CarView(
  sim.car.def,
  sim.car.wheels.map((w) => w.mount),
);
stage.scene.add(carView.root);
// The other cars, each in its own colour: those simulated here (the AI's), then those other
// players' browsers simulate (online: the other player's, and the host's AI on the guest's
// screen), the same colour on both screens. `id`: the car's number in the standings.
const AI_COLOURS = [0xd8342c, 0x2f6fd8, 0x2fa84f, 0xeeeeee, 0xf08a24, 0x8e44c8, 0x1fb5b0];
const OPPONENT_COLOUR = 0xd83fa0;
const others = [
  ...sim.cars.slice(1).map((car, k) => ({ def: car.def, poses: sim.poses[k + 1], id: online ? online.idOfCar(k + 1) : k + 1, remote: null })),
  ...sim.proxies.map((p, j) => ({ def: p.def, poses: p, id: online!.idOfProxy(j), remote: online!.remotes[j] })),
].map(({ def, poses, id, remote }) => {
  const colour = online && id === 1 ? OPPONENT_COLOUR : AI_COLOURS[(id - (online ? 2 : 1)) % AI_COLOURS.length];
  const view = new CarView(def, wheelMounts(def), { colour });
  stage.scene.add(view.root);
  return { id, def, view, poses, remote, drawn: createPose(), colour: `#${colour.toString(16).padStart(6, '0')}` };
});
// After dark: every car's lamps, and real headlights for the few nearest the camera.
const lamps = dark ? [new CarLamps(carView, sim.car.def), ...others.map((o) => new CarLamps(o.view, o.def))] : [];
const headlights = dark ? new HeadlightPool(stage.scene, graphics.level === 'low' ? TUNING.night.headlights.poolLow : TUNING.night.headlights.pool) : null;
/** How long the race lasts (s), roughly: dusk to night darkens over it. */
const darkens = ((race?.laps ?? connected?.setup.laps ?? 0) * track.length) / TUNING.night.raceSpeed;
/** Each car's driver and colour, by its number in the standings. */
const driverName = online ? (k: number) => (k === 0 ? 'You' : k === 1 ? `Opponent (${online.setup.theirs})` : AI_NAMES[k - 2]) : carName;
const colourOf = (entry: number) =>
  `#${(entry === 0 ? 0xe0b020 : online && entry === 1 ? OPPONENT_COLOUR : AI_COLOURS[(entry - (online ? 2 : 1)) % AI_COLOURS.length]).toString(16).padStart(6, '0')}`;
const raceHud =
  race || online
    ? new RaceHud(
        document.querySelector<HTMLDivElement>('#hud')!,
        online ? 'Enter rematch &nbsp; P replay &nbsp; Esc leave' : season ? 'The championship standings follow when everyone has finished.' : undefined,
        online ? driverName : undefined,
      )
    : null;
const standingsScreen = new StandingsScreen(
  document.body,
  {
    onNext: () => goTo(career ? { career: '' } : { season: '' }),
    onMenu: () => goTo(career ? { menu: 'career' } : {}),
    onReplay: race && !online ? () => watchFromStandings() : undefined,
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
const effects = new Effects(stage.scene, graphics.particles);
const tv = new TvCameraView(stage.camera, track, placeTvCameras(track, sim.physics.terrain));
const replayHud = {
  title: document.querySelector<HTMLDivElement>('#replay .r-title')!,
  time: document.querySelector<HTMLDivElement>('#replay .r-time')!,
  keys: document.querySelector<HTMLDivElement>('#replay .r-keys')!,
};
const LAP_REPLAY_KEYS = replayHud.keys.innerHTML;
const RACE_REPLAY_KEYS = 'Space pause &nbsp; ←/→ skip &nbsp; Q/E moments &nbsp; ↑/↓ car ahead/behind &nbsp; C camera &nbsp; D director &nbsp; 1–4 speed &nbsp; Esc back';
// A race replay: every car drawn from the race's recording, the director's shots (or the car
// you picked, from the camera you picked), and its own screen.
let director: Director | null = null;
/** The car you picked to follow (null: the director chooses), and from where. */
let following: number | null = null;
let followCamera: ShotCamera = 'tv';
let lastFollow = { car: -1, camera: '' };
const raceStates = Array.from({ length: race?.sim.cars.length ?? online?.count ?? 0 }, createRecordedState);
/** Each car's car, by its number in the standings. */
const defOf = (id: number): CarDef => (id === 0 ? sim.car.def : others.find((o) => o.id === id)!.def);
const replayRigs = new Map<string, CameraRig>();
const raceReplayHud =
  race || online
    ? new ReplayHud(
        document.querySelector<HTMLDivElement>('#hud')!,
        {
          pick(car) {
            following = car;
          },
          seek: (time) => replay.seek(time),
        },
        driverName,
        colourOf,
      )
    : null;
const input = new PlayerInput();
// Phones and tablets: the on-screen controls, shown at the first touch.
const touchControls = new TouchControls(document.body, input.touch);
const steering = input.steering;
let controls = NO_CONTROLS;
const telemetry = new Telemetry(document.body);
const timing = new TimingHud(document.querySelector<HTMLDivElement>('#timing')!);
const minimap = new Minimap(document.querySelector<HTMLDivElement>('#hud')!, track);
const tyresHud = new TyresHud(document.querySelector<HTMLDivElement>('#hud')!);
telemetry.visible = params.has('telemetry');
// ?line draws the AI's racing line, coloured by its target speed.
if (params.has('line')) {
  const { line, env } = circuitAi(track, sim.car.def);
  stage.scene.add(createLineView(track, line, speedProfile(line, env)));
}
// ?autopilot hands your car to the AI (for watching it, and checking it).
const autopilot = params.has('autopilot') ? createAiDriver(track, sim.car.def, undefined, 1, conditions) : null;
// ?debug exposes the simulation in the console, for poking at it while developing.
if (params.has('debug')) Object.assign(window, { sim, race, online, poseOnTrack, session: () => session, step: (c: Controls) => step(c), replay: () => replay, autopilot, effects, sound: () => sound, stage });

// Bests from earlier visits: the ghost, the delta and the sector colours carry on from them.
const store = await openBestStore();
const key = bestKey(circuit.id, sim.car.def.name, conditions);
// The weather beside the circuit's name.
if (conditions !== 'dry') document.querySelector('#track-name')!.textContent = `${circuit.name.toUpperCase()} · ${conditions.toUpperCase()}`;
// And the time of day.
if (timeOfDay !== 'day') document.querySelector('#track-name')!.textContent += ` · ${timeOfDay === 'duskToNight' ? 'DUSK TO NIGHT' : timeOfDay.toUpperCase()}`;
const stored = await store.load(key, session.fingerprint);
if (stored) session.loadBest(stored.lap, stored.timeAtSample, stored.bestSectors);
const NOT_KEPT = 'Bests are not kept in this browser';
if (!store.persistent) timing.note = NOT_KEPT;
let savedSectors = JSON.stringify(sim.timer.bestSectors);
/** The setup the best lap was set with (kept with it). */
let bestSetup: Setup | null = stored ? (stored.setup ?? {}) : null;

/** After a lap: keep a new best lap, or a new best sector. */
function keepBests(event: LapEvent): void {
  // Race laps (in traffic, from a standing start) aren't time-trial bests.
  if (race || online) return;
  const bests = session.bests();
  const sectors = JSON.stringify(sim.timer.bestSectors);
  if (!bests || (event !== 'best' && sectors === savedSectors)) return;
  savedSectors = sectors;
  if (event === 'best') bestSetup = setup;
  void store.save({ key, fingerprint: session.fingerprint, ...bests, setup: bestSetup ?? {} }).then((ok) => {
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
  touchControls.setTilt(settings.touchSteer === 'tilt');
  // New graphics take a fresh renderer: start again with them.
  if (settings.graphics !== graphicsChosen) {
    saveSettings(settings);
    location.reload();
  }
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
  Finch: 'Hot hatch: pushes on the power',
  Kestrel: 'Balanced coupé',
  Osprey: 'All-wheel drive: launches hardest',
  Harrier: 'Heavy GT: fast, a handful',
};
const builtCircuits = ALL_CIRCUITS.map((c) => (c.id === circuit.id ? track : buildTrack(c)));
const menu = new Menu(
  document.body,
  {
    onStart(choice) {
      settings.start = choice;
      saveSettings(settings);
      if (choice.mode === 'career') {
        careerScreen.show(loadCareer());
        return;
      }
      if (choice.mode === 'season') {
        const current = loadSeason();
        if (current && !seasonOver(current) && !window.confirm(`Start a new championship? The one in progress (round ${nextRound(current) + 1} of ${current.rounds.length}) will be lost.`)) return;
        saveSeason(newSeason(1 + Math.floor(Math.random() * 2 ** 30), choice.difficulty, choice.car));
        goTo({ season: '' });
        return;
      }
      if (choice.mode === 'online') {
        const car = choice.car.toLowerCase();
        if (choice.online === 'host')
          goTo({ online: 'host', track: choice.track, laps: String(choice.laps), opponents: String(choice.opponents), difficulty: choice.difficulty, weather: choice.weather, time: choice.time, wear: choice.wear, car });
        else if (cleanRoomCode(choice.code)) goTo({ online: 'join', code: choice.code, car });
        return;
      }
      const p = new URLSearchParams();
      p.set('track', choice.track);
      p.set('car', choice.car.toLowerCase());
      if (choice.weather !== 'dry') p.set('weather', choice.weather);
      if (choice.time !== 'day') p.set('time', choice.time);
      if (choice.mode === 'race') {
        p.set('mode', 'race');
        p.set('difficulty', choice.difficulty);
        p.set('opponents', String(choice.opponents));
        p.set('laps', String(choice.laps));
        p.set('wear', choice.wear);
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
    onReplay() {
      menu.hide();
      input.reset();
      sound.suspend(false);
      startRaceReplay();
    },
    onContinueSeason: () => goTo({ season: '' }),
    onQuit: () => {
      online?.leave();
      // A test drive goes back to the editor.
      goTo(params.get('from') === 'editor' ? { editor: circuit.id } : {});
    },
    onSettings: applySettings,
    onGarage: openGarage,
    onEditor: (id) => goTo({ editor: id ?? '' }),
    onDeleteCircuit(id) {
      const c = customTracks.get(id);
      if (!c || !window.confirm(`Delete ${c.name}?`)) return;
      customTracks.remove(id);
      goTo({});
    },
  },
  { ...settings.start },
  ALL_CIRCUITS.map((c, i) => ({
    id: c.id,
    name: c.name,
    length: builtCircuits[i].length / 1000,
    blurb: BLURBS[c.id] ?? 'your own',
    outline: builtCircuits[i].samples.filter((_, k) => k % 8 === 0).map((s) => ({ x: s.x, z: s.z })),
    custom: i >= CIRCUITS.length,
  })),
  CARS.map((c) => ({
    name: c.name,
    blurb: CAR_BLURBS[c.name] ?? '',
    layout: c.drivetrain.layout.toUpperCase(),
    power: Math.max(...c.engine.torqueCurve.map(([rpm, nm]) => (rpm * nm * Math.PI) / 30)) / 1000,
    mass: c.mass,
  })),
  settings,
);
// The career screen: from the start menu, or straight back to it after a round (?menu=career).
const careerScreen = new CareerScreen(
  document.body,
  {
    race: () => goTo({ career: '' }),
    startSeries(i) {
      const c = loadCareer();
      if (!c) return;
      const next = startSeries(c, i);
      saveCareer(next);
      careerScreen.show(next);
    },
    buy(car, kind) {
      const c = loadCareer();
      const next = c && buyUpgrade(c, car, kind);
      if (!next) return;
      saveCareer(next);
      careerScreen.show(next);
    },
    newCareer() {
      const c = loadCareer();
      if (c && !window.confirm('Start a new career? This one, its money and upgrades will be lost.')) return;
      const next = newCareer(1 + Math.floor(Math.random() * 2 ** 30));
      saveCareer(next);
      careerScreen.show(next);
    },
    close() {
      careerScreen.hide();
      menu.showStart();
    },
  },
  (k) => (k === 0 ? 'You' : AI_NAMES[k - 1]),
  (id) => findCircuit(id)?.name ?? id,
);
menu.allowReplay(race !== null && !online);
if (params.get('menu') === 'career') {
  menu.showStart();
  careerScreen.show(loadCareer());
} else if (!fromUrl) menu.showStart();
const garage = new Garage(document.body);
if (online) {
  menu.setOnline();
  document.querySelector('#keys')!.innerHTML = 'Esc menu (the race goes on) &nbsp; R back on the track &nbsp; C camera &nbsp; P replay (once it is over) &nbsp; Enter rematch';
}
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
  ALL_CIRCUITS.flatMap((c, i) =>
    CARS.flatMap((car) =>
      CONDITIONS.map(async (w) => {
        const best = await store.load(bestKey(c.id, car.name, w), trackFingerprint(builtCircuits[i]));
        return [`${c.id}/${car.name}/${w}`, best?.lap.lapTime ?? null] as const;
      }),
    ),
  ),
).then((rows) => {
  const bests = new Map(rows);
  menu.setBests((t, car, w) => bests.get(`${t}/${car}/${w}`) ?? null);
});

/**
 * The garage, from the start menu (`choice`: the car and circuit picked there) or the pause
 * menu (null: this car here; a changed setup restarts from the grid with it).
 */
function openGarage(choice: { track: string; car: string; weather: Conditions } | null): void {
  const def = choice ? (CARS.find((c) => c.name === choice.car) ?? KESTREL) : carDef;
  const index = choice ? Math.max(0, ALL_CIRCUITS.findIndex((c) => c.id === choice.track)) : -1;
  const where = choice ? ALL_CIRCUITS[index] : circuit;
  const best = choice
    ? store.load(bestKey(where.id, def.name, choice.weather), trackFingerprint(builtCircuits[index])).then((r) => (r ? (r.setup ?? {}) : null))
    : Promise.resolve(bestSetup);
  const now = setups.load(where.id, def.name);
  garage.show({
    car: def,
    circuitName: where.name,
    setup: choice ? now : setup,
    best,
    note: choice
      ? 'Kept for this car on this circuit; it is used whenever you drive it here.'
      : `Kept for this car on this circuit. Done with a change restarts ${race ? 'the race' : 'from the grid'} with it.`,
    onDone(next) {
      setups.save(where.id, def.name, next);
      if (choice) return;
      if (JSON.stringify(cleanSetup(next)) === JSON.stringify(cleanSetup(setup)) && params.get('setup') !== 'default') return;
      params.delete('setup');
      const search = params.toString();
      if (location.search.replace(/^\?/, '') === search) location.reload();
      else location.search = search;
    },
    onCancel() {},
  });
}

window.addEventListener('keydown', (e) => {
  sound.unlock();
  // The garage takes the keys: Esc closes it without keeping the changes.
  if (garage.open) {
    if (e.code === 'Escape') garage.cancel();
    return;
  }
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
  if (online) {
    // Online: no restarts or other modes, and the race's replay (P) only once it is over; Enter asks for a rematch.
    if (e.code === 'Enter') online.requestRematch();
    if (['KeyN', 'Backspace', 'Tab'].includes(e.code)) {
      e.preventDefault();
      return;
    }
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
    if (e.shiftKey && !online) startReplay(session.ghost, 'BEST LAP');
    else if (race || online) startRaceReplay();
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
  if (race) race.step(c);
  else sim.step(c);
  afterStep(c);
}

/** What follows each physics step (online, the race takes the step itself). */
function afterStep(c: Controls): void {
  controls = c;
  effects.afterStep(sim);
  audio.knocks(sim.contacts, listener);
  const event = session.afterStep(c);
  if (event) keepBests(event);
}

/** The light of the time of day at race time `t`, and the lamps lit (`brake(k)`: car k's brake pedal). */
function updateNight(t: number, brake: (k: number) => number): void {
  const level = lightLevel(timeOfDay, t, darkens);
  lighting.set(level);
  if (!floodField || !headlights) return;
  const on = Math.min(1, Math.max(0, (TUNING.night.lightsOn - level) / 0.15));
  floodView?.setOn(on);
  lamps.forEach((l, k) => l.update(on, brake(k)));
  headlights.update(lamps, stage.camera.position, on);
  lighting.setFloodAtCar(floodField.at(stage.camera.position.x, stage.camera.position.z));
}

/** Car k's brake pedal on the last step (for its brake lights). */
function brakeOf(k: number): number {
  if (k >= sim.cars.length) return 0;
  const all = race ? race.controls : online ? online.controls : [controls];
  return all[k]?.brake ?? 0;
}

/** Watch `rec` from the TV cameras; live driving waits until it ends. */
function startReplay(rec: LapRecording | null, caption: string): void {
  if (!rec) return;
  replay.play(rec, caption);
  replayHud.keys.innerHTML = LAP_REPLAY_KEYS;
  document.body.classList.add('replaying');
}

/**
 * Watch the race so far (or all of it), every car, as television; the race waits until it ends.
 * Online the race waits for nobody: only once it is over, and it goes on underneath.
 */
function startRaceReplay(): void {
  if (!raceReplayHud) return;
  let rec: RaceRecording;
  if (online) {
    if (!online.replayable) return;
    rec = online.recording();
  } else if (race && race.recorder.frameCount >= 2) rec = race.recorder.recording();
  else return;
  replay.playRace(rec, !race || race.phase === 'finished' ? 'RACE' : 'RACE SO FAR');
  director = new Director(rec, 0, track.samples.length);
  following = null;
  followCamera = 'tv';
  lastFollow = { car: -1, camera: '' };
  raceReplayHud.load(rec, replay.raceMoments);
  replayHud.keys.innerHTML = RACE_REPLAY_KEYS;
  document.body.classList.add('replaying', 'race-replaying');
}

/** From the championship standings: watch the race, then back to them. */
function watchFromStandings(): void {
  standingsScreen.hide();
  startRaceReplay();
}

function endReplay(): void {
  const wasRace = replay.race !== null;
  replay.stop();
  director = null;
  document.body.classList.remove('replaying', 'race-replaying');
  cameras.setMode(cameras.mode);
  input.reset();
  if (wasRace && showStandings) showStandings();
}

function replayKey(e: KeyboardEvent): void {
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) replay.togglePause();
  }
  const skip = replay.race ? TUNING.replay.skip : 2;
  if (e.code === 'ArrowLeft') replay.scrub(-skip);
  if (e.code === 'ArrowRight') replay.scrub(skip);
  if (replay.race && !e.repeat) raceReplayKey(e);
  const speed = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
  if (speed >= 0) replay.speed = REPLAY_SPEEDS[speed];
  if (e.code === 'Escape' || (e.code === 'KeyP' && !e.repeat)) endReplay();
  if (e.code === 'KeyT' && !e.repeat) telemetry.toggle();
}

/** A race replay's own keys: moments, the car to follow, the camera, the director. */
function raceReplayKey(e: KeyboardEvent): void {
  const rec = replay.race!;
  if (e.code === 'KeyE') replay.nextMoment();
  if (e.code === 'KeyQ') replay.previousMoment();
  if (e.code === 'KeyD') following = null;
  if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
    e.preventDefault();
    const rows = standingsAt(rec, replay.time);
    const now = following ?? lastFollow.car;
    const i = Math.max(0, rows.findIndex((r) => r.car === now));
    following = rows[Math.max(0, Math.min(rows.length - 1, i + (e.code === 'ArrowUp' ? -1 : 1)))].car;
  }
  if (e.code === 'KeyC') {
    const order: ShotCamera[] = ['tv', 'chase', 'onboard'];
    following ??= lastFollow.car;
    followCamera = order[(order.indexOf(lastFollow.camera as ShotCamera) + 1) % order.length];
  }
}

/** A chase or onboard camera for a car of this kind (the replay's own; yours stays as you set it). */
function rigFor(def: CarDef): CameraRig {
  let rig = replayRigs.get(def.name);
  if (!rig) {
    rig = new CameraRig(stage.camera, def);
    replayRigs.set(def.name, rig);
  }
  return rig;
}

/** A frame of a race replay: every car where the recording has it, from the director's (or your) shot. */
function drawRaceReplay(t: number, dt: number): void {
  const rec = replay.race!;
  const shot: Shot | null = following === null ? director!.at(t) : null;
  const car = shot ? shot.car : following!;
  const camera = shot ? shot.camera : followCamera;
  rec.cars.forEach((_, k) => sampleCar(rec, k, t, raceStates[k]));
  carView.update(raceStates[0].pose);
  others.forEach((o) => {
    const s = raceStates[o.id];
    if (!s) return;
    o.view.update(s.pose);
    copyPose(s.pose, o.drawn);
  });
  ghost.update(null, null, false);
  minimap.update(
    raceStates[0].pose,
    others.map((o) => ({ x: o.drawn.position.x, z: o.drawn.position.z, colour: o.colour })),
  );
  const followed = raceStates[car];
  const def = defOf(car);
  const cut = replay.jumped || lastFollow.car !== car || lastFollow.camera !== camera;
  lastFollow = { car, camera };
  if (camera === 'tv') tv.update(followed.pose, dt, cut);
  else {
    const rig = rigFor(def);
    if (cut) {
      rig.setMode(camera === 'onboard' ? 'hood' : 'chase');
      rig.snap();
    }
    rig.update(followed.pose, dt);
  }
  // Every car drawn, but from inside one you see the road, not its own bodywork.
  const inside = camera === 'onboard' ? car : -1;
  carView.root.visible = inside !== 0;
  others.forEach((o) => (o.view.root.visible = raceStates[o.id] !== undefined && inside !== o.id));
  replay.jumped = false;
  followSun(stage.sun, stage.camera.position, lighting.sunOffset);
  weatherView.update(dt, stage.camera.position);
  updateNight(t, (k) => raceStates[k === 0 ? 0 : others[k - 1].id]?.brake ?? 0);
  const rows = standingsAt(rec, t);
  const lap = Math.min(rec.laps, rows[0].laps + 1);
  replayHud.title.textContent = `REPLAY · ${replay.caption}`;
  const state = replay.paused ? 'PAUSED' : `${replay.speed}×`;
  replayHud.time.textContent = `LAP ${lap} / ${rec.laps}  ·  ${formatLapTime(t)} / ${formatLapTime(rec.duration)}  ·  ${state}`;
  raceReplayHud!.update(t, rows, car, shot, rec.laps);
  audio.replay(def, followed.rpm, followed.throttle);
  dash.update(
    {
      rpm: followed.rpm,
      speed: Math.abs(followed.speed) * 3.6,
      gear: gearLabel(Math.round(followed.gear)),
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
  followSun(stage.sun, carView.root.position, lighting.sunOffset);
  weatherView.update(dt, stage.camera.position);
  updateNight(race?.time ?? 0, (k) => (k === 0 ? replayState.brake : 0));
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
  // A championship round that has counted can't be run again; an online race goes on.
  if ((season && recorded) || online) return;
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
  // Online, the race doesn't stop for the menu.
  if (!online) sound.suspend(true);
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
  touchControls.update(settings.gearbox === 'manual');
  // BOX: the same call the AI acts on.
  tyresHud.update(sim.car, sim.pits?.state[0] ?? null, race?.boxCalls[0] ?? online?.boxCall ?? false);
  const racing = race ?? online;
  if (racing) raceHud?.update(racing);
  if (online) {
    onlinePanel?.setStatus(onlineStatus(online));
    // The pause menu's Watch replay, once the race is over.
    menu.allowReplay(online.replayable);
  }
  // A championship (or career) round over: count it, save it, and show the standings.
  if (season && race && race.phase === 'finished' && !recorded) {
    recorded = true;
    // It can't be run again, so not set up again either.
    menu.allowSetup(false);
    document.body.classList.add('standings-up');
    if (career) {
      const result = recordCareerRound(career, finishingOrder(race.standings()));
      career = result.career;
      season = career.season;
      saveCareer(career);
      const notes = [`Prize money: ${result.prize.toLocaleString('en-GB')} cr (${result.position === 1 ? 'a win' : `P${result.position}`}).`];
      if (result.final) {
        if (result.final.bonus > 0) notes.push(`Season bonus for P${result.final.position}: ${result.final.bonus.toLocaleString('en-GB')} cr.`);
        if (result.final.complete) notes.push('You are the Grand Champion: your career is complete!');
        else if (result.final.promoted) notes.push(`Promoted: the ${result.final.promoted.name} is open, and the ${result.final.promoted.car} is yours.`);
        else if (result.final.position > TUNING.career.promotion) notes.push(`A top ${TUNING.career.promotion} finish moves you up: run the series again.`);
      }
      const shown = season;
      const series = SERIES[career.series].name.toUpperCase();
      showStandings = () => standingsScreen.show(shown, { title: series, notes, back: 'Career' });
      showStandings();
    } else {
      season = recordRound(season, finishingOrder(race.standings()));
      saveSeason(season);
      if (seasonOver(season)) menu.setSeason(null);
      const shown = season;
      showStandings = () => standingsScreen.show(shown);
      showStandings();
    }
  }
}

/** The line over an online race: what it's waiting for, or why it ended. */
function onlineStatus(o: OnlineRace): string {
  if (o.closed) return `${o.closed} Esc for the menu.`;
  if (o.waitingFor === 'clock') return 'Setting the start clock…';
  if (o.waitingFor === 'player') return 'Waiting for the other player…';
  if (o.phase !== 'finished') return '';
  const [mine, theirs] = o.rematch;
  if (mine) return 'Rematch: waiting for your opponent…';
  if (theirs) return 'Your opponent wants a rematch: press Enter.';
  return '';
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
  // The touch controls' pause button: as Esc.
  if (pad.pause && !menu.open && !garage.open && !standingsScreen.open) {
    if (replay.active) endReplay();
    else pauseGame();
  }
  // Paused, or the start menu: no steps (and no catching up afterwards); the scene is still drawn.
  if (menu.open) accumulator = 0;
  if (replay.active && !menu.open && online) {
    // Online the race goes on underneath (over, but still on the shared clock), your car left
    // alone; a rematch starting ends the replay.
    online.advance(
      () => NO_CONTROLS,
      () => afterStep(online.controls[0] ?? NO_CONTROLS),
    );
    onlinePanel?.setStatus(onlineStatus(online));
    if (online.phase !== 'finished') endReplay();
  }
  if (replay.active && !menu.open) {
    // Live driving waits: no steps, and no catching up afterwards.
    accumulator = 0;
    const t = replay.update(dt);
    if (t === null) endReplay();
    else {
      if (replay.race) drawRaceReplay(t, dt);
      else drawReplay(t, dt);
      stage.renderer.render(stage.scene, stage.camera);
      requestAnimationFrame(frame);
      return;
    }
  }
  if (pad.reset) recover();
  if (online) {
    // Online the clock is shared: the race runs the steps that are due, menu or not.
    const alpha = online.advance(
      () => {
        if (!autopilot) return menu.open ? NO_CONTROLS : input.controls(sim.car, PHYSICS_STEP);
        if (online.held) return NO_CONTROLS;
        const c = autopilot.drive(sim.car, PHYSICS_STEP);
        if (autopilot.stuck) {
          recover();
          autopilot.recovered();
        }
        return c;
      },
      () => afterStep(online.controls[0] ?? NO_CONTROLS),
    );
    accumulator = alpha * PHYSICS_STEP;
  }
  while (!online && accumulator >= PHYSICS_STEP) {
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
  others.forEach((o) => {
    interpolatePose(o.poses.previous, o.poses.current, accumulator / PHYSICS_STEP, o.drawn);
    o.view.root.visible = true;
    o.view.update(o.drawn);
  });
  // The ghost at the same moment between steps as the car is drawn (not in a race).
  const lapTime = session.lapTime;
  ghost.update(session.ghost, lapTime === null ? null : lapTime - PHYSICS_STEP * (1 - accumulator / PHYSICS_STEP), settings.ghost && !race && !online);
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
  followSun(stage.sun, carView.root.position, lighting.sunOffset);
  weatherView.update(dt, stage.camera.position);
  updateNight((race ?? online)?.time ?? 0, brakeOf);
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
  // Online, the cars another browser simulates sound from their states, where they are drawn.
  const remotes = [];
  for (const o of others) {
    const s = o.remote?.latest;
    if (s) remotes.push({ x: o.drawn.position.x, z: o.drawn.position.z, def: o.def, rpm: s.rpm, throttle: s.throttle, speed: s.speed });
  }
  audio.update(sim, race ? race.controls : online ? online.controls : [controls], listener, remotes);
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
onlinePanel?.hide();
requestAnimationFrame(frame);
