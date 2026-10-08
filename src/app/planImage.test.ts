/**
 * Tests for the plan image — #165.
 *
 * The healthy case first: a planned four-quarter match comes out as the
 * image Rob approved, word for word. Then the edges his rulings named.
 */

import { describe, expect, it } from 'vitest';
import { uuid } from '../types/index';
import type { Format, Match, Player, UUID } from '../types/index';
import { makePlayer } from './squad';
import { makeFormat } from './shapes';
import { renamePosition } from './positionNames';
import type { MatchPlan } from './matchPlan';
import {
  PLAN_IMAGE_FOOTER,
  PLAN_IMAGE_WIDTH,
  kickoffLine,
  lengthLine,
  minutesLabel,
  planImage,
  subLine,
} from './planImage';

const MIN = 60_000;
const NAMES = ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo'];

function match(over: Partial<Match> = {}): Match {
  return {
    id: uuid(),
    squadId: uuid(),
    formatId: uuid(),
    opponent: 'Sample Town',
    competition: 'league',
    // Local time, so the test reads the same in any time zone.
    kickoffAt: new Date(2026, 9, 10, 10, 0).toISOString(),
    totalMinutes: 50,
    quarterCount: 4,
    status: 'planned',
    createdAt: new Date(2026, 9, 1).toISOString(),
    ...over,
  };
}

function setup(periodCount = 4) {
  const format = makeFormat('2-3-1');
  const squadId = uuid();
  const players = NAMES.map((n) => makePlayer(squadId, n));
  const id = (name: string) => players.find((p) => p.firstName === name)!.id;
  const at = (label: string, f: Format = format) => f.positions.find((p) => p.label === label)!.id;
  const lineup = (names: Record<string, string>) => {
    const slots: Record<UUID, UUID | null> = {};
    for (const [label, who] of Object.entries(names)) slots[at(label)] = id(who);
    return slots;
  };
  const q1 = lineup({ ST: 'Gus', LW: 'Eli', CM: 'Dee', RW: 'Fay', LB: 'Ben', RB: 'Cal', GK: 'Ava' });
  const plan: MatchPlan = {
    periods: Array.from({ length: periodCount }, (_, i) => ({
      slots: { ...q1 },
      subs:
        i === 0
          ? [{ onId: id('Hal'), offId: id('Eli'), atMs: 6 * MIN + 15_000 }]
          : i === 1
            ? [
                // Added out of time order: the image lists them as they happen.
                { onId: id('Ivy'), offId: id('Ben'), atMs: 8 * MIN },
                { onId: id('Jo'), offId: id('Dee'), atMs: 4 * MIN },
              ]
            : [],
    })),
  };
  return { format, players, id, at, plan };
}

const ALL_FIGURES = /\d{1,2}:\d{2}|\bmins?\b|minutes|fair share|±|GK \d/i;

describe('the plan image (#165): healthy case', () => {
  it('shows the match as Rob approved it', () => {
    const { format, players, plan } = setup();
    const img = planImage({ match: match(), squadName: 'Heart FC', format, plan, players });

    expect(img.title).toBe('Heart FC v Sample Town');
    expect(img.details).toBe('Saturday 10 October · kick-off 10:00 · 4 quarters of 12½ min');
    expect(img.footer).toBe('The plan, not a promise: it can change on the day.');
    expect(img.periods.map((p) => p.title)).toEqual(['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4']);

    const q1 = img.periods[0];
    expect(q1.slots).toHaveLength(7);
    const slot = (label: string) => q1.slots.find((s) => s.label === label)!;
    expect(slot('ST').firstName).toBe('Gus');
    expect(slot('GK').firstName).toBe('Ava');
    expect(slot('GK').keeper).toBe(true);
    expect(slot('ST').keeper).toBe(false);
    expect(q1.subLines).toEqual(['Hal on for Eli – 6m']);
    expect(q1.noSubs).toBeNull();
    expect(q1.bench).toBe('Bench: Hal, Ivy, Jo');
  });

  it('lists subs in the order they happen, minute counted into that period', () => {
    const { format, players, plan } = setup();
    const img = planImage({ match: match(), squadName: 'Heart FC', format, plan, players });
    expect(img.periods[1].subLines).toEqual(['Jo on for Dee – 4m', 'Ivy on for Ben – 8m']);
  });

  it('draws the pitch top to bottom, keeper last, left before right', () => {
    const { format, players, plan } = setup();
    const slots = planImage({ match: match(), squadName: 'H', format, plan, players }).periods[0].slots;
    expect(slots.map((s) => s.label)).toEqual(['ST', 'LW', 'CM', 'RW', 'LB', 'RB', 'GK']);
  });

  it('is 1200 px wide as 2×2 and 1600 px as four in a row', () => {
    expect(PLAN_IMAGE_WIDTH).toEqual({ grid: 1200, row: 1600 });
  });
});

describe('the plan image: halves and quarters', () => {
  it('a halves match has two pitches and says "halves of 25 min"', () => {
    const { format, players, plan } = setup(2);
    const img = planImage({
      match: match({ quarterCount: 2 }),
      squadName: 'Heart FC',
      format,
      plan,
      players,
    });
    expect(img.periods.map((p) => p.title)).toEqual(['Half 1', 'Half 2']);
    expect(img.details).toBe('Saturday 10 October · kick-off 10:00 · 2 halves of 25 min');
  });

  it('a four-quarter plan stored for a halves match is cut to two', () => {
    const { format, players, plan } = setup(4);
    const img = planImage({ match: match({ quarterCount: 2 }), squadName: 'H', format, plan, players });
    expect(img.periods).toHaveLength(2);
  });

  it('a 60-minute match in quarters is "4 quarters of 15 min"', () => {
    expect(lengthLine(60, 4)).toBe('4 quarters of 15 min');
    expect(lengthLine(75, 2)).toBe('2 halves of 37½ min');
    expect(lengthLine(75, 4)).toBe('4 quarters of 18¾ min');
  });

  it('writes half and quarter minutes as fractions', () => {
    expect(minutesLabel(12.5)).toBe('12½');
    expect(minutesLabel(25)).toBe('25');
    expect(minutesLabel(22.5)).toBe('22½');
  });
});

describe('the plan image: a period with no subs', () => {
  it('says so, by the period noun', () => {
    const { format, players, plan } = setup();
    const img = planImage({ match: match(), squadName: 'H', format, plan, players });
    expect(img.periods[2].subLines).toEqual([]);
    expect(img.periods[2].noSubs).toBe('No subs this quarter');

    const halves = setup(2);
    halves.plan.periods[1].subs = [];
    const h = planImage({
      match: match({ quarterCount: 2 }),
      squadName: 'H',
      format: halves.format,
      plan: halves.plan,
      players: halves.players,
    });
    expect(h.periods[1].noSubs).toBe('No subs this half');
  });

  it('leaves out a sub with nobody picked, rather than printing a blank', () => {
    const { format, players, plan, id } = setup();
    plan.periods[2].subs = [{ onId: id('Hal'), offId: null, atMs: 6 * MIN }];
    const img = planImage({ match: match(), squadName: 'H', format, plan, players });
    expect(img.periods[2].subLines).toEqual([]);
    expect(img.periods[2].noSubs).toBe('No subs this quarter');
  });

  it('an unplanned match still draws every period, empty', () => {
    const { format, players } = setup();
    const img = planImage({ match: match(), squadName: 'H', format, plan: undefined, players });
    expect(img.periods).toHaveLength(4);
    expect(img.periods[0].slots.every((s) => s.firstName === null)).toBe(true);
    expect(img.periods[0].bench).toBe(`Bench: ${NAMES.join(', ')}`);
  });
});

describe('the plan image: renamed positions (#166)', () => {
  it('shows the match\'s own names, in the same places', () => {
    const { format, players, plan, at } = setup();
    const renamed = renamePosition(format, at('CM'), 'Holding mid');
    if (!renamed.ok) throw new Error(renamed.reason);
    const before = planImage({ match: match(), squadName: 'H', format, plan, players }).periods[0].slots;
    const after = planImage({ match: match(), squadName: 'H', format: renamed.format, plan, players })
      .periods[0].slots;
    const cm = after.find((s) => s.positionId === at('CM'))!;
    expect(cm.label).toBe('Holding mid');
    expect(cm.firstName).toBe('Dee');
    expect(after.map((s) => s.label)).not.toContain('CM');
    expect(after.map((s) => [s.positionId, s.x, s.y])).toEqual(before.map((s) => [s.positionId, s.x, s.y]));
  });
});

describe('the plan image: the sub line', () => {
  it('reads exactly "X on for Y – Nm", with an en dash', () => {
    expect(subLine('Hal', 'Eli', 6 * MIN)).toBe('Hal on for Eli – 6m');
    expect(subLine('Hal', 'Eli', 6 * MIN)).toMatch(/^\S+ on for \S+ – \d+m$/);
  });

  it('rounds to the nearest whole minute into the period', () => {
    expect(subLine('A', 'B', 6 * MIN + 15_000)).toBe('A on for B – 6m');
    expect(subLine('A', 'B', 6 * MIN + 29_000)).toBe('A on for B – 6m');
    expect(subLine('A', 'B', 6 * MIN + 30_000)).toBe('A on for B – 7m');
    expect(subLine('A', 'B', 12 * MIN + 15_000)).toBe('A on for B – 12m');
  });
});

describe('the plan image: what it never shows', () => {
  it('no minutes figures anywhere', () => {
    const { format, players, plan } = setup();
    const img = planImage({ match: match(), squadName: 'Heart FC', format, plan, players });
    const text = [
      img.title,
      img.footer,
      ...img.periods.flatMap((p) => [p.title, p.bench, p.noSubs ?? '', ...p.subLines]),
      ...img.periods.flatMap((p) => p.slots.map((s) => `${s.label} ${s.firstName ?? ''}`)),
    ].join('\n');
    expect(text).not.toMatch(ALL_FIGURES);
  });

  it('first names only: no suffix, no surname, nothing but the stored first name', () => {
    const { format, players, plan } = setup();
    // A suffix is how the app tells two children apart; it is not a surname,
    // and it is not part of the first name the image shows.
    const withSuffix: Player[] = players.map((p) => (p.firstName === 'Gus' ? { ...p, displaySuffix: 'T' } : p));
    const img = planImage({ match: match(), squadName: 'H', format, plan, players: withSuffix });
    const shown = img.periods.flatMap((p) => p.slots.map((s) => s.firstName).filter((n) => n !== null));
    for (const n of shown) expect(NAMES).toContain(n);
    expect(JSON.stringify(img)).not.toContain('Gus T');
  });

  it('keeps absent children off the bench, and never names them as absent', () => {
    const { format, players, plan, id } = setup();
    const img = planImage({
      match: match(),
      squadName: 'H',
      format,
      plan,
      players,
      absent: new Set([id('Ivy')]),
    });
    expect(img.periods[0].bench).toBe('Bench: Hal, Jo');
    expect(JSON.stringify(img)).not.toMatch(/absent|unavailable|not available/i);
  });

  it('a player no longer in the squad is not named from anywhere else', () => {
    const { format, players, plan, id } = setup();
    const gone = id('Gus');
    const img = planImage({
      match: match(),
      squadName: 'H',
      format,
      plan,
      players: players.filter((p) => p.id !== gone),
    });
    const st = img.periods[0].slots.find((s) => s.label === 'ST')!;
    expect(st.firstName).toBeNull();
    expect(JSON.stringify(img)).not.toContain('Gus');
  });

  it('a child planned in two positions is drawn once', () => {
    const { format, players, plan, id, at } = setup();
    plan.periods[0].slots[at('RW')] = id('Gus');
    const slots = planImage({ match: match(), squadName: 'H', format, plan, players }).periods[0].slots;
    expect(slots.filter((s) => s.firstName === 'Gus')).toHaveLength(1);
  });
});

describe('the header', () => {
  it('says "Date TBC" with no kick-off, and "Opponent TBC" with no opponent', () => {
    const { format, players, plan } = setup();
    const img = planImage({
      match: match({ kickoffAt: null, opponent: null }),
      squadName: 'Heart FC',
      format,
      plan,
      players,
    });
    expect(img.title).toBe('Heart FC v Opponent TBC');
    expect(img.details).toBe('Date TBC · 4 quarters of 12½ min');
  });

  it('formats a kick-off without Intl, zero-padded', () => {
    expect(kickoffLine(new Date(2026, 10, 7, 9, 5).toISOString())).toBe('Saturday 7 November · kick-off 09:05');
    expect(kickoffLine('not a date')).toBe('Date TBC');
  });

  it('the footer is the agreed sentence', () => {
    expect(PLAN_IMAGE_FOOTER).toBe('The plan, not a promise: it can change on the day.');
  });
});
