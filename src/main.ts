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
import { Simulation } from './sim';
import { TimingHud } from './ui/timingHud';
import { CIRCUITS } from './track/circuits';
import { buildTrack } from './track/track';
import { NO_CONTROLS, poseOnTrack } from './vehicle/car';
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
const input = new PlayerInput();
const steering = input.steering;
let controls = NO_CONTROLS;
const telemetry = new Telemetry(document.body);
const timing = new TimingHud(document.querySelector<HTMLDivElement>('#timing')!);
const minimap = new Minimap(document.querySelector<HTMLDivElement>('#hud')!, track);
const params = new URLSearchParams(location.search);
telemetry.visible = params.has('telemetry');
// ?debug exposes the simulation in the console, for poking at it while developing.
if (params.has('debug')) Object.assign(window, { sim, poseOnTrack });

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
  if (e.repeat) return;
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
  if (e.code === 'KeyM') settings.gearbox = settings.gearbox === 'auto' ? 'manual' : 'auto';
  if (['KeyC', 'KeyV', 'KeyZ', 'KeyX', 'KeyM'].includes(e.code)) applySettings();
  if (e.code === 'KeyR') recover();
});

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
  if (pad.reset) recover();
  while (accumulator >= PHYSICS_STEP) {
    controls = input.controls(sim.car, PHYSICS_STEP);
    sim.step(controls);
    accumulator -= PHYSICS_STEP;
  }

  // Draw the car the right fraction of the way into the step that hasn't happened yet.
  interpolatePose(sim.previous, sim.current, accumulator / PHYSICS_STEP, drawn);
  carView.update(drawn);
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
