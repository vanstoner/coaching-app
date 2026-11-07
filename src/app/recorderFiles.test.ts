/**
 * #281 (ADR-025): the recorder pack out, the recorded match back, and the
 * import with its refusals. Made-up names only.
 */

import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { UUID } from '../types/index';
import { makePlayer } from './squad';
import { makeFormat } from './shapes';
import { appendRecords, emptyLedger, recordMatches, serialiseLedger, type Ledger } from './ledger';
import { fixtureRecord } from './ledgerSetup';
import {
  ALREADY_IN_RECORD,
  importRecordedMatch,
  makeRecordedMatch,
  makeRecorderPack,
  packLedger,
  readRecorderFile,
  RECORDED_HERE_TOO,
  recordedElsewhere,
} from './recorderFiles';

const squadId = uuid();
const players = ['Ava', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal'].map((n) => makePlayer(squadId, n));
const format = makeFormat('2-3-1');
const T0 = new Date('2026-11-01T09:00:00Z');

function coachWithFixture() {
  const engine = new MatchEngine({ nowFn: () => T0 });
  const state = engine.createMatch(squadId, format.id, { totalMinutes: 50, quarterCount: 4, availablePlayerIds: players.map((p) => p.id) });
  state.match.opponent = 'Rovers';
  let coach = emptyLedger(squadId, 'Test FC', T0);
  coach = recordMatches(coach, [], players, 'Test FC', T0);
  coach = appendRecords(coach, players.map((p) => ({ type: 'player', id: p.id, firstName: p.firstName, displaySuffix: null, active: true })), T0);
  coach = appendRecords(coach, [fixtureRecord({ match: state.match, format } as never)], T0);
  return { coach, state };
}

/** The recorder's borrowed team plays the fixture through and closes it. */
function recordOnBorrowed(pack: Ledger, fixtureMatch: ReturnType<typeof coachWithFixture>['state']) {
  let now = new Date('2026-11-08T10:00:00Z');
  const engine = new MatchEngine({ nowFn: () => now });
  const state = engine.createMatch(squadId, format.id, { totalMinutes: 50, quarterCount: 4, availablePlayerIds: players.map((p) => p.id) });
  state.match = { ...state.match, id: fixtureMatch.match.id, opponent: 'Rovers' };
  state.quarters.forEach((q) => (q.matchId = state.match.id));
  const sheet = new Map<UUID, UUID>();
  format.positions.forEach((p, i) => sheet.set(p.id, players[i].id));
  for (const q of state.quarters) {
    engine.startQuarter(state, q, sheet, format);
    now = new Date(now.getTime() + 12.5 * 60_000);
    engine.endQuarter(state, q);
  }
  engine.completeMatch(state);
  return recordMatches(pack, [{ ...state, format }], players, 'Test FC', now);
}

describe('the recorder pack (ADR-025 D1, D2)', () => {
  it('holds the team name, active children, the fixture and a pack record; no history', () => {
    const { coach, state } = coachWithFixture();
    const pack = packLedger(coach, state.match.id, T0);
    expect(pack.squad.name).toBe('Test FC');
    expect(pack.players.map((p) => p.firstName).sort()).toEqual(players.map((p) => p.firstName).sort());
    expect(pack.fixtures.map((f) => f.id)).toEqual([state.match.id]);
    expect(pack.matches).toEqual([]);
    expect(pack.entries.flatMap((e) => e.records).some((r) => r.type === 'pack' && r.fixtureId === state.match.id)).toBe(true);
  });

  it('reads back by kind; a bare minutes file goes to Import minutes file; a newer file is refused', () => {
    const { coach, state } = coachWithFixture();
    const file = makeRecorderPack(coach, state.match.id, null, [], T0);
    const back = readRecorderFile(JSON.stringify(file));
    expect(back.kind).toBe('pack');
    expect(readRecorderFile(serialiseLedger(coach)).kind).toBe('minutes');
    expect(readRecorderFile(JSON.stringify({ ...file, minReaderVersion: 2 }))).toMatchObject({ kind: 'refused' });
  });
});

describe('importing the recorded match (ADR-025 D5)', () => {
  it('appends the match unchanged, with a received record; then refuses it twice', () => {
    const { coach, state } = coachWithFixture();
    const pack = packLedger(coach, state.match.id, T0);
    const borrowed = recordOnBorrowed(pack, state);
    const file = makeRecordedMatch(borrowed, state.match.id, new Date('2026-11-08T11:00:00Z'));
    const read = readRecorderFile(JSON.stringify(file));
    if (read.kind !== 'match') throw new Error(read.kind);
    const r = importRecordedMatch(coach, read.file, read.ledger, false, new Date('2026-11-08T12:00:00Z'));
    if (!r.ok) throw new Error(r.reason);
    const m = r.ledger.matches.find((x) => x.id === state.match.id)!;
    expect(m.status).toBe('completed');
    const theirs = read.ledger.matches.find((x) => x.id === state.match.id)!;
    expect(m.intervals.map((i) => i.id).sort()).toEqual(theirs.intervals.map((i) => i.id).sort());
    expect(recordedElsewhere(r.ledger, state.match.id)).toBe(true);
    expect(importRecordedMatch(r.ledger, read.file, read.ledger, false, new Date())).toEqual({ ok: false, reason: ALREADY_IN_RECORD });
  });

  it('refuses when this phone recorded the match too, or holds it live; nothing written', () => {
    const { coach, state } = coachWithFixture();
    const pack = packLedger(coach, state.match.id, T0);
    const borrowed = recordOnBorrowed(pack, state);
    const read = readRecorderFile(JSON.stringify(makeRecordedMatch(borrowed, state.match.id, new Date())));
    if (read.kind !== 'match') throw new Error(read.kind);
    expect(importRecordedMatch(coach, read.file, read.ledger, true, new Date())).toEqual({ ok: false, reason: RECORDED_HERE_TOO });
    const ownCopy = recordOnBorrowed(coach, state);
    expect(importRecordedMatch(ownCopy, read.file, read.ledger, false, new Date())).toEqual({ ok: false, reason: RECORDED_HERE_TOO });
  });

  it('refuses a match that is not one of this team\'s fixtures, or not finished', () => {
    const { coach, state } = coachWithFixture();
    const other = coachWithFixture();
    const read = readRecorderFile(JSON.stringify(makeRecordedMatch(recordOnBorrowed(packLedger(other.coach, other.state.match.id, T0), other.state), other.state.match.id, new Date())));
    if (read.kind !== 'match') throw new Error(read.kind);
    expect(importRecordedMatch(coach, read.file, read.ledger, false, new Date())).toMatchObject({ ok: false, reason: expect.stringMatching(/not one of this team/) });
    const unfinished = readRecorderFile(JSON.stringify(makeRecordedMatch(packLedger(coach, state.match.id, T0), state.match.id, new Date())));
    if (unfinished.kind !== 'match') throw new Error(unfinished.kind);
    expect(importRecordedMatch(coach, unfinished.file, unfinished.ledger, false, new Date())).toMatchObject({ ok: false, reason: expect.stringMatching(/not been finished/) });
  });
});
