/**
 * Pristine, live unsigned or reconstructed — #199 AC1–AC6 (PO `approve
 * readiness`, 18 Oct; the derived rule replaces #189 AC2), ADR-021 D4.
 * Matches are played through the real engine and recorded through the real
 * ledger, signed with made-up keys. Made-up first names only (invariant 4).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MatchEngine, type MatchState } from '../engine/MatchEngine';
import { uuid, type Player } from '../types/index';
import {
  addUnknownTimeEvent,
  emptyLedger,
  importLedger,
  parseLedger,
  recordMatches,
  serialiseLedger,
  type Ledger,
} from './ledger';
import { makeEntry, verifyChain } from './ledgerChain';
import { childPositionLine } from './matchRecord';
import { setEntrySigner, signerFromSecret } from './entrySigning';
import { provenanceOf, provenanceTag, provenances, withoutReconstructed } from './provenance';
import { makeFormat } from './shapes';
import { makePlayer } from './squad';
import { squadViews } from './squadViews';
import { sortSquadList } from './tableSort';
import { sheetFromSelection, toTeamSheet } from './teamSheet';

const MIN = 60_000;
const DAY = 86_400_000;
const squadId = uuid();
const players: Player[] = ['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gil', 'Hal'].map((n) => makePlayer(squadId, n));
const ids = players.map((p) => p.id);
const KICKOFF = Date.parse('2026-10-10T09:00:00Z');
const phoneA = signerFromSecret('phone-a', new Uint8Array(32).fill(1));
const phoneB = signerFromSecret('phone-b', new Uint8Array(32).fill(2));

afterEach(() => setEntrySigner(null));

/**
 * Two halves of 20, recorded as the app does: at kick-off and at each
 * period's end. `lateMs` delays every write, as a back-fill would; `between`
 * runs after the first half is recorded.
 */
function playLive(
  opts: {
    lateMs?: number;
    between?: () => void;
    corrected?: boolean;
    kickoffAt?: number;
    opponent?: string;
    pick?: typeof ids;
  } = {}
): { ledger: Ledger; state: MatchState } {
  const at = opts.kickoffAt ?? KICKOFF;
  let nowMs = at;
  const engine = new MatchEngine({ nowFn: () => new Date(nowMs) });
  const format = makeFormat('2-3-1');
  const s = engine.createMatch(squadId, format.id, { totalMinutes: 40, quarterCount: 2 });
  s.match.kickoffAt = new Date(at).toISOString();
  s.match.opponent = opts.opponent ?? 'Mock Rovers';
  for (const id of ids) engine.setAvailability(s, id, 'available');
  const write = (l: Ledger) => recordMatches(l, [{ ...s, format }], players, 'Test FC', new Date(nowMs + (opts.lateMs ?? 0)));
  let ledger = emptyLedger(squadId, 'Test FC', new Date(at - DAY));
  for (const q of s.quarters) {
    const pick = opts.pick ?? ids.slice(0, 7);
    engine.startQuarter(s, q, toTeamSheet(sheetFromSelection(pick, pick[0], format)), format);
    ledger = write(ledger);
    nowMs += 10 * MIN;
    engine.recordEvent(s, q, 'goal', ids[3]);
    ledger = write(ledger);
    nowMs += 10 * MIN;
    engine.endQuarter(s, q);
    if (opts.corrected && q.index === 2) {
      s.appearances[0] = { ...s.appearances[0], corrected: true, correctionNote: 'Came off earlier' };
    }
    ledger = write(ledger);
    if (q.index === 1) opts.between?.();
  }
  engine.completeMatch(s);
  ledger = write(ledger);
  return { ledger, state: s };
}

const stateOf = (l: Ledger, s: MatchState) => provenanceOf(l, s.match.id)?.state;

describe('the three states, derived and never stored (#199 AC1)', () => {
  it('pristine: signed live by the phone that played it, in the match window', () => {
    setEntrySigner(phoneA);
    const { ledger, state } = playLive();
    expect(stateOf(ledger, state)).toBe('pristine');
    expect(ledger.entries.flatMap((e) => e.records).some((r) => /pristine|provenance/.test(r.type))).toBe(false);
  });

  it('an imported pristine match stays pristine on another phone: the signatures travel', () => {
    setEntrySigner(phoneA);
    const { ledger, state } = playLive();
    setEntrySigner(phoneB);
    const file = parseLedger(serialiseLedger(ledger));
    if (!file.ok) throw new Error(file.reason);
    const imported = importLedger(emptyLedger(uuid(), 'Other', new Date(KICKOFF + 30 * DAY)), file.ledger);
    if (!imported.ok) throw new Error(imported.reason);
    expect(stateOf(imported.ledger, state)).toBe('pristine');
  });

  it('live, unsigned: written in the window before signing existed (10 Oct)', () => {
    const { ledger, state } = playLive();
    expect(stateOf(ledger, state)).toBe('live-unsigned');
  });

  it('reconstructed: written weeks after kick-off (the back-filled matches), signed or not', () => {
    const { ledger, state } = playLive({ lateMs: 21 * DAY });
    const p = provenanceOf(ledger, state.match.id);
    expect(p?.state).toBe('reconstructed');
    expect(p?.why).toMatch(/3 weeks after kick-off/);
    setEntrySigner(phoneA);
    const signed = playLive({ lateMs: 21 * DAY });
    expect(stateOf(signed.ledger, signed.state)).toBe('reconstructed');
  });

  it('reconstructed: a corrected interval', () => {
    setEntrySigner(phoneA);
    const { ledger, state } = playLive({ corrected: true });
    expect(provenanceOf(ledger, state.match.id)?.why).toMatch(/corrected/);
  });

  it('reconstructed: an event added after the match', () => {
    setEntrySigner(phoneA);
    const { ledger, state } = playLive();
    const r = addUnknownTimeEvent(ledger, state.match.id, 'goal', ids[2], 'Report', new Date(KICKOFF + 60 * MIN));
    if (!r.ok) throw new Error(r.reason);
    expect(provenanceOf(r.ledger, state.match.id)?.why).toMatch(/added after the match/);
  });

  it('reconstructed: written by two phones', () => {
    setEntrySigner(phoneA);
    const { ledger, state } = playLive({ between: () => setEntrySigner(phoneB) });
    expect(provenanceOf(ledger, state.match.id)?.why).toMatch(/more than one phone/);
  });

  it('reconstructed: a coach’s `origin: reconstructed` record (#189), carried from a file', () => {
    setEntrySigner(phoneA);
    const { ledger, state } = playLive();
    const last = ledger.entries[ledger.entries.length - 1];
    const entries = [
      ...ledger.entries,
      makeEntry(last, 'record', [{ type: 'origin', matchId: state.match.id, how: 'reconstructed', source: 'Paper', note: 'From paper' }], new Date(KICKOFF + 2 * DAY)),
    ];
    expect(verifyChain(entries)).toEqual({ ok: true });
    const parsed = parseLedger(serialiseLedger({ ...ledger, entries }));
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(provenanceOf(parsed.ledger, state.match.id)?.why).toMatch(/marked as reconstructed/i);
  });
});

describe('the same treatment everywhere (#199 AC2) and the toggle (AC4)', () => {
  it('tags: reconstructed, a fainter live-unsigned, none for pristine', () => {
    expect(provenanceTag('reconstructed')).toBe('◐ reconstructed');
    expect(provenanceTag('live-unsigned')).toBe('◐ live, unsigned');
    expect(provenanceTag('pristine')).toBeNull();
  });

  it('leaving out reconstructed matches changes the figures and never the chain', () => {
    const live = playLive({ kickoffAt: KICKOFF + 7 * DAY, opponent: 'Live Town' });
    const late = playLive({ lateMs: 21 * DAY });
    // One record holding both: the live one, then the back-fill appended.
    const both = recordMatches(live.ledger, [{ ...late.state }], players, 'Test FC', new Date(KICKOFF + 21 * DAY));
    const p = provenances(both);
    expect(p.get(live.state.match.id)?.state).toBe('live-unsigned');
    expect(p.get(late.state.match.id)?.state).toBe('reconstructed');
    const without = withoutReconstructed(both);
    expect(without.entries).toBe(both.entries);
    expect(without.matches.map((m) => m.id)).toEqual([live.state.match.id]);
    expect(squadViews(without, players).matches).toHaveLength(1);
    expect(squadViews(both, players).matches).toHaveLength(2);
    expect(squadViews(both, players).grid[0].cells.some((c) => c?.reconstructed)).toBe(true);
  });
});

describe('the Squad list sort follows the toggle (#199 with #222)', () => {
  it('with reconstructed matches left out, a child who played only in one drops to the bottom', () => {
    const live = playLive({ kickoffAt: KICKOFF + 7 * DAY, opponent: 'Live Town' });
    const late = playLive({ lateMs: 21 * DAY, pick: ids.slice(1, 8) });
    const both = recordMatches(live.ledger, [{ ...late.state }], players, 'Test FC', new Date(KICKOFF + 21 * DAY));
    const listed = (l: Ledger) => {
      const v = squadViews(l, players);
      const rows = players.map((p) => {
        const c = v.season.children.find((x) => x.playerId === p.id);
        return { player: p, name: p.firstName, averageMs: c?.averageMs ?? null, mainKeeper: c?.mainKeeper === true };
      });
      return sortSquadList(rows, { key: 'perGame', dir: 'desc' }).map((r) => r.player.firstName);
    };
    const hal = players[7].firstName;
    const halAvg = (l: Ledger) => squadViews(l, players).season.children.find((c) => c.playerId === players[7].id)?.averageMs;
    // On: his minutes in the reconstructed match count. Off: he only sat on the bench.
    expect(halAvg(both)).toBeGreaterThan(0);
    expect(halAvg(withoutReconstructed(both))).toBe(0);
    expect(listed(both)).toHaveLength(players.length);
    expect(listed(withoutReconstructed(both))).toEqual([...listed(withoutReconstructed(both)).filter((n) => n !== hal), hal]);
  });
});

describe("the child page's position line follows the toggle (#199 AC4; QA 1.3.0 finding 5)", () => {
  it('with reconstructed matches left out, minutes from them leave the line', () => {
    const live = playLive({ kickoffAt: KICKOFF + 7 * DAY, opponent: 'Live Town' });
    const late = playLive({ lateMs: 21 * DAY, pick: ids.slice(1, 8) });
    const both = recordMatches(live.ledger, [{ ...late.state }], players, 'Test FC', new Date(KICKOFF + 21 * DAY));
    const hal = players[7].id; // on the pitch only in the reconstructed match
    expect(childPositionLine(both, hal)).not.toBe('');
    expect(childPositionLine(withoutReconstructed(both), hal)).toBe('');
    const bo = players[1].id; // played in both
    expect(childPositionLine(withoutReconstructed(both), bo)).not.toBe(childPositionLine(both, bo));
  });

  it("Squad hands the child page the toggled ledger, not the whole record's matches", () => {
    const src = readFileSync(join(__dirname, '..', 'screens', 'SquadScreen.tsx'), 'utf-8');
    expect(src).toMatch(/roleLine=\{childPositionLine\(shown, child\.id\)\}/);
    expect(src).not.toMatch(/ledger\?\.matches/);
  });
});
