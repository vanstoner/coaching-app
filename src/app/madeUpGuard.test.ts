/**
 * The made-up guard (PO, `approve made-up guard` on #218, 18 Oct): "Clear it
 * and start" takes the made-up squad, fixtures and matches off the phone,
 * from the session and from the record, and keeps anything real untouched.
 * Made-up first names only (invariant 4).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid, type UUID } from '../types/index';
import { addAwardType, addEventType, emptyLedger, isHidden, recordMatches, visibleLedger, type Ledger } from './ledger';
import { newMatch } from './matchLifecycle';
import type { SavedMatch } from './persistence';
import { DEFAULT_QUARTER_COUNT, DEFAULT_TOTAL_MINUTES, PLACEHOLDER_SQUAD_NAME, makeSevenASideFormat } from './placeholderSquad';
import { makePlayer } from './squad';
import { sheetFromSelection, toTeamSheet } from './teamSheet';
import {
  MADE_UP_CLEARED_NOTE,
  MADE_UP_GUARD,
  allStepsDone,
  clearMadeUpTeam,
  isMadeUpTeam,
  loadMadeUpTeam,
  recordedMatchCount,
  startSteps,
} from './gettingStarted';

const NOW = new Date('2026-10-20T18:00:00Z');
const format = makeSevenASideFormat();

function madeUp(squadId: UUID = uuid()) {
  const team = loadMadeUpTeam({
    players: [],
    matches: [],
    squadId,
    squadName: PLACEHOLDER_SQUAD_NAME,
    format,
    totalMinutes: DEFAULT_TOTAL_MINUTES,
    periodCount: DEFAULT_QUARTER_COUNT,
    ledger: emptyLedger(squadId, PLACEHOLDER_SQUAD_NAME, NOW),
    now: NOW,
  });
  return { ...team, squadId, ledger: team.ledger as Ledger };
}

/** A fixture the coach added: a real opponent, not yet played. */
function realFixture(squadId: UUID, opponent: string): SavedMatch {
  return newMatch(
    { squadId, format, totalMinutes: 50, periodCount: 4, players: [], opponent },
    () => NOW
  ).stored;
}

describe('the made-up guard (approve made-up guard)', () => {
  it('asks the approved question, with the two approved answers', () => {
    expect(MADE_UP_GUARD.question).toBe('This is the made-up team. Clear it and start your real squad?');
    expect(MADE_UP_GUARD.clear).toBe('Clear it and start');
    expect(MADE_UP_GUARD.keep).toBe('Keep exploring');
  });

  it('Clear it and start: the made-up squad, fixtures and matches leave the session and the record', () => {
    const team = madeUp();
    expect(isMadeUpTeam(team.players, team.matches)).toBe(true);
    expect(team.ledger.matches.length).toBeGreaterThan(0);
    const out = clearMadeUpTeam({
      players: team.players,
      matches: team.matches,
      live: null,
      ledger: team.ledger,
      squadName: PLACEHOLDER_SQUAD_NAME,
      now: NOW,
    });
    expect(out.players).toEqual([]);
    expect(out.matches).toEqual([]);
    expect(out.record).toBe('fresh');
    expect(out.ledger!.matches).toEqual([]);
    expect(out.ledger!.players).toEqual([]);
    expect(out.ledger!.squad.id).toBe(team.ledger.squad.id);
    expect(out.removedPlayers).toBe(team.players.length);
    expect(out.removedMatches).toBe(team.matches.length);

    // The coach's first real player is then recorded into the new record alone.
    const nia = makePlayer(team.squadId, 'Nia');
    const after = recordMatches(out.ledger!, out.matches, [nia], 'Your team', NOW);
    expect(after.players.map((p) => p.firstName)).toEqual(['Nia']);
    expect(after.matches).toEqual([]);
  });

  it('keeps a fixture the coach added themselves', () => {
    const team = madeUp();
    const mine = realFixture(team.squadId, 'Riverside');
    const out = clearMadeUpTeam({
      players: team.players,
      matches: [...team.matches, mine],
      live: null,
      ledger: team.ledger,
      squadName: PLACEHOLDER_SQUAD_NAME,
      now: NOW,
    });
    expect(out.matches.map((m) => m.match.id)).toEqual([mine.match.id]);
  });

  it('lets go of a held made-up match (Play now with the made-up children)', () => {
    const team = madeUp();
    const { held } = newMatch(
      { squadId: team.squadId, format, totalMinutes: 50, periodCount: 4, players: team.players },
      () => NOW
    );
    const engine = new MatchEngine({ nowFn: () => NOW });
    const ids = team.players.map((p) => p.id);
    engine.startQuarter(
      held.state,
      held.state.quarters[0],
      toTeamSheet(sheetFromSelection(ids.slice(0, 7), ids[0], format)),
      format
    );
    const out = clearMadeUpTeam({
      players: team.players,
      matches: team.matches,
      live: held,
      ledger: team.ledger,
      squadName: PLACEHOLDER_SQUAD_NAME,
      now: NOW,
    });
    expect(out.releaseLive).toBe(true);
    expect(out.matches).toEqual([]);
  });

  it('a real match with no made-up child stays visible when the record is voided around it', () => {
    const team = madeUp();
    const kids = ['Nia', 'Omar', 'Pip', 'Quin', 'Rae', 'Sol', 'Tam'].map((n) => makePlayer(team.squadId, n));
    const state = new MatchEngine({ nowFn: () => NOW }).createMatch(team.squadId, format.id, {
      totalMinutes: 50,
      quarterCount: 4,
      availablePlayerIds: kids.map((k) => k.id),
      opponent: 'Riverside',
    });
    new MatchEngine({ nowFn: () => NOW }).startQuarter(
      state,
      state.quarters[0],
      toTeamSheet(sheetFromSelection(kids.map((k) => k.id), kids[0].id, format)),
      format
    );
    const recorded = recordMatches(team.ledger, [state], [...team.players, ...kids], 'Your team', NOW);
    const out = clearMadeUpTeam({
      players: [...team.players, ...kids],
      matches: team.matches,
      live: null,
      ledger: recorded,
      squadName: 'Your team',
      now: NOW,
    });
    expect(out.record).toBe('voided');
    expect(out.players.map((p) => p.firstName)).toEqual(['Nia', 'Omar', 'Pip', 'Quin', 'Rae', 'Sol', 'Tam']);
    expect(visibleLedger(out.ledger!).matches.map((m) => m.id)).toEqual([state.match.id]);
    // Nothing removed from the chain: it only grew, and each made-up match carries the note.
    expect(out.ledger!.entries.slice(0, recorded.entries.length)).toEqual(recorded.entries);
    const voided = out.ledger!.matches.filter(isHidden);
    expect(voided.length).toBe(team.ledger.matches.length);
    expect(voided.every((m) => m.matchKind?.kind === 'void' && m.matchKind.note === MADE_UP_CLEARED_NOTE)).toBe(true);
  });

  it('with a record this build may not write, only the session is cleared', () => {
    const team = madeUp();
    const out = clearMadeUpTeam({
      players: team.players,
      matches: team.matches,
      live: null,
      ledger: null,
      squadName: PLACEHOLDER_SQUAD_NAME,
      now: NOW,
    });
    expect(out.record).toBe('untouched');
    expect(out.ledger).toBeNull();
    expect(out.players).toEqual([]);
  });

  it("keeps the coach's tally kinds and award types when the record held only made-up data (QA 1.3.0 finding 4)", () => {
    const team = madeUp();
    let l = team.ledger;
    const tally = addEventType(l, 'Headers', 'child', NOW);
    if (!tally.ok) throw new Error(tally.reason);
    const award = addAwardType(tally.ledger, 'Best tackle', NOW);
    if (!award.ok) throw new Error(award.reason);
    l = award.ledger;

    const out = clearMadeUpTeam({ players: team.players, matches: team.matches, live: null, ledger: l, squadName: 'Your team', now: NOW });
    expect(out.record).toBe('fresh');
    // The made-up team, its matches and fixtures are gone ...
    expect(out.ledger!.matches).toEqual([]);
    expect(out.ledger!.players).toEqual([]);
    expect(out.ledger!.fixtures).toEqual([]);
    // ... and what the coach added in Settings stays.
    expect(out.ledger!.eventTypes.map((t) => t.label)).toEqual(['Headers']);
    expect(out.ledger!.awardTypes.map((t) => t.name)).toContain('Best tackle');
  });

  it('after clearing on the voided path, "Press Play now" is not ticked by the voided matches (QA 1.3.0 finding 7)', () => {
    const team = madeUp();
    // A real child is in the record, so the made-up matches are voided, not dropped.
    const nia = makePlayer(team.squadId, 'Nia');
    const recorded = recordMatches(team.ledger, [], [...team.players, nia], 'Your team', NOW);
    const out = clearMadeUpTeam({
      players: [...team.players, nia],
      matches: team.matches,
      live: null,
      ledger: recorded,
      squadName: 'Your team',
      now: NOW,
    });
    expect(out.record).toBe('voided');
    expect(out.ledger!.matches.length).toBeGreaterThan(0); // still in the chain, voided
    expect(recordedMatchCount(out.ledger)).toBe(0);
    const s = startSteps({
      activePlayers: out.players.length,
      onFieldCount: format.onFieldCount,
      matches: out.matches,
      ledgerMatches: recordedMatchCount(out.ledger),
    });
    expect(s.find((x) => x.key === 'play')?.done).toBe(false);
    expect(allStepsDone(s)).toBe(false);
  });

  it('a real recorded match still ticks it', () => {
    expect(recordedMatchCount(null)).toBe(0);
    const team = madeUp();
    expect(recordedMatchCount(team.ledger)).toBe(team.ledger.matches.length);
  });

  it('App counts recorded matches for Getting started through recordedMatchCount', () => {
    const app = readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf-8');
    expect(app).toMatch(/ledgerMatches: recordedMatchCount\(ledger\)/);
  });
});
