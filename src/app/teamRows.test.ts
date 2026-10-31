/**
 * What the team switcher reads, and Add a team's checks — #224 AC1, AC5.
 * Made-up names only (invariant 4).
 */

import { describe, expect, it } from 'vitest';

import { FIRST_SEASON_ID, emptyLedger, saveSeason, serialiseLedger } from './ledger';
import { uuid } from '../types/index';
import { MatchEngine } from '../engine/MatchEngine';
import { createMemoryStore, loadSession, saveSession, toMatchState } from './persistence';
import { addTeam, openTeam, openTeams, teamStore, teamSummaries } from './storage/teams';
import { makeSevenASideFormat } from './placeholderSquad';
import { makePlayer } from './squad';
import { sheetFromSelection, toTeamSheet } from './teamSheet';
import { formatForAge, readTeamRow, teamNameProblem } from './teamRows';
import { seasonLine, seasonNameFor } from './seasons';

const NOW = new Date('2026-10-26T12:00:00Z');

describe('a team’s row in the switcher (#224 AC1)', () => {
  it('a team whose squad will not read is named so, never hidden', () => {
    expect(readTeamRow('{damaged', null)).toEqual({ name: null, season: 'This season', live: false });
  });

  it('reads the season line from the team’s own record', () => {
    const l = saveSeason(
      emptyLedger(uuid(), 'Mock FC', NOW),
      { id: FIRST_SEASON_ID, name: '2026–27', mainSide: 7, ageGroup: 'U10', level: 'development' },
      NOW
    );
    if (!l.ok) throw new Error(l.reason);
    expect(readTeamRow(null, serialiseLedger(l.ledger)).season).toBe('2026–27 · U10 development · 7-a-side');
  });
});

describe('Add a team (#224 AC5)', () => {
  it('a name must be given and unique on this phone, capitals aside', () => {
    expect(teamNameProblem(' ', [])).not.toBeNull();
    expect(teamNameProblem('unicorns u10 ', ['Unicorns U10'])).not.toBeNull();
    expect(teamNameProblem('Unicorns U10 Sun', ['Unicorns U10'])).toBeNull();
  });

  it('the first season is named for the football year it starts in', () => {
    expect(seasonNameFor(new Date('2026-10-26T12:00:00Z'))).toBe('2026–27');
    expect(seasonNameFor(new Date('2027-03-01T12:00:00Z'))).toBe('2026–27');
    expect(seasonNameFor(new Date('2027-08-01T12:00:00Z'))).toBe('2027–28');
  });

  it('only what the coach set shows in the season line', () => {
    const base = { id: FIRST_SEASON_ID, startedAt: '', lens: 'full', note: null };
    expect(seasonLine({ ...base, name: null, mainSide: null, ageGroup: null, level: null })).toBe('This season');
    expect(seasonLine({ ...base, name: '2026–27', mainSide: 5, ageGroup: 'U8', level: null })).toBe(
      '2026–27 · U8 · 5-a-side'
    );
  });

  // Replaced for #249 E20 (Rob, 30 Oct, ruling 5a and "U9 fix"): U11 now goes
  // to 9-a-side and U15 to 11; the full table is in nineAndEleven.test.ts.
  it('nudges the format by age, and leaves a choice that already fits', () => {
    expect(formatForAge('U8', '2-3-1')).toBe('2-2');
    expect(formatForAge('U8', '1-2-1')).toBe('1-2-1');
    expect(formatForAge('U11', '2-2')).toBe('3-3-2');
    expect(formatForAge('U15', '2-2')).toBe('4-4-2');
  });
});

describe('a match left running in one team (#224 T3, AC1; ADR-022 D3 consequence)', () => {
  it('is intact when the team is reopened, and the team list says "Match on"', async () => {
    const root = createMemoryStore();
    const squadId = uuid();
    const kids = ['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gil'].map((n) => makePlayer(squadId, n));
    const format = makeSevenASideFormat();
    let nowMs = Date.parse('2026-10-31T10:00:00Z');
    const engine = new MatchEngine({ nowFn: () => new Date(nowMs) });
    const state = engine.createMatch(squadId, format.id, { totalMinutes: 50, quarterCount: 4 });
    for (const k of kids) engine.setAvailability(state, k.id, 'available');
    engine.startQuarter(
      state,
      state.quarters[0],
      toTeamSheet(
        sheetFromSelection(
          kids.map((k) => k.id),
          kids[0].id,
          format
        )
      ),
      format
    );
    nowMs += 4 * 60_000;
    const T1 = uuid();
    const T2 = uuid();
    await addTeam(root, T1, NOW);
    await saveSession(teamStore(root, T1), {
      squadName: 'Unicorns',
      squadId,
      players: kids,
      format,
      totalMinutes: 50,
      periodCount: 4,
      plan: {},
      state,
      now: new Date(nowMs),
    });
    // The coach opens another team mid-period, then comes back.
    await addTeam(root, T2, NOW);
    await openTeam(root, T1);
    const opened = await openTeams(root, NOW, () => uuid());
    expect(opened).toMatchObject({ kind: 'team', teamId: T1 });
    if (opened.kind !== 'team') return;

    const list = await teamSummaries(root, opened.index, readTeamRow);
    expect(list.map((t) => t.live)).toEqual([true, false]);
    expect(list[0].name).toBe('Unicorns');

    const saved = await loadSession(teamStore(root, T1));
    const back = saved ? toMatchState(saved) : null;
    if (!back) throw new Error('the match did not come back');
    // Invariant 2: elapsed comes from the anchors, so ten minutes away reads as ten minutes more.
    nowMs += 10 * 60_000;
    const again = new MatchEngine({ nowFn: () => new Date(nowMs) });
    expect(again.getMatchElapsedMs(back)).toBe(14 * 60_000);
  });
});
