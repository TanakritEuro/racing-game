import { describe, expect, it } from 'vitest';
import { buyUpgrade, careerRound, newCareer, parseCareer, recordCareerRound, SERIES, startSeries, type Career } from '../src/race/career';
import { ENTRIES } from '../src/race/championship';
import { upgradePrice } from '../src/vehicle/upgrades';

/** A finishing order with you (entry 0) in `position`, the AI in entry order around you. */
function order(position: number): number[] {
  const ai = Array.from({ length: ENTRIES - 1 }, (_, i) => i + 1);
  return [...ai.slice(0, position - 1), 0, ...ai.slice(position - 1)];
}

/** Run every round of the current season with you finishing `position`. */
function runSeason(career: Career, position: number) {
  let c = career;
  let last = null;
  for (let r = 0; r < c.season.rounds.length; r++) {
    last = recordCareerRound(c, order(position));
    c = last.career;
  }
  return last!;
}

describe('a career', () => {
  it('starts in the Club Cup with the Wren and no money', () => {
    const c = newCareer(5);
    expect(c.series).toBe(0);
    expect(c.reached).toBe(0);
    expect(Object.keys(c.garage)).toEqual(['Wren']);
    expect(c.money).toBe(0);
    const round = careerRound(c);
    expect(round.car).toBe('Wren');
    expect(round.track).toBe(SERIES[0].rounds[0].track);
    expect(round.options.laps).toBe(SERIES[0].rounds[0].laps);
    expect(round.options.difficulty).toBe('easy');
    expect(round.options.conditions).toBe('dry');
    expect(round.options.wear).toBe('off');
  });

  it('pays every round by position', () => {
    const c = newCareer(5);
    const win = recordCareerRound(c, order(1));
    expect(win.prize).toBe(SERIES[0].prize[0]);
    expect(win.career.money).toBe(SERIES[0].prize[0]);
    expect(win.final).toBeNull();
    const eighth = recordCareerRound(c, order(8));
    expect(eighth.prize).toBe(SERIES[0].prize[7]);
    expect(eighth.prize).toBeLessThan(win.prize);
  });

  it('opens the next series and its car for a top-three season, with the bonus', () => {
    const end = runSeason(newCareer(5), 3);
    expect(end.final!.position).toBe(3);
    expect(end.final!.bonus).toBe(SERIES[0].bonus[2]);
    expect(end.final!.promoted?.id).toBe('national');
    expect(end.career.reached).toBe(1);
    expect(end.career.garage.Kestrel).toBeDefined();
    expect(end.career.best[0]).toBe(3);
    expect(end.career.money).toBe(4 * SERIES[0].prize[2] + SERIES[0].bonus[2]);
  });

  it('runs a series again after a season outside the top three, keeping money and upgrades', () => {
    let c = newCareer(5);
    c = { ...c, money: 5000 };
    c = buyUpgrade(c, 'Wren', 'engine')!;
    const end = runSeason(c, 4);
    expect(end.final!.promoted).toBeNull();
    expect(end.career.reached).toBe(0);
    const again = startSeries(end.career, 0);
    expect(again.season.results).toEqual([]);
    expect(again.season.seed).not.toBe(c.season.seed);
    expect(again.money).toBe(end.career.money);
    expect(again.garage.Wren.engine).toBe(1);
    // Not a series you haven't reached.
    expect(startSeries(again, 2)).toBe(again);
  });

  it('is complete once the Grand Championship is won', () => {
    let c = newCareer(5);
    c = startSeries(runSeason(c, 1).career, 1);
    expect(careerRound(c).car).toBe('Kestrel');
    expect(careerRound(c).options.wear).toBe('normal');
    c = startSeries(runSeason(c, 2).career, 2);
    const grand = careerRound(c);
    expect(grand.car).toBe('Harrier');
    expect(grand.options.difficulty).toBe('hard');
    expect(grand.options.wear).toBe('high');
    const second = runSeason(c, 2);
    expect(second.career.complete).toBe(false);
    const won = runSeason(startSeries(second.career, 2), 1);
    expect(won.final!.complete).toBe(true);
    expect(won.career.complete).toBe(true);
    expect(Object.keys(won.career.garage).sort()).toEqual(['Harrier', 'Kestrel', 'Wren']);
  });

  it('spends money on upgrades, up to the top level and no further than the money goes', () => {
    let c = { ...newCareer(5), money: 100_000 };
    for (let level = 0; level < 3; level++) c = buyUpgrade(c, 'Wren', 'tyres')!;
    expect(c.garage.Wren.tyres).toBe(3);
    expect(buyUpgrade(c, 'Wren', 'tyres')).toBeNull();
    const spent = upgradePrice('tyres', 0)! + upgradePrice('tyres', 1)! + upgradePrice('tyres', 2)!;
    expect(c.money).toBe(100_000 - spent);
    expect(buyUpgrade({ ...c, money: 10 }, 'Wren', 'engine')).toBeNull();
    // Not a car you own.
    expect(buyUpgrade(c, 'Harrier', 'engine')).toBeNull();
  });

  it('comes back from JSON, and refuses what it cannot read', () => {
    const c = runSeason(newCareer(7), 2).career;
    expect(parseCareer(JSON.parse(JSON.stringify(c)))).toEqual(c);
    expect(parseCareer(null)).toBeNull();
    expect(parseCareer({ ...c, money: -5 })).toBeNull();
    expect(parseCareer({ ...c, series: 2, reached: 1 })).toBeNull();
    expect(parseCareer({ ...c, season: { nonsense: true } })).toBeNull();
    // Upgrades out of range are brought back into it.
    const odd = parseCareer({ ...c, garage: { Wren: { engine: 9, tyres: -1 } } })!;
    expect(odd.garage.Wren).toEqual({ engine: 3, tyres: 0, weight: 0, brakes: 0 });
    // The cars of every series reached are there.
    expect(odd.garage.Kestrel).toBeDefined();
  });
});
