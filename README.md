# Racing

A 3D racing game for the browser with real car physics, built with Three.js, Rapier and TypeScript.
Three invented circuits: fast Harrowmere, tight Saltmarsh and hilly Ridgeback. Time trial
with sectors, a live delta, a ghost of your best lap (kept in the browser) and replays from
trackside cameras.

```bash
npm install
npm run dev
```

Open http://localhost:5173.

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
| P / Shift+P | Replay the last lap / the best lap. In a replay: Space pause, ← / → skip, 1–4 speed (¼× to 2×), Esc back to driving |
| T | Telemetry overlay (or open with `?telemetry`) |

Gamepads work too: left stick steers, RT/LT throttle and brake, A handbrake, RB/LB shift,
Y camera, View/Back resets the car.

Play it at https://tanakriteuro.github.io/racing-game/.

See `CLAUDE.md` for the vehicle model, architecture and roadmap.
