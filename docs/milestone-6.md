# Milestone 6 plan: presentation

## Status: done

Closed after two fixes from your first look: the circuit thumbnails in the start menu are
drawn as SVG (on a small canvas Chrome drew them broken), and the bumper and hood cameras
sit outside the car models (the hood camera above each model's bonnet; your car hidden from
the bumper). The playtest questions (engine sounds, squeal, effects, the three cars, the
rev counter, the menus and reloading) stay open.

Approved as proposed: Kenney's Car Kit, Wren and Harrier, a start menu with Esc for pause.
No engine character was asked for: Wren and Kestrel are high-revving fours, Harrier a six.

Measured in the production build with eight cars racing and every effect: ~0.8 ms per physics
step (~1.6 ms of each 60 fps frame), ~1.4 ms to render (about 100 draw calls), effects
0.07 ms. Wren: 0–100 km/h in 7.9 s, 203 km/h, 0.93 g; Harrier: 5.3 s, 281 km/h, 1.0 g.

Where the build differs from the plan below:

- **Models:** the kit's `race` and `race-future` are open-wheelers, which don't suit a GT,
  so Wren is `hatchback-sports`, Kestrel `sedan` and Harrier `sedan-sports` (the one with
  the wing). The files are small, so the script copies them unchanged rather than trimming.
  Paint: the kit shares one palette texture; the body's most-used colourful cell is repainted
  in the car's colour, keeping its shading.
- **Harrier needed taming for the AI:** it spun under power on corner exits (the rear lets go
  sideways before the wheels spin enough for traction control to notice). Its diff locks a
  little less and its rear tyres grip a little more, and every AI driver now keeps the
  throttle within what the rear tyres have to spare while cornering.
- **Sparks are glowing points**, not streaks: one-pixel lines were all but invisible.
- **Mute is U**, not M (M already switches automatic and manual).
- **Engines need a cylinder count**, so `EngineDef.cylinders` is new car data.
- **Menus reload the page:** Start writes the choices into the URL (which then skips the menu)
  and Quit to menu goes back to the bare URL. Rebuilding the world in place can come later if
  the reload ever feels slow. `?car=wren|kestrel|harrier` joins the other URL options.
- **Only the dashboard was restyled**; the timing and race panels already matched it. The key
  list moved into the menus, with a short hint left at the bottom.

Goal: make it look, sound and start like a game. The placeholder boxes become real car
models; tyres leave skid marks and smoke, barriers throw sparks; the engine, tyres and wind
are synthesised from the simulation; a dashboard with a rev counter; and menus to pick the
mode, circuit, car and settings instead of URL options. None of it touches the simulation
except one new piece of read-only data, its contact events.

## Scope decisions

- **Car models from a CC0 kit.** Kenney's *Car Kit* (kenney.nl, CC0): low-poly, no real
  makes or logos, and each wheel a separate node. A script (`scripts/prepare-cars.mjs`, like
  five-a-side's `prepare-models.mjs`) trims the few models used into `public/models/cars/`,
  and `ASSETS.md` records them. Each model is scaled to its car's collision box, its wheels are
  driven by the simulation (steer, suspension, spin) exactly as the placeholder's are, and its
  paint takes the car's or AI driver's colour. If a model fails to load, the placeholder is
  drawn, so the game never depends on it.
- **Two more cars, as data.** A car select needs a choice: **Wren**, a light, low-powered
  roadster on narrower tyres (forgiving, slower), and **Harrier**, a heavy, powerful GT with
  more downforce (fast, harder to drive). Both rear-wheel drive like `KESTREL`, invented, each
  with its own vehicle-test ranges. The AI builds its envelope and racing line from whichever
  car it drives, and bests are already kept per car.
- **Effects are presentation that reads the simulation.** Skid marks are dark strips laid
  under any wheel past its peak slip (a ring buffer of quads, oldest overwritten); tyre smoke
  is pooled sprites from the same wheels, thicker with more slip and speed; sparks are pooled
  streaks at barrier and car-to-car impacts. The simulation gains `contacts`: each step's
  impacts (where, how hard, against what), taken from Rapier's contact events. Nothing is
  allocated per frame once the pools exist.
- **Audio is synthesised, no sound files** (ported structure from five-a-side's `Sound`:
  unlock on the first gesture, mute remembered). The engine is a stack of harmonics of the
  firing frequency (RPM × cylinders ÷ 120), its tone and loudness following throttle and
  load, with a rasp at the limiter and a pop on gearshifts. Tyre squeal from filtered noise
  and a tone, louder with slip beyond the peak; wind rising with speed²; kerb rumble from the
  kerb ridges under the wheels; thumps and scrapes from the contact events. The nearest three
  AI cars get their own engines, panned and fading with distance.
- **Dashboard.** A rev counter drawn on a canvas (needle, redline from the car's limiter,
  shift lights from its upshift RPM), digital speed and gear, the ABS / TC / assist lights,
  in the bottom right where the bar is now. The timing and race panels keep their content
  and get the same style.
- **Menus** (DOM, after five-a-side's `menu.ts`): a start menu with the mode (time trial or
  race), the circuit (with its minimap and your best there), the car, and for a race the
  difficulty, opponents and laps; a pause menu on Esc (resume, restart, settings, quit to the
  menu); a settings page (aids, gearbox, steering assist, camera, ghost, sound volume and
  mute). The URL options still work and skip the menu, for links and testing.

## Files

Simulation:

| File | Contents |
| --- | --- |
| `src/vehicle/cars.ts` | `WREN` and `HARRIER` beside `KESTREL`; `CARS` list |
| `src/physics.ts`, `src/sim.ts` | Contact events on car colliders; `sim.contacts`: this step's impacts (point, normal impulse, car, against barrier / car) |

Presentation:

| File | Contents |
| --- | --- |
| `scripts/prepare-cars.mjs` | Trims the kit's chosen models into `public/models/cars/*.glb` |
| `src/render/carModels.ts` | Loads a car's model, scales it to the car, finds its wheel nodes, paints it; placeholder fallback |
| `src/render/carView.ts` | Draws either the model or the placeholder from the same pose |
| `src/render/effects/skidMarks.ts`, `smoke.ts`, `sparks.ts` | Pooled effects, fed each frame from the wheels and `sim.contacts` |
| `src/audio/sound.ts` | Context, unlock, master volume and mute (ported) |
| `src/audio/engine.ts`, `tyres.ts`, `ambience.ts` | Engine voices, squeal and kerb rumble, wind and impacts |
| `src/audio/mix.ts` | Pure functions from car state to voice parameters (frequencies, gains, filter) |
| `src/ui/dashboard.ts` | Rev counter, shift lights, speed, gear, aid lights |
| `src/ui/menu.ts` | Start, pause and settings menus |
| `src/settings.ts` | Sound volume and mute, the last mode, circuit, car and race options |
| `ASSETS.md` | Credits for every model |

## Key data structures

```ts
interface Contact {
  car: number;               // index into sim.cars
  against: 'barrier' | 'car';
  x: number; y: number; z: number;
  impulse: number;           // N·s this step: how hard
}

interface EngineVoice {      // from audio/mix.ts, pure
  fundamental: number;       // Hz: rpm / 60 × cylinders / 2
  gain: number;              // throttle and load
  brightness: number;        // low-pass cut-off (Hz)
  limiter: boolean;
}
```

## Tests

| File | Asserts |
| --- | --- |
| `cars.test.ts` | Each car: static loads, 0–100 km/h, top speed, braking from 100, skidpad g, within its own ranges (Wren slower and gentler than Kestrel, Harrier quicker); the AI laps the Proving Ground cleanly in each |
| `contacts.test.ts` | Driving into a barrier gives impacts against the barrier with an impulse that grows with speed; two cars touching give car impacts for both; driving clean gives none |
| `mix.test.ts` | Engine fundamental from RPM; louder and brighter with throttle; squeal only past peak slip; wind rising with speed² |
| `effects.test.ts` | Skid marks are laid only past peak slip and the ring buffer wraps; smoke and spark pools never grow past their size |

Models, menus, the dashboard and audio are checked in the browser (and by ear in your
playtest).

## Commits, in order

1. Plan (this file).
2. Wren and Harrier, a car list, and per-car vehicle tests.
3. Car models: the prepare script, loading, scaling, wheels and paint, fallback; `ASSETS.md`.
4. Contact events in the simulation; skid marks, tyre smoke and sparks. Tests.
5. Audio: engine (yours and the three nearest AI), tyre squeal, kerb rumble, wind, impacts; M mutes. Tests for the mix.
6. The dashboard with the rev counter; panels restyled.
7. Menus: start, pause (Esc) and settings; settings remembered; URL options still skip them.
8. Performance check with eight cars and every effect, docs, then playtest questions.

## Risks

- **Model scale and wheel positions.** The kit's proportions won't match the collision box
  exactly. The model is scaled to the box's length and width, and its wheels are moved onto
  the physics wheel mounts, so the tyres touch where the rays do.
- **Audio in the browser.** Nothing plays until the first click or key (the menu's Start is
  that gesture). Eleven engine harmonics × four engines is cheap for Web Audio.
- **Performance.** Skid marks and smoke are pooled and drawn in one draw call each; sparks
  likewise. Checked with eight cars sliding.

## Questions for you

1. Car models: may I download Kenney's *Car Kit* (CC0, a zip of a few MB from kenney.nl)? Or
   if you'd rather fetch it yourself, put the zip somewhere and tell me the path.
2. Wren (light roadster) and Harrier (heavy GT) as the two new cars, so car select means
   something. All right, or would you prefer one car in different colours for now?
3. Menus: a start menu on load, Esc for pause, URL options skipping the menu. All right?
4. Engine sound: synthesised from RPM and load (no recordings), as `CLAUDE.md` says. Any
   character you want (a high-revving four, a deeper six)?
