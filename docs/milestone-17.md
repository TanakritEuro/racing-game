# Milestone 17 plan: night racing

## Status: built, in playtesting

Approved as written: night racing, the AI unaffected by the dark, dusk to night as a race option.

Measured: 15–17 towers per km (Harrowmere 80, Saltmarsh 46, Ridgeback 66, the Proving Ground
25), every sample's darker edge lit to its minimum (corners and the grid more), placed in
under 25 ms. Checked in the browser: dusk and night at Harrowmere with eight cars (the sky,
the towers lit, the floodlit grid, head and tail lights, the car ahead in your headlights),
a frame drawn in 2.2 ms with four headlights lit; night at the Proving Ground with four cars.
No console errors. (The in-app browser's frame rate is no guide: it draws at about 1.5 fps
whatever the scene, so these are timings of the drawing itself.)

Where the build differs from the plan below:

- **The floodlight's light is baked into vertex attributes** and added by a small patch to
  the track's, terrain's and scenery's materials (`render/nightLight.ts`): emitted light in
  the surface's own colour on lit materials, and on unlit ones (painted lines, decals) a
  dimming in the dark that the floodlight brings back up. Cars, which move, get a little
  extra sky fill light where the camera's car stands under the lights, rather than baked light.
- **Headlights fall off gently** (linear with distance, not as the square): at first a car
  just ahead on the grid was blown out to white while the road beyond was dark.
- **The headlight spot lights stay in the scene all session** (off is a strength of 0):
  switching lights in and out makes three.js rebuild every shader.
- **Online:** the time of day goes in the welcome (`PROTOCOL` 8; the online replays took 7).
- **Online race replays** were added alongside, in a session of their own (see
  `docs/milestone-16.md`, *Online*).

Every race today runs at noon under the same sun. This milestone adds the time of day: dusk,
with the sun low and long shadows, and night, with the circuits lit by floodlight towers and
every car by its own headlights, tail lights and brake lights. A race can start at dusk and
run into the dark. The physics doesn't change at night (the tyres don't know); what changes
is what you can see: the braking boards and apexes come out of the dark at the last moment
on a badly lit stretch, and the cars ahead are pairs of red lights.

## Scope decisions

- **Three times of day for a session: day, dusk and night**, chosen in the start menu (beside
  the weather) or `?time=day|dusk|night`. **Dusk to night** as a race option: the light goes
  down over the race's distance, the floodlights and headlights coming on as it does.
- **The sky and the light follow the time:** the sun's height, colour and strength, the sky's
  colour and the fog. At night a dark blue sky, a little moonlight, and the fog drawn in. With
  rain, both together (darker still).
- **Floodlight towers on every circuit** (built-in and custom), placed beyond the barriers
  so that every sample of the track gets at least a minimum of light, more at the corners,
  pits and grid. The towers are drawn, with their lamps lit. **The light they give is baked**
  into the road, kerbs, run-off and barriers (a brightness per vertex from the towers within
  reach), not real lights: dozens of real lights would cost far too much frame time.
- **Headlights:** real spot lights, casting light on the road ahead, for your car and the
  three nearest cars (the four that matter on screen); every car's headlamps, tail lights
  and brake lights glow (brighter with the brake pedal, in replays too, from the recorded
  brake). On Low graphics only your own headlights are real lights.
- **No change to grip, the AI or lap times:** bests stay per circuit, car and weather (a lap
  at night is the same lap). The AI drives the same at night (question 2).
- **The championship and career** draw a time of day for each round the way they draw the
  weather (night now and then; the Grand Championship's final round always under lights).
  Online, the host's.

## Files

Simulation and pure logic:

| File | Contents |
| --- | --- |
| `src/track/timeOfDay.ts` | `TimeOfDay` (`day`, `dusk`, `night`, `duskToNight`), the light level at a race time (0 night … 1 day), the sun's elevation; parsing. Pure |
| `src/track/floodlights.ts` | `placeFloodlights(track, terrain)`: towers beyond the barriers, greedily, until every sample has its minimum; `lightAt(towers, x, z)`: the light a point gets. Pure |
| `src/race/championship.ts`, `career.ts` | A round's time of day, drawn like its weather |
| `src/online/protocol.ts` | The time of day in `welcome`; `PROTOCOL` 7 |

Presentation:

| File | Contents |
| --- | --- |
| `src/render/lighting.ts` | The sky, sun, hemisphere light and fog for a light level (and the weather) |
| `src/render/trackView.ts`, `render/floodlightView.ts` | The baked floodlight brightness on the track's vertices at night; the towers and their lamps |
| `src/render/carLights.ts` | Headlamps, tail and brake lights on each car model; the pool of four real spot lights given to the nearest cars |
| `src/ui/menu.ts`, `main.ts` | Time of day in the start menu and links; the light level updated through a dusk-to-night race |

## Key data structures

```ts
type TimeOfDay = 'day' | 'dusk' | 'night' | 'duskToNight';

/** The light level at race time t (s) of a race lasting about `length` (s): 1 day … 0 night. */
function lightLevel(time: TimeOfDay, t: number, length: number): number;

interface Floodlight {
  x: number; y: number; z: number;   // the lamp head
  aim: number;                       // the sample it points at
}
```

## Tests

| File | Asserts |
| --- | --- |
| `timeOfDay.test.ts` | Day 1, night 0, dusk in between; dusk to night falls from the dusk level to night over the race and stays there; parsing |
| `floodlights.test.ts` | On every circuit (built-in and a custom one): every tower beyond the barriers and off the road; every sample lit to its minimum, corners and the grid more; a reasonable number of towers per km |
| `season.test.ts`, `career.test.ts` | A round's time of day drawn, the same for the same season; the Grand Championship's last round at night |
| `protocol.test.ts`, `online.test.ts` | The time of day reaches the guest |

## Commits, in order

1. Plan (this file).
2. Time of day and floodlight placement (pure), in seasons, the career and online. Tests.
3. On screen: the light and sky, the towers and baked light, the car lights and headlight
   pool, the menu. Checked in the browser, including the frame time with eight cars at night.
4. Docs, then playtest questions.

## Risks

- **Frame time.** Four extra spot lights cost every lit material more shader work; the
  baked floodlight is free at run time. Measured in the browser with eight cars; if it costs
  too much, Low graphics keeps one light and High four.
- **How dark is right.** Too dark is unplayable, too light isn't night. The levels are in
  `TUNING` for your playtest; the minimum floodlight level keeps every stretch drivable.

## Questions for you

1. Night racing (as proposed), or **dirt and rally stages** (loose surfaces, point-to-point
   stages against the clock) instead?
2. The AI unaffected by the dark (as proposed), or a little more cautious at night (braking
   earlier where the track is darkest)?
3. Dusk to night as a race option (as proposed), or also a full day's cycle for long races?
