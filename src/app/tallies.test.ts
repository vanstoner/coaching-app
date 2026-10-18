/**
 * The coach's tallies — #198 AC1–AC5 (PO `approve readiness`, 18 Oct: save
 * and shot on target are tallies; assist is core; an added kind gets its own
 * button during play). Made-up first names only (invariant 4).
 */

import { describe, expect, it } from 'vitest';
import { MatchEngine, type MatchState } from '../engine/MatchEngine';
import { uuid, type Player, type TallyKind } from '../types/index';
import {
  addEventType,
  emptyLedger,
  foldLedger,
  parseLedger,
  recordMatches,
  serialiseLedger,
  setEventTypeActive,
  type Ledger,
} from './ledger';
import * as released from './fixtures/reader-1.2.0/ledger';
import { scoreFromEvents } from './matchRecord';
import { scoreOf, timeStream } from './matchEvents';
import { recordMatchPage } from './recordOnly';
import { makeFormat } from './shapes';
import { makePlayer } from './squad';
import { sheetFromSelection, toTeamSheet } from './teamSheet';
import { planSubs, restoreSubPlan } from './subPlan';
import {
  CORE_KINDS,
  matchTallies,
  matchTalliesWithGoals,
  tallyButtons,
  tallyKindOf,
  tallyLineText,
  tierOf,
} from './tallies';

const MIN = 60_000;
const NOW = new Date('2026-10-18T12:00:00Z');
const squadId = uuid();
const players: Player[] = ['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gil', 'Hal'].map((n) => makePlayer(squadId, n));
const ids = players.map((p) => p.id);
const nameOf = (id: string) => players.find((p) => p.id === id)?.firstName ?? 'Unknown';

const ok = (r: { ok: true; ledger: Ledger } | { ok: false; reason: string }): Ledger => {
  if (!r.ok) throw new Error(r.reason);
  return r.ledger;
};

/** One period through the engine with core and tally taps, and a coach's own kind. */
function played(throwIn: TallyKind, teamKind: TallyKind): MatchState {
  let nowMs = Date.parse('2026-10-17T09:00:00Z');
  const engine = new MatchEngine({ nowFn: () => new Date(nowMs) });
  const format = makeFormat('2-3-1');
  const s = engine.createMatch(squadId, format.id, { totalMinutes: 20, quarterCount: 1 });
  const q = s.quarters[0];
  engine.startQuarter(s, q, toTeamSheet(sheetFromSelection(ids.slice(0, 7), ids[0], format)), format);
  nowMs += 5 * MIN;
  const goal = engine.recordEvent(s, q, 'goal', ids[2]);
  engine.recordAssist(s, goal.id, ids[3]);
  engine.recordEvent(s, q, 'tackle', ids[4]);
  engine.recordEvent(s, q, 'save', ids[0]);
  engine.recordEvent(s, q, 'shot_on_target', ids[5]);
  engine.recordTally(s, q, throwIn, ids[4]);
  engine.recordTally(s, q, throwIn, ids[4]);
  engine.recordTally(s, q, teamKind, null);
  expect(() => engine.recordTally(s, q, throwIn, ids[7])).toThrow(); // on the bench
  nowMs += 15 * MIN;
  engine.endQuarter(s, q);
  engine.completeMatch(s);
  return s;
}

function setup() {
  let ledger = emptyLedger(squadId, 'Test FC', NOW);
  ledger = ok(addEventType(ledger, 'Throw-in won', 'child', NOW));
  ledger = ok(addEventType(ledger, 'Kick-off', 'team', NOW));
  const [child, team] = ledger.eventTypes;
  const state = played(tallyKindOf(child.id), tallyKindOf(team.id));
  return { ledger: recordMatches(ledger, [state], players, 'Test FC', NOW), state };
}

describe('every kind has a tier (#198 AC1)', () => {
  it('core: goal, assist, conceded; tally: everything else, a kind added later included', () => {
    expect(CORE_KINDS).toEqual(['goal', 'assist', 'conceded']);
    for (const k of ['save', 'shot_on_target', 'tackle', 'corner', 'free_kick', 'tally:abc', 'a-later-kind']) {
      expect(tierOf(k)).toBe('tally');
    }
    expect(tierOf('withdrawn')).toBeNull();
  });
});

describe('Settings › Tallies adds a kind without a release (#198 AC2)', () => {
  it('needs a name not already used; can stop being offered, and its buttons follow', () => {
    let l = emptyLedger(squadId, 'Test FC', NOW);
    expect(addEventType(l, ' ', 'child', NOW).ok).toBe(false);
    expect(addEventType(l, 'Tackle', 'child', NOW).ok).toBe(false);
    l = ok(addEventType(l, 'Throw-in won', 'child', NOW));
    expect(addEventType(l, 'throw-in won', 'team', NOW).ok).toBe(false);
    const [t] = l.eventTypes;
    expect(tallyButtons(l.eventTypes)).toEqual([{ kind: `tally:${t.id}`, label: 'Throw-in won', team: false }]);
    l = ok(setEventTypeActive(l, t.id, false, NOW));
    expect(tallyButtons(l.eventTypes)).toEqual([]);
  });

  it('a custom kind round-trips through a minutes file, and the released build carries it (AC5)', () => {
    const { ledger } = setup();
    const back = parseLedger(serialiseLedger(ledger));
    if (!back.ok) throw new Error(back.reason);
    expect(back.ledger.eventTypes.map((t) => [t.label, t.credited])).toEqual([
      ['Throw-in won', 'child'],
      ['Kick-off', 'team'],
    ]);
    const old = released.parseLedger(serialiseLedger(ledger));
    if (!old.ok) throw new Error(old.reason);
    const again = parseLedger(released.serialiseLedger(old.ledger));
    if (!again.ok) throw new Error(again.reason);
    const page = recordMatchPage(again.ledger, ledger.matches[0].id);
    expect(page?.tallies.map(tallyLineText)).toContain('2 Throw-in won: Ed 2');
    expect(page?.tallies.map(tallyLineText)).toContain('1 Kick-off');
  });
});

describe('core and tally are kept apart in every fold (#198 AC3–AC5)', () => {
  it('the match’s tallies hold no core kind; goals count as shots on target only where #202 says', () => {
    const { ledger, state } = setup();
    const lines = matchTallies(state.events, ledger.eventTypes, nameOf);
    expect(lines.map((l) => l.kind).some((k) => CORE_KINDS.includes(k))).toBe(false);
    expect(lines.map(tallyLineText)).toEqual([
      '1 shot on target: Flo 1',
      '1 save: Ada 1',
      '1 tackle: Ed 1',
      '2 Throw-in won: Ed 2',
      '1 Kick-off',
    ]);
    const withGoals = matchTalliesWithGoals(state.events, ledger.eventTypes, nameOf);
    expect(tallyLineText(withGoals[0])).toBe('2 shots on target: Cy 1, Flo 1');
  });

  it('tallies never feed the result, minutes or fairness', () => {
    const { ledger, state } = setup();
    const coreOnly = { ...state, events: (state.events ?? []).filter((e) => tierOf(e.kind) === 'core') };
    expect(scoreOf(state.events)).toEqual(scoreOf(coreOnly.events));
    expect(scoreFromEvents(ledger.matches[0].events)).toEqual({ us: 1, them: 0 });
    const plain = recordMatches(emptyLedger(squadId, 'Test FC', NOW), [coreOnly], players, 'Test FC', NOW);
    expect(foldLedger(ledger)).toEqual(foldLedger(plain));
  });

  it('the time stream names a coach’s own kind by its label', () => {
    const { ledger, state } = setup();
    const labels = new Map(tallyButtons(ledger.eventTypes).map((t) => [t.kind, t.label]));
    const text = timeStream(state.appearances, state.events, players, labels).map((r) => r.text);
    expect(text).toContain('Throw-in won: Ed');
    expect(text).toContain('Kick-off: team');
  });
});

describe('a tally button beside the clock subs (#198 with #203)', () => {
  it('recording a tally leaves the planned subs and their made state as they were, and reads in order on the stream', () => {
    let nowMs = Date.parse('2026-10-17T09:00:00Z');
    const engine = new MatchEngine({ nowFn: () => new Date(nowMs) });
    const format = makeFormat('2-3-1');
    const s = engine.createMatch(squadId, format.id, { totalMinutes: 20, quarterCount: 1 });
    const q = s.quarters[0];
    engine.startQuarter(s, q, toTeamSheet(sheetFromSelection(ids.slice(0, 7), ids[0], format)), format);
    const plan = planSubs([ids[7]], 20 * MIN);
    const saved = { quarterId: q.id, subs: plan.map(({ playerId, atMs, forPlayerId }) => ({ playerId, atMs, forPlayerId })) };
    nowMs += 4 * MIN;
    engine.recordTally(s, q, tallyKindOf(uuid()), ids[2]);
    expect(restoreSubPlan(saved, s)).toEqual([{ ...plan[0], done: false }]);
    nowMs += 6 * MIN;
    engine.substitute(s, q, ids[6], ids[7]);
    nowMs += 1 * MIN;
    const kind = tallyKindOf(uuid());
    engine.recordTally(s, q, kind, ids[7]);
    expect(restoreSubPlan(saved, s)).toEqual([{ ...plan[0], done: true }]);
    const stream = timeStream(s.appearances, s.events, players, new Map([[kind, 'Throw-in won']])).map((r) => r.text);
    expect(stream.slice(-2)).toEqual(['Sub: Hal on for Gil', 'Throw-in won: Hal']);
  });
});
