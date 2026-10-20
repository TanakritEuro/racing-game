# Milestone 14 plan: career mode

## Status: done

Closed without playtest answers; the questions (whether the climb feels earned, the pace of
money and upgrades, the upgrades on the road, the Grand Championship as a finale, the career
screen) stay open.

Approved as written: three series, promotion for a top-three finish, prize money and upgrades,
unlocks only inside the career.

Measured (headless): the engine's third level (+12 % torque) reaches 160 km/h at least 5 %
sooner (to 100 km/h only 0.18 s sooner: off the line the car is limited by its traction, not
its power); the tyres' third level (+6 % grip) corners over 2 % harder on the skidpad.
Checked in the browser: Career in the start menu, a new career's screen (the ladder with the
Club Cup open, round 1 next, the Wren's upgrades), round 1 run to the flag with the autopilot
(the Wren, 4 laps, eight cars, dry, no wear, easy rivals), the Club Cup standings with the
prize (100 cr for P8), and back to the career screen with the money and round 2 next.

Where the build differs from the plan below:

- **Races carry more fuel:** 0.35 kg per km, up from 0.25. In the Club Cup's opening round
  the Wren had used half its fuel by half distance: the stop-start Proving Ground burns
  ~0.31 kg/km (Harrowmere's long straights ~0.21). Running dry never stopped a car, but a
  race should start with enough.
- **The 10-lap high-wear soak now allows up to two cars put back on the track**, and a stop
  costing 18–45 s: with a few kilos more fuel aboard the race ran differently. One car spun
  on worn tyres, and one ran wide out of Saltmarsh's last corner into the **blunt end of the
  pit wall**, which sits a metre beyond the road edge where the lane's entry taper ends.
  That's worth looking at in your playtest; a sloped nose on the wall is the likely fix.
- **Not clicked in the browser:** buying an upgrade and a promotion at a season's end (the
  test career had 100 cr); both are covered by `career.test.ts`.

Your choice of what's next. Today the championship is one season in one car against one
field. A career turns the game into a long climb: a ladder of three series, each a step up in
car, rivals and race length, that you earn your way up by finishing near the front. Prize
money from every race buys upgrades for your cars, so you get faster as the opposition does,
and the top series uses the features built since: weather, tyre wear and pit stops.

## Scope decisions

- **Three series, each a season of four rounds** (built on the championship: the same points,
  standings, grid and saved seasons):

  | Series | Car | Rivals | Rounds | Conditions |
  | --- | --- | --- | --- | --- |
  | **Club Cup** | Wren | easy | Proving Ground 4 laps, Saltmarsh 2, Ridgeback 2, Harrowmere 2 | always dry, no tyre wear |
  | **National Series** | Kestrel | medium | Saltmarsh 3, Ridgeback 3, Harrowmere 3, Proving Ground 6 | weather drawn per round, normal wear |
  | **Grand Championship** | Harrier | hard | Harrowmere 6, Saltmarsh 8, Ridgeback 6, Proving Ground 12 | weather drawn, high wear (you'll need to stop) |

- **Promotion:** finish a series in the top three and the next one opens, and its car is
  yours. Otherwise you run that series again (a new season, a new draw of the field), keeping
  your money and upgrades. Win the Grand Championship and the career is complete; you can go
  on racing any series you've reached.
- **Prize money** after every round, by position and series (the Grand pays most), and a
  bonus for a series' top three. Shown on the standings screen after each round.
- **Upgrades, bought with it, for each car you own** (four kinds, three levels each):
  engine (+4 % torque a level), tyres (+2 % grip), weight (−25 kg), brakes (+8 % torque).
  Like a setup, they change only your car's `CarDef` (`applyUpgrades`), and only in the
  career; the AI drives its car as designed. The garage readout shows what they do.
- **Career only:** the time trial, quick races, the championship and online keep every car
  and circuit open, as now. The career has its own saved progress (one career at a time;
  start again from the career screen).
- **The career screen** (start menu → Career): the ladder (locked, open, or done, with your
  best finish in each), the current season's standings and next round, your money, the
  upgrade shop for each car, and Race next round. A round runs as a championship round does
  (`?career`), then the standings with the prize, then back to the career screen.

## Files

Simulation:

| File | Contents |
| --- | --- |
| `src/race/championship.ts` | A season's settings beyond its rounds: whether weather is drawn and how fast tyres wear (the existing championship keeps its own) |
| `src/race/career.ts` | `Career`: the series ladder, the current season, money, cars owned and their upgrades; recording a round (prize, standings), promotion, buying; JSON and `parseCareer`. Pure |
| `src/vehicle/upgrades.ts` | `Upgrades` (a level per kind), `applyUpgrades(def, upgrades)`, prices. Pure |

Presentation:

| File | Contents |
| --- | --- |
| `src/storage/career.ts` | The career in localStorage |
| `src/ui/careerScreen.ts` | The ladder, the season, money, the upgrade shop, Race next round |
| `src/ui/standings.ts` | The prize after a round, promotion at a series' end |
| `src/ui/menu.ts`, `main.ts` | Career in the start menu; `?career` runs the next round with your upgraded car |

## Key data structures

```ts
type UpgradeKind = 'engine' | 'tyres' | 'weight' | 'brakes';
type Upgrades = Record<UpgradeKind, number>;         // 0..3

interface SeriesDef {
  id: 'club' | 'national' | 'grand';
  name: string;
  car: string;
  difficulty: Difficulty;
  rounds: { track: string; laps: number }[];
  weather: boolean;                                  // drawn per round, or always dry
  wear: WearRate;
  prize: number[];                                   // by position, per round
  bonus: number[];                                   // for the series' top three
}

interface Career {
  version: 1;
  seed: number;
  reached: number;                                   // the highest series open (index)
  series: number;                                    // the one being run
  season: Season;                                    // its current season
  money: number;
  garage: Record<string, Upgrades>;                  // cars owned → their upgrades
  best: (number | null)[];                           // best final position per series
  complete: boolean;
}
```

## Tests

| File | Asserts |
| --- | --- |
| `career.test.ts` | A new career: the Club Cup, the Wren, no money. A round pays by position; a season ending in the top three opens the next series and its car, below it runs the series again with the money and upgrades kept; winning the Grand completes it. Buying spends money, stops at level 3 and at no money. A saved career comes back; a broken one is refused |
| `upgrades.test.ts` | No upgrades: the car unchanged. Each kind changes its numbers and nothing else; measured, the engine's third level reaches 100 km/h sooner, the tyres' raise the skidpad g, the weight's lighten the car |
| `season.test.ts` | A career round's race takes its series' car, field, laps, weather and wear |

## Commits, in order

1. Plan (this file).
2. Series settings in seasons, upgrades, and the career model. Tests.
3. The career screen, the shop, running a round, prizes and promotion on the standings.
   Checked in the browser.
4. Docs, then playtest questions.

## Risks

- **Balance.** Prize money, prices and how hard each series' field is decide whether the climb
  feels earned or a grind. The numbers start simple (a few wins buy an upgrade level) and are
  in `TUNING` for your playtest to tune.
- **Upgraded cars against stock rivals.** With every upgrade the Harrier is quicker than the
  hard AI's Harrier; that's the reward, but if it makes the Grand too easy, the series can
  give its field a pace bonus (still no extra grip: the AI drives closer to its limit).

## Questions for you

1. Three series as above, or more (a fourth, invitation-only, mixed-car series)?
2. Promotion for a top-three finish (as proposed), or only for winning?
3. Upgrades bought with prize money (as proposed), or no money and upgrades: just the ladder?
4. Unlocks only inside the career (as proposed), or should cars and circuits be locked in the
   other modes too until the career earns them?
