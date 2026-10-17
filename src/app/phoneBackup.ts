/**
 * Whole-phone backup and restore — #192, ADR-021 D5.
 *
 * A minutes file carries the minutes record only. A phone backup carries
 * everything the phone keeps: the saved session (squad, players, fixtures,
 * plans, settings, every match) and the minutes record, in one file, so a
 * phone can be put back exactly as it was.
 *
 * Restoring never deletes (#192 AC3, the #173 rule). What is on the phone now
 * is copied aside under its own keys and read back first; only a proved copy
 * lets the restore write. The ledger and its head are written together, in
 * the same turn as the copy, so no queued save can land between them.
 *
 * Pure apart from the `KeyValueStore` it is handed: the file itself is moved
 * by `ledgerFile.ts`.
 */

import { chainHead, serialiseChainHead } from './ledgerAnchor';
import { LEDGER_HEAD_KEY, LEDGER_STORAGE_KEY, LEDGER_V1_STORAGE_KEY } from './ledgerStore';
import { isWritable, parseLedger, serialiseLedger, type Ledger } from './ledger';
import { STORAGE_KEY, inTurn, readSession, type KeyValueStore, type SavedSession } from './persistence';

export const BACKUP_ID = 'coaching-app/phone-backup';
export const BACKUP_VERSION = 1;

/** Where a restore keeps what it replaced: one folder per restore. */
export const RESTORE_ASIDE_PREFIX = 'coaching-app/before-restore/';

/** Which app made a backup, for the confirm screen (AC6). */
export interface BackupSource {
  app: string;
  build: string;
}

/** What the coach is shown before anything changes (AC2). */
export interface BackupPreview {
  from: BackupSource;
  writtenAt: string;
  squadName: string;
  players: number;
  fixtures: number;
  played: number;
  entries: number;
  /** Six hex of the chain head, as Export and Import show it (ADR-014 N1). */
  head: string;
}

export interface ReadBackup {
  ok: true;
  preview: BackupPreview;
  /** The session exactly as it will be stored. */
  sessionText: string;
  /** Null when the backup was taken before any minutes were recorded. */
  ledger: Ledger | null;
}

/** The backup file's text. The ledger is written as Export minutes file writes it. */
export function makePhoneBackup(
  session: SavedSession,
  ledger: Ledger | null,
  from: BackupSource,
  now: Date
): string {
  return JSON.stringify(
    {
      backup: BACKUP_ID,
      version: BACKUP_VERSION,
      writtenAt: now.toISOString(),
      from,
      session,
      ledger: ledger ? JSON.parse(serialiseLedger(ledger, false)) : null,
    },
    null,
    2
  );
}

/** "phone-backup-2026-10-17.json". */
export function backupFileName(now: Date): string {
  return `phone-backup-${now.toISOString().slice(0, 10)}.json`;
}

const NOTHING = 'Nothing on this phone has been changed.';

/**
 * Read and check a backup without touching the phone (AC2, AC5). The session
 * must read as this build reads its own; the minutes record must verify and
 * be one this build may write.
 */
export function readPhoneBackup(text: string): ReadBackup | { ok: false; reason: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: `That file is not a phone backup. ${NOTHING}` };
  }
  if (typeof raw !== 'object' || raw === null || (raw as { backup?: unknown }).backup !== BACKUP_ID) {
    return {
      ok: false,
      reason: `That file is not a phone backup. A minutes file goes in through Import minutes file. ${NOTHING}`,
    };
  }
  const file = raw as {
    version?: unknown;
    writtenAt?: unknown;
    from?: { app?: unknown; build?: unknown };
    session?: unknown;
    ledger?: unknown;
  };
  if (typeof file.version !== 'number' || file.version > BACKUP_VERSION) {
    return { ok: false, reason: `That backup was made by a newer version of the app. Update the app first. ${NOTHING}` };
  }

  const sessionText = JSON.stringify(file.session ?? null);
  const session = readSession(sessionText);
  if (session.status === 'too_new') {
    return { ok: false, reason: `That backup was made by a newer version of the app. Update the app first. ${NOTHING}` };
  }
  if (session.status !== 'ok') {
    return { ok: false, reason: `The squad and fixtures in that backup are damaged. ${NOTHING}` };
  }

  let ledger: Ledger | null = null;
  if (file.ledger !== null && file.ledger !== undefined) {
    const parsed = parseLedger(JSON.stringify(file.ledger));
    if (!parsed.ok) return { ok: false, reason: `The minutes record in that backup: ${parsed.reason} ${NOTHING}` };
    if (!isWritable(parsed.ledger)) {
      return {
        ok: false,
        reason: `The minutes record in that backup was made by a newer version of the app. Update the app first. ${NOTHING}`,
      };
    }
    ledger = parsed.ledger;
  }

  const saved = session.session;
  const head = ledger && ledger.entries.length > 0 ? chainHead(ledger).headHash.slice(0, 6) : '';
  return {
    ok: true,
    sessionText,
    ledger,
    preview: {
      from: {
        app: typeof file.from?.app === 'string' ? file.from.app : 'an unknown app',
        build: typeof file.from?.build === 'string' ? file.from.build : '',
      },
      writtenAt: typeof file.writtenAt === 'string' ? file.writtenAt : '',
      squadName: saved.squadName,
      players: saved.players.filter((p) => p.active !== false).length,
      fixtures: saved.matches.filter((m) => m.match.status === 'planned').length,
      played: ledger
        ? ledger.matches.filter((m) => m.status === 'completed').length
        : saved.matches.filter((m) => m.match.status === 'completed').length,
      entries: ledger?.entries.length ?? 0,
      head,
    },
  };
}

/** The preview in words, for the confirm sheet. */
export function describeBackup(p: BackupPreview): string {
  const made = p.writtenAt ? new Date(p.writtenAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'an unknown date';
  const record = p.entries > 0 ? `minutes record ${p.entries} entries · ${p.head}` : 'no minutes recorded';
  return (
    `${p.squadName} · ${p.players} ${p.players === 1 ? 'player' : 'players'} · ` +
    `${p.fixtures} upcoming · ${p.played} played · ${record}. ` +
    `Backed up from ${p.from.app}${p.from.build ? ` (${p.from.build})` : ''} on ${made}.`
  );
}

export type RestoreOutcome = { ok: true; asideKey: string } | { ok: false; reason: string };

/**
 * Replace what the phone keeps with the backup, after copying what is there
 * aside and reading the copy back (AC3). Runs in the store's turn, behind any
 * save still queued, so an older save cannot land on top of the restore.
 */
export function restorePhoneBackup(store: KeyValueStore, backup: ReadBackup, now: Date): Promise<RestoreOutcome> {
  const run = async (): Promise<RestoreOutcome> => {
    const aside = `${RESTORE_ASIDE_PREFIX}${now.toISOString()}/`;
    try {
      for (const key of [STORAGE_KEY, LEDGER_STORAGE_KEY, LEDGER_HEAD_KEY, LEDGER_V1_STORAGE_KEY]) {
        const value = await store.getItem(key);
        if (value === null) continue;
        await store.setItem(aside + key, value);
        if ((await store.getItem(aside + key)) !== value) throw new Error('copy did not read back');
      }
    } catch {
      return {
        ok: false,
        reason: `What is on this phone now could not be set aside safely, so nothing was restored. ${NOTHING}`,
      };
    }

    try {
      await store.setItem(STORAGE_KEY, backup.sessionText);
      if (backup.ledger && backup.ledger.entries.length > 0) {
        // The head first goes, then the ledger, then its head: a crash between
        // writes leaves no head, never one the ledger cannot match (ledgerStore).
        await store.removeItem(LEDGER_HEAD_KEY);
        await store.setItem(LEDGER_STORAGE_KEY, serialiseLedger(backup.ledger, false));
        await store.setItem(LEDGER_HEAD_KEY, serialiseChainHead(chainHead(backup.ledger)));
      } else {
        // No minutes in the backup: none may come back from this phone either,
        // and a pre-v2 ledger is read whenever v2 is missing (ADR-014 §7).
        for (const key of [LEDGER_HEAD_KEY, LEDGER_STORAGE_KEY, LEDGER_V1_STORAGE_KEY]) await store.removeItem(key);
      }
    } catch {
      return {
        ok: false,
        reason:
          'The restore could not be finished. What was on this phone is kept aside and nothing was deleted. ' +
          'Close the app and open it again before trying once more.',
      };
    }
    return { ok: true, asideKey: aside };
  };
  return inTurn(store, run);
}
