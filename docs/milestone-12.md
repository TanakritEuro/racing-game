# Milestone 12 plan: a track editor

## Status: done

Closed without playtest answers; the questions (how drawing feels, the problem messages,
where kerbs, gravel and the pit lane land, driving and racing a drawn circuit, a shared link
on another device) stay open.

Approved as written: the track editor next, editing from above in 2D, sharing as links,
custom circuits online.

Measured: checking a circuit takes 2–21 ms (the built-in ones); every built-in circuit and the
blank oval keep every rule, and layouts made to break each rule are caught with the place
marked; the AI laps a drawn circuit (the oval with its back straight bent into an S) twice
without leaving the road. Checked in the browser: the editor on the blank oval, dragging a
point into a hairpin (gravel placed on its outside, still valid at 2.23 km), test drive into
the game on it (pit lane, building and grandstand placed, the minimap's shape), the circuit
in the start menu with Edit and Delete, and a shared link (about 550 characters for 15
points) opening it again.

Where the build differs from the plan below:

- **A shared link opens the editor** with the circuit in it, ready to test-drive or save,
  rather than a separate "drive it / keep it" prompt: one place to look at it first.
- **A copy of the Proving Ground has no automatic pit lane**: its straight is too short for
  the lane's standard tapers (its built-in lane is placed by hand with short ones). The
  editor says so; lengthen the straight or start from another circuit.
- **Deleting a custom circuit leaves its best laps stored**, keyed by the circuit: draw the
  identical circuit again and they come back.
- **While a point or slider moves, only the road is rebuilt** (no kerbs, pit lane or checks);
  the full circuit and its checks follow when it stops, as planned.
- **N** (next circuit) still cycles through the built-in circuits only.

The roadmap's planned milestones are done, so this one is a proposal (the other candidate is
in question 1). A circuit is already pure data, a `TrackDef`: a loop of control points with
elevation, banking and width. Kerbs and gravel traps can already be placed from a layout's
corners, and the AI computes its own racing line and speeds for any layout. So a circuit you
draw yourself can be driven, raced against the AI and shared, with no extra work per circuit.
What's missing is a way to draw one, and the rules that keep it drivable, which today live
only in `tests/circuits.test.ts`.

## Scope decisions

- **A top-down editor**, its own screen (start menu → Track editor, or `?editor`). The map
  shows the road as it will be built, with its run-off and barriers, over a metre grid.
  Control points are handles: drag one to move it; click the road to add a point there;
  select one to set its elevation (−20 to 40 m), banking (±12°) and width (8–16 m) with
  sliders, or delete it. Point 0 is the start line ("Start here" makes the selected point
  the start). Undo and redo.
- **Circuit settings:** name, run-off width and surface, how hilly the land around it is,
  how many trees, which side the pits are on, and whether kerbs (at the corners) and gravel
  (at the hairpins) are placed for you, as on the built-in circuits.
- **Live checks, the same rules as the built-in circuits.** The circuit tests become a pure
  `validateTrack(def)` (`track/validate.ts`) used by the tests and the editor: length 0.8–8
  km, no corner tighter than 12 m, no grade over 12 %, no banking over 12°, no part of the
  circuit (with its run-off) touching another, a straight start and grid, and room for a pit
  lane. Each problem is listed in words and marked on the map in red where it is. Only a
  circuit that passes can be driven.
- **The pit lane, pits building and grandstands are placed for you:** the lane along the
  straight through the start line (in after the last corner, out before the first, as on the
  built-in circuits), the building beside it, a grandstand opposite.
- **Saved in your browser** (up to 20 circuits), each with its own bests. Custom circuits
  appear in the start menu beside the built-in ones (marked, with Edit and Delete) for time
  trial and races. The championship stays on its four circuits.
- **Test drive** from the editor: straight into a time trial on it; Esc → back to the editor.
- **Sharing:** "Copy link" gives a URL with the circuit packed into it; opening it offers to
  drive it and save it. A link is checked like anything else that arrives from outside.
- **Online:** a host can choose a custom circuit; the guest is sent its definition in the
  welcome (checked, and refused if it fails validation; `PROTOCOL` 5).
- **Starting points:** a blank oval, or a copy of any built-in circuit to modify.

## Files

Simulation:

| File | Contents |
| --- | --- |
| `src/track/validate.ts` | `validateTrack(def)`: every rule, each problem with where on the track it is. Pure |
| `src/track/custom.ts` | A custom circuit (points and settings) → `TrackDef`: kerbs, gravel, the pit lane and scenery placed; ids; `cleanCustom(raw)` for anything from outside. Pure |
| `src/track/pitLane.ts` | `autoPitLane(track, side)`: entry and exit from the straight through the line |
| `tests/circuits.test.ts` | Uses `validateTrack` |

Presentation:

| File | Contents |
| --- | --- |
| `src/storage/customTracks.ts` | Custom circuits in localStorage |
| `src/editor/` | `editor.ts` (state, edits, undo), `mapView.ts` (the canvas: road, handles, problems), `panels.ts` (point and circuit settings, the problem list, buttons) |
| `src/share.ts` | Pack a circuit into a link and back (compact JSON, base64url) |
| `src/ui/menu.ts`, `main.ts` | Custom circuits in the circuit cards; Track editor; `?editor`, `?track=custom-…`, `?share=` |
| `src/online/protocol.ts`, `session.ts` | The custom circuit sent in the welcome |

## Key data structures

```ts
interface CustomCircuit {
  version: 1;
  id: string;                 // 'custom-' + a short hash
  name: string;
  points: ControlPoint[];     // x, z, y?, bank?, width?
  width: number;
  runoff: { width: number; surface: 'grass' | 'gravel' };
  hills: number;
  trees: number;
  pitSide: Side;
  kerbs: boolean;             // at the corners
  gravel: boolean;            // at the hairpins
}

interface Problem {
  rule: 'length' | 'radius' | 'grade' | 'banking' | 'overlap' | 'start' | 'grid' | 'pits';
  message: string;            // in words, with the number
  at: number[];               // track distances (m) where it is
}
```

## Tests

| File | Asserts |
| --- | --- |
| `validate.test.ts` | Every built-in circuit passes; layouts made to break each rule fail it, with the right place marked |
| `custom.test.ts` | A custom circuit becomes a valid `TrackDef` with kerbs, gravel, a pit lane and scenery; junk from outside is cleaned or refused; the same circuit gives the same id |
| `share.test.ts` | A circuit survives a link both ways; a link longer than the limit, or broken, is refused |
| `ai.test.ts` (soak) | The AI laps a custom circuit (made from the oval template, bent into an S) cleanly |
| `protocol.test.ts` | A welcome with a custom circuit round-trips; one that fails validation is refused |

## Commits, in order

1. Plan (this file).
2. `validateTrack` (the circuit tests use it), the automatic pit lane, custom circuit →
   `TrackDef`, storage and the share link. Tests.
3. The editor: map, handles, point and circuit panels, live problems, undo. Checked in the
   browser.
4. Custom circuits in the game: menu cards, test drive, races, sharing, online. Tests and a
   check in the browser.
5. Docs, then playtest questions.

## Risks

- **Building a circuit on every edit.** Sampling and checking a 4 km circuit takes a few
  tens of milliseconds; the editor rebuilds after a drag ends (and a cheap preview of the
  spline while dragging), not on every mouse move.
- **Strange layouts the rules allow.** The checks are the ones the built-in circuits pass;
  a layout can still be dull or awkward (that's yours to judge) but not undrivable or broken.
- **Long links:** a 40-point circuit packs into about 1–2 KB of URL, fine for chat apps;
  the limit is checked.

## Questions for you

1. A track editor next, or touch controls for phones and tablets?
2. Editing from above in 2D (as proposed), or also a 3D fly-over preview before driving?
3. Sharing circuits as links (as proposed): all right?
4. Custom circuits in online races (the guest receives the circuit), as proposed?
