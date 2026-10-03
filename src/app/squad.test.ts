/**
 * Tests for squad entry — REQ-09 (#9).
 *
 * The ones that matter most are the invariant-4 tests. This is children's data,
 * the repository is public, and a surname typed once is a surname in the data
 * forever. The rule has to be a gate, and a gate has to be tested.
 */

import { describe, it, expect } from 'vitest';
import { uuid } from '../types/index';
import type { UUID } from '../types/index';
import {
  validateName,
  makePlayer,
  displayName,
  hasDuplicateName,
  duplicatedNames,
  squadReadiness,
  buildTeamSheet,
  MAX_NAME_LENGTH,
  activePlayers,
  playedPlayerIds,
  playersForMatch,
  removePlayer,
  restorePlayer,
  setKeeperPreference,
  setUnitPreference,
  preferenceSummary,
} from './squad';

const squadId = uuid();
const P = (name: string, suffix: string | null = null) => makePlayer(squadId, name, suffix);

describe('invariant 4 — first names only, no PII', () => {
  it('rejects anything with a second word, which is almost always a surname', () => {
    for (const input of ['Alex Smith', 'Jo  Bloggs', ' Sam Jones ', 'Casey Van Stone']) {
      const r = validateName(input);
      expect(r.ok, `${input} must be rejected`).toBe(false);
      expect(r.reason).toBe('looks-like-a-full-name');
      expect(r.message).toMatch(/surname/i);
    }
  });

  it('accepts real first names that are not plain ASCII', () => {
    for (const input of ['Síobhán', 'Jean-Luc', "O'Neill", 'Zoë', 'Mohammed']) {
      expect(validateName(input).ok, `${input} must be accepted`).toBe(true);
    }
  });

  it('a Player carries a first name and nothing else about the child', () => {
    const p = P('Alex');
    expect(p.firstName).toBe('Alex');
    expect(p.displaySuffix).toBeNull();
    expect(p.squadNumber).toBeNull();
    // No surname, DOB, contact or photo field exists to be populated.
    expect(Object.keys(p).sort()).toEqual(
      ['active', 'createdAt', 'displaySuffix', 'firstName', 'id', 'squadId', 'squadNumber'].sort()
    );
  });
});

describe('validateName', () => {
  it('rejects empty and whitespace-only input', () => {
    for (const input of ['', '   ', '\t', '\n ']) {
      const r = validateName(input);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('empty');
    }
  });

  it('trims and collapses whitespace before judging length', () => {
    expect(validateName('  Alex  ').cleaned).toBe('Alex');
    expect(validateName('  Alex  ').ok).toBe(true);
  });

  it('rejects a name longer than the limit', () => {
    expect(validateName('A'.repeat(MAX_NAME_LENGTH)).ok).toBe(true);
    const tooLong = validateName('A'.repeat(MAX_NAME_LENGTH + 1));
    expect(tooLong.ok).toBe(false);
    expect(tooLong.reason).toBe('too-long');
  });

  it('rejects input with no letter in it', () => {
    for (const input of ['123', '!!!', '--', '7']) {
      const r = validateName(input);
      expect(r.ok, `${input} must be rejected`).toBe(false);
      expect(r.reason).toBe('not-a-name');
    }
  });
});

describe('two children with the same name', () => {
  it('is allowed, because real squads have them', () => {
    expect(validateName('Alex').ok).toBe(true);
  });

  it('is detected so the coach can be asked for an initial', () => {
    const a = P('Alex');
    const b = P('Alex');
    const c = P('Sam');
    const squad = [a, b, c];
    expect(hasDuplicateName(squad, a)).toBe(true);
    expect(hasDuplicateName(squad, b)).toBe(true);
    expect(hasDuplicateName(squad, c)).toBe(false);
  });

  it('matches case-insensitively — "alex" and "Alex" are the same name', () => {
    const squad = [P('Alex'), P('alex')];
    expect(hasDuplicateName(squad, squad[0])).toBe(true);
    expect(duplicatedNames(squad)).toEqual(['Alex']);
  });

  it('lists each duplicated name once', () => {
    const squad = [P('Alex'), P('Alex'), P('Sam'), P('Sam'), P('Jo')];
    expect(duplicatedNames(squad).sort()).toEqual(['Alex', 'Sam']);
  });

  it('shows the suffix only when one was given', () => {
    expect(displayName(P('Alex'))).toBe('Alex');
    expect(displayName(P('Alex', 'B'))).toBe('Alex B');
  });
});

describe('squadReadiness', () => {
  const squadOf = (n: number) => Array.from({ length: n }, (_, i) => P(`P${i}`));

  it('is not ready below the format size, and says how many are missing', () => {
    expect(squadReadiness(squadOf(5), 7)).toMatchObject({ ready: false, shortBy: 2 });
    expect(squadReadiness(squadOf(5), 7).message).toContain('2 more players');
  });

  it('uses the singular when one short', () => {
    expect(squadReadiness(squadOf(6), 7).message).toContain('1 more player');
    expect(squadReadiness(squadOf(6), 7).message).not.toContain('players');
  });

  it('is ready at exactly a full team, and warns there is no bench', () => {
    const r = squadReadiness(squadOf(7), 7);
    expect(r.ready).toBe(true);
    expect(r.message).toMatch(/no substitutions/i);
  });

  it('reports the bench when there are spares', () => {
    expect(squadReadiness(squadOf(11), 7).message).toBe('7 on the pitch, 4 on the bench.');
  });

  it('is not ready for an empty squad', () => {
    expect(squadReadiness([], 7).ready).toBe(false);
  });
});

describe('buildTeamSheet', () => {
  const positions = Array.from({ length: 7 }, () => ({ id: uuid() as UUID }));

  it('assigns one distinct player to every position', () => {
    const players = Array.from({ length: 7 }, (_, i) => P(`P${i}`));
    const sheet = buildTeamSheet(players, positions);
    expect(sheet.size).toBe(7);
    expect(new Set(sheet.values()).size).toBe(7);
    for (const position of positions) expect(sheet.has(position.id)).toBe(true);
  });

  it('starts the first players in entry order and benches the rest', () => {
    const players = Array.from({ length: 10 }, (_, i) => P(`P${i}`));
    const sheet = buildTeamSheet(players, positions);
    expect(sheet.size).toBe(7);
    const started = new Set(sheet.values());
    for (let i = 0; i < 7; i++) expect(started.has(players[i].id)).toBe(true);
    for (let i = 7; i < 10; i++) expect(started.has(players[i].id)).toBe(false);
  });

  it('leaves positions unfilled rather than inventing a player', () => {
    // The screen must not let this happen, but the function must not lie if it does.
    const sheet = buildTeamSheet([P('Alex'), P('Sam')], positions);
    expect(sheet.size).toBe(2);
  });
});

describe('retire, do not delete — #77', () => {
  const squadId = uuid();
  const a = makePlayer(squadId, 'Ann');
  const b = makePlayer(squadId, 'Bob');
  const c = makePlayer(squadId, 'Cal');
  const everyone = [a, b, c];
  const played = playedPlayerIds([{ appearances: [{ playerId: a.id }] }]);

  it('AC1/AC2: a player who has played is retired, kept for history, gone from today', () => {
    const after = removePlayer(everyone, a.id, played);
    expect(after).toHaveLength(3);
    expect(after.find((p) => p.id === a.id)!.firstName).toBe('Ann');
    expect(activePlayers(after).map((p) => p.firstName)).toEqual(['Bob', 'Cal']);
  });

  it('AC3: a player who never played is removed outright', () => {
    const after = removePlayer(everyone, b.id, played);
    expect(after.map((p) => p.firstName)).toEqual(['Ann', 'Cal']);
  });

  it('AC4: a retired player can be brought back, same id', () => {
    const back = restorePlayer(removePlayer(everyone, a.id, played), a.id);
    expect(activePlayers(back).map((p) => p.id)).toContain(a.id);
  });

  it('a save from before `active` was used reads as active', () => {
    const legacy = { ...a, active: undefined as unknown as boolean };
    expect(activePlayers([legacy])).toHaveLength(1);
  });

  it('a match shows its own retired players, and nobody else retired', () => {
    const after = removePlayer(removePlayer(everyone, a.id, played), c.id, new Set([c.id]));
    // Ann played in this match; Cal was retired after playing in another one.
    const here = playersForMatch(after, [{ playerId: a.id }]);
    expect(here.map((p) => p.firstName)).toEqual(['Ann', 'Bob']);
  });
});

describe('position preference — #86', () => {
  const squadId = uuid();
  const a = makePlayer(squadId, 'Ann');
  const b = makePlayer(squadId, 'Bob');

  it('sets and clears a keeper and a unit preference, touching only that player', () => {
    let players = setKeeperPreference([a, b], a.id, 'main');
    players = setUnitPreference(players, b.id, 'ATT');
    expect(preferenceSummary(players[0])).toBe('Main keeper');
    expect(preferenceSummary(players[1])).toBe('FWD');
    players = setKeeperPreference(players, a.id, null);
    expect(preferenceSummary(players[0])).toBe('');
  });

  it('survives retire and bring back (#77, #86 AC4)', () => {
    const played = playedPlayerIds([{ appearances: [{ playerId: a.id }] }]);
    let players = setKeeperPreference([a, b], a.id, 'backup');
    players = restorePlayer(removePlayer(players, a.id, played), a.id);
    expect(players[0].keeper).toBe('backup');
  });
});
