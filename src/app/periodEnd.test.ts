/**
 * #180: the forgotten clock. Acceptance criteria are on the issue; each test
 * names the one it proves.
 */

import { describe, it, expect } from 'vitest';
import { MatchEngine, MatchEngineError, type MatchState } from '../engine/MatchEngine';
import { uuid, type Player, type UUID } from '../types/index';
import { emptyLedger, recordMatches } from './ledger';
import { makeSevenASideFormat } from './placeholderSquad';
import { foldPlayerMinutes } from './playerMinutes';
import { PERIOD_END_MARGIN_MS, periodEndChoices } from './periodEnd';
import { makePlayer } from './squad';

const MIN = 60_000;
/** 50 minutes in quarters: 12:30 a period. */
const PLANNED = 12.5 * MIN;

function kickOff() {
  let t = Date.parse('2026-10-10T09:00:00.000Z');
  const engine = new MatchEngine({ nowFn: () => new Date(t) });
  const advance = (ms: number) => {
    t += ms;
  };
  const format = makeSevenASideFormat();
  const squadId = uuid();
  const players: Player[] = Array.from({ length: 9 }, (_, i) => makePlayer(squadId, `P${i}`));
  const state: MatchState = engine.createMatch(squadId, format.id, { totalMinutes: 50, quarterCount: 4 });
  for (const p of players) state.playerAvailability.set(p.id, 'available');
  const sheet = new Map<UUID, UUID>();
  format.positions.forEach((pos, i) => sheet.set(pos.id, players[i].id));
  const q1 = state.quarters[0];
  engine.startQuarter(state, q1, sheet, format);
  const keeper = players[format.positions.findIndex((p) => p.kind === 'goalkeeper')];
  const outfield = players.find((p, i) => i < format.onFieldCount && p.id !== keeper.id)!;
  const bench = players.slice(format.onFieldCount);
  return { engine, state, q1, players, keeper, outfield, bench, advance, format };
}

const minutesOf = (m: ReturnType<typeof kickOff>, id: UUID) =>
  foldPlayerMinutes(m.engine, m.state, m.players).find((r) => r.playerId === id)!;

describe('periodEndChoices (#180)', () => {
  it('AC1: within planned + margin, nothing is asked', () => {
    const m = kickOff();
    m.advance(PLANNED + PERIOD_END_MARGIN_MS);
    expect(periodEndChoices(m.engine, m.state, m.q1)).toBeNull();
  });

  it('AC2: past the margin, the coach is offered planned time and now', () => {
    const m = kickOff();
    m.advance(PLANNED + PERIOD_END_MARGIN_MS + 1);
    const choices = periodEndChoices(m.engine, m.state, m.q1)!;
    expect(choices.planned).toEqual({ atMs: PLANNED, label: 'Ended at planned time' });
    expect(choices.now.atMs).toBe(PLANNED + PERIOD_END_MARGIN_MS + 1);
    expect(choices.now.label).toBe('Ended just now (13:30)');
  });

  it('AC3: a sub after planned time is the floor, and the label says so', () => {
    const m = kickOff();
    m.advance(13 * MIN);
    m.engine.substitute(m.state, m.q1, m.outfield.id, m.bench[0].id);
    m.advance(10 * MIN);
    expect(periodEndChoices(m.engine, m.state, m.q1)!.planned).toEqual({
      atMs: 13 * MIN,
      label: 'Ended at 13:00 (last sub)',
    });
  });

  it('AC3: a goal after planned time is the floor; a withdrawn one is not', () => {
    const m = kickOff();
    m.advance(13 * MIN);
    m.engine.recordEvent(m.state, m.q1, 'goal', m.outfield.id);
    m.advance(1 * MIN);
    const late = m.engine.recordEvent(m.state, m.q1, 'goal', m.outfield.id);
    m.engine.withdrawEvent(m.state, late.id, 'not a goal');
    m.advance(10 * MIN);
    expect(periodEndChoices(m.engine, m.state, m.q1)!.planned).toEqual({
      atMs: 13 * MIN,
      label: 'Ended at 13:00 (last goal)',
    });
  });

  it('AC3: a sub before planned time leaves "Ended at planned time" alone', () => {
    const m = kickOff();
    m.advance(5 * MIN);
    m.engine.substitute(m.state, m.q1, m.outfield.id, m.bench[0].id);
    m.advance(20 * MIN);
    expect(periodEndChoices(m.engine, m.state, m.q1)!.planned.label).toBe('Ended at planned time');
  });

  it('a later period measures from its own kick-off, not the match', () => {
    const m = kickOff();
    m.advance(PLANNED);
    m.engine.endQuarter(m.state, m.q1);
    const q2 = m.state.quarters[1];
    const sheet = new Map<UUID, UUID>();
    for (const a of m.state.appearances.filter((x) => x.quarterId === m.q1.id)) sheet.set(a.positionId, a.playerId);
    m.engine.startQuarter(m.state, q2, sheet, m.format);
    m.advance(13 * MIN);
    m.engine.substitute(m.state, q2, m.outfield.id, m.bench[0].id);
    m.advance(7 * MIN);
    const choices = periodEndChoices(m.engine, m.state, q2)!;
    expect(choices.planned).toEqual({ atMs: 13 * MIN, label: 'Ended at 13:00 (last sub)' });
    expect(choices.now.atMs).toBe(20 * MIN);
    m.engine.endQuarter(m.state, q2, choices.planned.atMs);
    expect(minutesOf(m, m.outfield.id).totalMs).toBe(PLANNED + 13 * MIN);
  });
});

describe('ending at the chosen time (#180)', () => {
  it('AC4: "Ended at planned time" credits nobody past it, in minutes and the ledger', () => {
    const m = kickOff();
    m.advance(25 * MIN); // the coach forgot for 12:30
    m.engine.endQuarter(m.state, m.q1, PLANNED);

    expect(m.q1.accumulatedMs).toBe(PLANNED);
    expect(minutesOf(m, m.outfield.id).totalMs).toBe(PLANNED);
    expect(minutesOf(m, m.bench[0].id).benchMs).toBe(PLANNED);

    const ledger = recordMatches(
      emptyLedger(m.state.match.squadId, 'Test FC', new Date(0)),
      [m.state],
      m.players,
      'Test FC',
      new Date(1)
    );
    const intervals = ledger.entries.flatMap((e) => e.records).filter((r) => r.type === 'interval');
    expect(intervals).toHaveLength(7);
    for (const r of intervals) expect(r.endMs).toBe(PLANNED);
  });

  it('AC5: both times are kept, and it is not a correction', () => {
    const m = kickOff();
    m.advance(25 * MIN);
    m.engine.endQuarter(m.state, m.q1, PLANNED);
    expect(m.q1.endedAt).toBe('2026-10-10T09:25:00.000Z');
    for (const a of m.state.appearances) {
      expect(a.corrected).toBe(false);
      expect(a.correctionNote).toBeNull();
      expect(a.endReason).toBe('quarter_end');
    }
  });

  it('"Ended just now" is the old behaviour', () => {
    const m = kickOff();
    m.advance(25 * MIN);
    m.engine.endQuarter(m.state, m.q1);
    expect(minutesOf(m, m.outfield.id).totalMs).toBe(25 * MIN);
  });

  it('AC8: the engine refuses an end before the last thing recorded, or after now', () => {
    const m = kickOff();
    m.advance(13 * MIN);
    m.engine.substitute(m.state, m.q1, m.outfield.id, m.bench[0].id);
    m.advance(10 * MIN);
    expect(() => m.engine.endQuarter(m.state, m.q1, PLANNED)).toThrow(MatchEngineError);
    expect(() => m.engine.endQuarter(m.state, m.q1, 24 * MIN)).toThrow(MatchEngineError);
    expect(m.q1.status).toBe('running');
    m.engine.endQuarter(m.state, m.q1, 13 * MIN);
    // The player subbed on at 13:00 has no time: nothing past the end.
    expect(minutesOf(m, m.bench[0].id).totalMs).toBe(0);
    expect(minutesOf(m, m.outfield.id).totalMs).toBe(13 * MIN);
  });
});
