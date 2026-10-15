// Entry point: builds the simulation and the view, then runs fixed physics steps with
// variable-rate rendering. Everything that affects the result happens inside sim.step().

import { PHYSICS_STEP } from './constants';
import { Keyboard } from './input';
import { initPhysics } from './physics';
import { formatLapTime } from './race/timing';
import { CarView } from './render/carView';
import { ChaseCamera } from './render/chaseCamera';
import { createStage, followSun } from './render/scene';
import { createTrackView } from './render/trackView';
import { Simulation } from './sim';
import { TEST_CIRCUIT } from './track/circuits';
import { buildTrack } from './track/track';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const hud = {
  speed: document.querySelector<HTMLDivElement>('#speed')!,
  gear: document.querySelector<HTMLDivElement>('#gear')!,
  lap: document.querySelector<HTMLDivElement>('#lap')!,
  last: document.querySelector<HTMLDivElement>('#last')!,
  best: document.querySelector<HTMLDivElement>('#best')!,
};

await initPhysics();
const track = buildTrack(TEST_CIRCUIT);
const sim = new Simulation(track);

const stage = createStage(canvas);
stage.scene.add(createTrackView(track));
const carView = new CarView();
stage.scene.add(carView.root);
const chase = new ChaseCamera(stage.camera);
const keyboard = new Keyboard();

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') {
    sim.recover();
    chase.snap();
  }
});

function updateHud(): void {
  hud.speed.textContent = String(Math.round(Math.abs(sim.car.speed) * 3.6));
  hud.gear.textContent = sim.car.reversing ? 'R' : 'D';
  const t = sim.timer;
  hud.lap.textContent = t.current(sim.time) === null ? 'OUT LAP' : `LAP ${t.laps + 1}  ${formatLapTime(t.current(sim.time))}`;
  hud.last.textContent = `LAST ${formatLapTime(t.lastLap)}`;
  hud.best.textContent = `BEST ${formatLapTime(t.bestLap)}`;
}

let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  accumulator += dt;
  const controls = keyboard.controls();
  while (accumulator >= PHYSICS_STEP) {
    sim.step(controls);
    accumulator -= PHYSICS_STEP;
  }

  carView.update(sim.car);
  chase.update(sim.car, dt);
  followSun(stage.sun, carView.root.position);
  updateHud();
  stage.renderer.render(stage.scene, stage.camera);
  requestAnimationFrame(frame);
}

document.querySelector('#loading')?.remove();
requestAnimationFrame(frame);
