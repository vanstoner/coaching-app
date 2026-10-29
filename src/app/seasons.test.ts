/**
 * Seasons in the record — #243 AC1, AC2, AC4, AC5, AC9, AC11; ADR-022 D5, D6.
 *
 * The healthy case first: a team with no season record is one implicit
 * first season, and every figure is exactly what it was before seasons.
 * Made-up first names only (invariant 4).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { uuid, type UUID } from '../types/index';
import {
  FIRST_SEASON_ID,
  emptyLedger,
  parseLedger,
  recordMatches,
  saveSeason,
  serialiseLedger,
  setFormatCounted,
  startSeason,
  stillToPlay,
  type Ledger,
} from './ledger';
import { verifyChain } from './ledgerChain';
import { fixtureRecord, setupFrom } from './ledgerSetup';
import { newMatch } from './matchLifecycle';
import { createMemoryStore, loadSession } from './persistence';
import { openStoredLedger } from './storage/ledgerStore';
import { teamStore } from './storage/teams';
import { figureDifferences, releaseFigures } from './releaseFigures';
import { inFairness, isOffFormat, seasonSide } from './analysis';
import {
  currentSeason,
  ledgerForSeason,
  nextAgeGroup,
  nextSeasonName,
  newSeasonPromptDue,
  PROMPT_QUIET_MS,
  seasonBegan,
  seasonName,
  seasonOfMatch,
  seasonsOf,
} from './seasons';
import { makeSevenASideFormat } from './placeholderSquad';
import { makePlayer } from './squad';

const NOW = new Date('2026-10-26T12:00:00Z');
const LATER = new Date('2027-08-02T12:00:00Z');
const squadId = uuid();
const kids = ['Ada', 'Bo'].map((n) => makePlayer(squadId, n));
const format = makeSevenASideFormat();

const ok = (r: { ok: true; ledger: Ledger } | { ok: false; reason: string }): Ledger => {
  if (!r.ok) throw new Error(r.reason);
  return r.ledger;
};

/** A fixture made now, in `seasonId` (absent: the first season), recorded through a save. */
function withFixture(ledger: Ledger, kickoffAt: string, seasonId?: UUID) {
  const { stored } = newMatch(
    {
      squadId,
      format,
      players: kids,
      totalMinutes: 50,
      periodCount: 4,
      kickoffAt,
      seasonId,
    },
    () => NOW
  );
  const setup = setupFrom({
    players: kids,
    matches: [{ match: stored.match, format }],
    live: null,
    format,
    totalMinutes: 50,
    periodCount: 4,
    buzzWhenSubDue: true,
  });
  return {
    id: stored.match.id,
    ledger: recordMatches(ledger, [], kids, 'Mock FC', NOW, setup),
    match: stored.match,
  };
}

describe('a team with no season record (#243 AC1, AC9; the healthy case)', () => {
  const ledger = emptyLedger(squadId, 'Mock FC', NOW);

  it('is in one implicit first season, named "This season", with nothing set', () => {
    const s = currentSeason(ledger);
    expect(s.id).toBe(FIRST_SEASON_ID);
    expect(seasonName(s)).toBe('This season');
    expect([s.mainSide, s.ageGroup, s.level]).toEqual([null, null, null]);
    expect(s.lens).toBe('full');
    expect(seasonsOf(ledger)).toHaveLength(1);
  });

  it('writes no season record and no season on a fixture: the record is as before seasons', () => {
    const { ledger: after, match } = withFixture(ledger, '2026-11-07T10:00:00Z');
    expect(after.seasons).toEqual([]);
    expect('season' in fixtureRecord({ match, format })).toBe(false);
  });

  it('every released version’s figures are identical through the first season’s view (#167)', async () => {
    const dir = resolve(__dirname, 'fixtures');
    const versions = Object.keys(JSON.parse(readFileSync(resolve(dir, 'releases.json'), 'utf8')) as object);
    for (const version of versions) {
      const read = (f: string) => readFileSync(resolve(dir, `release-${version}`, f), 'utf8');
      const meta = JSON.parse(read('release.json')) as { now: string; layout?: 'teams'; teamId?: UUID };
      const now = new Date(meta.now);
      const root = createMemoryStore();
      for (const [k, v] of Object.entries(JSON.parse(read('store.json')) as Record<string, string>)) {
        await root.setItem(k, v);
      }
      // From 2.0.0 a release kept its data in a team (ADR-022 D2).
      const store = meta.layout === 'teams' ? teamStore(root, meta.teamId as UUID) : root;
      const session = await loadSession(store);
      const { ledger: stored } = await openStoredLedger(store, now);
      if (!session || !stored) throw new Error(`release ${version} did not open`);
      const first = ledgerForSeason(stored, currentSeason(stored).id);
      expect(first.matches, version).toEqual(stored.matches);
      expect(
        figureDifferences(JSON.parse(read('expected.json')), releaseFigures(session, first, now)),
        version
      ).toEqual([]);
    }
  });
});

describe('starting and confirming seasons (#243 AC2, AC4, AC9)', () => {
  it('confirming the first season writes only what the coach chose', () => {
    const l = ok(
      saveSeason(
        emptyLedger(squadId, 'Mock FC', NOW),
        {
          id: FIRST_SEASON_ID,
          name: '2026–27',
          mainSide: null,
          ageGroup: 'U10',
          level: 'development',
        },
        NOW
      )
    );
    expect(currentSeason(l)).toMatchObject({
      id: FIRST_SEASON_ID,
      name: '2026–27',
      ageGroup: 'U10',
      level: 'development',
      mainSide: null,
      lens: 'full',
    });
  });

  it('a new season is current from when it starts; the first keeps its matches', () => {
    let l = emptyLedger(squadId, 'Mock FC', NOW);
    const before = withFixture(l, '2027-05-01T10:00:00Z');
    l = before.ledger;
    const next = uuid();
    l = ok(
      saveSeason(
        l,
        {
          id: next,
          name: '2027–28',
          mainSide: 7,
          ageGroup: 'U11',
          level: 'development',
        },
        LATER
      )
    );
    expect(currentSeason(l).id).toBe(next);
    expect(seasonOfMatch(l, before.id)).toBe(FIRST_SEASON_ID);
  });

  it('membership is the fixture’s, never the date (AC11)', () => {
    let l = emptyLedger(squadId, 'Mock FC', NOW);
    const next = uuid();
    l = ok(
      saveSeason(
        l,
        {
          id: next,
          name: '2027–28',
          mainSide: 7,
          ageGroup: 'U11',
          level: 'development',
        },
        LATER
      )
    );
    // Made in the new season, though dated before it started.
    const early = withFixture(l, '2026-01-01T10:00:00Z', next);
    expect(seasonOfMatch(early.ledger, early.id)).toBe(next);
  });

  it('a save never changes a fixture’s season once made', () => {
    const next = uuid();
    let l = ok(
      saveSeason(
        emptyLedger(squadId, 'Mock FC', NOW),
        { id: next, name: 'B', mainSide: 7, ageGroup: null, level: null },
        NOW
      )
    );
    const made = withFixture(l, '2027-09-01T10:00:00Z', next);
    l = made.ledger;
    // The same fixture saved again without its season: the record keeps it.
    const { seasonId: _dropped, ...without } = made.match;
    l = recordMatches(
      l,
      [],
      kids,
      'Mock FC',
      NOW,
      setupFrom({
        players: kids,
        matches: [{ match: without, format }],
        live: null,
        format,
        totalMinutes: 50,
        periodCount: 4,
        buzzWhenSubDue: true,
      })
    );
    expect(seasonOfMatch(l, made.id)).toBe(next);
  });

  it('confirming the first season after a new one started does not make the first current again', () => {
    const next = uuid();
    let l = ok(
      saveSeason(
        emptyLedger(squadId, 'Mock FC', NOW),
        { id: next, name: 'B', mainSide: 7, ageGroup: null, level: null },
        NOW
      )
    );
    l = ok(
      saveSeason(
        l,
        {
          id: FIRST_SEASON_ID,
          name: 'A',
          mainSide: null,
          ageGroup: 'U10',
          level: 'development',
        },
        LATER
      )
    );
    expect(currentSeason(l).id).toBe(next);
    expect(seasonsOf(l).map((s) => s.id)).toEqual([FIRST_SEASON_ID, next]);
  });

  it('a season keeps when it started when its settings change later', () => {
    const id = uuid();
    let l = ok(
      saveSeason(
        emptyLedger(squadId, 'Mock FC', NOW),
        { id, name: 'B', mainSide: null, ageGroup: null, level: null },
        NOW
      )
    );
    l = ok(saveSeason(l, { id, name: 'B', mainSide: 7, ageGroup: null, level: null }, LATER));
    expect(currentSeason(l)).toMatchObject({
      startedAt: NOW.toISOString(),
      mainSide: 7,
    });
  });

  it('refuses a name over 16 characters, an age group outside U7–U18, a format 2.0.0 does not offer', () => {
    const l = emptyLedger(squadId, 'Mock FC', NOW);
    const base = {
      id: uuid(),
      name: 'B',
      mainSide: 7,
      ageGroup: 'U10',
      level: 'development' as const,
    };
    expect(saveSeason(l, { ...base, name: 'Seventeen chars!!' }, NOW).ok).toBe(false);
    expect(saveSeason(l, { ...base, ageGroup: 'U6' }, NOW).ok).toBe(false);
    expect(saveSeason(l, { ...base, mainSide: 9 }, NOW).ok).toBe(false);
    expect(saveSeason(l, { ...base, name: '2026–27' }, NOW).ok).toBe(true);
  });

  it('seasons live in the record: they survive export and import, and the chain verifies (AC11)', () => {
    const l = ok(
      saveSeason(
        emptyLedger(squadId, 'Mock FC', NOW),
        {
          id: FIRST_SEASON_ID,
          name: '2026–27',
          mainSide: 7,
          ageGroup: 'U10',
          level: 'development',
        },
        NOW
      )
    );
    const back = parseLedger(serialiseLedger(l));
    if (!back.ok) throw new Error('did not parse');
    expect(back.ledger.seasons).toEqual(l.seasons);
    expect(verifyChain(back.ledger.entries)).toEqual({ ok: true });
  });
});

describe('season figures (#243 AC2, AC5; ADR-022 D6)', () => {
  it('a season’s view holds only its matches', () => {
    let l = emptyLedger(squadId, 'Mock FC', NOW);
    const a = withFixture(l, '2027-05-01T10:00:00Z');
    l = a.ledger;
    const next = uuid();
    l = ok(saveSeason(l, { id: next, name: 'B', mainSide: 7, ageGroup: null, level: null }, LATER));
    const b = withFixture(l, '2027-09-01T10:00:00Z', next);
    l = b.ledger;
    expect(ledgerForSeason(l, FIRST_SEASON_ID).fixtures.map((f) => f.id)).toEqual([a.id]);
    expect(ledgerForSeason(l, next).fixtures.map((f) => f.id)).toEqual([b.id]);
  });

  it('a season’s main format is its side once set; until then the dominating side, as before', () => {
    const l = emptyLedger(squadId, 'Mock FC', NOW);
    expect(seasonSide(ledgerForSeason(l, FIRST_SEASON_ID))).toBeNull();
    const set = ok(
      saveSeason(
        l,
        {
          id: FIRST_SEASON_ID,
          name: null,
          mainSide: 5,
          ageGroup: null,
          level: null,
        },
        NOW
      )
    );
    expect(seasonSide(ledgerForSeason(set, FIRST_SEASON_ID))).toBe(5);
    // The ledger itself, not a season's view, still uses the dominating side.
    expect(seasonSide(set)).toBeNull();
  });
});

describe('the next season’s defaults (#243 AC4, Q1, Q4)', () => {
  it('moves the name and the age group on a year', () => {
    expect(nextSeasonName('2026–27')).toBe('2027–28');
    expect(nextSeasonName('2026/27')).toBe('2027/28');
    expect(nextSeasonName('2099-00')).toBe('2100-01');
    expect(nextSeasonName('2027')).toBe('2028');
    expect(nextSeasonName('Spring')).toBe('Spring');
    expect(nextAgeGroup('U10')).toBe('U11');
    expect(nextAgeGroup('U18')).toBe('U18');
    expect(nextAgeGroup(null)).toBeNull();
  });
});

describe('an older build reads a record with seasons (ADR-021 D1, additive only)', () => {
  it('the released 1.2.0 reader parses it, and carries the season record untouched', async () => {
    const released = await import('./fixtures/reader-1.2.0/ledger');
    const l = ok(
      saveSeason(
        emptyLedger(squadId, 'Mock FC', NOW),
        {
          id: FIRST_SEASON_ID,
          name: '2026–27',
          mainSide: 7,
          ageGroup: 'U10',
          level: 'development',
        },
        NOW
      )
    );
    const text = serialiseLedger(l);
    const read = released.parseLedger(text);
    expect(read.ok).toBe(true);
    if (read.ok) expect(JSON.stringify(read.ledger.entries)).toContain('"type":"season"');
  });
});

describe('counting an off-format match (#243 AC8; Rob’s ruling 8A)', () => {
  const sevens = { onField: 7, periodCount: 4, periodMs: [1], shape: null, note: null };
  const fives = { ...sevens, onField: 5 };
  const match = { status: 'completed' as const, structure: fives };

  it('a 5-a-side week in a 7-a-side season is left out of fairness by default', () => {
    expect(isOffFormat(match, 7)).toBe(true);
    expect(isOffFormat({ ...match, structure: sevens }, 7)).toBe(false);
  });

  it('counted with a note, it is in; left out again, it is out', () => {
    expect(isOffFormat({ ...match, formatCount: { counted: true, note: 'League said it counts' } }, 7)).toBe(false);
    expect(isOffFormat({ ...match, formatCount: { counted: false, note: 'Changed our mind' } }, 7)).toBe(true);
  });

  it('the coach’s own “leave this match out” still wins (ADR-020)', () => {
    const left = { ...match, excluded: { excluded: true, note: 'ad hoc' }, formatCount: { counted: true, note: 'x' } };
    expect(inFairness(left, 7)).toBe(false);
  });

  it('needs a note, never repeats itself, and is a record of its own in the chain', async () => {
    const dir = resolve(__dirname, 'fixtures', 'release-1.3.1');
    const store = createMemoryStore();
    for (const [k, v] of Object.entries(
      JSON.parse(readFileSync(resolve(dir, 'store.json'), 'utf8')) as Record<string, string>
    )) {
      await store.setItem(k, v);
    }
    const { ledger } = await openStoredLedger(store, NOW);
    if (!ledger) throw new Error('fixture did not open');
    const id = ledger.matches[0].id;
    expect(setFormatCounted(ledger, id, true, '  ', NOW).ok).toBe(false);
    expect(setFormatCounted(ledger, id, false, 'x', NOW).ok).toBe(false);
    const counted = ok(setFormatCounted(ledger, id, true, 'Counts for the league', NOW));
    expect(counted.matches.find((m) => m.id === id)?.formatCount).toEqual({
      counted: true,
      note: 'Counts for the league',
    });
    expect(counted.matches.find((m) => m.id === id)?.excluded).toEqual(
      ledger.matches.find((m) => m.id === id)?.excluded
    );
    const back = ok(setFormatCounted(counted, id, false, 'Not after all', NOW));
    expect(back.matches.find((m) => m.id === id)?.formatCount?.counted).toBe(false);
    expect(verifyChain(back.entries)).toEqual({ ok: true });
  });
});

describe('the August prompt (#243 AC4, Q2, Q3)', () => {
  const sep2026 = Date.parse('2026-09-01T10:00:00Z');
  it('is due from 1 August once the season is about a year old', () => {
    expect(newSeasonPromptDue(sep2026, new Date('2027-07-31T10:00:00Z'), null)).toBe(false);
    expect(newSeasonPromptDue(sep2026, new Date('2027-08-03T10:00:00Z'), null)).toBe(true);
    expect(newSeasonPromptDue(sep2026, new Date('2028-01-10T10:00:00Z'), null)).toBe(true);
  });
  it('a season begun in October is due the next August, at ten months', () => {
    expect(newSeasonPromptDue(Date.parse('2026-10-05T10:00:00Z'), new Date('2027-08-06T10:00:00Z'), null)).toBe(true);
  });
  it('is never due in the season’s first months, even in August', () => {
    expect(newSeasonPromptDue(Date.parse('2027-07-20T10:00:00Z'), new Date('2027-08-03T10:00:00Z'), null)).toBe(false);
  });
  it('"Not yet" quiets it for a week', () => {
    const now = new Date('2027-08-03T10:00:00Z');
    expect(newSeasonPromptDue(sep2026, now, now.getTime() + PROMPT_QUIET_MS)).toBe(false);
    expect(
      newSeasonPromptDue(sep2026, new Date(now.getTime() + PROMPT_QUIET_MS), now.getTime() + PROMPT_QUIET_MS)
    ).toBe(true);
  });
  it('a first season with no record begins at its earliest match; with none, never due', () => {
    const first = currentSeason({ seasons: [] });
    expect(seasonBegan(first, { matches: [] })).toBeNull();
    expect(seasonBegan(first, { matches: [{ kickoffAt: '2026-09-05T10:00:00Z' }, { kickoffAt: null }] as never })).toBe(
      Date.parse('2026-09-05T10:00:00Z')
    );
  });
});

it('a confirmed first season still began at its first match, not the day it was confirmed (QA D8)', () => {
  const l = ok(
    saveSeason(
      emptyLedger(squadId, 'Mock FC', NOW),
      { id: FIRST_SEASON_ID, name: '2026–27', mainSide: null, ageGroup: 'U10', level: 'development' },
      new Date('2027-05-01T10:00:00Z')
    )
  );
  const view = { matches: [{ kickoffAt: '2026-09-05T10:00:00Z' }] as never };
  expect(seasonBegan(currentSeason(l), view)).toBe(Date.parse('2026-09-05T10:00:00Z'));
});

describe('a fixture counts in the season it is played in (Rob, 27 Oct: "season by play")', () => {
  it('starting a season moves the fixtures still to be played; those played stay; one entry', () => {
    let l = emptyLedger(squadId, 'Mock FC', NOW);
    const played = withFixture(l, '2027-07-01T10:00:00Z');
    l = played.ledger;
    const upcoming = withFixture(l, '2027-09-04T10:00:00Z');
    l = upcoming.ledger;
    const entries = l.entries.length;
    const next = uuid();
    const started = ok(
      startSeason(
        l,
        { id: next, name: '2027–28', mainSide: 7, ageGroup: 'U11', level: 'development' },
        [upcoming.id],
        LATER
      )
    );
    expect(started.entries.length).toBe(entries + 1);
    expect(currentSeason(started).id).toBe(next);
    expect(seasonOfMatch(started, upcoming.id)).toBe(next);
    expect(seasonOfMatch(started, played.id)).toBe(FIRST_SEASON_ID);
    expect(verifyChain(started.entries)).toEqual({ ok: true });
  });

  it('a later save keeps the move, even from a copy that never heard of it', () => {
    let l = emptyLedger(squadId, 'Mock FC', NOW);
    const upcoming = withFixture(l, '2027-09-04T10:00:00Z');
    l = upcoming.ledger;
    const next = uuid();
    l = ok(startSeason(l, { id: next, name: 'B', mainSide: 7, ageGroup: null, level: null }, [upcoming.id], LATER));
    l = recordMatches(
      l,
      [],
      kids,
      'Mock FC',
      NOW,
      setupFrom({
        players: kids,
        matches: [{ match: upcoming.match, format }],
        live: null,
        format,
        totalMinutes: 50,
        periodCount: 4,
        buzzWhenSubDue: true,
      })
    );
    expect(seasonOfMatch(l, upcoming.id)).toBe(next);
  });

  it('a played match is never moved, whatever the phone’s copy says (QA D1)', () => {
    let l = emptyLedger(squadId, 'Mock FC', NOW);
    const played = withFixture(l, '2027-07-01T10:00:00Z');
    l = played.ledger;
    const upcoming = withFixture(l, '2027-09-04T10:00:00Z');
    l = upcoming.ledger;
    // Full time is in the record; the phone's copy may still read it as planned.
    l = recordMatches(
      l,
      [
        {
          match: { ...played.match, status: 'completed' },
          quarters: [{ id: uuid(), index: 1, status: 'completed', accumulatedMs: 0 }],
          appearances: [],
        },
      ],
      kids,
      'Mock FC',
      NOW
    );
    expect(stillToPlay(l, [played.id, upcoming.id])).toEqual([upcoming.id]);
    // What the engine writes mid-match: in progress, with play time.
    const underway = { ...l, matches: l.matches.map((m) => ({ ...m, status: 'in_progress' as const })) };
    expect(stillToPlay(underway, [played.id, upcoming.id])).toEqual([upcoming.id]);
    const timed = { ...l, matches: l.matches.map((m) => ({ ...m, status: 'planned' as const })) };
    const withPlay = { ...timed, matches: timed.matches.map((m) => ({ ...m, intervals: [{} as never] })) };
    expect(stillToPlay(timed, [played.id])).toEqual([played.id]);
    expect(stillToPlay(withPlay, [played.id])).toEqual([]);
    const next = uuid();
    const started = ok(
      startSeason(l, { id: next, name: 'B', mainSide: 7, ageGroup: null, level: null }, [played.id, upcoming.id], LATER)
    );
    expect(seasonOfMatch(started, played.id)).toBe(FIRST_SEASON_ID);
    expect(seasonOfMatch(started, upcoming.id)).toBe(next);
  });
});
