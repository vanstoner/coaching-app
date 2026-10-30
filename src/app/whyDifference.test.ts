/**
 * "Why the difference" (#261 AC10 to AC12, AC18), on Ada's worked example
 * from #261 §1 (made-up names): 5-a-side, three counted matches, Gus the
 * Main keeper. Synthetic first names only (invariant 4).
 */

import { describe, expect, it } from 'vitest';
import type { UUID } from '../types/index';
import type { ChildSeason, SquadSeason } from './childSeason';
import { owedTime, type MatchMinutes, type SeasonMatch, type SquadViews, type UnclosedMatch } from './squadViews';
import { minSec, signedMinSec, whyDifference } from './whyDifference';

const MIN = 60_000;

// Minutes per match; null = not there.
const TABLE: Record<string, (number | null)[]> = {
  Ava: [35, 40, 35],
  Ben: [35, 40, 35],
  Cara: [30, 40, 20],
  Dan: [35, 45, 35],
  Eve: [30, 35, 35],
  Finn: [35, null, 40],
  Gus: [50, 50, 50],
};
const NAMES = Object.keys(TABLE);
const id = (name: string) => `id-${name}` as UUID;

function minutes(j: number): Map<UUID, MatchMinutes> {
  const out = new Map<UUID, MatchMinutes>();
  for (const name of NAMES) {
    const m = TABLE[name][j];
    if (m === null) continue;
    out.set(id(name), {
      pitchMs: m * MIN,
      goalMs: name === 'Gus' ? m * MIN : 0,
      unitMs: { GK: 0, DEF: 0, MID: 0, ATT: 0 },
    });
  }
  return out;
}

function match(j: number, extra: Partial<SeasonMatch> = {}): SeasonMatch {
  const date = `Sat ${j + 1} Oct`;
  return {
    matchId: `m${j}` as UUID,
    at: null,
    day: '',
    date,
    opponent: `Mock ${j + 1}`,
    competition: null,
    competitionShort: '',
    label: date,
    minutes: minutes(j),
    counted: true,
    offFormat: null,
    provenance: 'recorded' as SeasonMatch['provenance'],
    ...extra,
  };
}

function views(matches: SeasonMatch[], unclosed: UnclosedMatch[] = [], fillIn: string[] = []): SquadViews {
  const children = NAMES.map((name) => {
    const played = matches.filter((m) => m.counted && m.minutes.has(id(name))).length;
    return {
      playerId: id(name),
      name,
      mainKeeper: name === 'Gus',
      fillIn: fillIn.includes(name),
      played,
      averageMs: played ? 1 : null,
    };
  }) as unknown as ChildSeason[];
  const season = { children } as unknown as SquadSeason;
  return {
    season,
    matches,
    owed: owedTime(season, matches),
    unclosed,
  } as unknown as SquadViews;
}

const ada = () => views([match(0), match(1), match(2, { late: new Set([id('Cara')]) })]);

describe('the season line and its sum (AC11 1–2)', () => {
  it('Cara: 16 under, and the sum adds up to it', () => {
    const w = whyDifference(ada(), id('Cara'))!;
    expect(w.headline).toBe('16 min under the average this season');
    expect(w.sum).toBe('Squad average 35:25 a game × 3 matches = 106:15 · they played 90:00 · difference 16 min under');
  });

  it('Eve: 6 under; Dan: 9 over', () => {
    expect(whyDifference(ada(), id('Eve'))!.headline).toBe('6 min under the average this season');
    const dan = whyDifference(ada(), id('Dan'))!;
    expect(dan.headline).toBe('9 min over the average this season');
    expect(dan.sum).toMatch(/they played 115:00 · difference 9 min over$/);
  });

  it('a missed match is in no sum: Finn over two matches', () => {
    const finn = whyDifference(ada(), id('Finn'))!;
    expect(finn.sum).toMatch(/× 2 matches = 70:50 · they played 75:00 · difference 4 min over$/);
    expect(finn.notCounted).toEqual([{ matchId: 'm1', label: 'Sat 2 Oct v Mock 2', reason: 'Not there' }]);
  });

  it('level reads level', () => {
    // Sat 1 without Cara and Eve: everyone counted played 35, the average.
    const lvl = views([
      match(0, {
        minutes: new Map([...minutes(0)].filter(([k]) => k !== id('Cara') && k !== id('Eve'))),
      }),
    ]);
    expect(whyDifference(lvl, id('Ava'))!.headline).toBe('Level with the average this season');
    expect(whyDifference(lvl, id('Ava'))!.sum).toMatch(/difference level$/);
  });
});

describe('match by match (AC11 3)', () => {
  it('each match’s share is the report’s rule: Sat 2 is 40:00, Main keeper out, Finn absent', () => {
    const eve = whyDifference(ada(), id('Eve'))!;
    expect(eve.matches.map((m) => [m.label, minSec(m.minutesMs), minSec(m.shareMs!), signedMinSec(m.diffMs!)])).toEqual(
      [
        ['Sat 1 Oct v Mock 1', '30:00', '33:20', '−3:20'],
        ['Sat 2 Oct v Mock 2', '35:00', '40:00', '−5:00'],
        ['Sat 3 Oct v Mock 3', '35:00', '33:20', '+1:40'],
      ],
    );
  });

  it('a late arrival in the record says so; nothing else is claimed (AC12)', () => {
    const cara = whyDifference(ada(), id('Cara'))!;
    expect(cara.matches.map((m) => m.late)).toEqual([false, false, true]);
    expect(JSON.stringify(cara)).not.toMatch(/injur|unwell|ill\b|planned|correct/i);
  });

  it('left out, another format and not closed are listed under Not counted, with the reason', () => {
    const v = views(
      [match(0), match(1, { counted: false }), match(2, { counted: false, offFormat: 7 })],
      [
        {
          matchId: 'm3' as UUID,
          date: 'Sat 4 Oct',
          opponent: 'Mock 4',
          abandoned: true,
          players: new Set([id('Ava')]),
        },
        {
          matchId: 'm4' as UUID,
          date: 'Sat 5 Oct',
          opponent: 'Mock 5',
          abandoned: false,
          players: new Set([id('Ava')]),
        },
        {
          matchId: 'm5' as UUID,
          date: 'Sat 6 Oct',
          opponent: 'Mock 6',
          abandoned: false,
          players: new Set([id('Ben')]),
        },
      ],
    );
    const ava = whyDifference(v, id('Ava'))!;
    expect(ava.matches.map((m) => m.matchId)).toEqual(['m0']);
    expect(ava.notCounted.map((n) => n.reason)).toEqual([
      'Left out of the figures',
      '7-a-side, not in fairness',
      'Abandoned',
      'Not ended with End match',
    ]);
  });
});

describe('no figure, and why (AC12)', () => {
  it('the Main keeper', () => {
    const gus = whyDifference(ada(), id('Gus'))!;
    expect(gus.headline).toBe('Main keeper, not in the squad average, so never shown as under or over.');
    expect(gus.sum).toBeNull();
    expect(gus.matches.every((m) => m.diffMs === null && m.notInShare === 'main-keeper')).toBe(true);
  });

  it('a fill-in', () => {
    const v = views([match(0)], [], ['Ben']);
    const ben = whyDifference(v, id('Ben'))!;
    expect(ben.headline).toBe('Fill-in, not counted in fairness, so never shown as under or over.');
    // In the share on the day (#190, ruling 1b).
    expect(ben.matches[0].diffMs).not.toBeNull();
  });

  it('no counted match yet', () => {
    const v = views([match(1)]);
    expect(whyDifference(v, id('Finn'))!.headline).toBe('No counted matches yet this season.');
  });
});
