/**
 * #173: launch must never write an empty squad over a session it cannot read.
 *
 * Each case drives what the shell does at launch: open the stored session,
 * then make the save that every launch makes, with the empty squad a new
 * install starts from. The stored text must survive it.
 */

import { describe, it, expect } from 'vitest';
import { uuid } from '../../types/index';
import {
  MIN_READER_VERSION,
  SCHEMA_VERSION,
  STORAGE_KEY,
  createMemoryStore,
  saveSession,
  type KeyValueStore,
  type SessionInput,
} from '../persistence';
import { makeSevenASideFormat } from '../placeholderSquad';
import { makePlayer } from '../squad';
import { UNREADABLE_SESSION_PREFIX, openStoredSession, saveSessionIfWritable } from './sessionStore';

const NOW = new Date('2026-10-10T09:00:00.000Z');

function input(players: SessionInput['players'] = []): SessionInput {
  return {
    squadName: 'Test FC',
    squadId: uuid(),
    players,
    format: makeSevenASideFormat(),
    totalMinutes: 50,
    periodCount: 4,
    plan: {},
    matches: [],
    state: null,
  };
}

/** The save every launch makes once it leaves the loading screen. */
const firstSave = (store: KeyValueStore, writable: boolean) => saveSessionIfWritable(store, writable, input());

const TOO_NEW = JSON.stringify({
  schemaVersion: SCHEMA_VERSION + 1,
  minReaderVersion: MIN_READER_VERSION + 1,
  squadName: 'Newer FC',
  players: [{ firstName: 'Ava' }],
});
const NOT_JSON = '{"schemaVersion": 6, "players": [';

describe('openStoredSession (#173)', () => {
  it('AC5: a readable session opens and may be written, as before', async () => {
    const store = createMemoryStore();
    await saveSession(store, input([makePlayer(uuid(), 'Ava')]));
    const opened = await openStoredSession(store, NOW);
    expect(opened.writable).toBe(true);
    expect(opened.message).toBe('');
    expect(opened.session?.players.map((p) => p.firstName)).toEqual(['Ava']);
  });

  it('AC5: an empty store is a new install, as before', async () => {
    const opened = await openStoredSession(createMemoryStore(), NOW);
    expect(opened).toEqual({ session: null, writable: true, message: '' });
  });

  it('AC3: a too-new session is left exactly as it was after the first save', async () => {
    const store = createMemoryStore();
    await store.setItem(STORAGE_KEY, TOO_NEW);
    const opened = await openStoredSession(store, NOW);
    expect(opened.session).toBeNull();
    expect(opened.writable).toBe(false);
    expect(opened.message).toMatch(/newer version/);
    expect(opened.message).toMatch(/Nothing has been deleted/);

    expect(await firstSave(store, opened.writable)).toBe(false);
    expect(await store.getItem(STORAGE_KEY)).toBe(TOO_NEW);
  });

  it('AC1: an unreadable session is set aside byte for byte, then a new one may start', async () => {
    const store = createMemoryStore();
    await store.setItem(STORAGE_KEY, NOT_JSON);
    const opened = await openStoredSession(store, NOW);
    expect(opened.session).toBeNull();
    expect(opened.writable).toBe(true);
    expect(opened.setAsideKey).toBe(`${UNREADABLE_SESSION_PREFIX}${NOW.toISOString()}`);
    expect(opened.message).toMatch(/set aside unchanged/);

    expect(await firstSave(store, opened.writable)).toBe(true);
    expect(await store.getItem(opened.setAsideKey!)).toBe(NOT_JSON);
  });

  it('AC1: a session that parses but fails validation is set aside too', async () => {
    const store = createMemoryStore();
    const broken = JSON.stringify({ schemaVersion: SCHEMA_VERSION, minReaderVersion: MIN_READER_VERSION, players: 'Ava' });
    await store.setItem(STORAGE_KEY, broken);
    const opened = await openStoredSession(store, NOW);
    expect(opened.writable).toBe(true);
    expect(await store.getItem(opened.setAsideKey!)).toBe(broken);
  });

  it('AC2: a copy that cannot be proved blocks writing, and the original stays', async () => {
    const memory = createMemoryStore();
    await memory.setItem(STORAGE_KEY, NOT_JSON);
    const store: KeyValueStore = {
      ...memory,
      // The copy "succeeds" but reads back different: not proved.
      setItem: (key, value) =>
        key.startsWith(UNREADABLE_SESSION_PREFIX) ? memory.setItem(key, value.slice(1)) : memory.setItem(key, value),
    };
    const opened = await openStoredSession(store, NOW);
    expect(opened.writable).toBe(false);
    expect(opened.message).toMatch(/could not be set aside/);

    expect(await firstSave(store, opened.writable)).toBe(false);
    expect(await memory.getItem(STORAGE_KEY)).toBe(NOT_JSON);
  });

  it('AC2: a copy that fails to write blocks writing', async () => {
    const memory = createMemoryStore();
    await memory.setItem(STORAGE_KEY, NOT_JSON);
    const store: KeyValueStore = {
      ...memory,
      setItem: async (key, value) => {
        if (key.startsWith(UNREADABLE_SESSION_PREFIX)) throw new Error('disk full');
        return memory.setItem(key, value);
      },
    };
    const opened = await openStoredSession(store, NOW);
    expect(opened.writable).toBe(false);
    expect(await memory.getItem(STORAGE_KEY)).toBe(NOT_JSON);
  });

  /** A stored session with one whole match and one missing its quarters. */
  async function withOneBrokenMatch(store: KeyValueStore): Promise<string> {
    await saveSession(store, input([makePlayer(uuid(), 'Ava')]));
    const saved = JSON.parse((await store.getItem(STORAGE_KEY))!);
    const match = (id: string) => ({ match: { id, status: 'planned' }, quarters: [], appearances: [], benchStints: [] });
    const broken = { ...match('broken'), quarters: undefined };
    saved.matches = [match('kept'), broken];
    const text = JSON.stringify(saved);
    await store.setItem(STORAGE_KEY, text);
    return text;
  }

  it('#177: a match that will not read is left out, after the whole document is set aside', async () => {
    const store = createMemoryStore();
    const text = await withOneBrokenMatch(store);
    const opened = await openStoredSession(store, NOW);
    expect(opened.writable).toBe(true);
    expect(opened.session?.players.map((p) => p.firstName)).toEqual(['Ava']);
    expect(opened.session?.matches.map((m) => m.match.id)).toEqual(['kept']);
    expect(opened.message).toMatch(/One match on this phone would not read/);
    expect(opened.message).toMatch(/Nothing has been deleted/);

    expect(await firstSave(store, opened.writable)).toBe(true);
    expect(await store.getItem(opened.setAsideKey!)).toBe(text);
  });

  it('#177: when that copy cannot be proved, the squad still opens but nothing is written', async () => {
    const memory = createMemoryStore();
    const text = await withOneBrokenMatch(memory);
    const store: KeyValueStore = {
      ...memory,
      setItem: async (key, value) => {
        if (key.startsWith(UNREADABLE_SESSION_PREFIX)) throw new Error('disk full');
        return memory.setItem(key, value);
      },
    };
    const opened = await openStoredSession(store, NOW);
    expect(opened.writable).toBe(false);
    expect(opened.session?.matches).toHaveLength(1);
    expect(opened.message).toMatch(/could not be set aside/);

    expect(await firstSave(store, opened.writable)).toBe(false);
    expect(await memory.getItem(STORAGE_KEY)).toBe(text);
  });

  it('a store that fails to read blocks writing: the session may be perfectly fine', async () => {
    const memory = createMemoryStore();
    await saveSession(memory, input([makePlayer(uuid(), 'Ava')]));
    const before = await memory.getItem(STORAGE_KEY);
    const store: KeyValueStore = {
      ...memory,
      getItem: async () => {
        throw new Error('storage unavailable');
      },
    };
    const opened = await openStoredSession(store, NOW);
    expect(opened.writable).toBe(false);
    expect(opened.message).toMatch(/could not be read/);

    expect(await firstSave(store, opened.writable)).toBe(false);
    expect(await memory.getItem(STORAGE_KEY)).toBe(before);
  });
});
