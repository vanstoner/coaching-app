/**
 * Opening the stored session at launch without ever losing it — #173.
 *
 * `loadSession` answers "a session, or null", and null used to mean both "new
 * install" and "there is a session here this build cannot read". The shell
 * treated both as a new install and its first save wrote an empty squad over
 * the stored one. The ledger never had that hole (`openStoredLedger`); this
 * gives the session the same two rules (PO, `approve 1`):
 *
 * - **unreadable** (will not parse, or fails validation): copied aside under
 *   its own key and read back to prove the copy, and only then may a new
 *   session be written. A copy that cannot be proved blocks writing.
 * - **too new** (a newer build said this one must not write it), or **the
 *   store itself failed to read**: nothing is written to the session key for
 *   the rest of this launch.
 *
 * A session that reads except for some of its matches (#177) is set aside the
 * same way, then opened without them: the rest of the season stays usable and
 * the matches are not lost. A copy that cannot be proved blocks writing.
 *
 * Restoring a set-aside session is out of scope (#173): it stays on the phone,
 * as an unreadable ledger does.
 */

import {
  STORAGE_KEY,
  clearSession,
  inTurn,
  readSession,
  saveSession,
  type KeyValueStore,
  type SavedSession,
  type SessionInput,
} from '../persistence';

/** Where an unreadable session is kept: one key per launch that found one. */
export const UNREADABLE_SESSION_PREFIX = `${STORAGE_KEY}/unreadable/`;

export interface OpenedSession {
  /** What the app loads, or null to start as a new install would. */
  session: SavedSession | null;
  /** False when nothing may be written to the session key this launch. */
  writable: boolean;
  /** For the coach, in plain English; empty when there is nothing to say. */
  message: string;
  /** The key a set-aside session was copied to, when one was. */
  setAsideKey?: string;
}

const KEPT = 'Nothing has been deleted.';

export async function openStoredSession(store: KeyValueStore, now: Date): Promise<OpenedSession> {
  let raw: string | null;
  try {
    raw = await store.getItem(STORAGE_KEY);
  } catch {
    return {
      session: null,
      writable: false,
      message: `Your squad and fixtures could not be read from this phone just now. ${KEPT} Close the app and open it again; nothing will be saved until they can be read.`,
    };
  }

  const read = readSession(raw);
  switch (read.status) {
    case 'ok': {
      if (read.droppedMatches === 0) return { session: read.session, writable: true, message: '' };
      const n = read.droppedMatches;
      const them = n === 1 ? 'One match' : `${n} matches`;
      const key = await setAside(store, raw as string, now);
      if (!key) {
        return {
          session: read.session,
          writable: false,
          message: `${them} on this phone would not read, and could not be set aside safely. ${KEPT} Nothing will be saved until this is resolved.`,
        };
      }
      return {
        session: read.session,
        writable: true,
        setAsideKey: key,
        message: `${them} on this phone would not read and ${n === 1 ? 'has' : 'have'} been left out. Your squad and other fixtures are here, and a copy of everything has been set aside unchanged. ${KEPT} Player minutes are kept separately.`,
      };
    }
    case 'empty':
      return { session: null, writable: true, message: '' };
    case 'too_new':
      return {
        session: null,
        writable: false,
        // read.message names the format numbers; the coach needs what to do.
        message: `Your squad and fixtures were saved by a newer version of this app. Update the app to see them. ${KEPT} Nothing will be saved until then.`,
      };
    case 'corrupt': {
      // readSession only says corrupt for a non-empty string.
      const key = await setAside(store, raw as string, now);
      if (!key) {
        return {
          session: null,
          writable: false,
          message: `Your squad and fixtures on this phone would not read, and could not be set aside safely. ${KEPT} Nothing will be saved until this is resolved.`,
        };
      }
      return {
        session: null,
        writable: true,
        setAsideKey: key,
        message: `Your squad and fixtures on this phone would not read. They have been set aside unchanged and the app has started afresh. ${KEPT} Player minutes are kept separately.`,
      };
    }
  }
}

/**
 * Save the session only when this launch may write it (#173 AC2, AC3). Saves
 * wait their turn behind every earlier save of the session or ledger (#177).
 */
export async function saveSessionIfWritable(
  store: KeyValueStore,
  writable: boolean,
  input: SessionInput
): Promise<boolean> {
  if (!writable) return false;
  return inTurn(store, () => saveSession(store, input));
}

/** Forget the session, after any save asked for before it (#177). */
export function forgetSession(store: KeyValueStore): Promise<boolean> {
  return inTurn(store, () => clearSession(store));
}

/** Copy the stored text aside and read it back; the key, or null if not proved. */
async function setAside(store: KeyValueStore, text: string, now: Date): Promise<string | null> {
  const key = `${UNREADABLE_SESSION_PREFIX}${now.toISOString()}`;
  try {
    await store.setItem(key, text);
    return (await store.getItem(key)) === text ? key : null;
  } catch {
    return null;
  }
}
