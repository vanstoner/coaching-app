/**
 * Matching children on import — #195, QA finding N1 on 1.3.0. Criteria 1–36
 * on #195 (Bea's 1–32, and Q1–Q4 settled as 33–36); Ada's design on #195.
 * Invented first names only (invariant 4).
 */

import { describe, expect, it } from 'vitest';
import type { Player, UUID } from '../types/index';
import { uuid } from '../types/index';
import {
  describeImport,
  emptyLedger,
  fairnessHistory,
  foldLedger,
  importLedger,
  parseLedger,
  recordMatches,
  recordRemovedPlayers,
  serialiseLedger,
  setPlayerFairness,
  type ImportResult,
  type Ledger,
  type LedgerRecord,
} from './ledger';
import { latestRecords } from './ledgerChain';
import { setupFrom } from './ledgerSetup';
import { loadMadeUpTeam } from './gettingStarted';
import { newMatch } from './matchLifecycle';
import type { SavedMatch } from './persistence';
import { makeSevenASideFormat } from './placeholderSquad';
import { extendFromRecord, restoreFromRecord } from './recordRestore';
import { makePlayer } from './squad';
import {
  HELD_MATCH_REFUSAL,
  SQUAD_OPTIONS,
  importChoice,
  matchSquads,
  planImport,
  rekeySession,
  type SquadOption,
} from './squadMatch';
import * as released from './fixtures/reader-1.2.0/ledger';

const NOW = new Date('2026-10-20T10:00:00Z');
const IMPORT_AT = new Date('2026-10-23T09:00:00Z');
const LATER = new Date('2026-10-23T10:00:00Z');
const format = makeSevenASideFormat();
const TEN = ['Ava', 'Ben', 'Cara', 'Dan', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jo'];

type Kid = string | { name: string; suffix?: string | null; edit?: (p: Player) => Player };

interface Side {
  ledger: Ledger;
  players: Player[];
  squadId: UUID;
}

/** A squad typed in and saved, nothing played: what a phone (or a file) holds. */
function squad(kids: Kid[], label = 'Phone', opts: { profiles?: boolean } = {}): Side {
  const squadId = uuid();
  const players = kids.map((k) => {
    const p = typeof k === 'string' ? makePlayer(squadId, k) : makePlayer(squadId, k.name, k.suffix ?? null);
    return typeof k === 'string' || !k.edit ? p : k.edit(p);
  });
  const setup =
    opts.profiles === false
      ? undefined
      : setupFrom({ players, matches: [], live: null, format, totalMinutes: 50, periodCount: 4, buzzWhenSubDue: true });
  const ledger = recordMatches(emptyLedger(squadId, label, NOW), [], players, label, NOW, setup);
  return { ledger, players, squadId };
}

const byName = (side: Side, name: string) => side.players.find((p) => p.firstName.trim() === name) as Player;

const okL = (r: { ok: true; ledger: Ledger } | { ok: false; reason: string }): Ledger => {
  if (!r.ok) throw new Error(r.reason);
  return r.ledger;
};

/** importMinutes, without React: plan, choose, import, re-key, extend. */
function runImport(phone: Side, file: Ledger, option: SquadOption, matches: SavedMatch[] = []) {
  const plan = planImport({ ours: phone.ledger, file, players: phone.players, matchHeld: false });
  const matching = plan.kind === 'step' ? plan.matching : null;
  const choice = matching ? importChoice(matching, option) : undefined;
  const result = importLedger(phone.ledger, file, choice, IMPORT_AT);
  if (!result.ok) throw new Error(result.reason);
  const session = rekeySession(phone.players, matches, choice, result.ledger, phone.squadId, IMPORT_AT);
  const x = extendFromRecord(result.ledger, session.players, session.matches, phone.squadId, format, IMPORT_AT);
  const restored = restoreFromRecord(result.ledger, phone.squadId, format, IMPORT_AT).players;
  return { plan, matching, choice, result: result as Extract<ImportResult, { ok: true }>, ledger: result.ledger, session: x, restored };
}

const allRecords = (l: Ledger) => l.entries.flatMap((e) => e.records);
const recordsFor = (l: Ledger, type: string, playerId: string) =>
  allRecords(l).filter((r) => r.type === type && (r.playerId === playerId || r.id === playerId));
const names = (ps: { firstName: string }[]) => ps.map((p) => p.firstName);
const dupes = (ns: string[]) => ns.filter((n, i) => ns.indexOf(n) !== i);

/** The entries the import appended after the file's chain and the carried phone records. */
function lastEntryRecords(l: Ledger): LedgerRecord[] {
  return l.entries[l.entries.length - 1].records.filter((r) => r.type !== 'device');
}

// --- A. The healthy case ------------------------------------------------------

describe('A. the healthy case', () => {
  it('criterion 1: ten typed children (Ava to Jo) and a file of the same ten give ten, not twenty', () => {
    const phone = squad(TEN);
    const file = squad(TEN, 'File');
    const run = runImport(phone, file.ledger, 'match');
    expect(run.plan.kind).toBe('step');
    expect(run.matching?.pairs.map((p) => p.file.firstName)).toEqual(TEN);
    expect(run.restored).toHaveLength(10);
    expect(run.session.players.filter((p) => p.active)).toHaveLength(10);
    const fileIds = new Set(file.players.map((p) => p.id));
    expect(run.session.players.every((p) => fileIds.has(p.id))).toBe(true);
    expect(dupes(names(run.session.players))).toEqual([]);
    expect(dupes(names(run.restored))).toEqual([]);
  });

  it('QA N1 regression: a file holding a played season and the same ten typed in give ten, not twenty', () => {
    // QA's probe (dupes.test.ts), as a test: the file is phone A's made-up season, played matches and all.
    const sqA = uuid();
    const file = loadMadeUpTeam({
      players: [],
      matches: [],
      squadId: sqA,
      squadName: 'A',
      format,
      totalMinutes: 50,
      periodCount: 4,
      ledger: emptyLedger(sqA, 'A', NOW),
      now: NOW,
    }).ledger as Ledger;
    expect(file.players).toHaveLength(10);
    expect(file.matches.length).toBeGreaterThan(0);
    const phone = squad(file.players.map((p) => p.firstName));
    const run = runImport(phone, file, 'match');

    expect(run.plan.kind).toBe('step');
    expect(run.matching?.pairs).toHaveLength(10);
    expect(run.restored).toHaveLength(10);
    expect(run.session.players).toHaveLength(10);
    expect(run.session.players.filter((p) => p.active)).toHaveLength(10);
    const fileIds = new Set(file.players.map((p) => p.id));
    expect(run.session.players.every((p) => fileIds.has(p.id))).toBe(true);
    expect(dupes(names(run.session.players))).toEqual([]);
    expect(dupes(names(run.restored))).toEqual([]);
  });

  it('criterion 2: a partly matching squad keeps Kit and adds Lola and Max (11)', () => {
    const eight = TEN.slice(0, 8);
    const phone = squad([...eight, 'Kit']);
    const file = squad([...eight, 'Lola', 'Max'], 'File');
    const run = runImport(phone, file.ledger, 'match');
    expect(run.matching?.pairs.map((p) => p.phone.firstName)).toEqual(eight);
    expect(names(run.matching?.fileOnly ?? [])).toEqual(['Lola', 'Max']);
    expect(names(run.matching?.phoneOnly ?? [])).toEqual(['Kit']);
    expect(run.session.players).toHaveLength(11);
    const kit = run.session.players.find((p) => p.firstName === 'Kit');
    expect(kit?.id).toBe(byName(phone, 'Kit').id);
    expect(kit?.active).toBe(true);
    for (const n of eight) expect(run.session.players.find((p) => p.firstName === n)?.id).toBe(byName(file, n).id);
    expect(run.restored).toHaveLength(11);
  });

  it('criterion 3: three choices, Match by name first and recommended; the file spelling wins', () => {
    expect(SQUAD_OPTIONS.map((o) => o.label)).toEqual(['Match by name', "Use the file's squad", 'Keep both']);
    expect(SQUAD_OPTIONS[0].option).toBe('match');
    expect(SQUAD_OPTIONS[0].hint).toMatch(/^Recommended/);
    const phone = squad([' ava ', 'Ben']);
    const file = squad(['Ava', 'Ben'], 'File');
    const run = runImport(phone, file.ledger, 'match');
    const pair = run.matching?.pairs.find((p) => p.file.firstName === 'Ava');
    expect(pair?.phone.firstName).toBe(' ava '); // the step shows "ava → Ava" from these two
    expect(run.session.players.find((p) => p.id === byName(file, 'Ava').id)?.firstName).toBe('Ava');
    expect(run.ledger.players.find((p) => p.id === byName(file, 'Ava').id)?.firstName).toBe('Ava');
  });

  it('criterion 4: the confirmation reads "8 matched, 2 added"', () => {
    const eight = TEN.slice(0, 8);
    const run = runImport(squad([...eight, 'Kit']), squad([...eight, 'Lola', 'Max'], 'File').ledger, 'match');
    expect(describeImport(run.result)).toMatch(/^8 matched, 2 added\./);
    expect(run.result.addedPlayers).toBe(2);
  });

  it('criterion 5: Cancel imports nothing (nothing is applied before a choice)', () => {
    const phone = squad(TEN);
    const before = serialiseLedger(phone.ledger);
    const plan = planImport({ ours: phone.ledger, file: squad(TEN, 'File').ledger, players: phone.players, matchHeld: false });
    expect(plan.kind).toBe('step');
    // Planning is pure: the phone's ledger and squad are untouched until a choice is applied.
    expect(serialiseLedger(phone.ledger)).toBe(before);
    expect(phone.players).toHaveLength(10);
  });
});

// --- B. The three choices -------------------------------------------------------

describe('B. the three choices', () => {
  it('criterion 6: Match by name appends one entry at import time with a noted removal per matched child', () => {
    const eight = TEN.slice(0, 8);
    const phone = squad([...eight, 'Kit']);
    const file = squad([...eight, 'Lola', 'Max'], 'File');
    const run = runImport(phone, file.ledger, 'match');
    const last = run.ledger.entries[run.ledger.entries.length - 1];
    expect(last.at).toBe(IMPORT_AT.toISOString());
    const recs = lastEntryRecords(run.ledger);
    const removals = recs.filter((r) => r.type === 'profile' && r.removed === true);
    expect(removals).toHaveLength(8);
    for (const n of eight) {
      const r = removals.find((x) => x.playerId === byName(phone, n).id);
      expect(r?.matchedTo).toBe(byName(file, n).id);
      expect(r?.note).toBe(`Matched to the file's ${n} on import`);
    }
    expect(recs.some((r) => r.playerId === byName(phone, 'Kit').id)).toBe(false);
    // Only one entry is dated at import time.
    expect(run.ledger.entries.filter((e) => e.at === IMPORT_AT.toISOString())).toHaveLength(1);
  });

  it("criterion 7: Use the file's squad removes Kit with a note and no matchedTo (10 left)", () => {
    const eight = TEN.slice(0, 8);
    const phone = squad([...eight, 'Kit']);
    const run = runImport(phone, squad([...eight, 'Lola', 'Max'], 'File').ledger, 'file');
    const kit = lastEntryRecords(run.ledger).find((r) => r.playerId === byName(phone, 'Kit').id);
    expect(kit?.removed).toBe(true);
    expect(kit?.note).toBe('Not in the imported squad');
    expect('matchedTo' in (kit ?? {})).toBe(false);
    expect(lastEntryRecords(run.ledger).filter((r) => r.removed === true)).toHaveLength(9);
    expect(run.session.players).toHaveLength(10);
    expect(names(run.session.players)).not.toContain('Kit');
    expect(names(run.restored)).not.toContain('Kit');
    expect(run.restored).toHaveLength(10);
  });

  it('criterion 8: Keep both is the import as it was, and no choice gives the same', () => {
    const phone = squad(TEN);
    const file = squad(TEN, 'File');
    const plain = importLedger(phone.ledger, file.ledger);
    const both = runImport(phone, file.ledger, 'both');
    expect(both.choice).toBeUndefined();
    expect(serialiseLedger(both.ledger)).toBe(serialiseLedger(okL(plain)));
    expect(allRecords(both.ledger).some((r) => 'matchedTo' in r)).toBe(false);
    expect(both.session.players).toHaveLength(20);
    // An empty choice is no choice too.
    const empty = importLedger(phone.ledger, file.ledger, { matched: [], leaving: [] }, IMPORT_AT);
    expect(serialiseLedger(okL(empty))).toBe(serialiseLedger(okL(plain)));
  });
});

// --- C. The matching rule ---------------------------------------------------------

describe('C. the matching rule', () => {
  it('criterion 9: case and spaces are ignored', () => {
    const m = matchSquads(squad([' ava ', 'Mia  Rose']).players, squad(['Ava', 'Mia Rose'], 'File').ledger);
    expect(m.pairs.map((p) => p.file.firstName)).toEqual(['Ava', 'Mia Rose']);
  });

  it('criterion 10: accents are not ignored', () => {
    const m = matchSquads(squad(['Zoe']).players, squad(['Zoë'], 'File').ledger);
    expect(m.pairs).toEqual([]);
    expect(names(m.phoneOnly)).toEqual(['Zoe']);
    expect(names(m.fileOnly)).toEqual(['Zoë']);
  });

  it('criterion 11: suffixes must agree', () => {
    const phone = squad([{ name: 'Sam', suffix: 'A' }, { name: 'Sam', suffix: 'B' }]);
    const file = squad([{ name: 'Sam', suffix: 'A' }, { name: 'Sam', suffix: 'B' }], 'File');
    const m = matchSquads(phone.players, file.ledger);
    expect(m.pairs.map((p) => [p.phone.displaySuffix, p.file.displaySuffix])).toEqual([
      ['A', 'A'],
      ['B', 'B'],
    ]);
    const n = matchSquads(squad(['Sam']).players, squad([{ name: 'Sam', suffix: 'B' }], 'File').ledger);
    expect(n.pairs).toEqual([]);
    expect(n.phoneOnly).toHaveLength(1);
    expect(n.fileOnly).toHaveLength(1);
  });

  it('criterion 12: a child removed in the file is not a candidate', () => {
    const file = squad(['Cara', 'Ben'], 'File');
    const removedFile = recordRemovedPlayers(file.ledger, [byName(file, 'Cara').id], NOW);
    const phone = squad(['Cara', 'Ben']);
    const m = matchSquads(phone.players, removedFile);
    expect(names(m.phoneOnly)).toEqual(['Cara']);
    expect(m.pairs.map((p) => p.file.firstName)).toEqual(['Ben']);

    const byMatch = runImport(phone, removedFile, 'match');
    expect(byMatch.session.players.find((p) => p.firstName === 'Cara')?.id).toBe(byName(phone, 'Cara').id);
    const byFile = runImport(phone, removedFile, 'file');
    expect(names(byFile.session.players)).not.toContain('Cara');
    const cara = lastEntryRecords(byFile.ledger).find((r) => r.playerId === byName(phone, 'Cara').id);
    expect(cara?.note).toBe('Not in the imported squad');

    // A removed Cara and a candidate Cara: the removed one does not count against uniqueness.
    const two = squad(['Cara', 'Cara'], 'File');
    const oneRemoved = recordRemovedPlayers(two.ledger, [two.players[0].id], NOW);
    const k = matchSquads(squad(['Cara']).players, oneRemoved);
    expect(k.pairs.map((p) => p.file.id)).toEqual([two.players[1].id]);
  });
});

// --- D. Duplicate names --------------------------------------------------------------

describe('D. duplicate names', () => {
  it('criterion 13: a name twice on the phone is never guessed', () => {
    const phone = squad(['Sam', 'Sam', 'Ava']);
    const file = squad(['Sam', 'Ava'], 'File');
    const m = matchSquads(phone.players, file.ledger);
    expect(m.pairs.map((p) => p.file.firstName)).toEqual(['Ava']);
    expect(m.notMatched.map((x) => [x.side, x.name])).toEqual([
      ['phone', 'Sam'],
      ['phone', 'Sam'],
      ['file', 'Sam'],
    ]);
    const run = runImport(phone, file.ledger, 'match');
    const sams = run.session.players.filter((p) => p.firstName === 'Sam').map((p) => p.id);
    expect(sams).toEqual([phone.players[0].id, phone.players[1].id, byName(file, 'Sam').id]);
  });

  it('criterion 14: a name twice in the file is the same', () => {
    const phone = squad(['Sam', 'Ava']);
    const file = squad(['Sam', 'Sam', 'Ava'], 'File');
    const m = matchSquads(phone.players, file.ledger);
    expect(m.pairs.map((p) => p.file.firstName)).toEqual(['Ava']);
    expect(m.notMatched.map((x) => x.side)).toEqual(['phone', 'file', 'file']);
    const run = runImport(phone, file.ledger, 'match');
    expect(run.session.players.filter((p) => p.firstName === 'Sam')).toHaveLength(3);
  });

  it('criterion 15: duplicates are counted on the name key', () => {
    const m = matchSquads(squad(['Ava', 'ava ']).players, squad(['Ava'], 'File').ledger);
    expect(m.pairs).toEqual([]);
    expect(m.notMatched).toHaveLength(3);
  });
});

// --- E. Edge cases ------------------------------------------------------------------

describe('E. edge cases', () => {
  it('criterion 16: a noted fill-in on the phone, counted in the file, crosses onto the file id', () => {
    const phone = squad(['Ben', 'Ava']);
    phone.ledger = okL(setPlayerFairness(phone.ledger, byName(phone, 'Ben').id, false, 'Fill-in from U9s', NOW));
    const file = squad(['Ben', 'Ava'], 'File');
    const fileBen = byName(file, 'Ben').id;
    const m = matchSquads(phone.players, file.ledger, phone.ledger);
    expect(m.pairs.find((p) => p.file.id === fileBen)?.notes).toEqual(['fill-in on this phone, counted in the file']);
    const run = runImport(phone, file.ledger, 'match');
    const crossed = lastEntryRecords(run.ledger).find((r) => r.type === 'profile' && r.playerId === fileBen);
    const fileLatest = latestRecords(file.ledger.entries).get(`profile:${fileBen}`) as LedgerRecord;
    expect(crossed).toEqual({ ...fileLatest, fairness: 'not-counted', note: 'Fill-in from U9s' });
    const history = fairnessHistory(run.ledger, fileBen);
    expect(history[history.length - 1]).toMatchObject({ counted: false, note: 'Fill-in from U9s' });
    expect(run.ledger.profiles.find((p) => p.playerId === fileBen)?.fairness).toBe('not-counted');
  });

  it('criterion 17: only a noted mark crosses; the file’s preferences stand', () => {
    const phone = squad([{ name: 'Ben', edit: (p) => ({ ...p, keeper: 'main', outfieldTargetPct: 80, prefers: 'ATT' }) }]);
    const file = squad([{ name: 'Ben', edit: (p) => ({ ...p, keeper: 'never', outfieldTargetPct: 50, prefers: 'DEF' }) }], 'File');
    const fileBen = byName(file, 'Ben').id;
    const run = runImport(phone, file.ledger, 'match');
    expect(lastEntryRecords(run.ledger).some((r) => r.playerId === fileBen)).toBe(false);
    expect(recordsFor(run.ledger, 'profile', fileBen)).toEqual(recordsFor(file.ledger, 'profile', fileBen));
    const ben = run.session.players.find((p) => p.id === fileBen);
    expect([ben?.keeper, ben?.outfieldTargetPct, ben?.prefers, ben?.active]).toEqual(['never', 50, 'DEF', true]);
  });

  it('criterion 18: both sides noted and different: the phone’s mark lands last, and the pair says so', () => {
    const phone = squad(['Ben']);
    phone.ledger = okL(setPlayerFairness(phone.ledger, byName(phone, 'Ben').id, false, 'Fill-in from U9s', NOW));
    const file = squad(['Ben'], 'File');
    const fileBen = byName(file, 'Ben').id;
    file.ledger = okL(setPlayerFairness(file.ledger, fileBen, false, 'Guest for one match', NOW));
    file.ledger = okL(setPlayerFairness(file.ledger, fileBen, true, 'Joined the squad', NOW));
    const m = matchSquads(phone.players, file.ledger, phone.ledger);
    expect(m.pairs[0].notes).toEqual(['fill-in on this phone, counted in the file']);
    const run = runImport(phone, file.ledger, 'match');
    const history = fairnessHistory(run.ledger, fileBen);
    expect(history.map((h) => h.note)).toEqual(['Guest for one match', 'Joined the squad', 'Fill-in from U9s']);
  });

  it('criterion 19: a child retired in the file still pairs, stays retired, and no mark crosses', () => {
    const phone = squad(['Ben']);
    phone.ledger = okL(setPlayerFairness(phone.ledger, byName(phone, 'Ben').id, false, 'Fill-in from U9s', NOW));
    const file = squad([{ name: 'Ben', edit: (p) => ({ ...p, active: false }) }], 'File');
    const fileBen = byName(file, 'Ben').id;
    const m = matchSquads(phone.players, file.ledger, phone.ledger);
    expect(m.pairs).toHaveLength(1);
    expect(m.pairs[0].notes).toEqual(['retired in the file']);
    const run = runImport(phone, file.ledger, 'match');
    expect(lastEntryRecords(run.ledger).some((r) => r.playerId === fileBen)).toBe(false);
    expect(run.session.players.find((p) => p.id === fileBen)?.active).toBe(false);
  });

  it('criterion 20: a match held before kick-off refuses the import when any name pairs', () => {
    const phone = squad(['Ava', 'Ben']);
    const plan = planImport({ ours: phone.ledger, file: squad(['Ava'], 'File').ledger, players: phone.players, matchHeld: true });
    expect(plan).toEqual({ kind: 'refuse', reason: HELD_MATCH_REFUSAL });
    expect(HELD_MATCH_REFUSAL).toBe('Finish or clear the match on this phone, then import.');
    const none = planImport({ ours: phone.ledger, file: squad(['Zed'], 'File').ledger, players: phone.players, matchHeld: true });
    expect(none).toEqual({ kind: 'straight' });
  });

  it('criterion 21: planned fixtures name the file’s children; no record is rewritten', () => {
    const phone = squad(['Ava', 'Ben', 'Kit']);
    const file = squad(['Ava', 'Ben'], 'File');
    const { stored } = newMatch(
      { squadId: phone.squadId, format, totalMinutes: 50, periodCount: 4, players: phone.players, opponent: 'Rovers' },
      () => NOW
    );
    const ava = byName(phone, 'Ava').id;
    const pos = format.positions[0].id;
    const fixture: SavedMatch = {
      ...stored,
      plan: { periods: [{ slots: { [pos]: ava }, subs: [{ onId: byName(phone, 'Ben').id, offId: ava, atMs: 1000 }] }] },
      benchStints: [{ id: uuid(), matchId: stored.match.id, quarterId: stored.quarters[0].id, playerId: ava, startElapsedMs: 0, endElapsedMs: null }],
    };
    const run = runImport(phone, file.ledger, 'match', [fixture]);
    const after = run.session.matches[0];
    const fileAva = byName(file, 'Ava').id;
    const fileBen = byName(file, 'Ben').id;
    const kit = byName(phone, 'Kit').id;
    expect(after.availability.map(([id]) => id).sort()).toEqual([fileAva, fileBen, kit].sort());
    expect(after.plan?.periods[0].slots[pos]).toBe(fileAva);
    expect(after.plan?.periods[0].subs[0]).toMatchObject({ onId: fileBen, offId: fileAva });
    expect(after.benchStints[0].playerId).toBe(fileAva);
    expect(after.match.id).toBe(stored.match.id);
    // Same children available, by name.
    const nameOf = (id: string) => run.session.players.find((p) => p.id === id)?.firstName;
    expect(after.availability.map(([id]) => nameOf(id)).sort()).toEqual(['Ava', 'Ben', 'Kit']);
    // No entry of either chain was rewritten.
    const hashes = run.ledger.entries.map((e) => e.hash);
    for (const e of file.ledger.entries) expect(hashes).toContain(e.hash);
  });

  it('criterion 22: the session child is built from the record, keeping the phone’s createdAt', () => {
    const phone = squad([{ name: ' ava ', edit: (p) => ({ ...p, createdAt: '2026-09-01T08:00:00.000Z', keeper: 'main' }) }]);
    const file = squad([{ name: 'Ava', edit: (p) => ({ ...p, keeper: 'backup' }) }], 'File');
    const run = runImport(phone, file.ledger, 'match');
    const ava = run.session.players[0];
    expect(ava).toMatchObject({ id: byName(file, 'Ava').id, firstName: 'Ava', keeper: 'backup', createdAt: '2026-09-01T08:00:00.000Z' });
  });
});

// --- F. The next save does not undo the match -----------------------------------------

describe('F. the next save', () => {
  for (const option of ['match', 'file'] as const) {
    it(`criterion 23: a save straight after "${option}" keeps the match`, () => {
      const eight = TEN.slice(0, 8);
      const phone = squad([...eight.map((n) => (n === 'Ava' ? ' ava ' : n)), 'Kit'].map((n) =>
        n === 'Ben' ? { name: n, edit: (p: Player) => ({ ...p, keeper: 'main' as const }) } : n
      ));
      const file = squad([...eight, 'Lola', 'Max'], 'File');
      const run = runImport(phone, file.ledger, option);
      const saved = recordMatches(
        run.ledger,
        [],
        run.session.players,
        'Phone',
        LATER,
        setupFrom({ players: run.session.players, matches: run.session.matches, live: null, format, totalMinutes: 50, periodCount: 4, buzzWhenSubDue: true })
      );
      const appended = saved.entries.slice(run.ledger.entries.length).flatMap((e) => e.records);
      const phoneIds = new Set(phone.players.map((p) => p.id));
      const fileIds = new Set(file.players.map((p) => p.id));
      for (const r of appended) {
        if (phoneIds.has(r.playerId as UUID) || phoneIds.has(r.id as UUID)) {
          expect(r.type === 'profile' && ('removed' in r || 'matchedTo' in r)).toBe(false);
        }
        if (r.type === 'player' && fileIds.has(r.id as UUID)) {
          expect(r.firstName).toBe(file.players.find((p) => p.id === r.id)?.firstName);
        }
      }
      // No player or profile record at all for the matched children: the file's stand.
      expect(appended.filter((r) => (r.type === 'player' || r.type === 'profile') && fileIds.has((r.id ?? r.playerId) as UUID))).toEqual([]);
      expect(saved.profiles.find((p) => p.playerId === byName(phone, 'Ben').id)?.removed).toBe(true);
      expect(saved.profiles.find((p) => p.playerId === byName(phone, 'Ben').id)?.matchedTo).toBe(byName(file, 'Ben').id);
      expect(restoreFromRecord(saved, phone.squadId, format, LATER).players).toHaveLength(run.restored.length);
    });
  }
});

// --- G. The released 1.2.0 reader -----------------------------------------------------

describe('G. the released 1.2.0 reader', () => {
  for (const option of ['match', 'file', 'both'] as const) {
    it(`criterion 25: reads, folds and writes back the record after "${option}"`, () => {
      const sqA = uuid();
      const file = loadMadeUpTeam({
        players: [],
        matches: [],
        squadId: sqA,
        squadName: 'A',
        format,
        totalMinutes: 50,
        periodCount: 4,
        ledger: emptyLedger(sqA, 'A', NOW),
        now: NOW,
      }).ledger as Ledger;
      const phone = squad([...file.players.map((p) => p.firstName), 'Kit']);
      const run = runImport(phone, file, option);
      const old = released.parseLedger(serialiseLedger(run.ledger));
      if (!old.ok) throw new Error(old.reason);
      expect(released.foldLedger(old.ledger)).toEqual(foldLedger(run.ledger));
      const back = parseLedger(released.serialiseLedger(old.ledger));
      if (!back.ok) throw new Error(back.reason);
      expect(back.ledger.entries).toEqual(run.ledger.entries);
      const matched = back.ledger.profiles.filter((p) => p.matchedTo !== undefined);
      expect(matched).toHaveLength(option === 'both' ? 0 : 10);
      expect(back.ledger.profiles.filter((p) => p.removed)).toHaveLength(run.ledger.profiles.filter((p) => p.removed).length);
    });
  }
});

// --- H. Nothing is erased -------------------------------------------------------------------

describe('H. nothing is erased', () => {
  for (const option of ['match', 'file', 'both'] as const) {
    it(`criteria 26, 27: every child record and entry survives under "${option}"; every removal is noted`, () => {
      const eight = TEN.slice(0, 8);
      const phone = squad([...eight, 'Kit']);
      phone.ledger = okL(setPlayerFairness(phone.ledger, byName(phone, 'Ben').id, false, 'Fill-in from U9s', NOW));
      const file = squad([...eight, 'Lola', 'Max'], 'File');
      const run = runImport(phone, file.ledger, option);
      const result = allRecords(run.ledger).map((r) => JSON.stringify(r));
      // The file's chain is the result's prefix, entry for entry.
      expect(run.ledger.entries.slice(0, file.ledger.entries.length)).toEqual(file.ledger.entries);
      // Every player: and profile: record of the phone's children, under the phone's ids.
      const phoneChild = allRecords(phone.ledger).filter((r) => r.type === 'player' || r.type === 'profile');
      expect(phoneChild.length).toBeGreaterThan(0);
      for (const r of phoneChild) expect(result).toContain(JSON.stringify(r));
      // Everything this change adds is in the one entry at import time.
      const added = allRecords(run.ledger).filter((r) => 'matchedTo' in r || r.note === 'Not in the imported squad');
      const last = lastEntryRecords(run.ledger).map((r) => JSON.stringify(r));
      for (const r of added) expect(last).toContain(JSON.stringify(r));
      // Criterion 27.
      for (const r of allRecords(run.ledger).filter((x) => x.type === 'profile' && x.removed === true)) {
        expect(typeof r.note === 'string' && r.note.trim() !== '').toBe(true);
        if ('matchedTo' in r) expect(typeof r.matchedTo === 'string' && /^[0-9a-f-]{36}$/.test(r.matchedTo)).toBe(true);
      }
    });
  }
});

// --- I. Unchanged paths ---------------------------------------------------------------------

describe('I. unchanged paths', () => {
  it('criterion 28: a phone with no children shows no step', () => {
    const empty = squad([]);
    expect(planImport({ ours: empty.ledger, file: squad(TEN, 'File').ledger, players: [], matchHeld: false })).toEqual({ kind: 'straight' });
  });

  it('criterion 29: a phone with player time takes the extend path and shows no step', () => {
    const sqA = uuid();
    const played = loadMadeUpTeam({
      players: [],
      matches: [],
      squadId: sqA,
      squadName: 'A',
      format,
      totalMinutes: 50,
      periodCount: 4,
      ledger: emptyLedger(sqA, 'A', NOW),
      now: NOW,
    });
    const plan = planImport({ ours: played.ledger as Ledger, file: squad(TEN, 'File').ledger, players: played.players, matchHeld: false });
    expect(plan).toEqual({ kind: 'straight' });
    // A choice handed to the extend path changes nothing: it still refuses a diverged chain.
    const diverged = importLedger(played.ledger as Ledger, squad(TEN, 'File').ledger, { matched: [], leaving: [] }, IMPORT_AT);
    expect(diverged.ok).toBe(false);
  });

  it('criterion 30: children but no pair: no step', () => {
    const phone = squad(['Kit', 'Zed']);
    expect(planImport({ ours: phone.ledger, file: squad(TEN, 'File').ledger, players: phone.players, matchHeld: false })).toEqual({ kind: 'straight' });
  });
});

// --- Settled questions 33–36 ----------------------------------------------------------------

describe('33–36: Q1–Q4 as settled', () => {
  it("criterion 33: Use the file's squad keeps a child unmatched only because their name appears twice", () => {
    const phone = squad(['Sam', 'Sam', 'Ava', 'Kit']);
    const run = runImport(phone, squad(['Sam', 'Ava'], 'File').ledger, 'file');
    expect(run.choice?.leaving).toEqual([byName(phone, 'Kit').id]);
    const ids = run.session.players.map((p) => p.id);
    expect(ids).toContain(phone.players[0].id);
    expect(ids).toContain(phone.players[1].id);
    expect(ids).not.toContain(byName(phone, 'Kit').id);
  });

  it('criterion 34: re-importing the same file after a match shows no step and adds nothing', () => {
    const phone = squad(TEN);
    const file = squad(TEN, 'File');
    const first = runImport(phone, file.ledger, 'match');
    const after: Side = { ledger: first.ledger, players: first.session.players, squadId: phone.squadId };
    const plan = planImport({ ours: after.ledger, file: file.ledger, players: after.players, matchHeld: false });
    expect(plan).toEqual({ kind: 'straight' });
    const again = runImport(after, file.ledger, 'match');
    expect(again.result.addedPlayers).toBe(0);
    expect(again.session.players.map((p) => p.id)).toEqual(after.players.map((p) => p.id));
    expect(again.restored).toHaveLength(10);
  });

  it('criterion 34 (QA F1): a setup-only file re-imported after Match and a save is nothing new', () => {
    const phone = squad([...TEN, 'Kit']);
    const file = squad(TEN, 'File');
    const first = runImport(phone, file.ledger, 'match');
    const ps = first.session.players;
    const saved = recordMatches(first.ledger, [], ps, 'Phone', LATER,
      setupFrom({ players: ps, matches: [], live: null, format, totalMinutes: 50, periodCount: 4, buzzWhenSubDue: true }));
    const r = importLedger(saved, file.ledger, undefined, LATER);
    if (!r.ok) throw new Error(r.reason);
    expect(r.ledger.entries.map((e) => e.hash)).toEqual(saved.entries.map((e) => e.hash));
    expect(saved.entries.every((e, i) => r.ledger.entries[i]?.hash === e.hash)).toBe(true);
    expect(r.addedEntries).toBe(0);
    expect(describeImport(r)).toBe('Nothing new in that file — everything in it is already here.');
  });

  it('criterion 35: a file child with no profile takes the phone child’s whole profile', () => {
    const phone = squad([{ name: 'Ben', edit: (p) => ({ ...p, keeper: 'main', outfieldTargetPct: 70, prefers: 'MID' }) }]);
    const file = squad(['Ben'], 'File', { profiles: false });
    const fileBen = byName(file, 'Ben').id;
    expect(file.ledger.profiles).toEqual([]);
    const run = runImport(phone, file.ledger, 'match');
    const crossed = lastEntryRecords(run.ledger).find((r) => r.type === 'profile' && r.playerId === fileBen);
    expect(crossed).toMatchObject({ keeperPreference: 'main', outfieldTarget: 70, prefers: 'MID', removed: false });
    expect('matchedTo' in (crossed ?? {})).toBe(false);
    const ben = run.session.players.find((p) => p.id === fileBen);
    expect([ben?.keeper, ben?.outfieldTargetPct, ben?.prefers]).toEqual(['main', 70, 'MID']);
  });

  it('criterion 36: the confirmation after Use the file’s squad says who left', () => {
    const eight = TEN.slice(0, 8);
    const run = runImport(squad([...eight, 'Kit']), squad([...eight, 'Lola', 'Max'], 'File').ledger, 'file');
    expect(describeImport(run.result)).toMatch(/^8 matched, 2 added, 1 left the squad\./);
  });
});
