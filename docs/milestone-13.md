# Milestone 13 plan: touch controls (phones and tablets)

## Status: planned, waiting for your approval

The last candidate from the earlier lists. The game runs in a phone's browser already, but
it can't be driven there: there's no keyboard, and the menus, HUD and renderer were made for
a laptop. This milestone makes a phone or tablet a proper way to play: controls under your
thumbs, a choice of steering by thumb or by tilting the device, a layout that fits a small
landscape screen, and graphics light enough to hold the frame rate.

## Scope decisions

- **Shown on touch devices only**, automatically (the first touch, or a coarse pointer);
  nothing changes with a keyboard or gamepad, and all three can be used together.
- **Steering, two ways (a setting):**
  - **Thumb** (the default): put your left thumb down anywhere on the left half and slide it
    sideways; how far it has moved from where it landed is the steering (a full 70 px is
    full deflection). It goes through the same assist as the keyboard, so full deflection
    gives the lock the tyres can use at this speed, and a slide gets counter-steer help.
  - **Tilt**: turn the phone like a wheel (the device's roll, 30° to full deflection, with a
    small dead zone), through the same assist. iOS asks permission once, on a tap.
- **Pedals under the right thumb:** a large accelerator and brake on the right. Each is
  analogue by how far up it you press (the top half is full), so you can feather the
  throttle. A small handbrake button between them. ABS and traction control stay on by
  default.
- **Small buttons along the top:** pause (the menu), camera, put back on the track, and
  shift up and down when the gearbox is manual. Every key the touch player needs is a
  button; the rest (replays, telemetry, ghost) is in the pause menu.
- **Landscape:** in portrait the game says "turn your phone sideways". **Full screen** on the
  first tap where the browser allows it, and the screen kept awake while driving.
- **A layout for small screens:** the HUD panels (timing, race, dashboard, tyres) scaled to
  fit a phone's short side, out of the thumbs' way; the menus' cards in one scrolling column.
- **Graphics: High or Low** (a setting; Low chosen for you on a phone): Low draws at
  pixel ratio 1, with a smaller shadow map, fewer trees, less spray and smoke, and no rain
  streaks beyond a short distance. The simulation is untouched.
- **The track editor on a tablet:** dragging points already works by touch; pinch to zoom is
  added. On a phone it fits, but it's cramped (that's fine to say).
- **Not on a phone:** the online room code is typed with the on-screen keyboard, which works
  as is.

## Files

Presentation (the simulation doesn't change):

| File | Contents |
| --- | --- |
| `src/input/touch.ts` | `TouchInput`: the thumb's steering, the pedals' pressure, buttons pressed; tilt from device orientation. Pure mapping functions for the thumb and the tilt |
| `src/input/index.ts` | Touch alongside keyboard and gamepad: pedals take the hardest press, steering the last device to steer |
| `src/ui/touchControls.ts` | The on-screen controls (drawn, and their touch areas), the portrait notice |
| `src/settings.ts`, `ui/menu.ts` | Settings: steering by thumb or tilt; graphics High or Low |
| `src/render/scene.ts`, `render/effects/`, `render/scenery.ts`, `render/weatherView.ts` | Graphics Low: pixel ratio, shadow map, tree count, particle counts, rain |
| `src/style.css` | The small-screen layout |
| `src/editor/mapView.ts` | Pinch to zoom |

## Key data structures

```ts
interface TouchFrame {
  /** Steering −1..1 (thumb or tilt), and whether a thumb or tilt is steering now. */
  steer: number;
  steering: boolean;
  throttle: number;   // 0..1, how far up the pedal
  brake: number;
  handbrake: number;
  shift: -1 | 0 | 1;
  camera: boolean;
  reset: boolean;
  pause: boolean;
}

/** The thumb: horizontal travel from where it landed (px) → steering. */
function thumbSteer(dx: number): number;        // dead zone, then linear to ±1 at 70 px
/** The tilt: the device's roll (degrees) → steering. */
function tiltSteer(roll: number): number;
```

## Tests

| File | Asserts |
| --- | --- |
| `touch.test.ts` | Thumb and tilt mappings: dead zone, full deflection, symmetry, clamped; a pedal's pressure from where it's pressed |
| `input.test.ts` | Touch with keyboard and gamepad: the pedals take the hardest press; steering follows the device that steered last; letting go of the thumb hands back to centre through the assist |
| Browser (phone viewport, touch emulated) | Controls appear on touch and not otherwise; driving a lap of the Proving Ground with taps and a thumb drag; the portrait notice; the menus and HUD fit at 812 × 375; the frame rate with Low graphics and eight cars |

## Commits, in order

1. Plan (this file).
2. Touch input: thumb, tilt, pedals and buttons, merged with keyboard and gamepad. Tests.
3. The on-screen controls, landscape and full screen, the small-screen layout. Checked in a
   phone-sized browser.
4. Graphics Low, and pinch to zoom in the editor. Frame rate measured.
5. Docs, then playtest questions.

## Risks

- **Thumbs cover the screen.** The controls sit low in the corners, and the HUD moves up and
  in; your playtest will say if anything important hides under a thumb.
- **Tilt differs between phones** (axes, permissions, browsers). Thumb steering is the
  default for that reason; tilt is offered where the device reports its orientation.
- **Phone performance** varies a lot. Low graphics and fewer AI cars are the levers; the
  simulation at 120 Hz with eight cars is ~1 ms a step on a laptop, perhaps 3–4 ms on a phone.

## Questions for you

1. Thumb steering as the default, tilt as an option (as proposed), or the other way round,
   or left and right buttons instead of either?
2. Analogue pedals (how far up you press) as proposed, or simple on/off buttons?
3. Graphics Low chosen automatically on phones (as proposed)?
4. After this, the list of candidates is empty. Some ideas for what could follow: a
   **career mode** (seasons that unlock cars and circuits), **more cars** (a front-wheel-drive
   hatch, a four-wheel-drive rally car; the drivetrain would need a front or all-wheel-drive
   option), **night racing** with headlights, **dirt and rally stages** (loose surfaces,
   point-to-point), or **replays of whole races** with the TV cameras. Any you'd like next?
