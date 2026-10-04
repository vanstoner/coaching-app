/**
 * Attendance, games missed and the absence-adjusted average — #102, #100 AC3,
 * ADR-014 §4, ADR-015 §4–7. Synthetic first names only.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { Player, UUID } from '../types/index';
import { makePlayer } from './squad';
import { makeFormat } from './shapes';
import { toTeamSheet, sheetFromSelection } from './teamSheet';
import { markAbsent } from './absence';
import {
  correctAttendance,
  emptyLedger,
  parseLedger,
  recordMatches,
  serialiseLedger,
  type Ledger,
} from './ledger';
import {
  attendanceOf,
  gamesMissed,
  inferredMatchCount,
  matchesAttended,
  seasonAttendance,
} from './attendance';

const MIN = 60_000;
const NOW = new Date('2026-10-04T12:00:00Z');

/**
 * One squad of nine. A match in halves, played and recorded as the app
 * records it: once at kick-off, again as each half ends. `absent` are marked
 * absent before kick-off. Seven start; the rest of the available are benched
 * for the whole match.
 */
function season() {
  let nowMs = 1_700_000_000_000;
  const engine = new MatchEngine({ nowFn: () => new Date(nowMs) });
  const format = makeFormat('2-3-1');
  const squadId = uuid();
  const players: Player[] = ['Ava', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal', 'Ivy'].map((n) =>
    makePlayer(squadId, n)
  );
  const ids = players.map((p) => p.id);
  let ledger: Ledger = emptyLedger(squadId, 'Test FC', NOW);

  const play = (absent: UUID[], status: 'completed' | 'in_progress' = 'completed') => {
    const state = engine.createMatch(squadId, format.id, {
      totalMinutes: 50,
      quarterCount: 2,
      availablePlayerIds: ids,
    });
    for (const id of absent) markAbsent(engine, state, id, true);
    const here = ids.filter((id) => !absent.includes(id));
    const sheet = toTeamSheet(sheetFromSelection(here.slice(0, 7), here[0], format));
    for (const q of state.quarters) {
      engine.startQuarter(state, q, sheet, format);
      ledger = recordMatches(ledger, [state], players, 'Test FC', NOW);
      nowMs += 25 * MIN;
      engine.endQuarter(state, q);
      ledger = recordMatches(ledger, [state], players, 'Test FC', NOW);
    }
    state.match.status = status;
    ledger = recordMatches(ledger, [state], players, 'Test FC', NOW);
    return state;
  };
  return { engine, players, ids, play, ledger: () => ledger, setLedger: (l: Ledger) => (ledger = l) };
}

describe('attendance is snapshotted at kick-off (#100 AC3, #102 AC2)', () => {
  it('records every player’s status for the match, absent included', () => {
    const s = season();
    s.play([s.ids[8]]);
    const match = s.ledger().matches[0];
    expect(match.attendance).toHaveLength(9);
    expect(match.attendance!.find((a) => a.playerId === s.ids[8])!.status).toBe('absent');
    expect(attendanceOf(match).inferred).toBe(false);
  });

  it('survives a file round trip', () => {
    const s = season();
    s.play([s.ids[8]]);
    const back = parseLedger(serialiseLedger(s.ledger()));
    if (!back.ok) throw new Error(back.reason);
    expect(back.ledger.matches[0].attendance).toEqual(s.ledger().matches[0].attendance);
  });

  it('is not rewritten by a later change to the working document after kick-off', () => {
    const s = season();
    const state = s.play([s.ids[8]]);
    // The engine would take this; the ledger keeps its snapshot.
    s.engine.setAvailability(state, s.ids[8], 'available');
    const after = recordMatches(s.ledger(), [state], s.players, 'Test FC', NOW);
    expect(after.matches[0].attendance!.find((a) => a.playerId === s.ids[8])!.status).toBe('absent');
  });

  it('is not invented for a match the ledger first sees already played (ADR-015 §5)', () => {
    const s = season();
    const state = s.play([]);
    // A fresh chain back-filled from the working document, as after #100 AC7.
    const fresh = recordMatches(emptyLedger(uuid(), '', NOW), [state], s.players, '', NOW);
    expect(fresh.matches[0].attendance).toBeUndefined();
    expect(attendanceOf(fresh.matches[0]).inferred).toBe(true);
  });
});

describe('games missed and matches attended are derived (#102 AC3, AC4; ADR-015 §4, §7)', () => {
  it('counts absence as a game missed, and a whole match on the bench as attended', () => {
    const s = season();
    s.play([s.ids[8]]); // Ivy absent; Hal benched all match.
    s.play([]); // Everyone here; Hal and Ivy benched.
    const ledger = s.ledger();
    expect(gamesMissed(ledger, s.ids[8])).toBe(1);
    expect(matchesAttended(ledger, s.ids[8])).toBe(1);
    expect(gamesMissed(ledger, s.ids[7])).toBe(0);
    expect(matchesAttended(ledger, s.ids[7])).toBe(2);
    // Ruling B: benched all match counts against the average.
    expect(seasonAttendance(ledger).get(s.ids[7])!.averageMs).toBe(0);
  });

  it('averages pitch time — goal plus outfield — over matches attended only', () => {
    const s = season();
    s.play([s.ids[1]]); // Ben absent: Ava in goal, Cal–Hal out.
    s.play([]); // Ava in goal, Ben–Gus out.
    const rows = seasonAttendance(s.ledger());
    // Ava: two full matches in goal. Pitch time counts goal time (ADR-015 §1).
    expect(rows.get(s.ids[0])).toMatchObject({ attended: 2, missed: 0, averageMs: 50 * MIN });
    // Ben: one match attended, fully played; not owed time for the one missed.
    expect(rows.get(s.ids[1])).toMatchObject({ attended: 1, missed: 1, averageMs: 50 * MIN });
  });

  it('is null, not zero, for a player who has attended nothing (#102 AC3)', () => {
    const s = season();
    s.play([s.ids[8]]);
    expect(seasonAttendance(s.ledger()).get(s.ids[8])!.averageMs).toBeNull();
  });

  it('only counts completed matches (ADR-015 §6)', () => {
    const s = season();
    s.play([s.ids[8]], 'in_progress');
    expect(gamesMissed(s.ledger(), s.ids[8])).toBe(0);
    expect(matchesAttended(s.ledger(), s.ids[0])).toBe(0);
  });

  it('a noted correction after kick-off changes it; the snapshot stays in the chain (invariant 5)', () => {
    const s = season();
    s.play([s.ids[8]]);
    const matchId = s.ledger().matches[0].id;
    const refused = correctAttendance(s.ledger(), matchId, s.ids[8], 'available', '  ', NOW);
    expect(refused).toEqual({ ok: false, reason: 'A correction needs a note saying why.' });
    const fixed = correctAttendance(s.ledger(), matchId, s.ids[8], 'available', 'Arrived at 9:05', NOW);
    if (!fixed.ok) throw new Error(fixed.reason);
    expect(gamesMissed(fixed.ledger, s.ids[8])).toBe(0);
    expect(fixed.ledger.matches[0].attendance!.find((a) => a.playerId === s.ids[8])!.note).toBe(
      'Arrived at 9:05'
    );
    const revisions = fixed.ledger.entries
      .flatMap((e) => e.records)
      .filter((r) => r.type === 'attendance' && r.playerId === s.ids[8]);
    expect(revisions.map((r) => r.status)).toEqual(['absent', 'available']);
  });
});

describe('v1 matches infer attendance from play (ruling C, ADR-015 §5)', () => {
  const v1Completed = () => {
    const doc = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'ledger-v1.json'), 'utf-8'));
    doc.matches[0].status = 'completed';
    // Take p6's time out of the match, so p6 is someone who did not play.
    doc.matches[0].intervals = doc.matches[0].intervals.filter((i: { playerId: string }) => i.playerId !== 'p6');
    delete doc.summary;
    const r = parseLedger(JSON.stringify(doc));
    if (!r.ok) throw new Error(r.reason);
    return r.ledger;
  };

  it('played any interval = attended; in the squad but did not play = missed', () => {
    const ledger = v1Completed();
    expect(attendanceOf(ledger.matches[0]).inferred).toBe(true);
    expect(matchesAttended(ledger, 'p1' as UUID)).toBe(1);
    expect(gamesMissed(ledger, 'p6' as UUID)).toBe(1);
    expect(inferredMatchCount(ledger)).toBe(1);
  });

  it('a player who joined afterwards did not miss it', () => {
    const ledger = v1Completed();
    const newcomer = makePlayer(ledger.squad.id, 'Joe');
    const later = recordMatches(ledger, [], [newcomer], '', NOW);
    expect(gamesMissed(later, newcomer.id)).toBe(0);
    expect(seasonAttendance(later).get(newcomer.id)!.averageMs).toBeNull();
  });
});
