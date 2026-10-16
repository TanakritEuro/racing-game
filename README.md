# Racing

A 3D racing game for the browser with real car physics, built with Three.js, Rapier and TypeScript.
Three invented circuits: fast Harrowmere, tight Saltmarsh and hilly Ridgeback. Time trial
with sectors, a live delta, a ghost of your best lap (kept in the browser) and replays from
trackside cameras. Race up to seven AI drivers who drive the same car you do. Three cars,
synthesised engine and tyre sounds, skid marks, smoke and sparks. A four-round championship
against the same seven drivers, kept between visits. Race a friend online: one hosts and
gets a four-character room code, the other joins with it, with or without AI drivers. Set
your car up in the garage (springs, anti-roll bars, dampers, ride height, wings, brake bias,
differential, gearing) for each circuit. Race in the dry, the damp or the wet: less grip,
slippery kerbs, standing water that floats the car at speed, rain and spray. In longer races
tyres wear and fuel burns: every circuit has a pit lane, and the AI chooses when to stop.

```bash
npm install
npm run dev
```

Open http://localhost:5173. The start menu picks the mode, circuit and car (Car setup opens
the garage); Esc pauses.

| Key | Action |
| --- | --- |
| W / ↑ | Throttle |
| S / ↓ | Brake. In automatic, stop, release and press again to reverse |
| A / D, ← / → | Steer |
| Space | Handbrake |
| E / Q | Shift up / down (manual) |
| M | Switch between automatic and manual |
| Z / X | ABS / traction control on or off |
| V | Keyboard steering assist on or off |
| C | Camera: chase, bumper, hood |
| N | Next circuit (or open with `?track=harrowmere`, `saltmarsh`, `ridgeback`, `proving-ground`) |
| R | Put the car back on the track (voids the lap) |
| Backspace | Restart from the grid (an out lap) |
| G | Ghost of your best lap on or off |
| Tab | Switch between time trial and a race (or open with `?mode=race`; options `&difficulty=easy\|medium\|hard&opponents=0..7&laps=3`) |
| P / Shift+P | Replay the last lap / the best lap. In a replay: Space pause, ← / → skip, 1–4 speed (¼× to 2×), Esc back to driving |
| U | Sound on or off |
| Esc | Pause menu (resume, restart, settings, quit to the menu). Online, the race goes on |
| Enter | Ask for a rematch after an online race |
| T | Telemetry overlay (or open with `?telemetry`) |

Gamepads work too: left stick steers, RT/LT throttle and brake, A handbrake, RB/LB shift,
Y camera, View/Back resets the car.

Play it at https://tanakriteuro.github.io/racing-game/.

See `CLAUDE.md` for the vehicle model, architecture and roadmap.
