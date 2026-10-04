/**
 * PO rulings D, E and F (#98, 2026-10-04), played through the real engine and
 * recorded through the real ledger the way App records them: once at
 * kick-off, again as each period ends. Synthetic first names only
 * (invariant 4).
 *
 * - D: End match closes a match; only closed matches count; leaving the
 *   report without closing keeps everything (#94 regression).
 * - E: a match counts for a child only if they were in the squad at its
 *   kick-off.
 * - F: a child marked absent who comes on arrived late — a noted
 *   correction; and the report's own noted correction.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MatchEngine, MatchEngineError, type MatchState } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { Player, UUID } from '../types/index';
import { makePlayer } from './squad';
import { makeFormat } from './shapes';
import { sheetFromSelection, toTeamSheet } from './teamSheet';
import { markAbsent } from './absence';
import { emptyLedger, parseLedger, recordMatches, type Ledger } from './ledger';
import { latestRecords } from './ledgerChain';
import { attendanceOf, kickoffTimes, seasonAttendance } from './attendance';
import { matchReport, seasonStats } from './analysis';
import { bucketOf, matchProgress, openDestination } from './fixtures';
import { matchesOnRelease, newMatch, openMatch } from './matchLifecycle';
import { withLiveMatch } from './liveMatch';
import { createMemoryStore, loadSession, saveSession, type SavedMatch } from './persistence';
import {
  LATE_ARRIVAL_NOTE,
  canEndMatch,
  correctMatchAttendance,
  endMatch,
  notClosedIds,
  recordLateArrival,
} from './matchClosing';

const MIN = 60_000;
const NOW = new Date('2026-10-04T12:00:00Z');

/** Nine players, a match in halves, seven start, the rest benched. */
function day() {
  let nowMs = Date.parse('2026-10-03T09:00:00Z');
  const nowFn = () => new Date(nowMs);
  const engine = new MatchEngine({ nowFn });
  const format = makeFormat('2-3-1');
  const squadId = uuid();
  const players: Player[] = ['Ava', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal', 'Ivy'].map((n) => ({
    ...makePlayer(squadId, n),
    createdAt: '2026-09-01T00:00:00.000Z',
  }));
  const ids = players.map((p) => p.id);
  let ledger: Ledger = emptyLedger(squadId, 'Test FC', NOW);
  const record = (state: MatchState) => {
    ledger = recordMatches(ledger, [state], players, 'Test FC', NOW);
  };
  const create = () =>
    engine.createMatch(squadId, format.id, { totalMinutes: 50, quarterCount: 2, availablePlayerIds: ids });
  const kickOff = (state: MatchState, absent: UUID[] = []) => {
    for (const id of absent) markAbsent(engine, state, id, true);
    const here = ids.filter((id) => !absent.includes(id));
    engine.startQuarter(state, state.quarters[0], toTeamSheet(sheetFromSelection(here.slice(0, 7), here[0], format)), format);
    record(state);
    return here;
  };
  const finish = (state: MatchState) => {
    for (const q of state.quarters) {
      if (q.status === 'pending') {
        const on = [...new Set(state.appearances.filter((a) => a.endElapsedMs === null).map((a) => a.playerId))];
        const here = ids.filter((id) => state.playerAvailability.get(id) === 'available');
        const pick = on.length === 7 ? on : here.slice(0, 7);
        engine.startQuarter(state, q, toTeamSheet(sheetFromSelection(pick, pick[0], format)), format);
        record(state);
      }
      if (q.status === 'running') {
        nowMs += 25 * MIN;
        engine.endQuarter(state, q);
        record(state);
      }
    }
  };
  return {
    engine,
    format,
    squadId,
    players,
    ids,
    create,
    kickOff,
    finish,
    record,
    nowFn,
    advance: (ms: number) => (nowMs += ms),
    ledger: () => ledger,
    setLedger: (l: Ledger) => (ledger = l),
  };
}

// ============================================================================
// D: End match
// ============================================================================

describe('End match closes a match (ruling D)', () => {
  it('the engine closes only a match whose every period has ended; status only', () => {
    const d = day();
    const state = d.create();
    expect(() => d.engine.completeMatch(state)).toThrow(MatchEngineError);
    d.kickOff(state);
    expect(() => d.engine.completeMatch(state)).toThrow('every period has ended');
    d.finish(state);
    const before = JSON.stringify({ q: state.quarters, a: state.appearances, b: state.benchStints });
    d.engine.completeMatch(state);
    expect(state.match.status).toBe('completed');
    // Nothing but the status moved.
    expect(JSON.stringify({ q: state.quarters, a: state.appearances, b: state.benchStints })).toBe(before);
    // Closing again changes nothing; an abandoned match cannot be closed.
    d.engine.completeMatch(state);
    expect(state.match.status).toBe('completed');
    const other = d.create();
    other.match.status = 'abandoned';
    expect(() => d.engine.completeMatch(other)).toThrow('abandoned');
  });

  it('is offered after the last period, and not once closed', () => {
    const d = day();
    const state = d.create();
    expect(canEndMatch(state)).toBe(false);
    d.kickOff(state);
    expect(canEndMatch(state)).toBe(false);
    expect(endMatch(d.engine, state)).toBe(false);
    d.finish(state);
    expect(canEndMatch(state)).toBe(true);
    expect(endMatch(d.engine, state)).toBe(true);
    expect(canEndMatch(state)).toBe(false);
    expect(endMatch(d.engine, state)).toBe(false);
  });

  it('reaches the ledger as a chain entry, and only then counts towards averages', () => {
    const d = day();
    const state = d.create();
    d.kickOff(state);
    d.finish(state);
    const open = d.ledger();
    expect(open.matches[0].status).toBe('in_progress');
    expect(seasonStats(open, d.players).countedMatches).toBe(0);
    expect(seasonAttendance(open).get(d.ids[0])!.attended).toBe(0);

    endMatch(d.engine, state);
    d.record(state);
    const closed = d.ledger();
    expect(closed.entries).toHaveLength(open.entries.length + 1);
    const last = closed.entries[closed.entries.length - 1];
    expect(last.records).toEqual([expect.objectContaining({ type: 'match', id: state.match.id, status: 'completed' })]);
    expect(closed.matches[0].status).toBe('completed');
    expect(seasonStats(closed, d.players).countedMatches).toBe(1);
    expect(seasonAttendance(closed).get(d.ids[0])!.attended).toBe(1);
    // The earlier, open revision is still in the chain (it only grows).
    expect(closed.entries.slice(0, -1)).toEqual(open.entries);
  });

  it('an abandoned match never counts', () => {
    const d = day();
    const state = d.create();
    d.kickOff(state);
    d.finish(state);
    state.match.status = 'abandoned';
    d.record(state);
    expect(seasonStats(d.ledger(), d.players).countedMatches).toBe(0);
    expect(canEndMatch(state)).toBe(false);
  });

  it('fixture cards: finished but not closed is hinted, still filed as Played', () => {
    const d = day();
    const finished = d.create();
    d.kickOff(finished);
    d.finish(finished);
    const closed = d.create();
    d.kickOff(closed);
    d.finish(closed);
    endMatch(d.engine, closed);
    const underway = d.create();
    d.kickOff(underway);
    const planned = d.create();
    const all = [finished, closed, underway, planned];
    expect(notClosedIds(all)).toEqual(new Set([finished.match.id]));
    expect(bucketOf(finished.match, NOW, matchProgress(finished.quarters))).toBe('past');
  });
});

describe('leaving the report without End match keeps everything (#94 regression, ruling D)', () => {
  it('the played match is folded into the list, reopens on its report, and can be closed later', async () => {
    const d = day();
    const { held, stored } = newMatch(
      { squadId: d.squadId, format: d.format, totalMinutes: 50, periodCount: 2, players: d.players },
      d.nowFn
    );
    // The list holds the copy from before kick-off; the match is played live.
    let matches: SavedMatch[] = [stored];
    const engine = new MatchEngine({ nowFn: d.nowFn });
    const state = held.state;
    const sheet = toTeamSheet(sheetFromSelection(d.ids.slice(0, 7), d.ids[0], d.format));
    for (const q of state.quarters) {
      engine.startQuarter(state, q, sheet, d.format);
      d.advance(25 * MIN);
      engine.endQuarter(state, q);
    }
    expect(canEndMatch(state)).toBe(true);

    // Back to Home from the report, End match NOT pressed: releaseMatch(null).
    matches = matchesOnRelease(matches, held, null);
    const kept = matches.find((m) => m.match.id === state.match.id)!;
    expect(kept.quarters.every((q) => q.status === 'ended')).toBe(true);
    expect(kept.appearances).toHaveLength(state.appearances.length);
    expect(kept.appearances.length).toBeGreaterThan(0);
    expect(kept.match.status).toBe('in_progress');

    // It survives a save and a relaunch.
    const store = createMemoryStore();
    await saveSession(store, {
      squadName: 'Test FC',
      squadId: d.squadId,
      players: d.players,
      format: d.format,
      totalMinutes: 50,
      periodCount: 2,
      plan: {},
      matches,
      state: null,
      matchFormat: null,
    });
    const reloaded = (await loadSession(store))!.matches;
    const again = reloaded.find((m) => m.match.id === state.match.id)!;
    expect(again.appearances).toEqual(kept.appearances);

    // Played on the list, hinted Not closed, and it opens on its report.
    expect(bucketOf(again.match, NOW, matchProgress(again.quarters))).toBe('past');
    expect(notClosedIds(reloaded)).toEqual(new Set([state.match.id]));
    const opened = openMatch(reloaded, null, state.match.id, d.players, d.format);
    if (opened.kind !== 'open') throw new Error(opened.kind);
    expect(openDestination(opened.held.state.quarters, opened.held.state.match.status, true)).toBe('summary');
    expect(canEndMatch(opened.held.state)).toBe(true);

    // Closed now, from the reopened copy; leaving again keeps the close.
    const reopenEngine = new MatchEngine({ nowFn: d.nowFn });
    expect(endMatch(reopenEngine, opened.held.state)).toBe(true);
    const after = matchesOnRelease(reloaded, opened.held, null);
    const closed = after.find((m) => m.match.id === state.match.id)!;
    expect(closed.match.status).toBe('completed');
    expect(closed.appearances).toEqual(kept.appearances);
    expect(notClosedIds(withLiveMatch(after, null)).size).toBe(0);
  });
});

// ============================================================================
// E: in the squad at kick-off
// ============================================================================

describe('a match counts for a child only if they were in the squad at kick-off (ruling E)', () => {
  /** The v1 fixture, closed, with p6's time taken out: p6 did not play. */
  const v1 = (kickoffAt: string | null) => {
    const doc = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'ledger-v1.json'), 'utf-8'));
    doc.matches[0].status = 'completed';
    doc.matches[0].kickoffAt = kickoffAt;
    doc.matches[0].intervals = doc.matches[0].intervals.filter((i: { playerId: string }) => i.playerId !== 'p6');
    delete doc.summary;
    const r = parseLedger(JSON.stringify(doc));
    if (!r.ok) throw new Error(r.reason);
    return r.ledger;
  };
  const squadMember = (id: string, createdAt: string): Player => ({
    ...makePlayer('s' as UUID, 'Kit'),
    id: id as UUID,
    createdAt,
  });

  it('v1 (inferred): joined before kick-off and did not play is missed; joined after is not', () => {
    const ledger = v1('2026-09-20T09:00:00.000Z');
    // Without the squad's dates, the v1 genesis holds everyone: p6 missed.
    expect(seasonAttendance(ledger).get('p6' as UUID)!.missed).toBe(1);
    const before = { players: [squadMember('p6', '2026-09-01T00:00:00.000Z')] };
    const after = { players: [squadMember('p6', '2026-09-25T00:00:00.000Z')] };
    expect(seasonAttendance(ledger, before).get('p6' as UUID)!.missed).toBe(1);
    expect(seasonAttendance(ledger, after).get('p6' as UUID)!).toMatchObject({ missed: 0, attended: 0 });
    // Exactly at kick-off counts as in the squad.
    const atKickoff = { players: [squadMember('p6', '2026-09-20T09:00:00.000Z')] };
    expect(seasonAttendance(ledger, atKickoff).get('p6' as UUID)!.missed).toBe(1);
    // The charts fold the same rule.
    const row = seasonStats(ledger, after.players).players.find((p) => p.playerId === ('p6' as UUID))!;
    expect(row).toMatchObject({ missed: 0, attended: 0, averageMs: null });
  });

  it('no kickoffAt (Play now): the first period start decides; with neither, it counts', () => {
    const ledger = v1(null);
    const joinedLate = { players: [squadMember('p6', '2026-09-25T00:00:00.000Z')] };
    // Known start, after they joined... and before.
    const kickoffs = kickoffTimes([
      { match: { id: ledger.matches[0].id, kickoffAt: null }, quarters: [{ index: 1, startedAt: '2026-09-20T09:00:00.000Z' }] },
    ]);
    expect(seasonAttendance(ledger, { ...joinedLate, kickoffs }).get('p6' as UUID)!.missed).toBe(0);
    const kickoffsLater = kickoffTimes([
      { match: { id: ledger.matches[0].id, kickoffAt: null }, quarters: [{ index: 1, startedAt: '2026-09-27T09:00:00.000Z' }] },
    ]);
    expect(seasonAttendance(ledger, { ...joinedLate, kickoffs: kickoffsLater }).get('p6' as UUID)!.missed).toBe(1);
    // Nothing known about when: counted, as before ruling E.
    expect(seasonAttendance(ledger, joinedLate).get('p6' as UUID)!.missed).toBe(1);
  });

  it('kickoffTimes: the fixture kick-off first, else the first period started', () => {
    const a = uuid();
    const b = uuid();
    const c = uuid();
    const times = kickoffTimes([
      { match: { id: a, kickoffAt: '2026-09-20T09:00:00.000Z' }, quarters: [{ index: 1, startedAt: '2026-09-20T09:07:00.000Z' }] },
      {
        match: { id: b, kickoffAt: null },
        quarters: [
          { index: 2, startedAt: '2026-09-21T10:30:00.000Z' },
          { index: 1, startedAt: '2026-09-21T10:00:00.000Z' },
        ],
      },
      { match: { id: c, kickoffAt: null }, quarters: [{ index: 1, startedAt: null }] },
    ]);
    expect(times.get(a)).toBe('2026-09-20T09:00:00.000Z');
    expect(times.get(b)).toBe('2026-09-21T10:00:00.000Z');
    expect(times.has(c)).toBe(false);
  });

  it('a child who played counts as attended whatever their createdAt says (e.g. re-imported)', () => {
    const ledger = v1('2026-09-20T09:00:00.000Z');
    const played = ledger.matches[0].intervals[0].playerId;
    const reimported = { players: [squadMember(played, '2026-10-04T00:00:00.000Z')] };
    expect(seasonAttendance(ledger, reimported).get(played)!.attended).toBe(1);
  });

  it('a recorded (v2) match: a child added after kick-off is neither attended nor missed', () => {
    const d = day();
    const state = d.create();
    d.kickOff(state);
    d.finish(state);
    endMatch(d.engine, state);
    d.record(state);
    const late = { ...makePlayer(d.squadId, 'Joe'), createdAt: '2026-10-04T00:00:00.000Z' };
    const ledger = recordMatches(d.ledger(), [], [...d.players, late], 'Test FC', NOW);
    const row = seasonAttendance(ledger, { players: [...d.players, late] }).get(late.id)!;
    expect(row).toMatchObject({ attended: 0, missed: 0, averageMs: null });
  });
});

// ============================================================================
// F: late arrivals and corrections
// ============================================================================

describe('a child marked absent who is brought on arrived late (ruling F)', () => {
  it('is recorded attended by a noted correction; the kick-off snapshot stays in the chain', () => {
    const d = day();
    const ivy = d.ids[8];
    const state = d.create();
    const here = d.kickOff(state, [ivy]);
    d.advance(10 * MIN);
    d.engine.substitute(state, state.quarters[0], here[6], ivy);

    const result = recordLateArrival(d.engine, state, d.ledger(), ivy, NOW);
    expect(result?.ok).toBe(true);
    if (!result?.ok) throw new Error('refused');
    d.setLedger(result.ledger);

    const last = result.ledger.entries[result.ledger.entries.length - 1];
    expect(last.records).toEqual([
      { type: 'attendance', matchId: state.match.id, playerId: ivy, status: 'available', note: LATE_ARRIVAL_NOTE },
    ]);
    const revisions = result.ledger.entries
      .flatMap((e) => e.records)
      .filter((r) => r.type === 'attendance' && r.playerId === ivy);
    expect(revisions.map((r) => [r.status, r.note])).toEqual([
      ['absent', null],
      ['available', LATE_ARRIVAL_NOTE],
    ]);
    // The match's own availability agrees, so later periods can pick her.
    expect(state.playerAvailability.get(ivy)).toBe('available');
    // A second sub of hers records nothing more.
    expect(recordLateArrival(d.engine, state, d.ledger(), ivy, NOW)).toBeNull();

    // Saving the match afterwards does not rewrite it from the working copy.
    d.finish(state);
    endMatch(d.engine, state);
    d.record(state);
    const ledger = d.ledger();
    expect(latestRecords(ledger.entries).get(`attendance:${state.match.id}:${ivy}`)).toMatchObject({
      status: 'available',
      note: LATE_ARRIVAL_NOTE,
    });
    const row = seasonAttendance(ledger).get(ivy)!;
    expect(row).toMatchObject({ attended: 1, missed: 0 });
    expect(row.pitchMsAttended).toBeGreaterThan(0);
    expect(attendanceOf(ledger.matches[0]).players.find((p) => p.playerId === ivy)!.attended).toBe(true);
    // The report no longer lists her as not here.
    expect(matchReport(d.engine, state, d.players).absentees).toEqual([]);
  });

  it('a child not marked absent: nothing recorded', () => {
    const d = day();
    const state = d.create();
    const here = d.kickOff(state);
    const before = d.ledger();
    d.engine.substitute(state, state.quarters[0], here[6], here[7]);
    expect(recordLateArrival(d.engine, state, before, here[7], NOW)).toBeNull();
  });
});

describe('Correct attendance on the report (ruling F, invariant 5)', () => {
  const played = () => {
    const d = day();
    const state = d.create();
    d.kickOff(state);
    d.finish(state);
    return { d, state };
  };

  it('needs a note, and writes a correction the snapshot stays under', () => {
    const { d, state } = played();
    const hal = d.ids[7]; // benched all match
    const refused = correctMatchAttendance(d.engine, state, d.ledger(), hal, 'absent', '   ', NOW);
    expect(refused).toEqual({ ok: false, reason: 'A correction needs a note saying why.' });
    expect(state.playerAvailability.get(hal)).toBe('available');

    const ok = correctMatchAttendance(d.engine, state, d.ledger(), hal, 'absent', 'Went home ill before kick-off', NOW);
    if (!ok.ok) throw new Error(ok.reason);
    d.setLedger(ok.ledger);
    expect(state.playerAvailability.get(hal)).toBe('absent');
    const revisions = ok.ledger.entries
      .flatMap((e) => e.records)
      .filter((r) => r.type === 'attendance' && r.playerId === hal);
    expect(revisions.map((r) => r.status)).toEqual(['available', 'absent']);
    expect(revisions[1].note).toBe('Went home ill before kick-off');

    endMatch(d.engine, state);
    d.record(state);
    expect(seasonAttendance(d.ledger()).get(hal)).toMatchObject({ attended: 0, missed: 1 });
    expect(matchReport(d.engine, state, d.players).absentees.map((a) => a.playerId)).toEqual([hal]);
  });

  it('refuses to mark absent a child who played, before kick-off, and without a ledger', () => {
    const { d, state } = played();
    const ava = d.ids[0];
    expect(correctMatchAttendance(d.engine, state, d.ledger(), ava, 'absent', 'wrong', NOW)).toEqual({
      ok: false,
      reason: 'They played in this match, so they were here.',
    });
    expect(correctMatchAttendance(d.engine, state, null, d.ids[7], 'absent', 'why', NOW).ok).toBe(false);
    const fresh = d.create();
    expect(correctMatchAttendance(d.engine, fresh, d.ledger(), d.ids[7], 'absent', 'why', NOW).ok).toBe(false);
    expect(fresh.playerAvailability.get(d.ids[7])).toBe('available');
  });

  it('on a v1 match with no snapshot, a correction overrides the inference for that child only', () => {
    const { d, state } = played();
    endMatch(d.engine, state);
    // A chain that first sees the match already played: no snapshot (§5).
    let ledger = recordMatches(emptyLedger(d.squadId, '', NOW), [state], d.players, '', NOW);
    expect(attendanceOf(ledger.matches[0]).inferred).toBe(true);
    const hal = d.ids[7];
    const ivy = d.ids[8];
    expect(seasonAttendance(ledger).get(hal)!.missed).toBe(1); // inferred: did not play
    const ok = correctMatchAttendance(d.engine, state, ledger, hal, 'available', 'On the bench all match', NOW);
    if (!ok.ok) throw new Error(ok.reason);
    ledger = ok.ledger;
    expect(attendanceOf(ledger.matches[0]).inferred).toBe(true);
    const rows = seasonAttendance(ledger);
    expect(rows.get(hal)).toMatchObject({ attended: 1, missed: 0 });
    expect(rows.get(ivy)).toMatchObject({ attended: 0, missed: 1 });
    expect(rows.get(d.ids[0])).toMatchObject({ attended: 1, missed: 0 });
  });
});
