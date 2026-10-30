/**
 * 9- and 11-a-side — #249 (Rob, 30 Oct: "approve 249, 1 2 3 4 5 6"), on
 * Bea's criteria and ADR-023. The pitch geometry is in pitchLayout.test.ts,
 * the refusal of an unknown formation in recordRestore.test.ts, the 1.2.0
 * reader in releasedReader.test.ts and the source checks in fitGuard.test.ts.
 *
 * Made-up first names only (invariant 4).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid, type Format, type UUID } from '../types/index';
import { emptySquadSentence, startSteps } from './gettingStarted';
import {
  FIRST_SEASON_ID,
  MAIN_SIDES,
  emptyLedger,
  foldLedger,
  parseLedger,
  recordMatches,
  saveSeason,
  serialiseLedger,
  type Ledger,
} from './ledger';
import { setupFrom } from './ledgerSetup';
import { lineupIsComplete, suggestLineup } from './lineup';
import { TOTAL_MINUTES_CHOICES, formatClock } from './matchClock';
import { newMatch } from './matchLifecycle';
import { emptyPlan, periodLengthMs, setSlot, type MatchPlan } from './matchPlan';
import { parsePeriodLengths } from './matchRecord';
import { PLAN_IMAGE_WIDTH, planImage, planPitchSize, planSlotBox, planSlotWidth, type PlanImageLayout } from './planImage';
import { restoreFromRecord } from './recordRestore';
import { describeDefaults } from './settings';
import {
  DEFAULT_SHAPE,
  SHAPES,
  SHAPE_CODES,
  defaultShapeFor,
  makeFormat,
  shapeCue,
  shapeOfFormat,
  sideOfShape,
  type ShapeCode,
} from './shapes';
import {
  MINUTES_ITEMS,
  OTHER_SIZES_NOTE,
  minutesValue,
  opensExpanded,
  shapeCostLine,
  shapeGroups,
} from './shapeList';
import { makePlayer, squadReadiness } from './squad';
import {
  TEAM_FORMATS,
  formatForAge,
  newSeasonShape,
  seasonStartShape,
  sideForAge,
  startingDefaults,
  startingHint,
} from './teamRows';
import { TEST_NAMES, TEST_OPPONENTS, addTestData, testNamesFor } from './testKit';

const MIN = 60_000;
const NOW = new Date('2026-10-30T09:00:00Z');

const units = (code: ShapeCode) => {
  const count = (u: string) => SHAPES.find((s) => s.code === code)!.slots.filter((s) => s.unit === u).length;
  return `${count('GK')}/${count('DEF')}/${count('MID')}/${count('ATT')}`;
};

// ---------------------------------------------------------------------------
// A. Shapes (ADR-023 D1, D2)
// ---------------------------------------------------------------------------

describe('A. the shapes (#249 A1–A5)', () => {
  it('adds 3-3-2 and 3-2-3 at nine and 4-4-2 and 4-3-3 at eleven, slots back to front as criterion A1 lists them', () => {
    const slots = (code: ShapeCode) =>
      SHAPES.find((s) => s.code === code)!.slots.map((s) => `${s.label}/${s.unit}/${s.roleCode}`).join(' ');
    expect(slots('3-3-2')).toBe('GK/GK/GK LB/DEF/LB CB/DEF/CB RB/DEF/RB LM/MID/LM CM/MID/CM RM/MID/RM LF/ATT/ST RF/ATT/ST');
    expect(slots('3-2-3')).toBe('GK/GK/GK LB/DEF/LB CB/DEF/CB RB/DEF/RB LM/MID/LM RM/MID/RM LW/ATT/LW ST/ATT/ST RW/ATT/RW');
    expect(slots('4-4-2')).toBe(
      'GK/GK/GK LB/DEF/LB CB/DEF/CB CB/DEF/CB RB/DEF/RB LM/MID/LM CM/MID/CM CM/MID/CM RM/MID/RM LF/ATT/ST RF/ATT/ST'
    );
    expect(slots('4-3-3')).toBe(
      'GK/GK/GK LB/DEF/LB CB/DEF/CB CB/DEF/CB RB/DEF/RB CM/MID/CM CM/MID/CM CM/MID/CM LW/ATT/LW ST/ATT/ST RW/ATT/RW'
    );
    const spec = (c: ShapeCode) => SHAPES.find((s) => s.code === c)!;
    expect(spec('3-3-2')).toMatchObject({ formatName: '9-a-side', description: '9-a-side · 3 defence · 3 midfield · 2 attack' });
    expect(spec('3-2-3')).toMatchObject({ formatName: '9-a-side', description: '9-a-side · 3 defence · 2 midfield · 3 attack' });
    expect(spec('4-4-2')).toMatchObject({ formatName: '11-a-side', description: '11-a-side · 4 defence · 4 midfield · 2 attack' });
    expect(spec('4-3-3')).toMatchObject({ formatName: '11-a-side', description: '11-a-side · 4 defence · 3 midfield · 3 attack' });
    // Ruling 1a: the 4-3-3 wingers are attack.
    expect(units('4-3-3')).toBe('1/4/3/3');
  });

  it('A2: one table of default shapes: 5 → 2-2, 7 → 2-3-1, 9 → 3-3-2, 11 → 4-4-2', () => {
    expect([5, 7, 9, 11].map((n) => defaultShapeFor(n))).toEqual(['2-2', '2-3-1', '3-3-2', '4-4-2']);
    expect(defaultShapeFor(8)).toBeNull();
  });

  it('A3: codes unique; no two shapes of one size share unit counts (D2); every shape reads back as itself', () => {
    expect(new Set(SHAPE_CODES).size).toBe(SHAPE_CODES.length);
    for (const a of SHAPES) {
      for (const b of SHAPES) {
        if (a.code === b.code || a.slots.length !== b.slots.length) continue;
        expect(units(a.code), `${a.code} vs ${b.code}`).not.toBe(units(b.code));
      }
    }
    expect(SHAPE_CODES).toHaveLength(8);
    for (const code of SHAPE_CODES) expect(shapeOfFormat(makeFormat(code))).toBe(code);
  });

  it('A4: DEFAULT_SHAPE stays 2-3-1, and the four 2.1.0 shapes are pinned exactly as released', () => {
    expect(DEFAULT_SHAPE).toBe('2-3-1');
    const pinned = SHAPES.slice(0, 4).map((s) => [s.code, s.formatName, s.label, s.slots.map((x) => `${x.label}/${x.unit}/${x.roleCode}`).join(' ')]);
    expect(pinned).toEqual([
      ['2-3-1', '7-a-side', '2-3-1', 'GK/GK/GK LB/DEF/LB RB/DEF/RB CM/MID/CM LW/MID/LW RW/MID/RW ST/ATT/ST'],
      ['2-2-2', '7-a-side', '2-2-2', 'GK/GK/GK LB/DEF/LB RB/DEF/RB LM/MID/LM RM/MID/RM LF/ATT/ST RF/ATT/ST'],
      ['1-2-1', '5-a-side', '1-2-1', 'GK/GK/GK D/DEF/CB LM/MID/LM RM/MID/RM F/ATT/ST'],
      ['2-2', '5-a-side', '2-2', 'GK/GK/GK LB/DEF/LB RB/DEF/RB LF/ATT/ST RF/ATT/ST'],
    ]);
  });

  it('A5: no 3-5-2, no 4-2-3-1, no sport field', () => {
    expect(SHAPE_CODES).not.toContain('3-5-2');
    expect(SHAPE_CODES).not.toContain('4-2-3-1');
    for (const s of SHAPES) expect(Object.keys(s)).not.toContain('sport');
  });
});

// ---------------------------------------------------------------------------
// B. Lists worked out from SHAPES
// ---------------------------------------------------------------------------

describe('B. lists worked out from SHAPES (#249 B6–B9)', () => {
  it('B6: TEAM_FORMATS is every shape, in size order, SHAPES order within a size, 2-2-2 included', () => {
    expect(TEAM_FORMATS.map((f) => f.shape)).toEqual(['1-2-1', '2-2', '2-3-1', '2-2-2', '3-3-2', '3-2-3', '4-4-2', '4-3-3']);
    expect(TEAM_FORMATS.map((f) => `${f.label} · ${f.detail}`)).toContain('9-a-side · 3-3-2');
    for (const f of TEAM_FORMATS) expect(f.side).toBe(sideOfShape(f.shape));
  });

  it('B7: MAIN_SIDES is 5, 7, 9, 11; a season takes 9 and 11 and refuses 6 and 8 naming all four', () => {
    expect([...MAIN_SIDES]).toEqual([5, 7, 9, 11]);
    const l = emptyLedger(uuid(), 'Mock FC', NOW);
    const base = { id: FIRST_SEASON_ID, name: 'S', ageGroup: 'U12', level: 'development' as const };
    expect(saveSeason(l, { ...base, mainSide: 9 }, NOW).ok).toBe(true);
    expect(saveSeason(l, { ...base, mainSide: 11 }, NOW).ok).toBe(true);
    for (const bad of [6, 8]) {
      const r = saveSeason(l, { ...base, mainSide: bad }, NOW);
      expect(r).toEqual({ ok: false, reason: 'The main format is 5-, 7-, 9- or 11-a-side.' });
    }
  });

  it('B9: Start a new season names its fallback: a 9-a-side season with no 9-a-side default offers 3-3-2', () => {
    expect(seasonStartShape('2-3-1', 9)).toBe('3-3-2');
    expect(seasonStartShape(null, 9)).toBe('3-3-2');
    expect(seasonStartShape('3-2-3', 9)).toBe('3-2-3');
    expect(seasonStartShape('4-3-3', null)).toBe('4-3-3');
    expect(seasonStartShape(null, null)).toBe(DEFAULT_SHAPE);
    expect(seasonStartShape('2-3-1', 11)).toBe('4-4-2');
  });
});

// ---------------------------------------------------------------------------
// C. Match lengths and the Minutes list sheet
// ---------------------------------------------------------------------------

describe('C. 70 and 80 minutes (#249 C10–C12)', () => {
  it('C10: the lengths are 40, 50, 60, 70, 75, 80 and 90', () => {
    expect([...TOTAL_MINUTES_CHOICES]).toEqual([40, 50, 60, 70, 75, 80, 90]);
  });

  it('C11: the Minutes sheet lists all seven ascending; the row reads "70 min"', () => {
    expect(MINUTES_ITEMS.map((i) => i.value)).toEqual([40, 50, 60, 70, 75, 80, 90]);
    expect(MINUTES_ITEMS[3].label).toBe('70 min');
    expect(minutesValue(70)).toBe('70 min');
  });

  it('C12: the periods are exact, never rounded', () => {
    expect(describeDefaults(70, 2)).toBe('2 × 35:00 halves');
    expect(describeDefaults(70, 4)).toBe('4 × 17:30 quarters');
    expect(describeDefaults(80, 2)).toBe('2 × 40:00 halves');
    expect(describeDefaults(80, 4)).toBe('4 × 20:00 quarters');
    // matchRecord still refuses a length over 90.
    expect(parsePeriodLengths('91')).toBeNull();
    expect(parsePeriodLengths('35 35')).toEqual([35 * MIN, 35 * MIN]);
  });

  it('C12: the clock ends a 70-minute quarter at 17:30, from wall-clock anchors (invariant 2)', () => {
    const now = Date.parse('2026-10-31T09:00:00Z');
    const engine = new MatchEngine({ nowFn: () => new Date(now) });
    const format = makeFormat('4-4-2');
    const state = engine.createMatch(uuid() as UUID, format.id, {
      opponent: 'Sample Rovers',
      kickoffAt: new Date(now).toISOString(),
      competition: 'league',
      totalMinutes: 70,
      quarterCount: 4,
      availablePlayerIds: [],
    });
    expect(formatClock(engine.getPlannedQuarterMs(state.match))).toBe('17:30');
    expect(periodLengthMs(70, 4)).toBe(17.5 * MIN);
  });
});

// ---------------------------------------------------------------------------
// D. A new team's starting settings (ruling 4a)
// ---------------------------------------------------------------------------

describe('D. a new team starts at its format’s length (#249 D14–D18, D22)', () => {
  it('9 → 60 min in halves, 11 → 70 min in halves, 5 and 7 → today’s', () => {
    expect(startingDefaults(9)).toEqual({ totalMinutes: 60, periodCount: 2 });
    expect(startingDefaults(11)).toEqual({ totalMinutes: 70, periodCount: 2 });
    expect(startingDefaults(5)).toBeNull();
    expect(startingDefaults(7)).toBeNull();
  });

  it('D18: the hint under Main format says it, and changes with the format', () => {
    expect(startingHint(9)).toBe('Matches start at 60 min in halves. Change it in Settings › Match defaults.');
    expect(startingHint(11)).toBe('Matches start at 70 min in halves. Change it in Settings › Match defaults.');
    expect(startingHint(7)).toBeNull();
  });

  it('D22: a format reached through the age nudge brings its length, because the length follows the format', () => {
    expect(startingDefaults(sideOfShape(formatForAge('U12', '2-3-1')))).toEqual({ totalMinutes: 60, periodCount: 2 });
    expect(startingDefaults(sideOfShape(formatForAge('U13', '2-3-1')))).toEqual({ totalMinutes: 70, periodCount: 2 });
  });
});

// ---------------------------------------------------------------------------
// E. The age nudge
// ---------------------------------------------------------------------------

describe('E. the age nudge (#249 E20, ruling 5a and "U9 fix")', () => {
  it('U7–U8 → 5, U9–U10 → 7, U11–U12 → 9, U13–U18 → 11, from a starting shape of every size', () => {
    const want = (n: number) => (n <= 8 ? 5 : n <= 10 ? 7 : n <= 12 ? 9 : 11);
    for (let n = 7; n <= 18; n++) {
      const age = `U${n}`;
      expect(sideForAge(age)).toBe(want(n));
      for (const start of SHAPE_CODES) {
        const got = formatForAge(age, start);
        expect(sideOfShape(got), `${age} from ${start}`).toBe(want(n));
        // Already the nudged size: kept. Otherwise that size's default.
        expect(got, `${age} from ${start}`).toBe(sideOfShape(start) === want(n) ? start : defaultShapeFor(want(n)));
      }
    }
    expect(formatForAge('U12', '3-2-3')).toBe('3-2-3');
    expect(formatForAge('U10', '2-2-2')).toBe('2-2-2');
  });
});

// ---------------------------------------------------------------------------
// H. The plan picture at 11-a-side
// ---------------------------------------------------------------------------

describe('H. the plan picture at 11-a-side (#249 H33–H35)', () => {
  const squadId = uuid();
  const players = TEST_NAMES.map((n) => makePlayer(squadId, n));

  function elevenImage(code: '4-4-2' | '4-3-3') {
    const format = makeFormat(code);
    const ids = players.map((p) => p.id);
    let plan: MatchPlan = emptyPlan(4);
    for (let q = 0; q < 4; q++) {
      format.positions.forEach((pos, i) => (plan = setSlot(plan, q, pos.id, ids[(i + q) % ids.length])));
    }
    const match = newMatch({ squadId, format, totalMinutes: 70, periodCount: 4, players, opponent: 'Mock Town' }, () => NOW).stored
      .match;
    return planImage({ match, squadName: 'Test FC', format, plan, players });
  }

  it('name boxes are 22 % at 11-a-side; 5, 7 and 9 stay 30 %', () => {
    expect(planSlotWidth(11)).toBe(0.22);
    for (const n of [5, 7, 9]) expect(planSlotWidth(n)).toBe(0.3);
    expect(elevenImage('4-4-2').slotWidth).toBe(0.22);
  });

  it('no two name boxes overlap and every box is on its pitch, in the 2×2 and the four-in-a-row picture', () => {
    for (const layout of ['grid', 'row'] as PlanImageLayout[]) {
      for (const code of SHAPE_CODES) {
        const format = makeFormat(code);
        const image =
          code === '4-4-2' || code === '4-3-3'
            ? elevenImage(code)
            : planImage({
                match: newMatch({ squadId, format, totalMinutes: 50, periodCount: 4, players, opponent: 'Mock Town' }, () => NOW)
                  .stored.match,
                squadName: 'Test FC',
                format,
                plan: undefined,
                players,
              });
        const { colWidth, pitchHeight } = planPitchSize(layout, image.periods.length);
        expect(colWidth).toBeLessThan(PLAN_IMAGE_WIDTH[layout]);
        const boxes = image.periods[0].slots.map((s) => planSlotBox(s, layout, colWidth, pitchHeight, image.slotWidth));
        for (const b of boxes) {
          expect(b.x, `${layout} ${code}`).toBeGreaterThanOrEqual(0);
          expect(b.y, `${layout} ${code}`).toBeGreaterThanOrEqual(0);
          expect(b.x + b.width, `${layout} ${code}`).toBeLessThanOrEqual(colWidth);
          expect(b.y + b.height, `${layout} ${code}`).toBeLessThanOrEqual(pitchHeight);
        }
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const r = boxes[i];
            const s = boxes[j];
            const ox = Math.min(r.x + r.width, s.x + s.width) - Math.max(r.x, s.x);
            const oy = Math.min(r.y + r.height, s.y + s.height) - Math.max(r.y, s.y);
            expect(ox > 0 && oy > 0, `${layout} ${code}: ${i} and ${j}`).toBe(false);
          }
        }
      }
    }
  });

  it('every sub line and the bench are in the picture’s words, with 11 on and the rest on the bench', () => {
    const image = elevenImage('4-4-2');
    for (const p of image.periods) {
      expect(p.slots).toHaveLength(11);
      expect(p.bench).toBe(`Bench: ${players.filter((x) => !p.slots.some((s) => s.name === x.firstName)).map((x) => x.firstName).join(', ')}`);
    }
  });
});

// ---------------------------------------------------------------------------
// I. Shape list B, and its cost line
// ---------------------------------------------------------------------------

describe('I. the Shape list sheet, list B (#249 I36–I41)', () => {
  it('I36, I38: the season’s size first, "· this season", the cue without the size; then the others in size order', () => {
    const { first, others } = shapeGroups({ side: 9, mainSet: true }, '3-3-2');
    expect(first.heading).toBe('9-a-side · this season');
    expect(first.items.map((i) => [i.label, i.detail])).toEqual([
      ['3-3-2 + GK', '3 defence · 3 midfield · 2 attack'],
      ['3-2-3 + GK', '3 defence · 2 midfield · 3 attack'],
    ]);
    expect(others.map((g) => g.heading)).toEqual(['5-a-side', '7-a-side', '11-a-side']);
    expect(shapeCue('2-2')).toBe('2 defence · 2 attack');
  });

  it('I37: opens expanded when the current shape is another size', () => {
    expect(opensExpanded({ side: 9, mainSet: true }, '3-3-2')).toBe(false);
    expect(opensExpanded({ side: 9, mainSet: true }, '4-4-2')).toBe(true);
  });

  it('I39: with no season size, the first heading is the current shape’s size, without "· this season", and no cost line', () => {
    const { first } = shapeGroups({ side: null, mainSet: false }, '4-3-3');
    expect(first.heading).toBe('11-a-side');
    expect(opensExpanded({ side: null, mainSet: false }, '4-3-3')).toBe(false);
    expect(shapeCostLine({ side: null, mainSet: false }, '4-3-3')).toBeNull();
  });

  it('I40: the cost line, in Bea’s words, sizes worked out', () => {
    expect(shapeCostLine({ side: 9, mainSet: true }, '4-4-2')).toBe(
      "This season is 9-a-side. An 11-a-side match is kept, but left out of the season's fairness figures unless you count it."
    );
    expect(shapeCostLine({ side: 9, mainSet: false }, '4-4-2')).toBe(
      "This season has been mostly 9-a-side. An 11-a-side match is kept, but left out of the season's fairness figures unless you count it."
    );
    expect(shapeCostLine({ side: 11, mainSet: true }, '3-3-2')).toBe(
      "This season is 11-a-side. A 9-a-side match is kept, but left out of the season's fairness figures unless you count it."
    );
    expect(shapeCostLine({ side: 9, mainSet: true }, '3-2-3')).toBeNull();
    expect(OTHER_SIZES_NOTE).toBe("A match at another size is kept, but left out of this season's fairness figures unless you count it.");
  });
});

// ---------------------------------------------------------------------------
// K. The test kit and the made-up team
// ---------------------------------------------------------------------------

describe('K. the made-up team fields every size (#249 K47–K49)', () => {
  it('K47: at least 14 one-word made-up names, the first ten as before', () => {
    expect(TEST_NAMES.length).toBeGreaterThanOrEqual(14);
    expect(TEST_NAMES.slice(0, 10)).toEqual(['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo']);
    for (const n of TEST_NAMES) expect(n).toMatch(/^[A-Z][a-z]+$/);
    expect(new Set(TEST_NAMES).size).toBe(TEST_NAMES.length);
  });

  it('K48: for each size the Test kit fields the team with a bench of at least 3, and Test Rovers has a sub due every period', () => {
    for (const code of ['2-2', '2-3-1', '3-3-2', '4-4-2'] as const) {
      const format = makeFormat(code);
      const squadId = uuid();
      const data = addTestData([], [], squadId, format, 50, 4, NOW);
      expect(data.players.length - format.onFieldCount, code).toBeGreaterThanOrEqual(3);
      expect(data.players.length).toBe(testNamesFor(format.onFieldCount).length);
      const rovers = data.matches.find((m) => m.match.opponent === TEST_OPPONENTS[0])!;
      const plan = rovers.plan!;
      for (const period of plan.periods) {
        for (const pos of format.positions) expect(period.slots[pos.id], `${code} ${pos.label}`).toBeTruthy();
        expect(period.subs.length, code).toBeGreaterThanOrEqual(1);
        expect(period.subs[0].onId).not.toBeNull();
        expect(period.subs[0].offId).not.toBeNull();
      }
      const s = suggestLineup(data.players, [], format);
      expect(lineupIsComplete(s.onPitch, format)).toBe(true);
    }
  });

  it('K49: Getting started counts toward 9 and 11, and Play now’s "enough players" uses the same count', () => {
    for (const code of ['3-3-2', '4-4-2'] as const) {
      const n = makeFormat(code).onFieldCount;
      const steps = (activePlayers: number) => startSteps({ activePlayers, onFieldCount: n, matches: [], ledgerMatches: 0 });
      expect(steps(4)[0]).toMatchObject({ detail: `First names · 4 of ${n} added`, done: false });
      expect(steps(n)[0]).toMatchObject({ detail: `${n} players`, done: true });
      const squadId = uuid();
      const kids = (k: number) => TEST_NAMES.slice(0, k).map((x) => makePlayer(squadId, x));
      expect(squadReadiness(kids(n - 1), n)).toMatchObject({ ready: false, shortBy: 1 });
      expect(squadReadiness(kids(n), n)).toMatchObject({ ready: true, shortBy: 0 });
    }
    expect(emptySquadSentence(11)).toContain('Eleven');
    expect(emptySquadSentence(9)).toContain('Nine');
  });
});

// ---------------------------------------------------------------------------
// L52. A 9- and an 11-a-side season round-trip through a minutes file
// ---------------------------------------------------------------------------

describe('L52. a 9- and an 11-a-side season, exported and imported on an empty phone', () => {
  function teamFile(code: '3-3-2' | '4-4-2', side: 9 | 11, totalMinutes: number) {
    const squadId = uuid();
    const format = makeFormat(code);
    const data = addTestData([], [], squadId, format, totalMinutes, 2, NOW);
    const settings = { format, totalMinutes, periodCount: 2, buzzWhenSubDue: true };
    const setup = setupFrom({ players: data.players, matches: data.matches, live: null, ...settings });
    let ledger: Ledger = recordMatches(emptyLedger(squadId, 'Test FC', NOW), data.matches, data.players, 'Test FC', NOW, setup);
    const saved = saveSeason(ledger, { id: FIRST_SEASON_ID, name: 'S1', mainSide: side, ageGroup: 'U12', level: 'development' }, NOW);
    if (!saved.ok) throw new Error(saved.reason);
    ledger = saved.ledger;
    return { data, ledger };
  }

  it('the squad, fixtures, settings, main format and every figure come back the same', () => {
    for (const [code, side, minutes] of [['3-3-2', 9, 60], ['4-4-2', 11, 70]] as const) {
      const { data, ledger } = teamFile(code, side, minutes);
      const file = parseLedger(serialiseLedger(ledger));
      if (!file.ok) throw new Error(file.reason);
      const r = restoreFromRecord(file.ledger, uuid(), makeFormat('2-3-1'), NOW);
      expect(r.players.map((p) => p.firstName)).toEqual(data.players.map((p) => p.firstName));
      expect(r.fixtures.map((f) => f.match.id).sort()).toEqual(data.matches.map((m) => m.match.id).sort());
      for (const f of r.fixtures) expect(shapeOfFormat(f.format as Format)).toBe(code);
      expect(r.settings).toMatchObject({ totalMinutes: minutes, periodCount: 2 });
      expect(shapeOfFormat(r.settings!.format)).toBe(code);
      expect(file.ledger.seasons?.find((s) => s.id === FIRST_SEASON_ID)?.mainSide).toBe(side);
      expect(foldLedger(file.ledger)).toEqual(foldLedger(ledger));
      expect(r.unknownShapes).toEqual({ fixtures: [], settings: null });
    }
  });
});

// ---------------------------------------------------------------------------
// M55. Invariant 3: no fairness figure reads a position, a unit's role or a shape
// ---------------------------------------------------------------------------

describe('M55. fairness stays total time on the pitch', () => {
  it('no roleCode in any fairness or season-figure module', () => {
    const dir = __dirname;
    // ledger.ts writes each interval's role into the record (#196) and is not listed: it measures nothing.
    const fairness = ['fairShare.ts', 'analysis.ts', 'squadViews.ts', 'childSeason.ts', 'playerMinutes.ts', 'outfieldTarget.ts'];
    const present = readdirSync(dir);
    for (const f of fairness) {
      expect(present, f).toContain(f);
      expect(readFileSync(join(dir, f), 'utf-8'), f).not.toMatch(/roleCode/);
    }
  });

  it('the match engine stays pure TypeScript', () => {
    const engineDir = join(__dirname, '..', 'engine');
    for (const f of readdirSync(engineDir).filter((x) => x.endsWith('.ts'))) {
      expect(readFileSync(join(engineDir, f), 'utf-8'), f).not.toMatch(/from ['"](react|expo)/);
    }
  });
});

describe('E23: Start a new season opens on the moved-up age’s format (QA Q1 on #269)', () => {
  it('a U10 7-a-side season opens the new season at U11 with 9-a-side suggested', () => {
    expect(newSeasonShape('2-3-1', 7, 'U10', 'U11')).toBe('3-3-2');
    expect(newSeasonShape('2-3-1', 7, 'U12', 'U13')).toBe('4-4-2');
    // Same age as last season, or none set: no nudge.
    expect(newSeasonShape('2-3-1', 7, 'U18', 'U18')).toBe('2-3-1');
    expect(newSeasonShape('3-3-2', 9, null, 'U10')).toBe('3-3-2');
    // A shape already the new age's size is kept.
    expect(newSeasonShape('3-2-3', 9, 'U11', 'U12')).toBe('3-2-3');
  });
});
