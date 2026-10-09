/**
 * The figures a released build shows for a stored season — #167 AC2.
 *
 * One pure function from what is on the phone (the session and the ledger,
 * as loaded) to every per-child figure a coach reads: minutes in total, in
 * goal and outfield, goals, appearances and match counts. Folded from the
 * records every time (invariant 1); nothing here is stored.
 *
 * It is run twice against the same frozen store. Once by the RELEASED code,
 * when the fixture is frozen (`scripts/freeze-release-fixture.ts`, which
 * copies this file into a worktree of the release commit), giving
 * `expected.json`. Once by THIS build, in `releaseUpgrade.test.ts`, after
 * loading and migrating the same store. Any difference is a figure an update
 * changed on a coach's phone.
 *
 * It only calls functions that existed at 1.0.0, so it still runs at that
 * commit. Children are keyed by first name (the fixture's names are the Test
 * kit's, all distinct), so a failure names the child.
 */

import { MatchEngine } from '../engine/MatchEngine';
import { seasonStats } from './analysis';
import { kickoffTimes } from './attendance';
import { foldLedger, type Ledger } from './ledger';
import { talliesOf, scoreOf } from './matchEvents';
import type { SavedSession } from './persistence';
import { toMatchState } from './persistence';
import { foldPlayerMinutes } from './playerMinutes';

/** One child's figures, from the working document (the session). */
export interface SessionChildFigures {
  totalMs: number;
  goalkeeperMs: number;
  outfieldMs: number;
  /** Appearance records, every match. */
  appearances: number;
  /** Matches with any time on the pitch. */
  matchesPlayed: number;
  goals: number;
  saves: number;
  conceded: number;
}

/** One child's figures, from the minutes ledger. */
export interface LedgerChildFigures {
  totalMs: number;
  goalkeeperMs: number;
  outfieldMs: number;
  /** Interval records, every match. */
  intervals: number;
  /** Matches with any time on the pitch. */
  matchesPlayed: number;
  goals: number;
  /** Season view: counted matches attended and missed, and the average. */
  attended: number;
  missed: number;
  averageMs: number | null;
}

export interface MatchFigures {
  opponent: string | null;
  status: string;
  us: number;
  them: number;
}

export interface ReleaseFigures {
  squad: {
    players: number;
    sessionMatches: number;
    ledgerMatches: number;
    ledgerPlayers: number;
    ledgerEntries: number;
    countedMatches: number;
  };
  /** By match id, from the session. */
  matches: Record<string, MatchFigures>;
  /** By first name. */
  session: Record<string, SessionChildFigures>;
  ledger: Record<string, LedgerChildFigures>;
}

const nameOf = (p: { firstName: string; displaySuffix?: string | null }): string =>
  p.displaySuffix ? `${p.firstName} ${p.displaySuffix}` : p.firstName;

/** Keys sorted, so the JSON is stable and a diff reads child by child. */
function sorted<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Every figure, from a loaded session and ledger. `now` only matters for a
 * match with a period still running; it is fixed by the caller.
 */
export function releaseFigures(session: SavedSession, ledger: Ledger, now: Date): ReleaseFigures {
  const engine = new MatchEngine({ nowFn: () => now });
  const names = new Map<string, string>(session.players.map((p) => [p.id, nameOf(p)]));
  for (const p of ledger.players) if (!names.has(p.id)) names.set(p.id, nameOf(p));
  const name = (id: string): string => names.get(id) ?? `unknown ${id}`;

  // --- the session -----------------------------------------------------------
  const sessionRows: Record<string, SessionChildFigures> = {};
  const sessionRow = (id: string): SessionChildFigures =>
    (sessionRows[name(id)] ??= {
      totalMs: 0,
      goalkeeperMs: 0,
      outfieldMs: 0,
      appearances: 0,
      matchesPlayed: 0,
      goals: 0,
      saves: 0,
      conceded: 0,
    });
  for (const p of session.players) sessionRow(p.id);

  const matches: Record<string, MatchFigures> = {};
  for (const m of session.matches) {
    const state = toMatchState(session, m.match.id);
    if (!state) continue;
    for (const row of foldPlayerMinutes(engine, state, session.players)) {
      const r = sessionRow(row.playerId);
      r.totalMs += row.totalMs;
      r.goalkeeperMs += row.goalkeeperMs;
      r.outfieldMs += row.outfieldMs;
      if (row.totalMs > 0) r.matchesPlayed++;
    }
    for (const a of m.appearances) sessionRow(a.playerId).appearances++;
    for (const t of talliesOf(m.events)) {
      const r = sessionRow(t.playerId);
      r.goals += t.goals;
      r.saves += t.saves;
      r.conceded += t.conceded;
    }
    const score = scoreOf(m.events);
    matches[m.match.id] = { opponent: m.match.opponent, status: m.match.status, us: score.us, them: score.them };
  }

  // --- the ledger -------------------------------------------------------------
  const ledgerRows: Record<string, LedgerChildFigures> = {};
  const ledgerRow = (id: string): LedgerChildFigures =>
    (ledgerRows[name(id)] ??= {
      totalMs: 0,
      goalkeeperMs: 0,
      outfieldMs: 0,
      intervals: 0,
      matchesPlayed: 0,
      goals: 0,
      attended: 0,
      missed: 0,
      averageMs: null,
    });
  for (const t of foldLedger(ledger)) {
    const r = ledgerRow(t.playerId);
    r.goalkeeperMs = t.goalkeeperMs;
    r.outfieldMs = t.outfieldMs;
    r.totalMs = t.goalkeeperMs + t.outfieldMs;
  }
  for (const m of ledger.matches) {
    const played = new Set<string>();
    for (const i of m.intervals) {
      ledgerRow(i.playerId).intervals++;
      if (i.endMs > i.startMs) played.add(i.playerId);
    }
    for (const id of played) ledgerRow(id).matchesPlayed++;
    const events = m.events ?? [];
    const withdrawn = new Set(events.filter((e) => e.kind === 'withdrawn' && e.refersTo).map((e) => e.refersTo));
    for (const e of events) {
      if (e.kind === 'goal' && e.playerId && !withdrawn.has(e.id)) ledgerRow(e.playerId).goals++;
    }
  }
  const stats = seasonStats(ledger, session.players, { kickoffs: kickoffTimes(session.matches) });
  for (const s of stats.players) {
    const r = ledgerRow(s.playerId);
    r.attended = s.attended;
    r.missed = s.missed;
    r.averageMs = s.averageMs;
  }

  return {
    squad: {
      players: session.players.length,
      sessionMatches: session.matches.length,
      ledgerMatches: ledger.matches.length,
      ledgerPlayers: ledger.players.length,
      ledgerEntries: ledger.entries.length,
      countedMatches: stats.countedMatches,
    },
    matches: sorted(matches),
    session: sorted(sessionRows),
    ledger: sorted(ledgerRows),
  };
}

/**
 * Every figure that differs, named: `Ava: ledger.goalkeeperMs was 1 in the
 * release, now 2`. Empty when they agree. Compares leaf by leaf, so a figure
 * missing on either side is named too.
 */
export function figureDifferences(released: unknown, current: unknown, path = ''): string[] {
  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (isObj(released) && isObj(current)) {
    const keys = [...new Set([...Object.keys(released), ...Object.keys(current)])].sort();
    return keys.flatMap((k) => figureDifferences(released[k], current[k], path ? `${path}.${k}` : k));
  }
  if (JSON.stringify(released) === JSON.stringify(current)) return [];
  return [`${describe(path)} was ${JSON.stringify(released)} in the release, now ${JSON.stringify(current)}`];
}

/** `session.Ava.goals` reads as `Ava: session.goals`. */
function describe(path: string): string {
  const [where, who, ...rest] = path.split('.');
  if ((where === 'session' || where === 'ledger') && who && rest.length) {
    return `${who}: ${where}.${rest.join('.')}`;
  }
  return path;
}
