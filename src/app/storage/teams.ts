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
import { forgetAppData, type Forgotten } from './forget';
import { inTurn, type KeyValueStore } from '../persistence';
import type { UUID } from '../../types/index';

/** Every key this app writes starts with this. */
const APP = 'coaching-app/';

export const TEAMS_INDEX_KEY = 'coaching-app/teams/v1';
export const TEAMS_PREFIX = 'coaching-app/teams/';
/** Where the move keeps the phone's keys as they were before teams (D3 step 5). */
export const BEFORE_TEAMS_PREFIX = 'coaching-app/before-teams/';

const INDEX_VERSION = 1;

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

/** The keys that live per install, never inside a team. */
function isRootKey(key: string): boolean {
  return key === TEST_CLOCK_KEY || key.startsWith(TEAMS_PREFIX) || key.startsWith(BEFORE_TEAMS_PREFIX);
}

/** `coaching-app/session/v1` in team T is `coaching-app/teams/T/session/v1`. */
export function teamKey(teamId: UUID, key: string): string {
  if (!key.startsWith(APP) || key === TEST_CLOCK_KEY) return key;
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
      index = {
        version: INDEX_VERSION,
        current: found[0],
        teams: found.map((id) => ({ id, createdAt: '', removedAt: null })),
        migration: { state: 'copied', teamId: found[0] },
      };
    }
  }

  // Moved already, and nothing left at the root: the everyday launch.
  if (index && (index.migration === undefined || index.migration.state === 'done') && legacy.length === 0) {
    const current = index.current ?? index.teams.find((t) => t.removedAt === null)?.id ?? null;
    if (current !== null)
      return {
        kind: 'team',
        teamId: current,
        index: { ...index, current },
        moved: false,
      };
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
    const aside = BEFORE_TEAMS_PREFIX + key.slice(APP.length);
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
  if (keep !== null) {
    await inTurn(root, () =>
      root
        .setItem(
          TEAMS_INDEX_KEY,
          serialiseTeamIndex({
            version: INDEX_VERSION,
            current: keep,
            teams: [{ id: keep, createdAt: now.toISOString(), removedAt: null }],
          })
        )
        .catch(() => undefined)
    );
  }
  return forgotten;
}
