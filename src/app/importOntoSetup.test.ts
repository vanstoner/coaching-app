/**
 * An import onto a phone that has a squad but no played match yet keeps the
 * phone's own records (QA finding 1 on 1.3.0; #195 AC5, #190 AC4, invariant 5):
 * the fill-in mark and its note, tally kinds and award types. The next save
 * does not write the fill-in back as counted. Made-up first names only.
 */

import { describe, expect, it } from 'vitest';
import { uuid } from '../types/index';
import {
  addAwardType,
  addEventType,
  emptyLedger,
  fairnessHistory,
  importLedger,
  isCountedInFairness,
  recordMatches,
  setPlayerFairness,
  type CorrectionResult,
  type Ledger,
} from './ledger';
import { verifyChain } from './ledgerChain';
import { setupFrom } from './ledgerSetup';
import { loadMadeUpTeam } from './gettingStarted';
import { makeSevenASideFormat } from './placeholderSquad';
import { makePlayer } from './squad';

const NOW = new Date('2026-10-20T10:00:00Z');
const LATER = new Date('2026-10-20T11:00:00Z');
const format = makeSevenASideFormat();

const ok = (r: CorrectionResult): Ledger => {
  if (!r.ok) throw new Error(r.reason);
  return r.ledger;
};

/** Phone B: a squad of one, a fill-in, a tally kind and an award type. No match played. */
function phoneWithSetup() {
  const squadId = uuid();
  const kid = makePlayer(squadId, 'Zed');
  const setup = setupFrom({ players: [kid], matches: [], live: null, format, totalMinutes: 50, periodCount: 4, buzzWhenSubDue: true });
  let b = recordMatches(emptyLedger(squadId, 'Phone B', NOW), [], [kid], 'Phone B', NOW, setup);
  b = ok(addEventType(b, 'Headers', 'child', NOW));
  b = ok(addAwardType(b, 'Best tackle', NOW));
  b = ok(setPlayerFairness(b, kid.id, false, 'Fill-in from U9s', NOW));
  return { b, kid, squadId };
}

/** Phone A's minutes file: a different chain holding played matches. */
function fileFromAnotherPhone() {
  const squadId = uuid();
  const team = loadMadeUpTeam({
    players: [],
    matches: [],
    squadId,
    squadName: 'A',
    format,
    totalMinutes: 50,
    periodCount: 4,
    ledger: emptyLedger(squadId, 'A', NOW),
    now: NOW,
  });
  return { file: team.ledger as Ledger, players: team.players };
}

describe('import onto a phone with setup but no player time (QA 1.3.0 finding 1)', () => {
  it("keeps the phone's tally kinds, award types and fill-in mark with its note", () => {
    const { b, kid } = phoneWithSetup();
    const { file } = fileFromAnotherPhone();
    expect(file.matches.length).toBeGreaterThan(0);

    const out = importLedger(b, file);
    if (!out.ok) throw new Error(out.reason);
    const l = out.ledger;

    expect(verifyChain(l.entries).ok).toBe(true);
    expect(l.eventTypes.map((t) => t.label)).toContain('Headers');
    expect(l.awardTypes.map((t) => t.name)).toContain('Best tackle');
    expect(l.players.map((p) => p.id)).toContain(kid.id);
    expect(isCountedInFairness(l, kid.id)).toBe(false);
    expect(fairnessHistory(l, kid.id).map((c) => c.note)).toEqual(['Fill-in from U9s']);
    // The file is only added to: every match and player in it is still there.
    expect(l.matches.map((m) => m.id).sort()).toEqual(file.matches.map((m) => m.id).sort());
    for (const p of file.players) expect(l.players.map((x) => x.id)).toContain(p.id);
  });

  it('the next save does not write the fill-in back as counted', () => {
    const { b, kid } = phoneWithSetup();
    const { file, players } = fileFromAnotherPhone();
    const out = importLedger(b, file);
    if (!out.ok) throw new Error(out.reason);

    // The working document after the import: its own child, plus the file's.
    const working = [kid, ...players];
    const setup = setupFrom({ players: working, matches: [], live: null, format, totalMinutes: 50, periodCount: 4, buzzWhenSubDue: true });
    const saved = recordMatches(out.ledger, [], working, 'Phone B', LATER, setup);

    expect(isCountedInFairness(saved, kid.id)).toBe(false);
    expect(saved.profiles.find((p) => p.playerId === kid.id)?.note).toBe('Fill-in from U9s');
    expect(saved.eventTypes.map((t) => t.label)).toContain('Headers');
  });

  it("where both hold a record, the file's stands unless the phone's is a noted act", () => {
    const { b } = phoneWithSetup();
    const made = fileFromAnotherPhone();
    const theirSetup = setupFrom({ players: made.players, matches: [], live: null, format, totalMinutes: 40, periodCount: 2, buzzWhenSubDue: false });
    const file = recordMatches(made.file, [], made.players, 'A', NOW, theirSetup);
    expect(file.settings?.totalMinutes).toBe(40);
    const out = importLedger(b, file);
    if (!out.ok) throw new Error(out.reason);
    // Settings carry no note: the file's are what a restore rebuilds from (#195 AC4).
    expect(out.ledger.settings).toEqual(file.settings);
  });

  it('a phone with nothing of its own adopts the file as before', () => {
    const squadId = uuid();
    const { file } = fileFromAnotherPhone();
    const out = importLedger(emptyLedger(squadId, 'New', NOW), file);
    if (!out.ok) throw new Error(out.reason);
    expect(out.ledger.entries).toEqual(file.entries);
  });
});
