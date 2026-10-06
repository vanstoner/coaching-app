/**
 * #157: the made-up test season a TestFlight tester imports.
 *
 * AC2: the committed file still parses, is writable by this build and
 * imports into an empty phone. A ledger format change that would break it
 * fails here until `npm run test-season-file` is run again.
 * AC3: once imported, the squad views fold from it, as App.tsx's
 * `importMinutes` leaves a fresh phone.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Player } from '../types/index';
import { emptyLedger, importLedger, isWritable, parseLedger, type Ledger } from './ledger';
import { squadViews } from './squadViews';
import { TEST_NAMES } from './testKit';
import { TEST_FILE_SQUAD_ID, testSeasonFile, testSeasonLedger } from './testSeasonFile';

const COMMITTED = resolve(__dirname, '../../test-data/test-season.json');

function parsed(text: string): Ledger {
  const r = parseLedger(text);
  if (!r.ok) throw new Error(r.reason);
  return r.ledger;
}

/** What `importMinutes` (App.tsx) does on a phone with no squad and no matches. */
function importOntoEmptyPhone(file: Ledger, now: Date): { ledger: Ledger; players: Player[] } {
  const phone = emptyLedger('phone-squad' as Player['squadId'], 'Example FC', now);
  const report = importLedger(phone, file);
  if (!report.ok) throw new Error(report.reason);
  const players: Player[] = report.ledger.players.map((p) => ({
    id: p.id,
    squadId: report.ledger.squad.id,
    firstName: p.firstName,
    displaySuffix: p.displaySuffix,
    squadNumber: null,
    active: p.active,
    createdAt: now.toISOString(),
  }));
  return { ledger: report.ledger, players };
}

describe('the test season file (#157)', () => {
  const now = new Date('2026-10-06T12:00:00Z');

  it('holds the Test kit squad and a recorded season, made-up names only', () => {
    const ledger = testSeasonLedger(now);
    expect(ledger.squad.id).toBe(TEST_FILE_SQUAD_ID);
    const names = ledger.players.map((p) => p.firstName);
    for (const n of TEST_NAMES) expect(names).toContain(n);
    for (const n of names) expect(TEST_NAMES).toContain(n);
    expect(ledger.matches.length).toBeGreaterThanOrEqual(9);
  });

  it('round-trips through the parser, as Export and Import do', () => {
    const back = parsed(testSeasonFile(now));
    expect(isWritable(back)).toBe(true);
    expect(back.entries.length).toBe(testSeasonLedger(now).entries.length);
  });

  describe('the committed file, test-data/test-season.json (AC2)', () => {
    const text = readFileSync(COMMITTED, 'utf-8');

    it('parses and this build may write it; else run `npm run test-season-file`', () => {
      const file = parsed(text);
      expect(isWritable(file)).toBe(true);
    });

    it('imports onto an empty phone with every player and every match', () => {
      const file = parsed(text);
      const phone = emptyLedger('phone-squad' as Player['squadId'], 'Example FC', now);
      const report = importLedger(phone, file);
      expect(report.ok).toBe(true);
      if (!report.ok) return;
      expect(report.addedPlayers).toBe(file.players.length);
      expect(report.addedMatches).toBe(file.matches.length);
      expect(report.addedEntries).toBe(file.entries.length);
    });

    it('fills the squad views once imported, as the demo does (AC3)', () => {
      const { ledger, players } = importOntoEmptyPhone(parsed(text), now);
      const views = squadViews(ledger, players);
      const playedSomething = views.season.children.filter((c) => c.played > 0);
      expect(playedSomething.length).toBe(TEST_NAMES.length);
      expect(views.season.squadAverageMs).not.toBeNull();
      expect(views.matches.length).toBe(ledger.matches.length);
      expect(views.positions.some((p) => p.total > 0)).toBe(true);
    });
  });
});
