/**
 * The record carries fixtures, settings and profiles; a phone is restored
 * from it — #195 AC2–AC7. A fill-in not counted in fairness — #190 AC1–AC6.
 *
 * Seasons are played through the real engine (the Test kit's season) and
 * recorded through the real ledger. Made-up first names only (invariant 4).
 */

import { describe, expect, it } from 'vitest';
import { uuid, type Format, type Player, type UUID } from '../types/index';
import {
  cancelFixture,
  emptyLedger,
  fairnessHistory,
  foldLedger,
  importLedger,
  isCountedInFairness,
  parseLedger,
  recordMatches,
  recordRemovedPlayers,
  serialiseLedger,
  setPlayerFairness,
  type Ledger,
} from './ledger';
import * as released from './fixtures/reader-1.2.0/ledger';

/** This build's matches, handed to the 1.2.0 reader as a 1.2.0 phone would hold them. */
const asReleased = (records: readonly unknown[]) => records as Parameters<typeof released.recordMatches>[1];
import { setupFrom } from './ledgerSetup';
import { newMatch } from './matchLifecycle';
import type { SavedMatch } from './persistence';
import { makeSevenASideFormat } from './placeholderSquad';
import { recordOnlyMatches } from './recordOnly';
import { PLANS_NOT_RESTORED, extendFromRecord, formatFromRecord, restoreFromRecord } from './recordRestore';
import { formatForShape } from './shapes';
import { makePlayer, removePlayer, restorePlayer } from './squad';
import { squadViews } from './squadViews';
import { addTestSeason } from './testSeason';
import { verifyChain } from './ledgerChain';

const NOW = new Date('2026-10-04T09:00:00Z');
const LATER = new Date('2026-10-05T09:00:00Z');

/** A phone with a played season, custom preferences, settings and two fixtures to come. */
function phone() {
  const squadId = uuid();
  const format = makeSevenASideFormat();
  const data = addTestSeason({
    players: [],
    matches: [],
    squadId,
    squadName: 'Test FC',
    format,
    totalMinutes: 50,
    periodCount: 4,
    ledger: emptyLedger(squadId, 'Test FC', NOW),
    now: NOW,
  });
  const players: Player[] = data.players.map((p, i) =>
    i === 2 ? { ...p, prefers: 'MID' as const, outfieldTargetPct: 75 } : p
  );
  const nextWeek = (opponent: string, days: number, shape: '2-3-1' | '2-2-2') =>
    newMatch(
      {
        squadId,
        format: formatForShape(shape, format),
        totalMinutes: 40,
        periodCount: 2,
        players,
        opponent,
        competition: 'cup',
        kickoffAt: new Date(NOW.getTime() + days * 86_400_000).toISOString(),
      },
      () => NOW
    ).stored;
  const fixtures = [nextWeek('Sample Rovers', 6, '2-3-1'), nextWeek('Mock Town', 13, '2-2-2')];
  const matches: SavedMatch[] = [...data.matches, ...fixtures];
  const settings = { format, totalMinutes: 60, periodCount: 2, buzzWhenSubDue: false };
  const setup = setupFrom({ players, matches, live: null, ...settings });
  const ledger = recordMatches(data.ledger as Ledger, matches, players, 'Test FC', NOW, setup);
  return { squadId, players, matches, fixtures, settings, ledger, format };
}

const recordsOf = (l: Ledger, type: string) => l.entries.flatMap((e) => e.records).filter((r) => r.type === type);

describe('fixtures, settings and profiles enter the record (#195 AC2, AC3, AC6)', () => {
  it('a save writes a fixture per match, a profile per child and the settings', () => {
    const p = phone();
    expect(p.ledger.fixtures.map((f) => f.id).sort()).toEqual(p.matches.map((m) => m.match.id).sort());
    expect(p.ledger.profiles).toHaveLength(p.players.length);
    expect(p.ledger.settings).toMatchObject({ totalMinutes: 60, periodCount: 2, buzzWhenSubDue: false, shape: '2-3-1' });
    const third = p.ledger.profiles.find((x) => x.playerId === p.players[2].id);
    expect(third).toMatchObject({ prefers: 'MID', outfieldTarget: 75, active: true, fairness: 'counted' });
  });

  it('an existing ledger is back-filled once, in one entry; saving again writes nothing (AC6)', () => {
    const p = phone();
    // As 1.2.0 left it: the same season recorded, with no setup records.
    const old = recordMatches(emptyLedger(p.squadId, 'Test FC', NOW), p.matches, p.players, 'Test FC', NOW);
    expect(old.fixtures).toEqual([]);
    const setup = setupFrom({ players: p.players, matches: p.matches, live: null, ...p.settings });
    const filled = recordMatches(old, p.matches, p.players, 'Test FC', LATER, setup);
    expect(filled.entries).toHaveLength(old.entries.length + 1);
    const types = new Set(filled.entries[filled.entries.length - 1].records.map((r) => r.type));
    expect([...types].sort()).toEqual(['fixture', 'profile', 'settings']);
    expect(filled.fixtures).toHaveLength(p.matches.length);
    expect(recordMatches(filled, p.matches, p.players, 'Test FC', LATER, setup)).toBe(filled);
  });

  it('a changed setting, preference or fixture is a new record; the earlier one stays (AC3)', () => {
    const p = phone();
    const players = p.players.map((x, i) => (i === 0 ? { ...x, keeper: 'never' as const } : x));
    const matches = p.matches.map((m) =>
      m.match.id === p.fixtures[0].match.id ? { ...m, archived: true } : m
    );
    const setup = setupFrom({ players, matches, live: null, ...p.settings, totalMinutes: 50 });
    const next = recordMatches(p.ledger, matches, players, 'Test FC', LATER, setup);
    const added = next.entries[next.entries.length - 1].records.filter((r) => r.type !== 'device');
    expect(added.map((r) => r.type).sort()).toEqual(['fixture', 'profile', 'settings']);
    expect(next.settings?.totalMinutes).toBe(50);
    expect(recordsOf(next, 'settings')).toHaveLength(2);
    expect(next.profiles.find((x) => x.playerId === players[0].id)?.keeperPreference).toBe('never');
  });

  it('deleting a fixture writes it cancelled; nothing is removed from the record (AC2)', () => {
    const p = phone();
    const id = p.fixtures[0].match.id;
    const next = cancelFixture(p.ledger, id, LATER);
    expect(next.fixtures.find((f) => f.id === id)?.state).toBe('cancelled');
    expect(recordsOf(next, 'fixture').filter((r) => r.id === id)).toHaveLength(2);
    expect(next.entries.slice(0, p.ledger.entries.length)).toEqual(p.ledger.entries);
    // A later save without it never brings it back.
    const rest = p.matches.filter((m) => m.match.id !== id);
    const setup = setupFrom({ players: p.players, matches: rest, live: null, ...p.settings });
    expect(recordMatches(next, rest, p.players, 'Test FC', LATER, setup)).toBe(next);
    expect(cancelFixture(next, id, LATER)).toBe(next);
  });
});

describe('restore from the record (#195 AC4, AC7 round trip)', () => {
  it('phone → minutes file → an empty phone gives the same squad, settings, fixtures and Played', () => {
    const p = phone();
    const file = parseLedger(serialiseLedger(p.ledger));
    if (!file.ok) throw new Error(file.reason);
    const empty = emptyLedger(uuid(), 'My team', LATER);
    const imported = importLedger(empty, file.ledger);
    if (!imported.ok) throw new Error(imported.reason);

    const r = restoreFromRecord(imported.ledger, uuid(), makeSevenASideFormat(), LATER);
    expect(r.squadId).toBe(p.squadId);
    expect(r.squadName).toBe('Test FC');
    const strip = (x: Player) => [x.id, x.firstName, x.active, x.keeper ?? null, x.prefers ?? null, x.outfieldTargetPct ?? null];
    expect(r.players.map(strip)).toEqual(p.players.map(strip));
    expect(r.settings).toMatchObject({ totalMinutes: 60, periodCount: 2, buzzWhenSubDue: false });
    expect(r.settings?.format.positions.map((x) => x.label)).toEqual(p.format.positions.map((x) => x.label));

    // Fixtures: the planned ones, same ids, opponents, dates, lengths and shapes.
    const fx = (m: SavedMatch) => [m.match.id, m.match.opponent, m.match.kickoffAt, m.match.totalMinutes, m.match.quarterCount, m.match.status];
    expect(r.fixtures.map(fx)).toEqual(p.fixtures.map(fx));
    expect(r.fixtures[1].format?.positions.filter((x) => x.unit === 'ATT')).toHaveLength(2); // 2-2-2
    expect(r.fixtures.every((m) => m.plan === undefined)).toBe(true);
    expect(PLANS_NOT_RESTORED).toMatch(/not/);

    // Played: every played match of the source phone, from the record.
    const sourcePlayed = p.matches.filter((m) => m.match.status === 'completed').map((m) => m.match.id).sort();
    const restoredPlayed = recordOnlyMatches(imported.ledger, new Set(r.fixtures.map((m) => m.match.id)))
      .map((m) => m.id)
      .sort();
    expect(restoredPlayed).toEqual(sourcePlayed);
  });

  it('a cancelled fixture and a child taken out before playing are not restored', () => {
    const p = phone();
    const extra = makePlayer(p.squadId, 'Zed');
    let l = recordMatches(p.ledger, p.matches, [...p.players, extra], 'Test FC', NOW, setupFrom({ players: [...p.players, extra], matches: p.matches, live: null, ...p.settings }));
    const after = removePlayer([...p.players, extra], extra.id, new Set());
    expect(after.some((x) => x.id === extra.id)).toBe(false);
    l = recordRemovedPlayers(l, [extra.id], LATER);
    l = cancelFixture(l, p.fixtures[0].match.id, LATER);
    const r = restoreFromRecord(l, uuid(), makeSevenASideFormat(), LATER);
    expect(r.players.some((x) => x.id === extra.id)).toBe(false);
    expect(r.fixtures.map((m) => m.match.id)).toEqual([p.fixtures[1].match.id]);
  });

  it('a ledger from before 1.3.0 still restores its squad, with no settings or fixtures', () => {
    const p = phone();
    const old = recordMatches(emptyLedger(p.squadId, 'Test FC', NOW), p.matches, p.players, 'Test FC', NOW);
    const r = restoreFromRecord(old, uuid(), makeSevenASideFormat(), LATER);
    expect(r.players).toHaveLength(p.players.length);
    expect(r.settings).toBeNull();
    expect(r.fixtures).toEqual([]);
  });

  it('an unknown shape falls back, and labels apply only when they fit', () => {
    const f: Format = formatFromRecord('3-2-1', ['a', 'b']);
    expect(f.positions.length).toBe(7);
    expect(formatFromRecord('2-2-2', ['K', 'L', 'R', 'M', 'N', 'S', 'T']).positions.map((x) => x.label)).toEqual([
      'K', 'L', 'R', 'M', 'N', 'S', 'T',
    ]);
  });
});

describe('import onto a phone with data adds, never overwrites (#195 AC5)', () => {
  it('missing players and fixtures are added; what is there is untouched', () => {
    const p = phone();
    const mine = p.players.slice(0, 3).map((x) => ({ ...x, keeper: 'never' as const }));
    const myMatches = [p.fixtures[0]];
    const x = extendFromRecord(p.ledger, mine, myMatches, p.squadId, p.format, LATER);
    expect(x.players.slice(0, 3)).toEqual(mine);
    expect(x.addedPlayers).toBe(p.players.length - 3);
    expect(x.matches[0]).toBe(p.fixtures[0]);
    expect(x.addedFixtures).toBe(1);
    expect(x.matches.map((m) => m.match.id)).toEqual([p.fixtures[0].match.id, p.fixtures[1].match.id]);
    // Nothing to add the second time.
    const again = extendFromRecord(p.ledger, x.players, x.matches, p.squadId, p.format, LATER);
    expect(again.addedPlayers + again.addedFixtures).toBe(0);
  });
});

describe('the released 1.2.0 parser reads a ledger with the new records (#195 AC7, ADR-021 D1)', () => {
  it('parses, verifies, gives the same minutes, and carries the records through its own save', () => {
    const p = phone();
    const fairness = setPlayerFairness(p.ledger, p.players[1].id, false, 'Fill-in from the U11s', LATER);
    if (!fairness.ok) throw new Error(fairness.reason);
    const text = serialiseLedger(cancelFixture(fairness.ledger, p.fixtures[0].match.id, LATER));
    const old = released.parseLedger(text);
    if (!old.ok) throw new Error(old.reason);
    expect(verifyChain(old.ledger.entries)).toEqual({ ok: true });
    expect(released.foldLedger(old.ledger)).toEqual(foldLedger(fairness.ledger));
    // The released build records over it and the new records ride along.
    const written = released.recordMatches(old.ledger, asReleased(p.matches), p.players, 'Test FC', LATER);
    const back = parseLedger(released.serialiseLedger(written));
    if (!back.ok) throw new Error(back.reason);
    expect(back.ledger.fixtures.find((f) => f.id === p.fixtures[0].match.id)?.state).toBe('cancelled');
    expect(isCountedInFairness(back.ledger, p.players[1].id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #190: not counted in fairness
// ---------------------------------------------------------------------------

describe('a fill-in not counted in fairness (#190)', () => {
  const fillIn = (l: Ledger, id: UUID) => {
    const r = setPlayerFairness(l, id, false, 'Fill-in from the U11s', LATER);
    if (!r.ok) throw new Error(r.reason);
    return r.ledger;
  };

  it('needs a note, is a new record, and is kept with the child’s history (AC4)', () => {
    const p = phone();
    const id = p.players[1].id;
    expect(setPlayerFairness(p.ledger, id, false, '  ', LATER)).toEqual({ ok: false, reason: 'A change needs a note saying why.' });
    const marked = fillIn(p.ledger, id);
    expect(marked.entries.slice(0, p.ledger.entries.length)).toEqual(p.ledger.entries);
    expect(isCountedInFairness(marked, id)).toBe(false);
    expect(setPlayerFairness(marked, id, false, 'again', LATER).ok).toBe(false);
    const cleared = setPlayerFairness(marked, id, true, 'Joined the squad', LATER);
    if (!cleared.ok) throw new Error(cleared.reason);
    expect(isCountedInFairness(cleared.ledger, id)).toBe(true);
    expect(fairnessHistory(cleared.ledger, id).map((h) => [h.counted, h.note])).toEqual([
      [false, 'Fill-in from the U11s'],
      [true, 'Joined the squad'],
    ]);
  });

  it('a later save never clears the mark, even when it writes their profile again', () => {
    const p = phone();
    const id = p.players[1].id;
    const marked = fillIn(p.ledger, id);
    const players = p.players.map((x) => (x.id === id ? { ...x, keeper: 'backup' as const } : x));
    const next = recordMatches(marked, p.matches, players, 'Test FC', LATER, setupFrom({ players, matches: p.matches, live: null, ...p.settings }));
    expect(next).not.toBe(marked);
    expect(isCountedInFairness(next, id)).toBe(false);
    expect(fairnessHistory(next, id)).toHaveLength(1);
  });

  it('is left out of the squad average, the fairness figures and owed time; their own minutes stay (AC2, AC3, AC6)', () => {
    const p = phone();
    const child = p.players.find((x) => x.keeper !== 'main') as Player;
    const before = squadViews(p.ledger, p.players);
    const after = squadViews(fillIn(p.ledger, child.id), p.players);

    const mine = (v: typeof before) => v.season.children.find((c) => c.playerId === child.id);
    // Their own season is unchanged and shown.
    expect(mine(after)?.averageMs).toBe(mine(before)?.averageMs);
    expect(mine(after)?.played).toBe(mine(before)?.played);
    expect(mine(after)?.fillIn).toBe(true);

    // The average is computed without them.
    const counted = before.season.children.filter((c) => !c.mainKeeper && c.playerId !== child.id && c.averageMs !== null);
    const expected = Math.round(counted.reduce((s, c) => s + (c.averageMs as number), 0) / counted.length);
    expect(after.season.squadAverageMs).toBe(expected);
    expect(after.season.squadAverageMs).not.toBe(before.season.squadAverageMs);

    expect(after.fairness?.rows.find((r) => r.playerId === child.id)?.offset).toBeNull();
    expect(after.fairness?.fillIns).toEqual([mine(after)?.name]);
    expect(after.owed.find((r) => r.playerId === child.id)?.owed).toBeNull();

    // Match totals still add up: the minutes in the record are the same.
    expect(foldLedger(fillIn(p.ledger, child.id))).toEqual(foldLedger(p.ledger));
    expect(after.grid.find((r) => r.playerId === child.id)).toEqual(before.grid.find((r) => r.playerId === child.id));
  });

  it('a child retired as a stopgap is brought back and marked, without losing a minute (AC5)', () => {
    const p = phone();
    const child = p.players[3];
    const retired = removePlayer(p.players, child.id, new Set([child.id]));
    let l = recordMatches(p.ledger, p.matches, retired, 'Test FC', NOW, setupFrom({ players: retired, matches: p.matches, live: null, ...p.settings }));
    const minutes = foldLedger(l).find((t) => t.playerId === child.id);
    const back = restorePlayer(retired, child.id);
    l = recordMatches(l, p.matches, back, 'Test FC', NOW, setupFrom({ players: back, matches: p.matches, live: null, ...p.settings }));
    l = fillIn(l, child.id);
    expect(foldLedger(l).find((t) => t.playerId === child.id)).toEqual(minutes);
    expect(squadViews(l, back).season.children.find((c) => c.playerId === child.id)?.fillIn).toBe(true);
  });
});
