/**
 * Renaming a match's positions — #166.
 *
 * The test that matters most is the last one (AC3): rename every slot halfway
 * through a match and the minutes, and the per-unit figures, come out exactly
 * as they would have with the standard names (invariants 1 and 3).
 */

import { describe, it, expect } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { Format, Player, UUID } from '../types/index';
import { emptyLedger, recordMatches, seasonRows } from './ledger';
import { foldPlayerMinutes } from './playerMinutes';
import {
  POSITION_NAME_HINT,
  POSITION_NAME_MAX,
  adoptPositionNames,
  canRenamePositions,
  checkPositionName,
  hasRenamedPositions,
  nameSuggestions,
  renamePosition,
  renameScopeHint,
  resetPositionNames,
  standardName,
} from './positionNames';
import { formatForShape, makeFormat } from './shapes';
import { makePlayer } from './squad';

const byLabel = (format: Format, label: string) => {
  const p = format.positions.find((q) => q.label === label);
  if (!p) throw new Error(`no ${label}`);
  return p;
};

const rename = (format: Format, label: string, typed: string): Format => {
  const result = renamePosition(format, byLabel(format, label).id, typed);
  if (!result.ok) throw new Error(result.reason);
  return result.format;
};

describe('checkPositionName (AC5)', () => {
  it('trims, and keeps a name of 1 to 16 characters', () => {
    expect(checkPositionName('  CDM  ', 'CM')).toEqual({ ok: true, label: 'CDM' });
    expect(checkPositionName('X', 'CM')).toEqual({ ok: true, label: 'X' });
    expect(checkPositionName('a'.repeat(POSITION_NAME_MAX), 'CM')).toEqual({
      ok: true,
      label: 'a'.repeat(16),
    });
  });

  it('refuses a name longer than 16 characters', () => {
    const result = checkPositionName('a'.repeat(17), 'CM');
    expect(result.ok).toBe(false);
  });

  it('counts characters, not UTF-16 units', () => {
    expect(checkPositionName('é'.repeat(16), 'CM').ok).toBe(true);
    expect(checkPositionName('⚽'.repeat(16), 'CM').ok).toBe(true);
    expect(checkPositionName('⚽'.repeat(17), 'CM').ok).toBe(false);
  });

  it('treats an empty or blank name as the standard name', () => {
    expect(checkPositionName('', 'CM')).toEqual({ ok: true, label: 'CM' });
    expect(checkPositionName('   ', 'LW')).toEqual({ ok: true, label: 'LW' });
  });

  it('refuses an empty name when there is no standard name to go back to', () => {
    expect(checkPositionName('', null).ok).toBe(false);
  });
});

describe('renamePosition (AC1)', () => {
  it('renames "CM" to "CDM" and changes nothing else about the slot', () => {
    const format = makeFormat('2-3-1');
    const before = byLabel(format, 'CM');
    const after = rename(format, 'CM', 'CDM');
    const renamed = after.positions.find((p) => p.id === before.id)!;
    expect(renamed).toEqual({ ...before, label: 'CDM' });
    expect(after.id).toBe(format.id);
    expect(after.onFieldCount).toBe(format.onFieldCount);
  });

  it('takes a free-text cue, e.g. "goes wherever"', () => {
    expect(byLabel(rename(makeFormat('2-3-1'), 'LW', 'goes wherever'), 'goes wherever').unit).toBe('MID');
  });

  it('leaves every other position as it was', () => {
    const format = makeFormat('2-3-1');
    const after = rename(format, 'CM', 'CDM');
    for (const p of format.positions.filter((q) => q.label !== 'CM')) {
      expect(after.positions.find((q) => q.id === p.id)).toEqual(p);
    }
  });

  it('never edits the format it was given: a match may share it with the default', () => {
    const squadDefault = makeFormat('2-3-1');
    const matchFormat = formatForShape('2-3-1', squadDefault);
    expect(matchFormat).toBe(squadDefault);
    rename(matchFormat, 'CM', 'CDM');
    expect(squadDefault.positions.map((p) => p.label)).toEqual(['GK', 'LB', 'RB', 'CM', 'LW', 'RW', 'ST']);
  });

  it('an empty name puts the standard name back', () => {
    const renamed = rename(makeFormat('2-3-1'), 'CM', 'CDM');
    expect(byLabel(rename(renamed, 'CDM', '  '), 'CM')).toBeDefined();
  });

  it('refuses a name that is too long, and a position not in the match', () => {
    const format = makeFormat('2-3-1');
    expect(renamePosition(format, byLabel(format, 'CM').id, 'x'.repeat(17)).ok).toBe(false);
    expect(renamePosition(format, uuid(), 'CDM').ok).toBe(false);
  });
});

describe('standard names and Reset names (AC6)', () => {
  it('knows each shape slot by its place, whatever it is called now', () => {
    let format = makeFormat('2-2-2');
    for (const p of format.positions) {
      const result = renamePosition(format, p.id, `cue ${p.sortOrder}`);
      if (!result.ok) throw new Error(result.reason);
      format = result.format;
    }
    expect([...format.positions].sort((a, b) => a.sortOrder - b.sortOrder).map((p) => standardName(format, p.id))).toEqual(
      ['GK', 'LB', 'RB', 'LM', 'RM', 'LF', 'RF']
    );
  });

  it('restores the shape\'s standard names for this match', () => {
    const original = makeFormat('2-3-1');
    const renamed = rename(rename(original, 'CM', 'CDM'), 'LB', 'Sweeper');
    expect(hasRenamedPositions(renamed)).toBe(true);
    const reset = resetPositionNames(renamed);
    expect(reset).toEqual(original);
    expect(hasRenamedPositions(reset)).toBe(false);
  });

  it('has no standard name for a format that is no known shape, and leaves it alone', () => {
    const custom: Format = { ...makeFormat('2-3-1'), onFieldCount: 6 };
    custom.positions = custom.positions.slice(0, 6);
    expect(standardName(custom, custom.positions[3].id)).toBeNull();
    expect(resetPositionNames(custom)).toEqual(custom);
    expect(hasRenamedPositions(custom)).toBe(false);
  });
});

describe('"Use these names for new matches" (Q2)', () => {
  it('copies the match names onto the default, which keeps its own ids', () => {
    const squadDefault = makeFormat('2-3-1');
    const matchFormat = rename(makeFormat('2-3-1'), 'CM', 'CDM');
    const adopted = adoptPositionNames(squadDefault, matchFormat)!;
    expect(adopted.id).toBe(squadDefault.id);
    expect(adopted.positions.map((p) => p.id)).toEqual(squadDefault.positions.map((p) => p.id));
    expect(adopted.positions.map((p) => p.unit)).toEqual(squadDefault.positions.map((p) => p.unit));
    expect(adopted.positions.map((p) => p.label)).toEqual(['GK', 'LB', 'RB', 'CDM', 'LW', 'RW', 'ST']);
    // The next new match in that shape starts from them (formatForShape).
    expect(formatForShape('2-3-1', adopted).positions.map((p) => p.label)).toContain('CDM');
  });

  it('is refused when the default is a different shape', () => {
    expect(adoptPositionNames(makeFormat('2-3-1'), makeFormat('2-2-2'))).toBeNull();
  });

  it('without it, a new match starts from the standard names (AC4)', () => {
    const squadDefault = makeFormat('2-3-1');
    rename(formatForShape('2-3-1', squadDefault), 'CM', 'CDM');
    expect(formatForShape('2-3-1', squadDefault).positions.map((p) => p.label)).toEqual([
      'GK', 'LB', 'RB', 'CM', 'LW', 'RW', 'ST',
    ]);
  });
});

describe('the sheet\'s words', () => {
  it('suggests the standard name first, then cues for the unit', () => {
    const format = makeFormat('2-3-1');
    expect(nameSuggestions(format, byLabel(format, 'CM').id)).toEqual(['CM', 'CDM', 'Holding mid', 'Box to box', 'Wide']);
    expect(nameSuggestions(format, byLabel(format, 'LB').id)[0]).toBe('LB');
    expect(nameSuggestions(format, byLabel(format, 'LB').id)).toContain('Sweeper');
    for (const p of format.positions) {
      for (const s of nameSuggestions(format, p.id)) expect(checkPositionName(s, null).ok).toBe(true);
    }
  });

  it('says the name is a cue, never a child (AC7), and the unit is unmoved', () => {
    expect(POSITION_NAME_HINT).toMatch(/never a child's name/);
    expect(renameScopeHint('MID')).toBe('Just this match. Time here still counts as Midfield.');
  });
});

// --- AC3: invariants 1 and 3 ---------------------------------------------------

/**
 * Play one match: four quarters, a sub in each, with the format handed to the
 * engine for each quarter chosen by `formatFor`. Deterministic, so two runs
 * differ only in the names.
 */
function play(formatFor: (quarterIndex: number, standard: Format) => Format) {
  let nowMs = 1_760_000_000_000;
  const engine = new MatchEngine({ nowFn: () => new Date(nowMs) });
  const squadId = uuid();
  const standard = makeFormat('2-3-1');
  const players: Player[] = ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy'].map((n) =>
    makePlayer(squadId, n)
  );
  const state = engine.createMatch(squadId, standard.id, { totalMinutes: 48, quarterCount: 4 });
  for (const p of players) state.playerAvailability.set(p.id, 'available');
  const ordered = [...standard.positions].sort((a, b) => a.sortOrder - b.sortOrder);

  for (let q = 0; q < 4; q++) {
    const format = formatFor(q, standard);
    const sheet = new Map<UUID, UUID>();
    // A different seven each quarter, rotating, so everyone sees several units.
    ordered.forEach((pos, i) => sheet.set(pos.id, players[(i + q * 2) % players.length].id));
    const quarter = state.quarters.find((x) => x.index === q + 1)!;
    engine.startQuarter(state, quarter, sheet, format);
    nowMs += 5 * 60_000;
    const onIds = new Set(sheet.values());
    const benched = players.find((p) => !onIds.has(p.id))!;
    engine.substitute(state, quarter, sheet.get(ordered[4].id)!, benched.id);
    nowMs += 7 * 60_000;
    engine.endQuarter(state, quarter);
    nowMs += 2 * 60_000;
  }

  const minutes = foldPlayerMinutes(engine, state, players);
  const ledger = recordMatches(
    emptyLedger(squadId, 'Test', new Date(nowMs)),
    [state],
    players,
    'Test',
    new Date(nowMs)
  );
  const perUnit = seasonRows(ledger).map((r) => ({
    playerId: r.playerId,
    outfieldMs: r.outfieldMs,
    goalkeeperMs: r.goalkeeperMs,
    byUnit: r.byUnit,
  }));
  return {
    // Ids differ between runs; compare by name.
    minutes: minutes.map((m) => ({ ...m, playerId: players.find((p) => p.id === m.playerId)!.firstName })),
    perUnit: perUnit.map((r) => ({ ...r, playerId: players.find((p) => p.id === r.playerId)!.firstName })),
    units: state.appearances.map((a) => [a.positionKind, a.positionUnit]),
  };
}

function renameEverySlot(format: Format): Format {
  let next = format;
  for (const p of format.positions) {
    const result = renamePosition(next, p.id, `cue ${p.sortOrder}`);
    if (!result.ok) throw new Error(result.reason);
    next = result.format;
  }
  return next;
}

describe('AC3: renaming never moves a minute (invariants 1 and 3)', () => {
  it('renames every slot and keeps every unit, kind and id', () => {
    const format = makeFormat('2-3-1');
    const renamed = renameEverySlot(format);
    expect(renamed.positions.every((p) => p.label.startsWith('cue '))).toBe(true);
    expect(renamed.positions.map(({ label: _label, ...rest }) => rest)).toEqual(
      format.positions.map(({ label: _label, ...rest }) => rest)
    );
  });

  it('a match with every slot renamed from kick-off records the same minutes and per-unit figures', () => {
    const plain = play((_, standard) => standard);
    const renamed = play((_, standard) => renameEverySlot(standard));
    expect(renamed.minutes).toEqual(plain.minutes);
    expect(renamed.perUnit).toEqual(plain.perUnit);
    expect(renamed.units).toEqual(plain.units);
    // A real match, not two empty ones agreeing.
    expect(plain.minutes.some((m) => m.totalMs > 0)).toBe(true);
    expect(plain.perUnit.some((r) => r.byUnit.MID > 0 && r.byUnit.DEF >= 0)).toBe(true);
  });

  it('renaming between periods, then resetting, records the same minutes too', () => {
    const plain = play((_, standard) => standard);
    const mixed = play((q, standard) =>
      q === 1 ? renameEverySlot(standard) : q === 2 ? resetPositionNames(renameEverySlot(standard)) : standard
    );
    expect(mixed.minutes).toEqual(plain.minutes);
    expect(mixed.perUnit).toEqual(plain.perUnit);
  });
});

describe('where names can be changed (ruling Q1)', () => {
  const q = (...statuses: ('pending' | 'running' | 'ended')[]) => statuses.map((status) => ({ status }));

  it('on the Plan, before kick-off only', () => {
    expect(canRenamePositions('plan', q('pending', 'pending', 'pending', 'pending'))).toBe(true);
    expect(canRenamePositions('plan', q('running', 'pending', 'pending', 'pending'))).toBe(false);
    expect(canRenamePositions('plan', q('ended', 'pending', 'pending', 'pending'))).toBe(false);
  });

  it('on the lineup, before kick-off and between periods', () => {
    expect(canRenamePositions('lineup', q('pending', 'pending'))).toBe(true);
    expect(canRenamePositions('lineup', q('ended', 'pending'))).toBe(true);
  });

  it('never while a period runs (the live clock), nor after the last one', () => {
    expect(canRenamePositions('lineup', q('ended', 'running'))).toBe(false);
    expect(canRenamePositions('lineup', q('ended', 'ended'))).toBe(false);
  });
});
