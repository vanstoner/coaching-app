/**
 * #194 part B (PO rulings on #191, 17 and 18 Oct): a test match started from
 * Settings is never recorded, runs on its own clock at ×1, ×5 or ×10, and
 * deletes outright; a played real match never deletes, and can be voided
 * with a note, which hides it everywhere and keeps it in the record.
 */

import { describe, it, expect } from 'vitest';
import { MatchEngine, type MatchState } from '../engine/MatchEngine';
import { uuid, type Player } from '../types/index';
import { makePlayer } from './squad';
import { makeFormat } from './shapes';
import { sheetFromSelection, toTeamSheet } from './teamSheet';
import { emptyLedger, isHidden, recordMatches, seasonRows, setMatchKind, visibleLedger, type Ledger } from './ledger';
import { deleteMatch, newMatch } from './matchLifecycle';
import { mergeCurrentMatch, type SavedMatch } from './persistence';
import { recordOnlyMatches } from './recordOnly';
import {
  deleteTestMatches,
  hiddenMatches,
  isTestMatch,
  matchClock,
  newTestMark,
  realMatches,
  recordable,
  testMatchNowMs,
  testMatchesOnPhone,
  withTestSpeed,
} from './testMatches';
import { canDeleteFixture } from './fixtures';

const MIN = 60_000;
const squadId = uuid();
const players: Player[] = ['Ada', 'Bo', 'Cai', 'Dot', 'Eli', 'Fin', 'Gus', 'Hal', 'Ivy'].map((n) =>
  makePlayer(squadId, n)
);
const ids = players.map((p) => p.id);
const format = makeFormat('2-3-1');
const NOW = new Date('2026-10-18T10:00:00Z');

/** A match built as the app builds one, real or test, played `periods` periods of `minutes` each. */
function build(test: boolean, periods: number, minutes = 12.5) {
  let nowMs = NOW.getTime();
  const appNow = () => new Date(nowMs);
  const { held, stored } = newMatch(
    {
      squadId,
      format,
      totalMinutes: 50,
      periodCount: 4,
      players,
      ...(test ? { test: newTestMark(nowMs) } : {}),
    },
    appNow
  );
  const engine = new MatchEngine({ nowFn: matchClock(held.state, appNow) });
  const s = held.state;
  for (const q of s.quarters.slice(0, periods)) {
    engine.startQuarter(s, q, toTeamSheet(sheetFromSelection(ids.slice(0, 7), ids[0], format)), format);
    nowMs += minutes * MIN;
    engine.endQuarter(s, q);
  }
  if (periods === s.quarters.length) engine.completeMatch(s);
  return { held, stored, state: s, engine, advance: (ms: number) => (nowMs += ms), appNow };
}

const ledgerOf = (records: (SavedMatch | MatchState)[]): Ledger =>
  recordMatches(emptyLedger(squadId, 'Test FC', NOW), records, players, 'Test FC', NOW);

describe('a test match is never recorded (AC1, AC2, AC6)', () => {
  it('Start a test match builds a match marked a test, held and stored alike', () => {
    const t = build(true, 0);
    expect(isTestMatch(t.held.state.match)).toBe(true);
    expect(isTestMatch(t.stored.match)).toBe(true);
    expect(isTestMatch(build(false, 0).held.state.match)).toBe(false);
  });

  it('never reaches recordMatches: the app records only what `recordable` passes', () => {
    const test = build(true, 2).state;
    const real = build(false, 2).state;
    const stored = mergeCurrentMatch(mergeCurrentMatch([], test, format), real, format);
    expect(recordable(stored).map((m) => m.match.id)).toEqual([real.match.id]);
    const l = ledgerOf(recordable(stored));
    expect(l.matches.map((m) => m.id)).toEqual([real.match.id]);
  });

  it('and recordMatches refuses one even if handed it: no match, interval or attendance', () => {
    const test = build(true, 4).state;
    const l = ledgerOf([test]);
    expect(l.matches).toEqual([]);
    const records = l.entries.flatMap((e) => e.records);
    expect(records.some((r) => r.matchId === test.match.id)).toBe(false);
    expect(records.some((r) => r.type === 'match')).toBe(false);
  });

  it('is in no figure: every season row is the real match alone', () => {
    const test = build(true, 4).state;
    const real = build(false, 4).state;
    const rows = seasonRows(visibleLedger(ledgerOf([test, real])));
    expect(rows.find((r) => r.playerId === ids[0])!.goalkeeperMs).toBe(50 * MIN);
  });

  it('is on no list but Settings › Test matches', () => {
    const test = build(true, 1);
    const real = build(false, 1);
    const stored = mergeCurrentMatch(mergeCurrentMatch([], real.state, format), test.state, format);
    expect(realMatches(stored).map((m) => m.match.id)).toEqual([real.state.match.id]);
    expect(testMatchesOnPhone(stored, null).map((m) => m.match.id)).toEqual([test.state.match.id]);
    // The held one is listed too, at its latest.
    expect(testMatchesOnPhone([], test.held).map((m) => m.match.id)).toEqual([test.state.match.id]);
  });
});

describe('a test match runs on its own clock (PO ruling 18 Oct: ×5 and ×10 in Heart FC Coach too)', () => {
  it('at ×10, ten real seconds are a hundred match seconds, read from anchors', () => {
    let app = NOW.getTime();
    const state = { match: { test: withTestSpeed(newTestMark(app), 10, app) } };
    const clock = matchClock(state, () => new Date(app));
    const t0 = clock().getTime();
    app += 10_000;
    expect(clock().getTime() - t0).toBe(100_000);
  });

  it('a speed change is continuous: no jump, and never behind the app clock', () => {
    const base = NOW.getTime();
    let mark = withTestSpeed(newTestMark(base), 5, base);
    const before = testMatchNowMs(mark, base + 60_000);
    mark = withTestSpeed(mark, 1, base + 60_000);
    expect(testMatchNowMs(mark, base + 60_000)).toBe(before);
    expect(testMatchNowMs(mark, base + 61_000)).toBe(before + 1_000);
    expect(before).toBeGreaterThanOrEqual(base + 60_000);
  });

  it('a real match reads the app clock untouched', () => {
    const app = NOW.getTime();
    expect(matchClock({ match: {} }, () => new Date(app))().getTime()).toBe(app);
  });

  it('a whole period at ×10 keeps every minute exact', () => {
    const t = build(true, 0);
    t.state.match.test = withTestSpeed(t.state.match.test!, 10, t.appNow().getTime());
    const q = t.state.quarters[0];
    t.engine.startQuarter(t.state, q, toTeamSheet(sheetFromSelection(ids.slice(0, 7), ids[0], format)), format);
    t.advance(75_000); // 75 real seconds at ×10
    expect(t.engine.getQuarterElapsedMs(q)).toBe(12.5 * MIN);
  });
});

describe('deleting (AC3, AC4)', () => {
  it('a test match deletes outright, played or not; a real one in the list stays', () => {
    const test = build(true, 4);
    const real = build(false, 4);
    const stored = mergeCurrentMatch(mergeCurrentMatch([], real.state, format), test.state, format);
    const out = deleteTestMatches(stored, null, [test.state.match.id, real.state.match.id]);
    expect(out.matches.map((m) => m.match.id)).toEqual([real.state.match.id]);
    expect(out.deleted).toBe(1);
    expect(out.releaseLive).toBe(false);
  });

  it('deleting the held test match lets go of it', () => {
    const test = build(true, 1);
    const out = deleteTestMatches([], test.held, [test.state.match.id]);
    expect(out).toEqual({ matches: [], releaseLive: true, deleted: 1 });
  });

  it('an unplayed fixture deletes; a played real match never does', () => {
    const unplayed = build(false, 0);
    const playedReal = build(false, 1);
    expect(canDeleteFixture(unplayed.state.quarters, unplayed.state.match.status)).toBe(true);
    expect(canDeleteFixture(playedReal.state.quarters, playedReal.state.match.status)).toBe(false);
    const stored = mergeCurrentMatch([], playedReal.state, format);
    expect(deleteMatch(stored, null, playedReal.state.match.id).ok).toBe(false);
  });
});

describe('Void, with a note (PO ruling 18 Oct)', () => {
  const real = build(false, 4).state;
  const other = build(false, 4).state;
  const voided = (() => {
    const r = setMatchKind(ledgerOf([real, other]), real.match.id, 'void', 'Started by mistake', NOW);
    if (!r.ok) throw new Error(r.reason);
    return r.ledger;
  })();

  it('needs a note', () => {
    expect(setMatchKind(ledgerOf([real]), real.match.id, 'void', ' ', NOW).ok).toBe(false);
  });

  it('is hidden from every view and folded figure, and kept in the record', () => {
    const view = visibleLedger(voided);
    expect(view.matches.map((m) => m.id)).toEqual([other.match.id]);
    expect(seasonRows(view).find((r) => r.playerId === ids[0])!.goalkeeperMs).toBe(50 * MIN);
    expect(recordOnlyMatches(view, new Set()).map((m) => m.id)).toEqual([other.match.id]);
    const kept = voided.matches.find((m) => m.id === real.match.id)!;
    expect(isHidden(kept)).toBe(true);
    expect(kept.intervals.length).toBeGreaterThan(0);
  });

  it('is listed with the hidden test matches, as voided, and can be shown again', () => {
    const listed = hiddenMatches(voided);
    expect(listed.map((m) => [m.id, m.matchKind?.kind, m.matchKind?.note])).toEqual([
      [real.match.id, 'void', 'Started by mistake'],
    ]);
    const r = setMatchKind(voided, real.match.id, 'real', 'Shown again by the coach', NOW);
    if (!r.ok) throw new Error(r.reason);
    expect(visibleLedger(r.ledger).matches).toHaveLength(2);
  });
});
