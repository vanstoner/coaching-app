/**
 * The minutes ledger — #75, ADR-013.
 *
 * Pure TypeScript. No storage, no I/O.
 *
 * > *"Whatever happens there, player time is what I want to keep hold of."*
 * > — PO, 2026-10-03
 *
 * The working document (`persistence.ts`) holds everything and is allowed to
 * churn as the data model is experimented with. Player time is not. This is a
 * second, small store with a FROZEN contract, holding only what minutes are
 * made of — the closed playing intervals — kept under its own key and
 * exportable as a file.
 *
 * ---------------------------------------------------------------------------
 * Rules this file keeps
 * ---------------------------------------------------------------------------
 *
 * - **Intervals, never totals (invariant 1, PO ruling 1A).** Totals are always
 *   folded from intervals. The `summary` in a written file is for people and
 *   is recomputed and compared on import, never trusted.
 * - **It never shrinks.** Recording a match adds and updates intervals by id
 *   and never removes one, so a bug or a reset in the working document cannot
 *   take player time with it.
 * - **Import merges, never overwrites (invariant 5, AC5).** Same id and same
 *   content: skipped. Same id, different content: the existing entry is kept
 *   and the difference is reported.
 * - **Additive versioning (AC3).** `ledgerVersion` 1 is a contract. A later
 *   version may add optional fields and nothing else; this reader ignores
 *   fields it does not know and reads any version.
 * - **First names only (invariant 4).**
 */

import type {
  Appearance,
  Competition,
  MatchStatus,
  Player,
  PositionKind,
  PositionUnit,
  UUID,
} from '../types/index';

export const LEDGER_ID = 'coaching-app/minutes';
export const LEDGER_VERSION = 1;

export interface LedgerInterval {
  /** The Appearance id: what makes recording and import idempotent. */
  id: UUID;
  playerId: UUID;
  /** 1-based half or quarter. */
  period: number;
  kind: PositionKind;
  unit: PositionUnit | null;
  /** Match-elapsed ms, from the closed Appearance. */
  startMs: number;
  endMs: number;
  corrected: boolean;
  note: string | null;
}

export interface LedgerMatch {
  id: UUID;
  kickoffAt: string | null;
  opponent: string | null;
  competition: Competition | null;
  totalMinutes: number;
  periodCount: number;
  status: MatchStatus;
  intervals: LedgerInterval[];
}

export interface LedgerPlayer {
  id: UUID;
  firstName: string;
  displaySuffix: string | null;
  /** False for a retired player (#77). Their minutes are kept regardless. */
  active: boolean;
}

export interface PlayerTotal {
  playerId: UUID;
  outfieldMs: number;
  goalkeeperMs: number;
}

export interface Ledger {
  ledger: typeof LEDGER_ID;
  ledgerVersion: number;
  writtenAt: string;
  squad: { id: UUID; name: string };
  players: LedgerPlayer[];
  matches: LedgerMatch[];
  /** Written for people; recomputed and checked on read. */
  summary?: PlayerTotal[];
}

export function emptyLedger(squadId: UUID, squadName: string): Ledger {
  return {
    ledger: LEDGER_ID,
    ledgerVersion: LEDGER_VERSION,
    writtenAt: new Date(0).toISOString(),
    squad: { id: squadId, name: squadName },
    players: [],
    matches: [],
  };
}

/** The slice of a stored match the ledger reads. */
export interface MatchRecord {
  match: {
    id: UUID;
    kickoffAt: string | null;
    opponent: string | null;
    competition: Competition | null;
    totalMinutes: number;
    quarterCount: number;
    status: MatchStatus;
  };
  quarters: { id: UUID; index: number }[];
  appearances: Appearance[];
}

/** Closed appearances only: a running one has no end yet (#75 design). */
function closedIntervals(record: MatchRecord): LedgerInterval[] {
  const periodOf = new Map(record.quarters.map((q) => [q.id, q.index]));
  return record.appearances
    .filter((a) => a.endElapsedMs !== null)
    .map((a) => ({
      id: a.id,
      playerId: a.playerId,
      period: periodOf.get(a.quarterId) ?? 0,
      kind: a.positionKind,
      unit: a.positionUnit ?? null,
      startMs: a.startElapsedMs,
      endMs: a.endElapsedMs as number,
      corrected: a.corrected,
      note: a.correctionNote,
    }));
}

function samePlayer(a: LedgerPlayer, b: LedgerPlayer): boolean {
  return a.firstName === b.firstName && a.displaySuffix === b.displaySuffix;
}

function sameInterval(a: LedgerInterval, b: LedgerInterval): boolean {
  return (
    a.playerId === b.playerId &&
    a.period === b.period &&
    a.kind === b.kind &&
    a.unit === b.unit &&
    a.startMs === b.startMs &&
    a.endMs === b.endMs &&
    a.corrected === b.corrected &&
    a.note === b.note
  );
}

/**
 * Write this device's matches and squad into the ledger.
 *
 * This device is the authority for its own records, so an interval it holds
 * replaces the ledger's copy with the same id — a later correction flag lands.
 * Nothing absent from `records` is removed: matches, intervals and players
 * only ever accumulate. Players are updated by id, so a corrected spelling
 * reaches every match, and retired players stay (#77).
 */
export function recordMatches(
  ledger: Ledger,
  records: MatchRecord[],
  players: Player[],
  squadName: string,
  now: Date
): Ledger {
  const playersById = new Map(ledger.players.map((p) => [p.id, p]));
  for (const p of players) {
    playersById.set(p.id, {
      id: p.id,
      firstName: p.firstName,
      displaySuffix: p.displaySuffix,
      active: p.active !== false,
    });
  }

  const matches = new Map(ledger.matches.map((m) => [m.id, m]));
  for (const record of records) {
    const fresh = closedIntervals(record);
    if (fresh.length === 0) continue; // nothing played yet: nothing to keep
    const existing = matches.get(record.match.id);
    const intervals = new Map((existing?.intervals ?? []).map((i) => [i.id, i]));
    for (const i of fresh) intervals.set(i.id, i);
    matches.set(record.match.id, {
      id: record.match.id,
      kickoffAt: record.match.kickoffAt,
      opponent: record.match.opponent,
      competition: record.match.competition,
      totalMinutes: record.match.totalMinutes,
      periodCount: record.match.quarterCount,
      status: record.match.status,
      intervals: [...intervals.values()].sort(
        (a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id)
      ),
    });
  }

  return {
    ...ledger,
    ledgerVersion: Math.max(ledger.ledgerVersion, LEDGER_VERSION),
    writtenAt: now.toISOString(),
    squad: { ...ledger.squad, name: squadName || ledger.squad.name },
    players: [...playersById.values()],
    matches: [...matches.values()],
  };
}

/** Every player's minutes, folded from the intervals. Never stored as truth. */
export function foldLedger(ledger: Ledger): PlayerTotal[] {
  const totals = new Map<UUID, PlayerTotal>();
  for (const p of ledger.players) {
    totals.set(p.id, { playerId: p.id, outfieldMs: 0, goalkeeperMs: 0 });
  }
  for (const m of ledger.matches) {
    for (const i of m.intervals) {
      let row = totals.get(i.playerId);
      if (!row) {
        row = { playerId: i.playerId, outfieldMs: 0, goalkeeperMs: 0 };
        totals.set(i.playerId, row);
      }
      const ms = Math.max(0, i.endMs - i.startMs);
      if (i.kind === 'goalkeeper') row.goalkeeperMs += ms;
      else row.outfieldMs += ms;
    }
  }
  return [...totals.values()];
}

/** The file: the ledger plus a summary a person can read. */
export function serialiseLedger(ledger: Ledger): string {
  return JSON.stringify({ ...ledger, summary: foldLedger(ledger) }, null, 2);
}

export type ParseResult =
  | { ok: true; ledger: Ledger }
  | { ok: false; reason: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Read a ledger file. Unknown fields are ignored; a missing required one, or a
 * summary that disagrees with the intervals, refuses the file with a reason a
 * coach can act on.
 */
export function parseLedger(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'This is not a minutes file — it could not be read.' };
  }
  if (!isObj(raw) || raw.ledger !== LEDGER_ID) {
    return { ok: false, reason: 'This is not a minutes file from this app.' };
  }
  if (typeof raw.ledgerVersion !== 'number' || raw.ledgerVersion < 1) {
    return { ok: false, reason: 'This minutes file has no version and cannot be trusted.' };
  }
  if (!isObj(raw.squad) || !Array.isArray(raw.players) || !Array.isArray(raw.matches)) {
    return { ok: false, reason: 'This minutes file is incomplete.' };
  }

  const players: LedgerPlayer[] = [];
  for (const p of raw.players) {
    if (!isObj(p) || typeof p.id !== 'string' || typeof p.firstName !== 'string') {
      return { ok: false, reason: 'A player in this file is damaged.' };
    }
    players.push({
      id: p.id as UUID,
      firstName: p.firstName,
      displaySuffix: typeof p.displaySuffix === 'string' ? p.displaySuffix : null,
      active: p.active !== false,
    });
  }

  const matches: LedgerMatch[] = [];
  for (const m of raw.matches) {
    if (!isObj(m) || typeof m.id !== 'string' || !Array.isArray(m.intervals)) {
      return { ok: false, reason: 'A match in this file is damaged.' };
    }
    const intervals: LedgerInterval[] = [];
    for (const i of m.intervals) {
      if (
        !isObj(i) ||
        typeof i.id !== 'string' ||
        typeof i.playerId !== 'string' ||
        (i.kind !== 'goalkeeper' && i.kind !== 'outfield') ||
        typeof i.startMs !== 'number' ||
        typeof i.endMs !== 'number' ||
        i.endMs < i.startMs
      ) {
        return { ok: false, reason: 'A playing interval in this file is damaged.' };
      }
      intervals.push({
        id: i.id as UUID,
        playerId: i.playerId as UUID,
        period: typeof i.period === 'number' ? i.period : 0,
        kind: i.kind,
        unit: typeof i.unit === 'string' ? (i.unit as PositionUnit) : null,
        startMs: i.startMs,
        endMs: i.endMs,
        corrected: i.corrected === true,
        note: typeof i.note === 'string' ? i.note : null,
      });
    }
    matches.push({
      id: m.id as UUID,
      kickoffAt: typeof m.kickoffAt === 'string' ? m.kickoffAt : null,
      opponent: typeof m.opponent === 'string' ? m.opponent : null,
      competition: typeof m.competition === 'string' ? (m.competition as Competition) : null,
      totalMinutes: typeof m.totalMinutes === 'number' ? m.totalMinutes : 0,
      periodCount: typeof m.periodCount === 'number' ? m.periodCount : 0,
      status: typeof m.status === 'string' ? (m.status as MatchStatus) : 'completed',
      intervals,
    });
  }

  const ledger: Ledger = {
    ledger: LEDGER_ID,
    ledgerVersion: raw.ledgerVersion,
    writtenAt: typeof raw.writtenAt === 'string' ? raw.writtenAt : new Date(0).toISOString(),
    squad: {
      id: (typeof raw.squad.id === 'string' ? raw.squad.id : '') as UUID,
      name: typeof raw.squad.name === 'string' ? raw.squad.name : '',
    },
    players,
    matches,
  };

  // The summary is for people. If it is present it must agree with the
  // intervals, or the file was damaged or edited by hand.
  if (Array.isArray(raw.summary)) {
    const folded = new Map(foldLedger(ledger).map((t) => [t.playerId, t]));
    for (const s of raw.summary) {
      if (!isObj(s) || typeof s.playerId !== 'string') continue;
      const f = folded.get(s.playerId as UUID);
      if (!f || f.outfieldMs !== s.outfieldMs || f.goalkeeperMs !== s.goalkeeperMs) {
        return {
          ok: false,
          reason:
            "This file's totals do not match its playing times. It has been damaged or edited, so nothing was imported.",
        };
      }
    }
  }

  return { ok: true, ledger };
}

export interface MergeReport {
  ledger: Ledger;
  addedPlayers: number;
  addedMatches: number;
  addedIntervals: number;
  skipped: number;
  /** Same id, different content. The existing entry was kept. Plain English. */
  conflicts: string[];
}

/**
 * Merge an imported ledger into this one — AC5.
 *
 * By id. New: added. Identical: skipped. Different: the existing entry is
 * kept and the difference listed. Nothing is overwritten or deleted, so
 * importing the same file twice changes nothing.
 */
export function mergeLedger(into: Ledger, from: Ledger, now: Date): MergeReport {
  let addedPlayers = 0;
  let addedMatches = 0;
  let addedIntervals = 0;
  let skipped = 0;
  const conflicts: string[] = [];

  const players = new Map(into.players.map((p) => [p.id, p]));
  for (const p of from.players) {
    const mine = players.get(p.id);
    if (!mine) {
      players.set(p.id, p);
      addedPlayers++;
    } else if (samePlayer(mine, p)) {
      skipped++;
    } else {
      conflicts.push(`A player is called ${mine.firstName} here and ${p.firstName} in the file; kept ${mine.firstName}.`);
    }
  }

  const matches = new Map(into.matches.map((m) => [m.id, m]));
  for (const m of from.matches) {
    const mine = matches.get(m.id);
    if (!mine) {
      matches.set(m.id, m);
      addedMatches++;
      addedIntervals += m.intervals.length;
      continue;
    }
    const intervals = new Map(mine.intervals.map((i) => [i.id, i]));
    let changed = false;
    for (const i of m.intervals) {
      const have = intervals.get(i.id);
      if (!have) {
        intervals.set(i.id, i);
        addedIntervals++;
        changed = true;
      } else if (sameInterval(have, i)) {
        skipped++;
      } else {
        conflicts.push(
          `A playing time in the match against ${mine.opponent ?? 'an unnamed opponent'} differs from the file; kept this phone's.`
        );
      }
    }
    if (changed) {
      matches.set(m.id, {
        ...mine,
        intervals: [...intervals.values()].sort(
          (a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id)
        ),
      });
    }
  }

  const changed = addedPlayers + addedMatches + addedIntervals > 0;
  return {
    ledger: {
      ...into,
      ledgerVersion: Math.max(into.ledgerVersion, LEDGER_VERSION),
      writtenAt: changed ? now.toISOString() : into.writtenAt,
      // A fresh install takes the squad's identity from the file, so its
      // later matches line up with the imported ones.
      squad: into.players.length === 0 && into.matches.length === 0 ? from.squad : into.squad,
      players: [...players.values()],
      matches: [...matches.values()],
    },
    addedPlayers,
    addedMatches,
    addedIntervals,
    skipped,
    conflicts,
  };
}

/** "minutes-2026-10-03.json". */
export function ledgerFileName(now: Date): string {
  return `minutes-${now.toISOString().slice(0, 10)}.json`;
}

export interface SeasonRow {
  playerId: UUID;
  name: string;
  outfieldMs: number;
  goalkeeperMs: number;
  retired: boolean;
}

/** Season minutes per player, from the ledger alone (AC6). Most outfield first. */
export function seasonRows(ledger: Ledger): SeasonRow[] {
  const names = new Map(ledger.players.map((p) => [p.id, p]));
  return foldLedger(ledger)
    .map((t) => {
      const p = names.get(t.playerId);
      return {
        playerId: t.playerId,
        name: p ? (p.displaySuffix ? `${p.firstName} ${p.displaySuffix}` : p.firstName) : 'Unknown',
        outfieldMs: t.outfieldMs,
        goalkeeperMs: t.goalkeeperMs,
        retired: p ? !p.active : false,
      };
    })
    .sort((a, b) => b.outfieldMs - a.outfieldMs || a.name.localeCompare(b.name));
}

/** What an import did, in one or two sentences a coach can read. */
export function describeMerge(report: Omit<MergeReport, 'ledger'>): string {
  const added = report.addedMatches + report.addedIntervals + report.addedPlayers;
  const parts: string[] = [];
  if (added === 0) {
    parts.push('Nothing new in that file — everything in it is already here.');
  } else {
    parts.push(
      `Added ${report.addedMatches} ${report.addedMatches === 1 ? 'match' : 'matches'} and ${report.addedPlayers} ${report.addedPlayers === 1 ? 'player' : 'players'}.`
    );
  }
  if (report.conflicts.length > 0) {
    parts.push(
      `${report.conflicts.length} ${report.conflicts.length === 1 ? 'entry differs' : 'entries differ'} from this phone; this phone's ${report.conflicts.length === 1 ? 'was' : 'were'} kept.`
    );
  }
  return parts.join(' ');
}
