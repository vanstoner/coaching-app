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

import { chainHead, serialiseChainHead } from '../ledgerAnchor';
import { LEDGER_HEAD_KEY, LEDGER_STORAGE_KEY, LEDGER_V1_STORAGE_KEY } from './ledgerStore';
import { isWritable, parseLedger, serialiseLedger, type Ledger } from '../ledger';
import { STORAGE_KEY, inTurn, readSession, type KeyValueStore, type SavedSession } from '../persistence';
import type { UUID } from '../../types/index';

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
  return readPart(file.session, file.ledger, file.from, file.writtenAt);
}

/** One squad and its minutes record, checked as this build reads its own. */
function readPart(
  sessionRaw: unknown,
  ledgerRaw: unknown,
  fromRaw: { app?: unknown; build?: unknown } | undefined,
  writtenAt: unknown
): ReadBackup | { ok: false; reason: string } {
  const file = { session: sessionRaw, ledger: ledgerRaw, from: fromRaw, writtenAt };
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

// --- every team in one file (#224 AC7, ADR-022 D4) -------------------------

/**
 * A backup of every team on the phone. 1.x refuses it with "made by a newer
 * version" (its BACKUP_VERSION is 1), so it can never be read as one squad.
 */
export const TEAMS_BACKUP_VERSION = 2;

/** One team as it is stored: its session and ledger, parsed from their stored text. */
export interface TeamBackupPart {
  id: UUID;
  removed: boolean;
  session: unknown;
  ledger: unknown;
}

export function makeTeamsBackup(teams: readonly TeamBackupPart[], from: BackupSource, now: Date): string {
  return JSON.stringify(
    { backup: BACKUP_ID, version: TEAMS_BACKUP_VERSION, writtenAt: now.toISOString(), from, teams },
    null,
    2
  );
}

/** A backup read and checked, team by team. `id` null: a 1.x backup, for the open team (D4). */
export interface ReadTeamsBackup {
  ok: true;
  teams: { id: UUID | null; removed: boolean; backup: ReadBackup }[];
}

/**
 * Read a backup of either version without touching the phone (#192 AC5): a
 * 1.x file is one squad for the open team; a 2.0.0 file lists every team.
 * One damaged team refuses the whole file, as one damaged squad always has.
 */
export function readAnyBackup(text: string): ReadTeamsBackup | { ok: false; reason: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: `That file is not a phone backup. ${NOTHING}` };
  }
  const version = (raw as { version?: unknown } | null)?.version;
  if (version !== TEAMS_BACKUP_VERSION) {
    const one = readPhoneBackup(text);
    return one.ok ? { ok: true, teams: [{ id: null, removed: false, backup: one }] } : one;
  }
  const file = raw as { backup?: unknown; writtenAt?: unknown; from?: { app?: unknown; build?: unknown }; teams?: unknown };
  if (file.backup !== BACKUP_ID || !Array.isArray(file.teams)) {
    return { ok: false, reason: `That file is not a phone backup. ${NOTHING}` };
  }
  const teams: ReadTeamsBackup['teams'] = [];
  for (const t of file.teams as { id?: unknown; removed?: unknown; session?: unknown; ledger?: unknown }[]) {
    if (typeof t?.id !== 'string') return { ok: false, reason: `A team in that backup is damaged. ${NOTHING}` };
    const part = readPart(t.session, t.ledger, file.from, file.writtenAt);
    if (!part.ok) return part;
    teams.push({ id: t.id as UUID, removed: t.removed === true, backup: part });
  }
  if (teams.length === 0) return { ok: false, reason: `That backup holds no team. ${NOTHING}` };
  return { ok: true, teams };
}

/** The confirm sheet's words for a backup of one team or several (#192 AC2). */
export function describeTeamsBackup(read: ReadTeamsBackup): string {
  if (read.teams.length === 1 && read.teams[0].id === null) return describeBackup(read.teams[0].backup.preview);
  const names = read.teams.map((t) => `${t.backup.preview.squadName}${t.removed ? ' (set aside)' : ''}`);
  const p = read.teams[0].backup.preview;
  const made = p.writtenAt
    ? new Date(p.writtenAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    : 'an unknown date';
  return (
    `${read.teams.length} ${read.teams.length === 1 ? 'team' : 'teams'}: ${names.join(', ')}. ` +
    `Each team on this phone with the same id is replaced, its data set aside first; the others are added. ` +
    `Teams on this phone that are not in the file are left alone. ` +
    `Backed up from ${p.from.app}${p.from.build ? ` (${p.from.build})` : ''} on ${made}.`
  );
}
