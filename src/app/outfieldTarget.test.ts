/**
 * Tests for the outfield-share target — #101 AC2, ADR-015 §3.
 *
 * The target is shown beside a player's figures as on track or below. It is
 * never a fairness input: the last test proves the lineup suggestion and the
 * fairness table ignore it.
 */

import { describe, it, expect } from 'vitest';
import { uuid } from '../types/index';
import type { MatchStatus, Player, UUID } from '../types/index';
import { emptyLedger, type Ledger, type LedgerMatch } from './ledger';
import { makePlayer, preferenceSummary } from './squad';
import { makeFormat } from './shapes';
import { fairnessTable, suggestLineup } from './lineup';
import type { PlayerMinutes } from './playerMinutes';
import {
  createMemoryStore,
  loadSession,
  saveSession,
} from './persistence';
import {
  outfieldShare,
  seasonOutfieldShares,
  setOutfieldTarget,
  shareLabel,
  targetOf,
} from './outfieldTarget';

const MIN = 60_000;

function match(status: MatchStatus, rows: [UUID, 'goalkeeper' | 'outfield', number][]): LedgerMatch {
  let at = 0;
  return {
    id: uuid(),
    kickoffAt: null,
    opponent: null,
    competition: null,
    totalMinutes: 50,
    periodCount: 2,
    status,
    intervals: rows.map(([playerId, kind, mins]) => {
      const startMs = at;
      at += mins * MIN;
      return {
        id: uuid(),
        playerId,
        period: 1,
        kind,
        unit: kind === 'goalkeeper' ? 'GK' : 'MID',
        startMs,
        endMs: startMs + mins * MIN,
        corrected: false,
        note: null,
      };
    }),
  };
}

describe('outfieldShare', () => {
  it('reads on track at or above the target and below under it', () => {
    expect(outfieldShare(10 * MIN, 30 * MIN, 25)).toEqual({ sharePct: 25, targetPct: 25, status: 'on-track' });
    expect(outfieldShare(5 * MIN, 35 * MIN, 25)).toEqual({ sharePct: 13, targetPct: 25, status: 'below' });
  });

  it('compares the exact share, not the rounded one', () => {
    // 24.6% shows as 25 but is under a 25% target.
    const s = outfieldShare(246, 754, 25);
    expect(s.sharePct).toBe(25);
    expect(s.status).toBe('below');
  });

  it('says nothing before any pitch time, and nothing with no target', () => {
    expect(outfieldShare(0, 0, 25).status).toBeNull();
    expect(outfieldShare(0, 0, 25).sharePct).toBeNull();
    expect(outfieldShare(10 * MIN, 0, null)).toEqual({ sharePct: 100, targetPct: null, status: null });
  });
});

describe('the target on the player', () => {
  const squadId = uuid();
  const players = [makePlayer(squadId, 'Kim'), makePlayer(squadId, 'Sam')];

  it('is optional: a player saved before it existed has no target', () => {
    expect(targetOf(players[0])).toBeNull();
    expect('outfieldTargetPct' in players[0]).toBe(false);
  });

  it('is set and cleared on one player only, as a whole 1–100', () => {
    const set = setOutfieldTarget(players, players[0].id, 25);
    expect(targetOf(set[0])).toBe(25);
    expect(targetOf(set[1])).toBeNull();
    expect(targetOf(setOutfieldTarget(set, players[0].id, null)[0])).toBeNull();
    expect(targetOf(setOutfieldTarget(players, players[0].id, 120)[0])).toBeNull();
    expect(targetOf(setOutfieldTarget(players, players[0].id, 12.5)[0])).toBeNull();
  });

  it('shows in the squad list summary', () => {
    const p = { ...players[0], keeper: 'main' as const, outfieldTargetPct: 25 };
    expect(preferenceSummary(p)).toBe('Main keeper · Outfield 25%');
  });

  it('survives a save and reload with no schema change (additive field)', async () => {
    const store = createMemoryStore();
    const format = makeFormat('2-3-1');
    const withTarget = setOutfieldTarget(players, players[0].id, 25);
    await saveSession(store, {
      squadName: 'Test FC',
      squadId,
      players: withTarget,
      format,
      totalMinutes: 50,
      periodCount: 2,
      plan: {},
      state: null,
    });
    const saved = (await loadSession(store))!;
    expect(saved.players.find((p) => p.id === players[0].id)!.outfieldTargetPct).toBe(25);
    expect(targetOf(saved.players.find((p) => p.id === players[1].id))).toBeNull();
  });
});

describe('seasonOutfieldShares', () => {
  it('counts completed matches only (ADR-015 §6)', () => {
    const squadId = uuid();
    const kim: Player = { ...makePlayer(squadId, 'Kim'), outfieldTargetPct: 25 };
    const ledger: Ledger = {
      ...emptyLedger(squadId, 'Test FC'),
      players: [{ id: kim.id, firstName: 'Kim', displaySuffix: null, active: true }],
      matches: [
        match('completed', [[kim.id, 'goalkeeper', 40], [kim.id, 'outfield', 10]]),
        // Abandoned: all outfield, would lift Kim to on track if counted.
        match('abandoned', [[kim.id, 'outfield', 50]]),
      ],
    };
    const share = seasonOutfieldShares(ledger, [kim]).get(kim.id)!;
    expect(share.sharePct).toBe(20);
    expect(share.status).toBe('below');
    expect(shareLabel(share)).toBe('Outfield 20% · target 25% · below');
  });

  it('labels nothing for a player with no target', () => {
    const squadId = uuid();
    const sam = makePlayer(squadId, 'Sam');
    const ledger: Ledger = {
      ...emptyLedger(squadId, ''),
      matches: [match('completed', [[sam.id, 'outfield', 10]])],
    };
    expect(shareLabel(seasonOutfieldShares(ledger, [sam]).get(sam.id))).toBe('');
  });
});

describe('never a fairness input (invariant 3)', () => {
  it('leaves the lineup suggestion and the fairness table unchanged', () => {
    const squadId = uuid();
    const format = makeFormat('2-3-1');
    const base = Array.from({ length: 9 }, (_, i) => makePlayer(squadId, `P${i}`));
    const minutes: PlayerMinutes[] = base.map((p, i) => ({
      playerId: p.id,
      outfieldMs: i * MIN,
      goalkeeperMs: i === 0 ? 20 * MIN : 0,
      totalMs: i * MIN + (i === 0 ? 20 * MIN : 0),
      benchMs: 0,
      onPitchNow: false,
      currentStintMs: 0,
    }));
    const targeted = base.map((p) => ({ ...p, outfieldTargetPct: 75 }));
    expect(suggestLineup(targeted, minutes, format)).toEqual(suggestLineup(base, minutes, format));
    expect(fairnessTable(targeted, minutes)).toEqual(fairnessTable(base, minutes));
  });
});
