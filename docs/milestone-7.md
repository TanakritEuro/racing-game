# Milestone 7 plan: championship

## Status: done

Closed without playtest answers; the questions (season length, the reverse grid, rivals
feeling distinct, the standings screen, continuing after closing the tab) stay open.

Approved as proposed: a championship rather than online, four rounds at 5 / 3 / 3 / 3 laps,
reverse championship order on the grid after round 1, points 10-8-6-5-4-3-2-1.

Measured: a whole season with one lap a round runs headless in about 40 s.

Where the build differs from the plan below:

- **The season stores only the AI's skills**, not names and colours: entry k is car k in
  every round, so its name and colour follow from the entry number as in a single race.
- **A finished round can't be run again:** once the result is recorded (when every car is
  classified), restart is refused. Restarting before then just reruns the round.
- **The soak test found a real bug:** traffic advice asked for before a car had been placed
  on the track read the racing line at index −1, giving the driver a NaN aim; one NaN
  control made the car's state NaN for good (and the vehicle maths very slow). Traffic now
  waits until it knows where a car is, the driver ignores a non-finite aim, and the car
  model treats any non-finite control as zero (`car.test.ts`, "bad input"). Only the
  autopilot and the tests could reach it; the AI cars were always placed first.

The roadmap's last milestone is optional: a short championship against the AI, *or*
two-player online racing. This plan proposes the **championship** (why, and how online
would go instead, are at the end). Goal: a four-round season against the same seven AI
drivers, with points, standings between rounds and a champion, kept between visits.

## Scope decisions

- **A season is four rounds, one on each circuit**, shortest first: Proving Ground
  (5 laps), Saltmarsh (3), Ridgeback (3), Harrowmere (3). About 25 minutes in all.
- **The same field all season.** The seven AI drivers keep their names, colours and skills
  for the whole championship (drawn once from the season's seed at the difficulty you pick),
  so rivals become familiar: the quick one, the one who bins it at the hairpin. Everyone
  drives the car you pick at the start.
- **Points** for the top eight: 10, 8, 6, 5, 4, 3, 2, 1. Ties in the standings go to more
  wins, then more second places, and so on, then the better result in the last round.
- **Grid:** round 1 from the season's seed with you mid-grid (as in a single race); after
  that, **reverse championship order** (the leader starts last), so the leader has to fight
  through and the rounds stay close. (The alternative, leader on pole, is a question below.)
- **Saved between visits** in localStorage: the season's seed, difficulty, car, the round
  you're on and every result. The start menu offers *Continue championship* (round 2 of 4)
  or a new one; abandoning a season asks first.
- **Between rounds:** after the results table, a standings screen (positions, points, the
  round's points in green, gaps to the leader) and *Next round*. After the last round, the
  final standings with the champion, and back to the menu.
- **No new driving rules:** a championship round is an ordinary race (the same AI, traffic,
  lights, results). Restarting a round (Backspace or the pause menu) is allowed and simply
  reruns it; only a finished round counts.

## Files

Simulation:

| File | Contents |
| --- | --- |
| `src/race/championship.ts` | `Season`: rounds, the field (names, colours, skills), results per round, points, standings with tie-breaks, the grid for the next round; to / from plain JSON |
| `src/race/race.ts` | `RaceOptions` takes the field's skills and the grid order instead of drawing them, so a championship round is built from the season |

Presentation:

| File | Contents |
| --- | --- |
| `src/storage/season.ts` | The season in localStorage (read, write, clear), ignored if unreadable |
| `src/ui/menu.ts` | *Championship* beside time trial and race: difficulty and car for a new season, or continue the saved one |
| `src/ui/standings.ts` | The standings screen between rounds and the final one |
| `src/main.ts` | `?season` starts the saved season's next round; at the flag the result is recorded and saved, then the standings |

## Key data structures

```ts
interface Season {
  version: 1;
  seed: number;
  difficulty: Difficulty;
  car: string;
  /** The AI drivers, the same all season (the player is entry 0). */
  field: { name: string; colour: number; skill: Skill | null }[];
  rounds: { track: string; laps: number }[];
  /** Finishing order of each round run so far: entry indices, winner first. */
  results: number[][];
}

interface SeasonStanding {
  entry: number;
  points: number;
  /** Points scored in the latest round, and finishing positions (for tie-breaks). */
  lastRound: number;
  finishes: number[];
}
```

## Tests

| File | Asserts |
| --- | --- |
| `championship.test.ts` | Points per position; standings sorted by points with the tie-breaks; reverse-order grid after round 1; the field's skills are the same every round and every reload; to / from JSON round-trips, and an unreadable save is refused |
| `race.test.ts` (added) | A race built from a season's field and grid puts each car in its slot with its skill |
| `season.test.ts` (soak) | A whole short season with an AI driving your car (one lap per round): four rounds, every car classified each time, points adding up to 39 per round |

## Commits, in order

1. Plan (this file).
2. The championship model: rounds, field, points, standings, grid, JSON. Tests.
3. Races built from a season (skills and grid passed in); the headless season soak. Tests.
4. Championship in the menus, saving and continuing, recording results, the standings
   screens.
5. Docs, then playtest questions.

## Risks

- **Reloading between rounds** (the menus already reload to start a race): the season is
  saved before the reload, so nothing is lost if the tab closes mid-season.
- **A round abandoned half-way** (closing the tab mid-race) is not counted; continuing the
  season starts that round again.

## Why not online (yet)

Online would port five-a-side's PeerJS link (room codes, host and guest), but racing is
harder than football over a network: your own car has to answer the controls *now*. With
the host running both cars, the guest's car would lag by a round trip (50–150 ms), which
feels awful at 200 km/h. Doing it properly means each player simulating their own car and
seeing the other's as a smoothed, predicted ghost that can be bumped only one way, plus
agreeing on the start and the finishing order. That is a milestone of its own, with no way
to test it here except two browsers on one machine. The championship uses what exists, is
testable headless, and finishes the single-player game.

## Questions for you

1. Championship rather than online for this milestone? (Online could follow as an eighth.)
2. Four rounds on the four circuits, 5 / 3 / 3 / 3 laps: right length, or shorter (2–3 laps
   each) or longer?
3. Grid after round 1: reverse championship order (the leader last), or leader on pole?
4. Points 10-8-6-5-4-3-2-1 for the top eight. All right?
