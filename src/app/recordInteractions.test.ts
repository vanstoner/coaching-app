/**
 * The record of #195 alongside the features that landed beside it in 1.3.0:
 * test matches (#194 part B), the made-up guard (#218) and getting started's
 * "nothing played yet". Made-up first names only (invariant 4).
 */

import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid, type UUID } from '../types/index';
import { emptyLedger, recordMatches, type Ledger } from './ledger';
import { setupFrom } from './ledgerSetup';
import { newMatch } from './matchLifecycle';
import type { SavedMatch } from './persistence';
import {
  DEFAULT_QUARTER_COUNT,
  DEFAULT_TOTAL_MINUTES,
  PLACEHOLDER_SQUAD_NAME,
  makeSevenASideFormat,
} from './placeholderSquad';
import { recordOnlyMatches } from './recordOnly';
import { restoreFromRecord } from './recordRestore';
import { makePlayer } from './squad';
import { sheetFromSelection, toTeamSheet } from './teamSheet';
import { newTestMark, recordable } from './testMatches';
import { clearMadeUpTeam, loadMadeUpTeam, nothingPlayedYet } from './gettingStarted';

const NOW = new Date('2026-10-20T18:00:00Z');
const format = makeSevenASideFormat();
const settings = { format, totalMinutes: 50, periodCount: 4, buzzWhenSubDue: true };

/** A match through the engine: one period played and closed. */
function playedMatch(squadId: UUID, players: { id: UUID }[], opts: { test?: boolean; opponent?: string } = {}) {
  const engine = new MatchEngine({ nowFn: () => NOW });
  const state = engine.createMatch(squadId, format.id, {
    totalMinutes: 20,
    quarterCount: 1,
    availablePlayerIds: players.map((p) => p.id),
    opponent: opts.opponent ?? 'Riverside',
  });
  if (opts.test) state.match.test = newTestMark(NOW.getTime());
  const ids = players.map((p) => p.id);
  engine.startQuarter(state, state.quarters[0], toTeamSheet(sheetFromSelection(ids.slice(0, 7), ids[0], format)), format);
  engine.endQuarter(state, state.quarters[0]);
  engine.completeMatch(state);
  return state;
}

describe('a test match is never a fixture, profile or structure in the record (#194 with #195, #196)', () => {
  it('setupFrom and recordMatches leave it out, live or stored, even when handed one', () => {
    const squadId = uuid();
    const kids = ['Nia', 'Omar', 'Pip', 'Quin', 'Rae', 'Sol', 'Tam'].map((n) => makePlayer(squadId, n));
    const test = playedMatch(squadId, kids, { test: true });
    const stored: SavedMatch = {
      match: test.match,
      quarters: test.quarters,
      appearances: test.appearances,
      benchStints: test.benchStints,
      availability: [...test.playerAvailability],
      format,
    };
    // As the app calls it: through `recordable`.
    const viaApp = recordMatches(
      emptyLedger(squadId, 'Your team', NOW),
      recordable([stored]),
      kids,
      'Your team',
      NOW,
      setupFrom({ players: kids, matches: recordable([stored]), live: null, ...settings })
    );
    // And the second lock: handed one directly, stored and as the live match.
    const direct = recordMatches(
      emptyLedger(squadId, 'Your team', NOW),
      [test],
      kids,
      'Your team',
      NOW,
      setupFrom({ players: kids, matches: [stored], live: { match: test.match, format }, ...settings })
    );
    for (const l of [viaApp, direct]) {
      const types = l.entries.flatMap((e) => e.records).filter((r) => r.matchId === test.match.id || r.id === test.match.id);
      expect(types).toEqual([]);
      expect(l.fixtures).toEqual([]);
      expect(l.matches).toEqual([]);
    }
    // Profiles are per child, not per match: the squad is still described.
    expect(direct.profiles).toHaveLength(kids.length);
  });
});

describe('the made-up guard and the record of #195', () => {
  function madeUp(squadId: UUID) {
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
    return { ...team, ledger: team.ledger as Ledger };
  }

  it('clearing it from a record that also holds real play cancels its fixtures and removes its children, so a restore never brings them back', () => {
    const squadId = uuid();
    const team = madeUp(squadId);
    // Saved once by this build: the made-up fixtures and children enter the record.
    let ledger = recordMatches(
      team.ledger,
      team.matches,
      team.players,
      PLACEHOLDER_SQUAD_NAME,
      NOW,
      setupFrom({ players: team.players, matches: team.matches, live: null, ...settings })
    );
    expect(ledger.fixtures.some((f) => f.state === 'planned')).toBe(true);
    // A real match too, so the record is not replaced but voided around it.
    const kids = ['Nia', 'Omar', 'Pip', 'Quin', 'Rae', 'Sol', 'Tam'].map((n) => makePlayer(squadId, n));
    const real = playedMatch(squadId, kids);
    ledger = recordMatches(ledger, [real], [...team.players, ...kids], 'Your team', NOW);

    const out = clearMadeUpTeam({
      players: [...team.players, ...kids],
      matches: team.matches,
      live: null,
      ledger,
      squadName: 'Your team',
      now: NOW,
    });
    expect(out.record).toBe('voided');
    const after = out.ledger as Ledger;
    const madeUpFixtureIds = new Set(team.matches.map((m) => m.match.id));
    expect(after.fixtures.filter((f) => madeUpFixtureIds.has(f.id)).every((f) => f.state === 'cancelled')).toBe(true);
    const madeUpIds = new Set(team.players.map((p) => p.id));
    expect(after.profiles.filter((p) => madeUpIds.has(p.playerId)).every((p) => p.removed)).toBe(true);
    // The earlier records stay in the chain (invariant 5).
    expect(after.entries.slice(0, ledger.entries.length)).toEqual(ledger.entries);

    const restored = restoreFromRecord(after, uuid(), format, NOW);
    expect(restored.players.map((p) => p.firstName).sort()).toEqual(kids.map((k) => k.firstName).sort());
    expect(restored.fixtures).toEqual([]);
  });
});

describe('getting started counts matches from the record (#218 with #195)', () => {
  it('an archived match from the record still means something has been played', () => {
    const squadId = uuid();
    const kids = ['Nia', 'Omar', 'Pip', 'Quin', 'Rae', 'Sol', 'Tam'].map((n) => makePlayer(squadId, n));
    const real = playedMatch(squadId, kids);
    const stored: SavedMatch = {
      match: real.match,
      quarters: real.quarters,
      appearances: real.appearances,
      benchStints: real.benchStints,
      availability: [...real.playerAvailability],
      format,
      archived: true,
    };
    const ledger = recordMatches(
      emptyLedger(squadId, 'Your team', NOW),
      [stored],
      kids,
      'Your team',
      NOW,
      setupFrom({ players: kids, matches: [stored], live: null, ...settings })
    );
    // On a restored phone, with no fixture here: listed from the record, archived.
    const list = recordOnlyMatches(ledger, new Set());
    expect(list.map((m) => [m.id, m.archived])).toEqual([[real.match.id, true]]);
    expect(nothingPlayedYet([], list.length)).toBe(false);
  });
});
