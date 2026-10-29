/**
 * Released data survives every update — #167 AC2 and AC4.
 *
 * Each `fixtures/release-<version>/` holds what a RELEASED build stored on a
 * phone, written by that release's own code (`store.json`), and the figures
 * that release showed for it (`expected.json`). See the README beside each,
 * and `scripts/freeze-release-fixture.ts`.
 *
 * THIS build must load every one of them through the normal load and
 * migrate path, find a ledger whose hash chain verifies, and show the same
 * per-child figures. A difference names the child and the figure.
 *
 * The fixtures are discovered, so the next release's needs no new test code:
 * freeze it, add it to `fixtures/releases.json`, and it is tested here.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LEDGER_VERSION, type Ledger } from './ledger';
import { verifyChain } from './ledgerChain';
import { openStoredLedger, saveLedger } from './storage/ledgerStore';
import {
  MIGRATIONS,
  SCHEMA_VERSION,
  STORAGE_KEY,
  createMemoryStore,
  loadSession,
  readSession,
  saveSession,
  type KeyValueStore,
  type SavedSession,
} from './persistence';
import { figureDifferences, releaseFigures } from './releaseFigures';
import { BEFORE_TEAMS_PREFIX, openTeams, teamKey, teamStore } from './storage/teams';
import type { UUID } from '../types/index';

const FIXTURES = resolve(__dirname, 'fixtures');
const MANIFEST = resolve(FIXTURES, 'releases.json');
const FILES = ['store.json', 'expected.json', 'release.json'] as const;

interface ReleaseMeta {
  version: string;
  commit: string;
  now: string;
  sessionSchemaVersion: number;
  ledgerVersion: number;
  migrations: { from: number; to: number }[];
  /** From 2.0.0: the release kept its data in a team (ADR-022 D2). Absent: at the root, as 1.x did. */
  layout?: 'teams';
  teamId?: UUID;
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, Record<string, string>>;
const onDisk = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name.startsWith('release-'))
  .map((d) => d.name.slice('release-'.length))
  .sort();

const read = (version: string, file: string): string => readFileSync(resolve(FIXTURES, `release-${version}`, file), 'utf8');

/** A phone holding exactly what the release stored. */
async function phoneWith(dump: Record<string, string>): Promise<KeyValueStore> {
  const store = createMemoryStore();
  for (const [key, value] of Object.entries(dump)) await store.setItem(key, value);
  return store;
}

/** Launch, as App.tsx does it: the session, then the ledger. */
async function launch(store: KeyValueStore, now: Date): Promise<{ session: SavedSession; ledger: Ledger }> {
  const session = await loadSession(store);
  const opened = await openStoredLedger(store, now);
  expect(session, 'the session did not load').not.toBeNull();
  expect(opened.message, 'the ledger opened with a warning').toBe('');
  expect(opened.writable, 'the ledger opened read-only').toBe(true);
  expect(opened.ledger, 'the ledger did not load').not.toBeNull();
  return { session: session as SavedSession, ledger: opened.ledger as Ledger };
}

describe('the release manifest (#167 AC4)', () => {
  it('lists at least the first store release', () => {
    expect(Object.keys(manifest)).toContain('1.0.0');
  });

  it('every listed release still has its fixture, unedited', () => {
    for (const [version, hashes] of Object.entries(manifest)) {
      for (const file of FILES) {
        const path = resolve(FIXTURES, `release-${version}`, file);
        expect(existsSync(path), `release-${version}/${file} has been deleted`).toBe(true);
        const sha = createHash('sha256').update(readFileSync(path)).digest('hex');
        expect(sha, `release-${version}/${file} has been edited; a release fixture is never edited`).toBe(
          hashes[file]
        );
      }
    }
  });

  it('every fixture on disk is listed, so none is tested without being guarded', () => {
    expect(onDisk).toEqual(Object.keys(manifest).sort());
  });
});

describe.each(onDisk)('release %s, loaded by this build (#167 AC2)', (version) => {
  const meta = JSON.parse(read(version, 'release.json')) as ReleaseMeta;
  const dump = JSON.parse(read(version, 'store.json')) as Record<string, string>;
  const expected = JSON.parse(read(version, 'expected.json')) as unknown;
  const now = new Date(meta.now);
  /** Where the release kept a key: in its team from 2.0.0, else at the root. */
  const at = (key: string) => (meta.layout === 'teams' ? teamKey(meta.teamId as UUID, key) : key);
  /** The store this build launches from: the release's team, opened as the shell opens it. */
  const opened = async (root: KeyValueStore): Promise<KeyValueStore> => {
    if (meta.layout !== 'teams') return root;
    const o = await openTeams(root, now, () => 'a-new-team' as UUID);
    expect(o, 'the release’s team did not open as it was').toMatchObject({
      kind: 'team',
      teamId: meta.teamId,
      moved: false,
    });
    return teamStore(root, meta.teamId as UUID);
  };

  it('was frozen by the release itself, not by this build', () => {
    expect(meta.version).toBe(version);
    expect(meta.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('reads its session through the normal migrate path', () => {
    const result = readSession(dump[at(STORAGE_KEY)]);
    expect(result.status).toBe('ok');
  });

  it('opens a ledger whose hash chain verifies', async () => {
    const { ledger } = await launch(await opened(await phoneWith(dump)), now);
    expect(verifyChain(ledger.entries)).toEqual({ ok: true });
  });

  it('shows every child the same figures the release did', async () => {
    const { session, ledger } = await launch(await opened(await phoneWith(dump)), now);
    expect(figureDifferences(expected, releaseFigures(session, ledger, now))).toEqual([]);
  });

  it('still shows them after this build writes the store back', async () => {
    const first = await launch(await opened(await phoneWith(dump)), now);
    const store = createMemoryStore();
    const s = first.session;
    await saveSession(store, { ...s, matches: s.matches, state: null, now });
    await saveLedger(store, first.ledger);
    const again = await launch(store, now);
    expect(verifyChain(again.ledger.entries)).toEqual({ ok: true });
    expect(figureDifferences(expected, releaseFigures(again.session, again.ledger, now))).toEqual([]);
  });

  // --- 2.0.0: the phone's data becomes the first team (#224 AC3, ADR-022 D3) ---
  // Only for a release from before teams: one from 2.0.0 on opens in place (above).

  if (meta.layout !== 'teams') {
    const TEAM = '00000000-0000-4000-8000-00000000c0de' as UUID;

    it('moves into the first team and shows every child the same figures', async () => {
      const root = await phoneWith(dump);
      const opened = await openTeams(root, now, () => TEAM);
      expect(opened).toMatchObject({ kind: 'team', teamId: TEAM, moved: true });
      const { session, ledger } = await launch(teamStore(root, TEAM), now);
      expect(verifyChain(ledger.entries)).toEqual({ ok: true });
      expect(figureDifferences(expected, releaseFigures(session, ledger, now))).toEqual([]);
    });

    it('keeps every key it moved byte for byte, in the team and set aside', async () => {
      const root = await phoneWith(dump);
      await openTeams(root, now, () => TEAM);
      const team = teamStore(root, TEAM);
      for (const [key, value] of Object.entries(dump)) {
        expect(await team.getItem(key), key).toBe(value);
        expect(await root.getItem(BEFORE_TEAMS_PREFIX + key.slice('coaching-app/'.length)), key).toBe(value);
        expect(await root.getItem(key), `${key} left at the root`).toBeNull();
      }
    });

    it('opens the same figures at the next launch, and after this build writes the team back', async () => {
      const root = await phoneWith(dump);
      await openTeams(root, now, () => TEAM);
      const again = await openTeams(root, now, () => 'not-this' as UUID);
      expect(again).toMatchObject({ kind: 'team', teamId: TEAM, moved: false });
      const team = teamStore(root, TEAM);
      const first = await launch(team, now);
      await saveSession(team, { ...first.session, matches: first.session.matches, state: null, now });
      await saveLedger(team, first.ledger);
      const after = await launch(team, now);
      expect(verifyChain(after.ledger.entries)).toEqual({ ok: true });
      expect(figureDifferences(expected, releaseFigures(after.session, after.ledger, now))).toEqual([]);
    });
  }

  // --- AC4: schema changes are deliberate ------------------------------------

  it('this build is not older than what the release wrote', () => {
    expect(SCHEMA_VERSION, 'SCHEMA_VERSION went below a released one').toBeGreaterThanOrEqual(
      meta.sessionSchemaVersion
    );
    expect(LEDGER_VERSION, 'LEDGER_VERSION went below a released one').toBeGreaterThanOrEqual(meta.ledgerVersion);
  });

  it('keeps every migration the release had', () => {
    const have = MIGRATIONS.map((m) => `${m.from}->${m.to}`);
    for (const m of meta.migrations) {
      expect(have, `the ${m.from} -> ${m.to} migration has been removed`).toContain(`${m.from}->${m.to}`);
    }
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(meta.migrations.length);
  });
});

describe('the migration chain (#167 AC4)', () => {
  it('runs unbroken from v1 to SCHEMA_VERSION, so a schema bump needs a migration', () => {
    MIGRATIONS.forEach((m, i) => {
      expect(m.from).toBe(i + 1);
      expect(m.to).toBe(i + 2);
    });
    expect(MIGRATIONS[MIGRATIONS.length - 1].to).toBe(SCHEMA_VERSION);
  });
});
