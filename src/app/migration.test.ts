/**
 * The golden fixture — #61.
 *
 * `fixtures/session-v1.json` is a REAL v1 document, produced by running the v1
 * writer before v2 existed. It is not a reconstruction of the v1 shape, and
 * that distinction is the whole value of it: a reconstruction is written by
 * the same person who changed the schema, and therefore agrees with the new
 * code by construction. A captured payload does not.
 *
 * It carries invented names — Ash, Blue, Cedar — never a real squad. ADR-011
 * and the public-repository ruling (#38) mean nothing from a device running a
 * real squad goes into this repository, and PO-approved on 2026-09-19.
 *
 * THIS FILE IS NEVER REGENERATED. It is a historical artifact. When v3 arrives
 * this same document must still load, through two migrations instead of one.
 */

import { describe, expect, it } from 'vitest';

import fixtureV1 from './fixtures/session-v1.json';
import {
  MIGRATIONS,
  MIN_READER_VERSION,
  SCHEMA_VERSION,
  parseSession,
  readSession,
  toMatchState,
  toSavedSession,
} from './persistence';
import { migrateDocument } from './schema';
import type { PositionUnit } from '../types/index';

const rawV1 = JSON.stringify(fixtureV1);

describe('a v1 save written by the released app', () => {
  it('is genuinely a v1 document', () => {
    // If this ever fails, the fixture has been regenerated and the test below
    // is no longer proving anything.
    expect(fixtureV1.schemaVersion).toBe(1);
    expect(fixtureV1).not.toHaveProperty('minReaderVersion');
  });

  it('LOADS — which is the whole point of this slice', () => {
    // The old code returned null here the moment SCHEMA_VERSION moved, and the
    // coach opened the app to an empty squad with no backup to recover from.
    const result = readSession(rawV1);
    expect(result.status).toBe('ok');
  });

  it('keeps every player, with their names intact', () => {
    const result = readSession(rawV1);
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.session.players).toHaveLength(10);
    expect(result.session.players.map((p) => p.firstName)).toEqual(
      fixtureV1.players.map((p) => p.firstName)
    );
    expect(result.session.squadName).toBe('Riverside Rovers');
  });

  it('keeps the match, every quarter and every recorded interval', () => {
    const result = readSession(rawV1);
    if (result.status !== 'ok') throw new Error(result.status);
    const match = result.session.match!;
    expect(match.quarters).toHaveLength(4);
    expect(match.appearances).toHaveLength(fixtureV1.match.appearances.length);
    expect(match.appearances).toHaveLength(21);
  });

  it('reports which migrations ran, rather than migrating silently', () => {
    const result = readSession(rawV1);
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.migrationsApplied).toEqual([
      'v1 → v2: positions and appearances carry a unit',
    ]);
  });

  it('arrives at the current version, ready to be written back', () => {
    const result = readSession(rawV1);
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.session.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.session.minReaderVersion).toBe(MIN_READER_VERSION);
  });

  it('still folds to the same elapsed time it was saved with', () => {
    // The migration must not disturb the wall-clock anchors. If it did, a
    // coach mid-match would relaunch to a different clock — invariant 2 broken
    // by a data change rather than a code change.
    const result = readSession(rawV1);
    if (result.status !== 'ok') throw new Error(result.status);
    const state = toMatchState(result.session)!;
    const before = fixtureV1.match.quarters.map((q) => q.accumulatedMs);
    expect(state.quarters.map((q) => q.accumulatedMs)).toEqual(before);
    expect(state.quarters.map((q) => q.runningSinceWallClock)).toEqual(
      fixtureV1.match.quarters.map((q) => q.runningSinceWallClock)
    );
  });
});

describe('what v1 → v2 does and does not invent', () => {
  it('gives the goalkeeping position the GK unit, because that much IS known', () => {
    const result = readSession(rawV1);
    if (result.status !== 'ok') throw new Error(result.status);
    const keeper = result.session.format.positions.find((p) => p.kind === 'goalkeeper')!;
    expect(keeper.unit).toBe<PositionUnit>('GK');
  });

  it('recovers outfield units from labels that are catalogue codes', () => {
    // The v1 format used 'LB', 'CM', 'ST' as labels, and those DO carry the
    // answer — so most real formats migrate fully without anything invented.
    const result = readSession(rawV1);
    if (result.status !== 'ok') throw new Error(result.status);
    const byLabel = new Map(result.session.format.positions.map((p) => [p.label, p.unit]));
    expect(byLabel.get('LB')).toBe<PositionUnit>('DEF');
    expect(byLabel.get('RB')).toBe<PositionUnit>('DEF');
    expect(byLabel.get('CM')).toBe<PositionUnit>('MID');
    expect(byLabel.get('ST')).toBe<PositionUnit>('ATT');

    // 'LW' and 'RW' are grassroots terms for Left and Right Midfield in the
    // catalogue, so the real 7-a-side format migrates with nothing left null.
    expect(byLabel.get('LW')).toBe<PositionUnit>('MID');
    expect(byLabel.get('RW')).toBe<PositionUnit>('MID');
    expect([...byLabel.values()].every((u) => u !== null)).toBe(true);
  });

  it('leaves a unit NULL rather than guessing when v1 recorded nothing', () => {
    // The property worth defending. A fabricated unit would sit in a child's
    // history looking exactly like a measured one.
    const v1 = JSON.parse(rawV1);
    v1.format.positions = v1.format.positions.map((p: Record<string, unknown>) =>
      p.kind === 'outfield' ? { ...p, label: 'Wherever he fancies' } : p
    );
    const result = readSession(JSON.stringify(v1));
    if (result.status !== 'ok') throw new Error(result.status);
    const outfield = result.session.format.positions.filter((p) => p.kind === 'outfield');
    expect(outfield.length).toBeGreaterThan(0);
    expect(outfield.every((p) => p.unit === null)).toBe(true);
  });

  it('gives every migrated appearance the unit of the position it was played in', () => {
    const result = readSession(rawV1);
    if (result.status !== 'ok') throw new Error(result.status);
    const unitOf = new Map(result.session.format.positions.map((p) => [p.id, p.unit]));
    const match = result.session.match!;
    expect(match.appearances.length).toBeGreaterThan(0);
    for (const appearance of match.appearances) {
      expect(appearance.positionUnit).toBe(unitOf.get(appearance.positionId));
    }
  });

  it('still knows a keeper was a keeper even if the position has vanished', () => {
    // The half that CAN be honoured when the format no longer has the slot.
    const v1 = JSON.parse(rawV1);
    v1.format.positions = [];
    const result = readSession(JSON.stringify(v1));
    if (result.status !== 'ok') throw new Error(result.status);
    const keeperIntervals = result.session.match!.appearances.filter(
      (a) => a.positionKind === 'goalkeeper'
    );
    expect(keeperIntervals.length).toBeGreaterThan(0);
    expect(keeperIntervals.every((a) => a.positionUnit === 'GK')).toBe(true);
  });
});

describe('a round trip does not lose anything', () => {
  it('survives load → save → load unchanged', () => {
    const first = readSession(rawV1);
    if (first.status !== 'ok') throw new Error(first.status);
    const saved = toSavedSession({
      squadName: first.session.squadName,
      squadId: first.session.squadId,
      players: first.session.players,
      format: first.session.format,
      totalMinutes: first.session.totalMinutes,
      periodCount: first.session.periodCount,
      plan: first.session.plan,
      state: toMatchState(first.session),
      now: new Date(fixtureV1.savedAt),
    });
    const second = parseSession(JSON.stringify(saved))!;
    expect(second.players).toEqual(first.session.players);
    expect(second.format.positions.map((p) => p.unit)).toEqual(
      first.session.format.positions.map((p) => p.unit)
    );
    expect(second.match!.appearances).toHaveLength(21);
  });

  it('carries a field from a FUTURE version through untouched', () => {
    // The one that decides whether a second device ever works. An older build
    // that drops what it does not understand, then saves, deletes the newer
    // build's data — silently, on someone else's phone.
    const v1 = JSON.parse(rawV1);
    v1.seasonLedger = { rounds: [1, 2, 3], note: 'written by a later version' };
    const result = readSession(JSON.stringify(v1));
    if (result.status !== 'ok') throw new Error(result.status);
    expect((result.session as Record<string, unknown>).seasonLedger).toEqual({
      rounds: [1, 2, 3],
      note: 'written by a later version',
    });
  });
});

describe('a save from a newer build', () => {
  it('is refused in words a coach can act on, not as an empty squad', () => {
    const future = { ...JSON.parse(rawV1), schemaVersion: 99, minReaderVersion: 99 };
    const result = readSession(JSON.stringify(future));
    expect(result.status).toBe('too_new');
    if (result.status !== 'too_new') return;
    expect(result.message).toContain('Update the app');
    expect(result.message).toContain('Nothing has been changed');
  });

  it('is READ when it declares that older builds are safe', () => {
    const future = { ...JSON.parse(rawV1), schemaVersion: 99, minReaderVersion: 2 };
    const result = readSession(JSON.stringify(future));
    expect(result.status).toBe('ok');
  });
});

describe('the chain itself', () => {
  it('has no gaps between 1 and the current version', () => {
    for (let v = 1; v < SCHEMA_VERSION; v++) {
      expect(MIGRATIONS.some((m) => m.from === v)).toBe(true);
    }
  });

  it('never leaves a half-applied document behind on failure', () => {
    const exploding = [
      { from: 1, to: 2, describe: 'boom', up: () => { throw new Error('boom'); } },
    ];
    const outcome = migrateDocument(JSON.parse(rawV1), exploding, 2, 2);
    expect(outcome.ok).toBe(false);
  });
});
