/**
 * Who's coming — #277 A1–A5, ADR-024 D1. Made-up names only (invariant 4).
 */

import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { AvailabilityStatus, UUID } from '../types/index';
import { makePlayer } from './squad';
import { makeFormat } from './shapes';
import { toTeamSheet, sheetFromSelection } from './teamSheet';
import { emptyLedger, recordMatches } from './ledger';
import { absentIds } from './absence';
import {
  changedLabel,
  comingOf,
  comingRows,
  comingSummary,
  nextComing,
  setComing,
  statusOf,
} from './whosComing';

const squadId = uuid();
const players = ['Ava', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal', 'Ivy'].map((n) => makePlayer(squadId, n));
const ids = players.map((p) => p.id);

describe("Who's coming: three states on the match's own availability (A2, D1)", () => {
  it('a tap moves Coming → Can’t → Not heard → Coming', () => {
    expect(nextComing('coming')).toBe('cant');
    expect(nextComing('cant')).toBe('notHeard');
    expect(nextComing('notHeard')).toBe('coming');
  });

  it('Coming is available, Can’t is unavailable, Not heard is unconfirmed', () => {
    expect(statusOf('coming')).toBe('available');
    expect(statusOf('cant')).toBe('unavailable');
    expect(statusOf('notHeard')).toBe('unconfirmed');
    // Here today or a correction may have set absent or injured: not coming either.
    expect(comingOf('absent')).toBe('cant');
    expect(comingOf('injured')).toBe('cant');
  });
});

describe('a new fixture starts with everyone Coming (A3, Rob 5 Nov), and an old one reads the same (A22)', () => {
  it('no list at all reads every active child as Coming', () => {
    expect(comingSummary(comingRows(undefined, players))).toBe('9 coming');
  });

  it('a retired child is not listed', () => {
    const retired = { ...players[8], active: false };
    expect(comingRows([], [...players.slice(0, 8), retired])).toHaveLength(8);
  });
});

describe('the summary reads "9 coming · 2 can’t · 1 not heard" (A1)', () => {
  it('counts each state, leaving out a state with none', () => {
    let list: [UUID, AvailabilityStatus][] = [];
    list = setComing(list, players, ids[0], 'cant');
    list = setComing(list, players, ids[1], 'cant');
    list = setComing(list, players, ids[2], 'notHeard');
    expect(comingSummary(comingRows(list, players))).toBe("6 coming · 2 can't · 1 not heard");
    expect(list).toHaveLength(9);
  });
});

describe('"changed Thu 20:14" (A4)', () => {
  it('names the day and the time', () => {
    const at = new Date(2026, 10, 5, 20, 14).getTime(); // Thursday 5 November 2026, local
    expect(changedLabel(at)).toBe('changed Thu 20:14');
  });
});

describe('Not heard never reaches the record (A5, D1, invariant 1)', () => {
  it('a child still unconfirmed at kick-off is unticked on Here today and recorded absent', () => {
    const engine = new MatchEngine({ nowFn: () => new Date(1_700_000_000_000) });
    const format = makeFormat('2-3-1');
    const state = engine.createMatch(squadId, format.id, {
      totalMinutes: 50,
      quarterCount: 2,
      availablePlayerIds: ids,
    });
    engine.setAvailability(state, ids[8], 'unconfirmed');
    // Here today starts from the list: Not heard is not ticked.
    expect(absentIds(state).has(ids[8])).toBe(true);
    const here = ids.slice(0, 8);
    engine.startQuarter(state, state.quarters[0], toTeamSheet(sheetFromSelection(here.slice(0, 7), here[0], format)), format);
    const ledger = recordMatches(emptyLedger(squadId, 'Test FC', new Date()), [state], players, 'Test FC', new Date());
    const statuses = ledger.matches[0].attendance!.map((a) => a.status);
    expect(statuses).not.toContain('unconfirmed');
    expect(ledger.matches[0].attendance!.find((a) => a.playerId === ids[8])!.status).toBe('absent');
  });
});
