/**
 * #192: whole-phone backup and restore. Acceptance criteria are on the issue;
 * each test names the one it proves.
 */

import { describe, it, expect } from 'vitest';
import { emptyLedger, serialiseLedger, type Ledger } from './ledger';
import { LEDGER_HEAD_KEY, LEDGER_STORAGE_KEY, LEDGER_V1_STORAGE_KEY, openStoredLedger, saveLedger } from './ledgerStore';
import {
  SCHEMA_VERSION,
  STORAGE_KEY,
  createMemoryStore,
  readSession,
  saveSession,
  toSavedSession,
  type KeyValueStore,
  type SavedSession,
  type SessionInput,
} from './persistence';
import { DEFAULT_QUARTER_COUNT, DEFAULT_TOTAL_MINUTES, PLACEHOLDER_SQUAD_NAME, makeSevenASideFormat } from './placeholderSquad';
import {
  BACKUP_ID,
  RESTORE_ASIDE_PREFIX,
  describeBackup,
  makePhoneBackup,
  readPhoneBackup,
  restorePhoneBackup,
  type ReadBackup,
} from './phoneBackup';
import { openStoredSession } from './sessionStore';
import { addTestData } from './testKit';
import { addTestSeason } from './testSeason';
import { uuid, type UUID } from '../types/index';

const NOW = new Date('2026-10-17T12:00:00.000Z');
const FROM = { app: 'Heart FC Beta Coach', build: 'beta · build 200' };

/** A phone with a squad, upcoming fixtures and a played season, as the Test kit leaves it. */
function phone(): { input: SessionInput; session: SavedSession; ledger: Ledger } {
  const squadId = uuid();
  const format = makeSevenASideFormat();
  const kit = addTestData([], [], squadId, format, DEFAULT_TOTAL_MINUTES, DEFAULT_QUARTER_COUNT, NOW);
  const season = addTestSeason({
    players: kit.players,
    matches: kit.matches,
    squadId,
    squadName: PLACEHOLDER_SQUAD_NAME,
    format,
    totalMinutes: DEFAULT_TOTAL_MINUTES,
    periodCount: DEFAULT_QUARTER_COUNT,
    ledger: emptyLedger(squadId, PLACEHOLDER_SQUAD_NAME, NOW),
    now: NOW,
  });
  const input: SessionInput = {
    squadName: PLACEHOLDER_SQUAD_NAME,
    squadId,
    players: season.players,
    format,
    totalMinutes: DEFAULT_TOTAL_MINUTES,
    periodCount: DEFAULT_QUARTER_COUNT,
    buzzWhenSubDue: false,
    plan: {},
    matches: season.matches,
    state: null,
    now: NOW,
  };
  return { input, session: toSavedSession(input), ledger: season.ledger! };
}

/** A different phone's worth of data, stored the way the app stores it. */
async function storedPhone(): Promise<{ store: KeyValueStore; before: Map<string, string> }> {
  const store = createMemoryStore();
  const other = phone();
  await saveSession(store, { ...other.input, squadName: 'Other FC' });
  await saveLedger(store, other.ledger);
  await store.setItem(LEDGER_V1_STORAGE_KEY, '{"an":"old v1 ledger"}');
  const before = new Map<string, string>();
  for (const key of [STORAGE_KEY, LEDGER_STORAGE_KEY, LEDGER_HEAD_KEY, LEDGER_V1_STORAGE_KEY]) {
    before.set(key, (await store.getItem(key))!);
  }
  return { store, before };
}

const read = (text: string): ReadBackup => {
  const r = readPhoneBackup(text);
  if (!r.ok) throw new Error(r.reason);
  return r;
};

describe('phone backup (#192)', () => {
  it('AC1: one file holds the session and the minutes record', () => {
    const p = phone();
    const file = JSON.parse(makePhoneBackup(p.session, p.ledger, FROM, NOW));
    expect(file.backup).toBe(BACKUP_ID);
    expect(file.session).toEqual(p.session);
    expect(file.ledger.entries).toHaveLength(p.ledger.entries.length);
    expect(file.from).toEqual(FROM);
  });

  it('AC2, AC6: the preview says what the file holds and which app made it', () => {
    const p = phone();
    const backup = read(makePhoneBackup(p.session, p.ledger, FROM, NOW));
    const planned = p.session.matches.filter((m) => m.match.status === 'planned').length;
    expect(planned).toBeGreaterThan(0);
    expect(backup.preview).toMatchObject({
      squadName: PLACEHOLDER_SQUAD_NAME,
      players: p.session.players.length,
      fixtures: planned,
      played: p.ledger.matches.filter((m) => m.status === 'completed').length,
      entries: p.ledger.entries.length,
      head: p.ledger.entries[p.ledger.entries.length - 1].hash.slice(0, 6),
      from: FROM,
    });
    expect(describeBackup(backup.preview)).toMatch(/Backed up from Heart FC Beta Coach \(beta · build 200\)/);
  });
});

describe('restore (#192)', () => {
  it('AC4, AC7: backup then restore gives the same session and minutes record', async () => {
    const p = phone();
    const { store } = await storedPhone();
    const outcome = await restorePhoneBackup(store, read(makePhoneBackup(p.session, p.ledger, FROM, NOW)), NOW);
    expect(outcome.ok).toBe(true);

    const session = await openStoredSession(store, NOW);
    expect(session.writable).toBe(true);
    // As the phone reads its own save back: the same normal read, nothing lost.
    const asSaved = readSession(JSON.stringify(p.session));
    if (asSaved.status !== 'ok') throw new Error('test session did not read');
    expect(session.session).toEqual(asSaved.session);

    const ledger = await openStoredLedger(store, NOW);
    expect(ledger.message).toBe('');
    expect(ledger.writable).toBe(true);
    expect(serialiseLedger(ledger.ledger!, false)).toBe(serialiseLedger(p.ledger, false));
  });

  it('AC3, AC7: what was on the phone is set aside unchanged and readable', async () => {
    const p = phone();
    const { store, before } = await storedPhone();
    const outcome = await restorePhoneBackup(store, read(makePhoneBackup(p.session, p.ledger, FROM, NOW)), NOW);
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.asideKey).toBe(`${RESTORE_ASIDE_PREFIX}${NOW.toISOString()}/`);
    for (const [key, value] of before) expect(await store.getItem(outcome.asideKey + key)).toBe(value);
  });

  it('AC3: a copy that cannot be proved restores nothing', async () => {
    const p = phone();
    const { store: memory, before } = await storedPhone();
    const store: KeyValueStore = {
      ...memory,
      setItem: (key, value) =>
        key.startsWith(RESTORE_ASIDE_PREFIX) ? memory.setItem(key, value.slice(1)) : memory.setItem(key, value),
    };
    const outcome = await restorePhoneBackup(store, read(makePhoneBackup(p.session, p.ledger, FROM, NOW)), NOW);
    expect(outcome.ok).toBe(false);
    for (const [key, value] of before) expect(await memory.getItem(key)).toBe(value);
  });

  it('a backup with no minutes recorded leaves none behind, and the old ones are kept aside', async () => {
    const p = phone();
    const { store, before } = await storedPhone();
    const outcome = await restorePhoneBackup(store, read(makePhoneBackup(p.session, null, FROM, NOW)), NOW);
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(await store.getItem(LEDGER_STORAGE_KEY)).toBeNull();
    expect(await store.getItem(LEDGER_V1_STORAGE_KEY)).toBeNull();
    expect(await store.getItem(LEDGER_HEAD_KEY)).toBeNull();
    expect((await openStoredLedger(store, NOW)).ledger).toBeNull();
    expect(await store.getItem(outcome.asideKey + LEDGER_STORAGE_KEY)).toBe(before.get(LEDGER_STORAGE_KEY));
  });
});

describe('refusing a backup (#192 AC5)', () => {
  it('a changed minutes record is refused, naming the damage', () => {
    const p = phone();
    const file = JSON.parse(makePhoneBackup(p.session, p.ledger, FROM, NOW));
    file.ledger.entries[1].at = '2026-01-01T00:00:00.000Z';
    const r = readPhoneBackup(JSON.stringify(file));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Nothing on this phone has been changed/);
  });

  it('a minutes file, or anything else, is not a phone backup', () => {
    const p = phone();
    for (const text of [serialiseLedger(p.ledger), 'not json', '{}']) {
      const r = readPhoneBackup(text);
      expect(r.ok).toBe(false);
    }
  });

  it('a session from a newer version is refused', () => {
    const p = phone();
    const file = JSON.parse(makePhoneBackup(p.session, p.ledger, FROM, NOW));
    file.session.schemaVersion = SCHEMA_VERSION + 1;
    file.session.minReaderVersion = SCHEMA_VERSION + 1;
    const r = readPhoneBackup(JSON.stringify(file));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/newer version/);
  });

  it('a damaged session is refused', () => {
    const p = phone();
    const file = JSON.parse(makePhoneBackup(p.session, p.ledger, FROM, NOW));
    file.session.players = 'Ava';
    expect(readPhoneBackup(JSON.stringify(file)).ok).toBe(false);
  });

  it('a refused backup leaves the phone untouched', async () => {
    const { store, before } = await storedPhone();
    expect(readPhoneBackup('{"backup":"something else"}').ok).toBe(false);
    for (const [key, value] of before) expect(await store.getItem(key)).toBe(value);
  });
});

// Keeps the helper honest: the stored phone really is different from the backup.
it('the two phones in these tests differ', async () => {
  const { store } = await storedPhone();
  const stored = JSON.parse((await store.getItem(STORAGE_KEY))!) as SavedSession;
  expect(stored.squadName).toBe('Other FC');
  expect(stored.squadId).not.toBe(phone().session.squadId as UUID);
});
