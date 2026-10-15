# Racing

A 3D racing game for the browser with real car physics, built with Three.js, Rapier and TypeScript.

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
| R | Put the car back on the track |
| T | Telemetry overlay (or open with `?telemetry`) |

Gamepads work too: left stick steers, RT/LT throttle and brake, A handbrake, RB/LB shift,
Y camera, View/Back resets the car.

Play it at https://tanakriteuro.github.io/racing-game/.

See `CLAUDE.md` for the vehicle model, architecture and roadmap.
