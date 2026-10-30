/**
 * Teams on one phone — #224, ADR-022 D2 and D3.
 *
 * A team is a key prefix. Each team's keys are today's keys with
 * `teams/<teamId>/` inserted after `coaching-app/`, so every storage module
 * keeps its key constants and works unchanged inside a team: `teamStore`
 * rewrites each key on the way in and out, and lists only its own team's.
 *
 * The team index is one key at the root, `coaching-app/teams/v1`. A team's
 * name is its squad's name, read from its session; the index does not copy
 * it, so the two cannot disagree. Team ids are fresh UUIDs, never the
 * `squadId`, which a restore from the record replaces.
 *
 * **The one-time move (D3): copy, prove, commit, set aside.** It runs once,
 * before any team is opened, on the device store's queue. Each step is
 * written to the index before the next starts, so a crash at any step is
 * repeated from that step at the next launch. The bytes are copied, never
 * changed: the session's migrations, the hash chain and the signatures are
 * untouched. A copy that does not read back stops the move; the phone's data
 * then opens read-only where it was, never as an empty team.
 *
 * Kept at the root, per install (D4): the index, the beta's test clock and
 * the `before-teams/` aside. The signing key is in the secure store.
 *
 * Pure apart from the `KeyValueStore` it is handed.
 */

import { TEST_CLOCK_KEY } from '../testKit';
import { LAST_BACKUP_KEY, SETTINGS_SECTIONS_KEY } from '../settingsSections';
import { forgetAppData, type Forgotten } from './forget';
import { STORAGE_KEY, inTurn, type KeyValueStore } from '../persistence';
import { LEDGER_STORAGE_KEY } from './ledgerStore';
import { restorePhoneBackup, type ReadTeamsBackup, type TeamBackupPart } from './phoneBackup';
import type { UUID } from '../../types/index';

/** Every key this app writes starts with this. */
const APP = 'coaching-app/';

export const TEAMS_INDEX_KEY = 'coaching-app/teams/v1';
export const TEAMS_PREFIX = 'coaching-app/teams/';
/** Where the move keeps the phone's keys as they were before teams (D3 step 5). */
export const BEFORE_TEAMS_PREFIX = 'coaching-app/before-teams/';

const INDEX_VERSION = 1;

/** Written in a team's own keys while it is set aside, so a rebuilt index knows (QA D5). */
export const REMOVED_MARK = 'coaching-app/team-removed/v1';

export interface TeamEntry {
  id: UUID;
  createdAt: string;
  /** Set aside by the coach (#224 AC9); its keys stay until Forget everything. */
  removedAt: string | null;
}

export interface TeamIndex {
  version: number;
  current: UUID | null;
  teams: TeamEntry[];
  /** The one-time move of the phone's keys into the first team (D3). */
  migration?: { state: 'copying' | 'copied' | 'done'; teamId: UUID };
}

/**
 * Keys about the phone, not a team: the test clock, and two view notes from
 * #263 — which Settings sections are open (one layout per phone, AC5) and
 * when this phone last made a backup (AC10). A team's store passes them
 * through to the root, and the move into teams leaves them where they are.
 */
const PHONE_KEYS: readonly string[] = [TEST_CLOCK_KEY, SETTINGS_SECTIONS_KEY, LAST_BACKUP_KEY];

/** The keys that live per install, never inside a team. */
function isRootKey(key: string): boolean {
  return PHONE_KEYS.includes(key) || key.startsWith(TEAMS_PREFIX) || key.startsWith(BEFORE_TEAMS_PREFIX);
}

/** `coaching-app/session/v1` in team T is `coaching-app/teams/T/session/v1`. */
export function teamKey(teamId: UUID, key: string): string {
  if (!key.startsWith(APP) || PHONE_KEYS.includes(key)) return key;
  return `${TEAMS_PREFIX}${teamId}/${key.slice(APP.length)}`;
}

/**
 * The device store as one team sees it (D2). The test clock passes through
 * to the root, since it is per install. `allKeys` lists only this team's.
 * Work queues on the root (`inTurn`), never on the wrapper.
 */
export function teamStore(root: KeyValueStore, teamId: UUID): KeyValueStore {
  const prefix = `${TEAMS_PREFIX}${teamId}/`;
  const listing = root.allKeys;
  return {
    root: root.root ?? root,
    getItem: (key) => root.getItem(teamKey(teamId, key)),
    setItem: (key, value) => root.setItem(teamKey(teamId, key), value),
    removeItem: (key) => root.removeItem(teamKey(teamId, key)),
    ...(listing
      ? {
          allKeys: async () =>
            (await listing.call(root)).filter((k) => k.startsWith(prefix)).map((k) => APP + k.slice(prefix.length)),
        }
      : {}),
  };
}

/**
 * The device store, read-only: what the phone's data opens as when the move
 * could not prove its copy (D3 step 3). Every write is refused, so nothing
 * this launch does can change what was there.
 */
export function readOnlyStore(root: KeyValueStore): KeyValueStore {
  const refuse = () => Promise.reject(new Error('read-only'));
  return {
    getItem: (key) => root.getItem(key),
    setItem: refuse,
    removeItem: refuse,
    ...(root.allKeys ? { allKeys: () => (root.allKeys as () => Promise<readonly string[]>)() } : {}),
  };
}

export function parseTeamIndex(text: string | null): TeamIndex | null {
  if (text === null) return null;
  try {
    const raw = JSON.parse(text) as Partial<TeamIndex>;
    if (typeof raw !== 'object' || raw === null || !Array.isArray(raw.teams)) return null;
    return {
      version: typeof raw.version === 'number' ? raw.version : INDEX_VERSION,
      current: typeof raw.current === 'string' ? (raw.current as UUID) : null,
      teams: raw.teams
        .filter((t): t is TeamEntry => typeof t === 'object' && t !== null && typeof t.id === 'string')
        .map((t) => ({
          id: t.id,
          createdAt: String(t.createdAt ?? ''),
          removedAt: t.removedAt ?? null,
        })),
      ...(raw.migration ? { migration: raw.migration } : {}),
    };
  } catch {
    return null;
  }
}

export function serialiseTeamIndex(index: TeamIndex): string {
  return JSON.stringify(index);
}

export type OpenedTeams =
  | { kind: 'team'; teamId: UUID; index: TeamIndex; moved: boolean }
  /** No team on this phone yet, or every one set aside (#224 AC6). */
  | { kind: 'none'; index: TeamIndex }
  /** The move could not prove its copy: the phone's data opens where it was, read-only (D3 step 3). */
  | { kind: 'read-only'; reason: string };

export const MOVE_FAILED =
  "This phone's squad could not be moved safely into teams, so it is open read-only and nothing is saved. Nothing has been changed or lost. Update the app, or contact support.";

/**
 * Open the phone's teams at launch: run the one-time move if it is due or
 * was interrupted, and return the team to open. `newId` makes the first
 * team's id.
 */
export function openTeams(root: KeyValueStore, now: Date, newId: () => UUID): Promise<OpenedTeams> {
  return inTurn(root, () => openTeamsNow(root, now, newId));
}

/** Read back what was written: a store that drops or changes a write is caught here. */
async function writeProved(root: KeyValueStore, key: string, value: string): Promise<boolean> {
  try {
    await root.setItem(key, value);
    return (await root.getItem(key)) === value;
  } catch {
    return false;
  }
}

async function openTeamsNow(root: KeyValueStore, now: Date, newId: () => UUID): Promise<OpenedTeams> {
  let index: TeamIndex | null;
  let keys: readonly string[];
  try {
    index = parseTeamIndex(await root.getItem(TEAMS_INDEX_KEY));
    // Without a listing, the move cannot know it copied everything.
    if (!root.allKeys) return { kind: 'read-only', reason: MOVE_FAILED };
    keys = await root.allKeys();
  } catch {
    return { kind: 'read-only', reason: MOVE_FAILED };
  }
  const legacy = keys.filter((k) => k.startsWith(APP) && !isRootKey(k)).sort();

  // An index that will not read, on a phone that already has teams: rebuild
  // it from the teams' own keys rather than open an empty team as the
  // coach's data. The keys say which teams exist; nothing is guessed.
  if (index === null) {
    const found = [
      ...new Set(
        keys
          .filter((k) => k.startsWith(TEAMS_PREFIX) && k !== TEAMS_INDEX_KEY)
          .map((k) => k.slice(TEAMS_PREFIX.length).split('/')[0])
          .filter((id) => id !== '' && id !== 'v1')
      ),
    ].sort() as UUID[];
    if (found.length > 0) {
      // A team set aside says so in its own keys (QA D5), so it stays aside.
      const aside = (id: UUID) => keys.includes(teamKey(id, REMOVED_MARK));
      const open = found.find((id) => !aside(id)) ?? null;
      // QA D6: a team with no squad yet was still being copied into; copy again.
      const first = open ?? found[0];
      const copied = keys.includes(teamKey(first, STORAGE_KEY));
      index = {
        version: INDEX_VERSION,
        current: open,
        teams: found.map((id) => ({ id, createdAt: '', removedAt: aside(id) ? now.toISOString() : null })),
        // Only a move still under way is resumed (QA N3): with nothing left at
        // the root, the index is simply rebuilt, and a phone whose every team
        // is set aside opens on "No teams on this phone yet".
        ...(legacy.length > 0 ? { migration: { state: copied ? 'copied' : 'copying', teamId: first } } : {}),
      };
    }
  }

  // Moved already, and nothing left at the root: the everyday launch.
  if (index && (index.migration === undefined || index.migration.state === 'done') && legacy.length === 0) {
    const open = index.teams.find((t) => t.id === index?.current && t.removedAt === null);
    const current = open?.id ?? index.teams.find((t) => t.removedAt === null)?.id ?? null;
    if (current === null) return { kind: 'none', index: { ...index, current: null } };
    return { kind: 'team', teamId: current, index: { ...index, current }, moved: false };
  }

  // #224 AC6: a fresh install has no team until the coach names one.
  // Nothing is written for them.
  if (index === null && legacy.length === 0) {
    return { kind: 'none', index: { version: INDEX_VERSION, current: null, teams: [] } };
  }

  // Steps 1 and 2: a fresh install gets its first team; a phone with keys
  // from before teams gets the team they will move into, written first.
  let teamId: UUID;
  if (index?.migration && index.migration.state !== 'done') {
    teamId = index.migration.teamId;
  } else if (index && index.current !== null) {
    // An index already exists, yet keys sit at the root: move them into the open team.
    teamId = index.current;
  } else {
    teamId = newId();
  }
  const entry: TeamEntry = index?.teams.find((t) => t.id === teamId) ?? {
    id: teamId,
    createdAt: now.toISOString(),
    removedAt: null,
  };
  const teams = [...(index?.teams ?? []).filter((t) => t.id !== teamId), entry];
  const write = (migration: TeamIndex['migration']) =>
    writeProved(
      root,
      TEAMS_INDEX_KEY,
      serialiseTeamIndex({
        version: INDEX_VERSION,
        current: teamId,
        teams,
        ...(migration ? { migration } : {}),
      })
    );

  if (legacy.length === 0) {
    if (!(await write(undefined))) return { kind: 'read-only', reason: MOVE_FAILED };
    return {
      kind: 'team',
      teamId,
      index: { version: INDEX_VERSION, current: teamId, teams },
      moved: false,
    };
  }

  // Copy only before the commit. Once a team is live (`copied`, `done`, or a
  // team made on a fresh install), a key still at the root is only ever set
  // aside: copying it again would write stale data over the team's own.
  const copying = index === null || index.migration?.state === 'copying';
  if (copying) {
    if (!(await write({ state: 'copying', teamId }))) return { kind: 'read-only', reason: MOVE_FAILED };
    // Step 3: copy every key byte for byte, asides included, and read each back.
    for (const key of legacy) {
      const value = await root.getItem(key).catch(() => null);
      if (value === null || !(await writeProved(root, teamKey(teamId, key), value))) {
        return { kind: 'read-only', reason: MOVE_FAILED };
      }
    }
    // Step 4: commit. From here the team is the phone's data.
    if (!(await write({ state: 'copied', teamId }))) return { kind: 'read-only', reason: MOVE_FAILED };
  }

  // Step 5: set the originals aside, proved, then remove them, so a module
  // that missed the team's store finds nothing rather than stale data.
  for (const key of legacy) {
    const value = await root.getItem(key).catch(() => null);
    if (value === null) continue;
    // QA D4: never over the bytes 1.x left, which a 2.0.x patch could put back.
    const first = BEFORE_TEAMS_PREFIX + key.slice(APP.length);
    const there = await root.getItem(first).catch(() => null);
    const aside =
      there === null || there === value
        ? first
        : `${BEFORE_TEAMS_PREFIX}later/${now.toISOString()}/${key.slice(APP.length)}`;
    if (!(await writeProved(root, aside, value))) continue;
    await root.removeItem(key).catch(() => undefined);
  }
  await write({ state: 'done', teamId });
  return {
    kind: 'team',
    teamId,
    index: {
      version: INDEX_VERSION,
      current: teamId,
      teams,
      migration: { state: 'done', teamId },
    },
    moved: true,
  };
}

/**
 * Forget everything (#207), for a phone with teams: every key this app owns
 * at the root goes, every team's and the `before-teams/` aside included,
 * since each holds children's first names. `keep` is the team left open,
 * empty, as a fresh install's first team. Queued behind any save.
 */
export async function forgetEveryTeam(root: KeyValueStore, keep: UUID | null, now: Date): Promise<Forgotten> {
  const forgotten = await forgetAppData(root);
  // An index of no teams, or of the one kept: a save that somehow follows the
  // forget finds an index that does not list it, so no team comes back (QA D1).
  await inTurn(root, () =>
    root
      .setItem(
        TEAMS_INDEX_KEY,
        serialiseTeamIndex({
          version: INDEX_VERSION,
          current: keep,
          teams: keep === null ? [] : [{ id: keep, createdAt: now.toISOString(), removedAt: null }],
        })
      )
      .catch(() => undefined)
  );
  return forgotten;
}

// --- the coach's acts on teams (#224 AC1, AC5, AC9) ------------------------

const EMPTY: TeamIndex = { version: INDEX_VERSION, current: null, teams: [] };

/** Change the index in the device store's turn, proved by reading it back. */
function changeIndex(root: KeyValueStore, change: (index: TeamIndex) => TeamIndex): Promise<TeamIndex | null> {
  return inTurn(root, async () => {
    const have = parseTeamIndex(await root.getItem(TEAMS_INDEX_KEY).catch(() => null)) ?? EMPTY;
    const next = change(have);
    return (await writeProved(root, TEAMS_INDEX_KEY, serialiseTeamIndex(next))) ? next : null;
  });
}

/** A new team, open from now (AC5). Null if the index could not be written. */
export function addTeam(root: KeyValueStore, id: UUID, now: Date): Promise<TeamIndex | null> {
  return changeIndex(root, (i) => ({
    ...i,
    current: id,
    teams: [...i.teams, { id, createdAt: now.toISOString(), removedAt: null }],
  }));
}

/** Open another team (AC1). */
export function openTeam(root: KeyValueStore, id: UUID): Promise<TeamIndex | null> {
  return changeIndex(root, (i) =>
    i.teams.some((t) => t.id === id && t.removedAt === null) ? { ...i, current: id } : i
  );
}

/**
 * Set a team aside (AC9): it leaves the list, its keys stay where they are
 * until Forget everything. The next team still listed opens; with none, the
 * phone has no team (AC6).
 */
export async function removeTeam(root: KeyValueStore, id: UUID, now: Date): Promise<TeamIndex | null> {
  const next = await changeIndex(root, (i) => {
    const teams = i.teams.map((t) => (t.id === id ? { ...t, removedAt: now.toISOString() } : t));
    const current = i.current === id ? (teams.find((t) => t.removedAt === null)?.id ?? null) : i.current;
    return { ...i, teams, current };
  });
  // The team says so in its own keys too, so a rebuilt index keeps it aside (QA D5).
  if (next) await inTurn(root, () => root.setItem(teamKey(id, REMOVED_MARK), now.toISOString()).catch(() => undefined));
  return next;
}

/** Bring a set-aside team back, exactly as it was (AC9). It opens if no team is open. */
export async function bringBackTeam(root: KeyValueStore, id: UUID): Promise<TeamIndex | null> {
  const next = await changeIndex(root, (i) => ({
    ...i,
    teams: i.teams.map((t) => (t.id === id ? { ...t, removedAt: null } : t)),
    current: i.current ?? id,
  }));
  if (next) await inTurn(root, () => root.removeItem(teamKey(id, REMOVED_MARK)).catch(() => undefined));
  return next;
}

/** One row of the team list (AC1): read from the team's own keys, never copied into the index. */
export interface TeamSummary {
  id: UUID;
  /** The squad's name; "A team that could not be opened" when its squad will not read (D2). */
  name: string;
  /** Which of the six badge colours, by when it was added (T5). */
  badge: number;
  /** "2026–27 · U10 development · 7-a-side", or "This season". */
  season: string;
  /** A match is under way (T3): "Match on". */
  live: boolean;
  removed: boolean;
}

export const UNREADABLE_TEAM = 'A team that could not be opened';

/**
 * Every team on the phone, in the order added, read without writing
 * anything. `read` turns a team's stored session and ledger text into its
 * name, season line and whether a match is on: passed in, so this module
 * stays storage only.
 */
export async function teamSummaries(
  root: KeyValueStore,
  index: TeamIndex,
  read: (session: string | null, ledger: string | null) => { name: string | null; season: string; live: boolean }
): Promise<TeamSummary[]> {
  const out: TeamSummary[] = [];
  for (const [n, t] of index.teams.entries()) {
    const store = teamStore(root, t.id);
    const session = await store.getItem(STORAGE_KEY).catch(() => null);
    const ledger = await store.getItem(LEDGER_STORAGE_KEY).catch(() => null);
    const r = read(session, ledger);
    out.push({
      id: t.id,
      name: r.name ?? UNREADABLE_TEAM,
      badge: n % 6,
      season: r.season,
      live: r.live,
      removed: t.removedAt !== null,
    });
  }
  return out;
}

// --- every team in one backup (#224 AC7, ADR-022 D4) -----------------------

/**
 * Every team's stored squad and minutes record, for a backup of the phone.
 * Read in the device store's turn, behind any save still queued. A team
 * whose stored text will not parse is named in `skipped`, never dropped
 * silently.
 */
export function teamsForBackup(
  root: KeyValueStore,
  index: TeamIndex
): Promise<{ parts: TeamBackupPart[]; skipped: UUID[] }> {
  return inTurn(root, async () => {
    const parts: TeamBackupPart[] = [];
    const skipped: UUID[] = [];
    for (const t of index.teams) {
      const store = teamStore(root, t.id);
      try {
        const session = await store.getItem(STORAGE_KEY);
        const ledger = await store.getItem(LEDGER_STORAGE_KEY);
        if (session === null) throw new Error('no squad');
        parts.push({
          id: t.id,
          removed: t.removedAt !== null,
          session: JSON.parse(session),
          ledger: ledger === null ? null : JSON.parse(ledger),
        });
      } catch {
        skipped.push(t.id);
      }
    }
    return { parts, skipped };
  });
}

/**
 * Restore a backup (ADR-022 D4): each team whose id is on the phone is
 * replaced, its data set aside first (as #192 does); a new id is added;
 * teams on the phone not in the file are left alone. A 1.x backup (no id)
 * restores into `openId`. A team the file holds as active comes back if it
 * was set aside here, and the open team is always one not set aside (QA D5,
 * D6). Returns the reasons any team was not restored.
 */
export async function restoreTeams(
  root: KeyValueStore,
  read: ReadTeamsBackup,
  openId: UUID | null,
  now: Date,
  /**
   * With no team open (the first screen): the team a 1.x file goes into,
   * from its squad name. A team already here with that name, or a new one.
   */
  teamFor?: (squadName: string) => UUID
): Promise<string[]> {
  const problems: string[] = [];
  for (const t of read.teams) {
    const id = t.id ?? openId ?? teamFor?.(t.backup.preview.squadName) ?? null;
    if (id === null) {
      problems.push('A backup from 1.x restores into an open team; add a team first.');
      continue;
    }
    const indexed = await changeIndex(root, (i) =>
      i.teams.some((x) => x.id === id)
        ? i
        : {
            ...i,
            teams: [...i.teams, { id, createdAt: now.toISOString(), removedAt: t.removed ? now.toISOString() : null }],
          }
    );
    if (indexed === null) {
      problems.push(`${t.backup.preview.squadName}: the team list could not be written.`);
      continue;
    }
    const outcome = await restorePhoneBackup(teamStore(root, id), t.backup, now);
    const asideHere = indexed.teams.some((x) => x.id === id && x.removedAt !== null);
    if (!outcome.ok) problems.push(`${t.backup.preview.squadName}: ${outcome.reason}`);
    // A team the file holds as set aside says so in its own keys too (QA N2).
    else if (t.removed && asideHere) {
      await inTurn(root, () => root.setItem(teamKey(id, REMOVED_MARK), now.toISOString()).catch(() => undefined));
    }
    // The file holds it as active: it is restored as active (QA D6).
    else if (!t.removed && asideHere) await bringBackTeam(root, id);
  }
  // The open team is one not set aside, or none (QA D5).
  await changeIndex(root, (i) => {
    const active = i.teams.filter((x) => x.removedAt === null);
    return active.some((x) => x.id === i.current) ? i : { ...i, current: active[0]?.id ?? null };
  });
  return problems;
}
