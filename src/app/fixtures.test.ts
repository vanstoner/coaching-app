import { describe, expect, it } from 'vitest';

import { uuid } from '../types/index';
import type { Competition, Match, MatchStatus, UUID } from '../types/index';
import {
  canDeleteFixture,
  openDestination,
  COMPETITIONS,
  NO_FIXTURES_YET,
  bucketOf,
  competitionLabel,
  fixtureList,
  inBucket,
  kickoffLabel,
  lengthLabel,
  matchIsUnderway,
  opponentLabel,
} from './fixtures';

const NOW = new Date('2026-09-19T09:00:00Z');

function fixture(
  opts: {
    opponent?: string | null;
    kickoffAt?: string | null;
    status?: MatchStatus;
    competition?: Competition | null;
  } = {}
): Match {
  return {
    id: uuid(),
    squadId: uuid(),
    formatId: uuid(),
    // `in` rather than `??`: passing an explicit null is the case under test,
    // and `??` would quietly replace it with the default.
    opponent: 'opponent' in opts ? opts.opponent! : 'Riverside',
    competition: 'competition' in opts ? opts.competition! : 'league',
    kickoffAt: 'kickoffAt' in opts ? opts.kickoffAt! : '2026-09-26T10:00:00Z',
    totalMinutes: 50,
    quarterCount: 4,
    status: opts.status ?? 'planned',
    createdAt: '2026-09-01T00:00:00Z',
  };
}

describe('bucketOf', () => {
  it('puts a match in progress in CURRENT', () => {
    expect(bucketOf(fixture({ status: 'in_progress' }), NOW)).toBe('current');
  });

  it('keeps a match in progress current even when its kick-off was yesterday', () => {
    // The situation this app exists to survive: the coach forgot to end it.
    // Status decides before the clock does.
    const forgotten = fixture({ status: 'in_progress', kickoffAt: '2026-09-12T10:00:00Z' });
    expect(bucketOf(forgotten, NOW)).toBe('current');
  });

  it('puts a completed match in PAST even if its kick-off is in the future', () => {
    // It has been played. No clock reading changes that.
    const odd = fixture({ status: 'completed', kickoffAt: '2026-12-25T10:00:00Z' });
    expect(bucketOf(odd, NOW)).toBe('past');
  });

  it('treats an abandoned match as past', () => {
    expect(bucketOf(fixture({ status: 'abandoned' }), NOW)).toBe('past');
  });

  it('places a planned match by its kick-off', () => {
    expect(bucketOf(fixture({ kickoffAt: '2026-09-26T10:00:00Z' }), NOW)).toBe('future');
    expect(bucketOf(fixture({ kickoffAt: '2026-09-12T10:00:00Z' }), NOW)).toBe('past');
  });

  it('treats a planned match with no date as still to come', () => {
    // A fixture without a date is real but unscheduled. Filing it under "past"
    // would hide work the coach still has to do.
    expect(bucketOf(fixture({ kickoffAt: null }), NOW)).toBe('future');
    expect(bucketOf(fixture({ kickoffAt: 'not a date' }), NOW)).toBe('future');
  });
});

describe('fixtureList', () => {
  it('is empty for a squad with no fixtures', () => {
    expect(fixtureList([], NOW)).toEqual([]);
    expect(NO_FIXTURES_YET).toContain('No fixtures yet');
  });

  it('orders the way a Saturday morning works: now, next, then history', () => {
    const playing = fixture({ status: 'in_progress', opponent: 'Today' });
    const soon = fixture({ kickoffAt: '2026-09-26T10:00:00Z', opponent: 'Next week' });
    const later = fixture({ kickoffAt: '2026-10-10T10:00:00Z', opponent: 'Next month' });
    const lastWeek = fixture({ status: 'completed', kickoffAt: '2026-09-12T10:00:00Z', opponent: 'Last week' });
    const ages = fixture({ status: 'completed', kickoffAt: '2026-08-01T10:00:00Z', opponent: 'August' });

    const rows = fixtureList([ages, later, playing, lastWeek, soon], NOW);
    expect(rows.map((r) => r.match.opponent)).toEqual([
      'Today',       // current
      'Next week',   // future, soonest first
      'Next month',
      'Last week',   // past, most recent first
      'August',
    ]);
  });

  it('sorts future soonest-first and past most-recent-first', () => {
    // Not the same direction, and that is deliberate: looking forward the next
    // thing matters, looking back the last thing does.
    const rows = fixtureList(
      [
        fixture({ kickoffAt: '2026-10-10T10:00:00Z', opponent: 'far' }),
        fixture({ kickoffAt: '2026-09-26T10:00:00Z', opponent: 'near' }),
        fixture({ status: 'completed', kickoffAt: '2026-08-01T10:00:00Z', opponent: 'old' }),
        fixture({ status: 'completed', kickoffAt: '2026-09-12T10:00:00Z', opponent: 'recent' }),
      ],
      NOW
    );
    expect(inBucket(rows, 'future').map((r) => r.match.opponent)).toEqual(['near', 'far']);
    expect(inBucket(rows, 'past').map((r) => r.match.opponent)).toEqual(['recent', 'old']);
  });

  it('puts an undated fixture after dated ones rather than ahead of them', () => {
    const rows = fixtureList(
      [
        fixture({ kickoffAt: null, opponent: 'TBC' }),
        fixture({ kickoffAt: '2026-09-26T10:00:00Z', opponent: 'dated' }),
      ],
      NOW
    );
    expect(rows.map((r) => r.match.opponent)).toEqual(['dated', 'TBC']);
  });

  it('marks which row is the match the app would open into', () => {
    const playing = fixture({ status: 'in_progress' });
    const other = fixture();
    const rows = fixtureList([playing, other], NOW, playing.id as UUID);
    expect(rows.find((r) => r.isCurrent)?.match.id).toBe(playing.id);
    expect(rows.filter((r) => r.isCurrent)).toHaveLength(1);
  });

  it('marks nothing current when there is no current match', () => {
    const rows = fixtureList([fixture(), fixture()], NOW, null);
    expect(rows.some((r) => r.isCurrent)).toBe(false);
  });

  it('never loses a match', () => {
    const all = [
      fixture({ status: 'in_progress' }),
      fixture({ status: 'completed' }),
      fixture({ kickoffAt: null }),
      fixture({ status: 'abandoned' }),
    ];
    expect(fixtureList(all, NOW)).toHaveLength(all.length);
  });
});

describe('labels', () => {
  it('covers the four competitions the PO named', () => {
    expect(COMPETITIONS).toEqual(['league', 'cup', 'friendly', 'tournament']);
    expect(COMPETITIONS.map(competitionLabel)).toEqual([
      'League',
      'Cup',
      'Friendly',
      'Tournament',
    ]);
  });

  it('renders an unset competition as nothing rather than "null"', () => {
    expect(competitionLabel(null)).toBe('');
  });

  it('never renders an empty opponent', () => {
    expect(opponentLabel(fixture({ opponent: 'Riverside' }))).toBe('Riverside');
    for (const blank of [null, '', '   ']) {
      expect(opponentLabel(fixture({ opponent: blank }))).toBe('Opponent TBC');
    }
  });

  it('says the date is to be confirmed rather than showing nothing', () => {
    expect(kickoffLabel(fixture({ kickoffAt: null }), NOW)).toBe('Date TBC');
    expect(kickoffLabel(fixture({ kickoffAt: 'rubbish' }), NOW)).toBe('Date TBC');
  });

  it('shows a weekday and a time, because that is what a coach checks', () => {
    const label = kickoffLabel(fixture({ kickoffAt: '2026-09-26T10:00:00Z' }), NOW);
    expect(label).toMatch(/Sat/);
    expect(label).toMatch(/\d{2}:\d{2}/);
  });

  it('adds the year only when it is not this one', () => {
    expect(kickoffLabel(fixture({ kickoffAt: '2026-09-26T10:00:00Z' }), NOW)).not.toMatch(/2026/);
    expect(kickoffLabel(fixture({ kickoffAt: '2027-03-06T10:00:00Z' }), NOW)).toMatch(/2027/);
  });
});

// ---------------------------------------------------------------------------
// The two routing defects found in the slice 3b audit
// ---------------------------------------------------------------------------

const pending = [{ status: 'pending' as const }, { status: 'pending' as const }];
const running = [{ status: 'ended' as const }, { status: 'running' as const }];
const finished = [{ status: 'ended' as const }, { status: 'ended' as const }];

describe('openDestination', () => {
  it('goes to the clock when a quarter is running', () => {
    expect(openDestination(running, 'in_progress', true)).toBe('playing');
    // Even with no squad loaded: the match is live and interrupting it to
    // pick players would be worse than a thin screen.
    expect(openDestination(running, 'in_progress', false)).toBe('playing');
  });

  it('shows a SUMMARY for a finished match, not the live clock', () => {
    // The defect: opening a match played weeks ago showed a running-match UI.
    expect(openDestination(finished, 'completed', true)).toBe('summary');
    expect(openDestination(finished, 'in_progress', true)).toBe('summary');
    expect(openDestination([], 'completed', true)).toBe('summary');
    expect(openDestination(pending, 'abandoned', true)).toBe('summary');
  });

  it('sends a planned match to the lineup when the squad is ready', () => {
    expect(openDestination(pending, 'planned', true)).toBe('lineup');
  });

  it('sends it to the SQUAD first when there are not enough players', () => {
    // The defect: opening a fixture on a fresh install landed on a lineup
    // screen with nobody in it.
    expect(openDestination(pending, 'planned', false)).toBe('squad');
    expect(openDestination([], 'planned', false)).toBe('squad');
  });

  it('never treats an empty quarter list as finished', () => {
    // A fixture created but never started has no quarters yet; calling that
    // "finished" would hide it behind a summary of nothing.
    expect(openDestination([], 'planned', true)).toBe('lineup');
  });
});

describe('canDeleteFixture', () => {
  it('allows removing a fixture nobody has kicked off', () => {
    expect(canDeleteFixture(pending, 'planned')).toBe(true);
    expect(canDeleteFixture([], 'planned')).toBe(true);
  });

  it('refuses to delete a match that has been played', () => {
    // Deleting it would destroy the record its minutes were folded from.
    // Invariant 5: corrections are explicit, noted and never destructive.
    expect(canDeleteFixture(finished, 'completed')).toBe(false);
    expect(canDeleteFixture(running, 'in_progress')).toBe(false);
    expect(canDeleteFixture(pending, 'abandoned')).toBe(false);
  });

  it('refuses even one started quarter', () => {
    expect(canDeleteFixture([{ status: 'ended' }, { status: 'pending' }], 'planned')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Play now, and what a fixture says about itself — #70
// ---------------------------------------------------------------------------

describe('matchIsUnderway', () => {
  it('is true while a quarter is running', () => {
    expect(matchIsUnderway(running)).toBe(true);
  });

  it('is true between quarters, with nothing running', () => {
    // The coach who left the clock at half time still has a match on. Offering
    // Play now here would start a second one and orphan the first.
    expect(matchIsUnderway([{ status: 'ended' }, { status: 'pending' }])).toBe(true);
  });

  it('is false before kick-off and false at full time', () => {
    expect(matchIsUnderway(pending)).toBe(false);
    expect(matchIsUnderway(finished)).toBe(false);
    expect(matchIsUnderway([])).toBe(false);
  });
});

describe('lengthLabel', () => {
  it('says what THIS fixture is, because length belongs to the fixture', () => {
    expect(lengthLabel(fixture())).toBe('50 min · Quarters');
  });

  it('shows a cup game saved as halves as halves', () => {
    const cup = { ...fixture({ competition: 'cup' }), totalMinutes: 60, quarterCount: 2 };
    expect(lengthLabel(cup)).toBe('60 min · Halves');
  });
});
