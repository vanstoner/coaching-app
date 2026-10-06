/**
 * The squad views — #143, building the design Rob approved on #138
 * (rulings 24 and 25).
 *
 * Pure TypeScript: no React, no platform imports, nothing stored. Every figure
 * is folded from the ledger on each draw (invariant 1, AC8), by the rules each
 * child's season already uses (#121, `childSeason.ts`): closed matches only,
 * attended as `countedAttendance` says, goal plus outfield (invariant 3), and
 * a Main keeper outside the squad average.
 *
 * - **Season grid** (AC2): each child's whole minutes in each closed match,
 *   oldest first, and null where they were not there. Time in goal is part of
 *   that total, and goal and outfield add up to it (AC10).
 * - **Fairness at a glance** (AC3): "Everyone within N min a game of the
 *   squad average, S". N comes from the whole minutes shown, so the sums a
 *   coach checks on screen agree. The trend is that N for the season so far,
 *   worked out again after each match (ruling 25).
 * - **Going into Saturday** (AC4): owed = (squad average − their average) ×
 *   the matches they played. Named as owed at 5 minutes or more (ruling 24).
 *   A missed match is never owed time.
 * - **Positions tried** (AC5): time in GK, DEF, MID and FWD. A record: never
 *   a target, a warning or a score (invariant 3).
 *
 * Nothing is ranked. Every list keeps the squad's own order (AC7).
 */

import type { Competition, KeeperPreference, Player, PositionUnit, UUID } from '../types/index';
import { UNIT_LABEL, type Ledger } from './ledger';
import { isCounted, wholeMinuteParts, wholeMinutes, type SeasonOptions } from './analysis';
import { countedAttendance, firstSeen, type SquadTimeline } from './attendance';
import { squadAverage, squadSeason, type ChildSeason, type SquadSeason } from './childSeason';
import { competitionLabel } from './fixtures';
import { dayLabel } from './kickoff';

const MIN = 60_000;
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Ruling 24: a child is named as owed at this many minutes or more over the season. */
export const OWED_MIN = 5;

/** Back to front, as the coach reads a team. Stored ATT is shown as FWD (`UNIT_LABEL`). */
export const UNITS: readonly PositionUnit[] = ['GK', 'DEF', 'MID', 'ATT'];

/** Before anything is closed, a view says when it will have something to show. */
export const AFTER_FIRST_MATCH = 'After the first match';

export type SquadView = 'grid' | 'fairness' | 'saturday' | 'positions';

/** Each view's title; its tile is the short form. */
export const VIEW_TITLE: Record<SquadView, string> = {
  grid: 'Season grid',
  fairness: 'Fairness at a glance',
  saturday: 'Going into Saturday',
  positions: 'Positions tried',
};

export const TILE_TITLE: Record<SquadView, string> = { ...VIEW_TITLE, fairness: 'Fairness' };

// ============================================================================
// The closed matches, oldest first
// ============================================================================

export interface MatchMinutes {
  /** Goal plus outfield. */
  pitchMs: number;
  goalMs: number;
  /** Per unit. Outfield time with no unit recorded (an early match) is in none. */
  unitMs: Record<PositionUnit, number>;
}

export interface SeasonMatch {
  matchId: UUID;
  /** Kick-off; else its first period's start; else when the ledger first saw it. */
  at: Date | null;
  /** "8 Aug", or "Date TBC". */
  day: string;
  /** "Sat 8 Aug", or "Date TBC". */
  date: string;
  /** "Mock Albion", or "Opponent TBC". */
  opponent: string;
  competition: Competition | null;
  /** "L", "C", "F", "T", or "" when not known. */
  competitionShort: string;
  /** "Sat 8 Aug · League · v Mock Albion". */
  label: string;
  /** Everyone who attended (played is attended), and their minutes. */
  minutes: ReadonlyMap<UUID, MatchMinutes>;
}

const blankUnits = (): Record<PositionUnit, number> => ({ GK: 0, DEF: 0, MID: 0, ATT: 0 });

/**
 * The closed matches (ADR-015 §6), oldest first, with who attended each and
 * their minutes. A match with no known time sits after the dated ones, in the
 * ledger's order.
 */
export function seasonMatches(
  ledger: Ledger | null,
  players: Player[],
  options: Pick<SeasonOptions, 'kickoffs'> = {}
): SeasonMatch[] {
  if (!ledger) return [];
  const timeline: SquadTimeline = { players, kickoffs: options.kickoffs };
  const seen = firstSeen(ledger);
  const entryAt = new Map(ledger.entries.map((e) => [e.seq, e.at]));

  const rows = ledger.matches.filter(isCounted).map((m, index) => {
    const { attended } = countedAttendance(ledger, m, timeline, seen);
    const minutes = new Map<UUID, MatchMinutes>();
    const of = (id: UUID) => {
      let row = minutes.get(id);
      if (!row) {
        row = { pitchMs: 0, goalMs: 0, unitMs: blankUnits() };
        minutes.set(id, row);
      }
      return row;
    };
    for (const id of attended) of(id);
    for (const i of m.intervals) {
      const ms = Math.max(0, i.endMs - i.startMs);
      const row = of(i.playerId);
      row.pitchMs += ms;
      if (i.kind === 'goalkeeper') row.goalMs += ms;
      const unit = i.unit ?? (i.kind === 'goalkeeper' ? 'GK' : null);
      // A unit a later version added is carried in the ledger but is none of these four.
      if (unit !== null && UNITS.includes(unit)) row.unitMs[unit] += ms;
    }
    const firstEntry = seen.get(`match:${m.id}`);
    const iso =
      m.kickoffAt ??
      options.kickoffs?.get(m.id) ??
      (firstEntry === undefined ? undefined : entryAt.get(firstEntry)) ??
      null;
    const t = iso === null ? NaN : Date.parse(iso);
    return { index, t, m, minutes };
  });

  rows.sort((a, b) => {
    const known = (t: number) => Number.isFinite(t);
    if (known(a.t) && known(b.t)) return a.t - b.t || a.index - b.index;
    if (known(a.t) !== known(b.t)) return known(a.t) ? -1 : 1;
    return a.index - b.index;
  });

  return rows.map(({ t, m, minutes }) => {
    const at = Number.isFinite(t) ? new Date(t) : null;
    const opponent = (m.opponent ?? '').trim() || 'Opponent TBC';
    const competition = competitionLabel(m.competition);
    const date = at ? dayLabel(at) : 'Date TBC';
    return {
      matchId: m.id,
      at,
      day: at ? `${at.getDate()} ${MONTH[at.getMonth()]}` : 'Date TBC',
      date,
      opponent,
      competition: m.competition,
      competitionShort: competition.slice(0, 1),
      label: [date, competition, `v ${opponent}`].filter((s) => s !== '').join(' · '),
      minutes,
    };
  });
}

/** Under each column: the day of the month, and the month under the first match of each month. */
export function axisLabels(matches: readonly SeasonMatch[]): { day: string; month: string }[] {
  return matches.map((m, j) => {
    if (!m.at) return { day: '–', month: '' };
    const prev = j > 0 ? matches[j - 1].at : null;
    const newMonth = !prev || prev.getMonth() !== m.at.getMonth() || prev.getFullYear() !== m.at.getFullYear();
    return { day: String(m.at.getDate()), month: newMonth ? MONTH[m.at.getMonth()] : '' };
  });
}

// ============================================================================
// Season grid (AC2)
// ============================================================================

export interface GridCell {
  /** Whole minutes on the pitch, goal plus outfield. */
  total: number;
  /** In goal and outfield, whole minutes that add up to `total` (AC10). */
  goal: number;
  outfield: number;
  /** "Ava, Sat 8 Aug v Mock Albion: 50 min (38 in goal, 12 outfield)". */
  text: string;
}

export interface GridRow {
  playerId: UUID;
  name: string;
  mainKeeper: boolean;
  /** Minutes a game, whole, as the Squad list shows it; null before their first closed match. */
  perGame: number | null;
  /** One per match, oldest first; null where they were not there. */
  cells: (GridCell | null)[];
}

/** One child's minutes in one match, as a cell and its words. */
export function gridCell(name: string, match: Pick<SeasonMatch, 'date' | 'opponent'>, m: MatchMinutes): GridCell {
  const total = wholeMinutes(m.pitchMs);
  const [goal, outfield] = wholeMinuteParts([m.goalMs, m.pitchMs - m.goalMs], m.pitchMs);
  const split = goal > 0 ? ` (${goal} in goal, ${outfield} outfield)` : '';
  return { total, goal, outfield, text: `${name}, ${match.date} v ${match.opponent}: ${total} min${split}` };
}

export function seasonGrid(matches: readonly SeasonMatch[], children: readonly ChildSeason[]): GridRow[] {
  return children.map((c) => ({
    playerId: c.playerId,
    name: c.name,
    mainKeeper: c.mainKeeper,
    perGame: c.averageMs === null ? null : wholeMinutes(c.averageMs),
    cells: matches.map((match) => {
      const m = match.minutes.get(c.playerId);
      return m ? gridCell(c.name, match, m) : null;
    }),
  }));
}

// ============================================================================
// Fairness at a glance (AC3)
// ============================================================================

export interface FairnessRow {
  playerId: UUID;
  name: string;
  /** Minutes a game, whole; null before their first closed match. */
  perGame: number | null;
  /** Outside the squad average: shown with the note, never against the band. */
  mainKeeper: boolean;
  /** `perGame` minus the squad average, both as shown; null when not in the average. */
  offset: number | null;
}

export interface Fairness {
  /** The squad average, whole minutes a game (S). */
  average: number;
  /** Everyone in the average is within this many whole minutes a game of it (N). */
  gap: number;
  rows: FairnessRow[];
  /** Main keepers, by name: not in the average. */
  mainKeepers: string[];
}

/** The widest gap from the average, in the whole minutes shown. */
function widestGap(perGame: readonly (number | null)[], average: number): number {
  return Math.max(0, ...perGame.map((v) => (v === null ? 0 : Math.abs(v - average))));
}

/** Null until somebody counted in the squad average has a closed match. */
export function fairnessOf(season: SquadSeason): Fairness | null {
  if (season.squadAverageMs === null) return null;
  const average = wholeMinutes(season.squadAverageMs);
  const rows: FairnessRow[] = season.children.map((c) => {
    const perGame = c.averageMs === null ? null : wholeMinutes(c.averageMs);
    return {
      playerId: c.playerId,
      name: c.name,
      perGame,
      mainKeeper: c.mainKeeper,
      offset: perGame === null || c.mainKeeper ? null : perGame - average,
    };
  });
  return {
    average,
    gap: Math.max(0, ...rows.map((r) => (r.offset === null ? 0 : Math.abs(r.offset)))),
    rows,
    mainKeepers: season.children.filter((c) => c.mainKeeper).map((c) => c.name),
  };
}

/** "Everyone within 5 min a game of the squad average, 39". */
export function fairnessHeadline(f: Fairness): string {
  return `Everyone within ${f.gap} min a game of the squad average, ${f.average}`;
}

/** "level with the squad average", "4 below the squad average". */
export function offsetWords(offset: number): string {
  if (offset === 0) return 'level with the squad average';
  return `${Math.abs(offset)} ${offset < 0 ? 'below' : 'above'} the squad average`;
}

export interface TrendPoint {
  matchId: UUID;
  /** The squad average after this match, for the season so far; null when nobody counted had played. */
  average: number | null;
  /** The headline's N after this match, for the season so far. */
  gap: number | null;
}

/** "After Sat 8 Aug v Mock Albion (1 of 9): everyone within 15 min a game of 41". */
export function trendLabel(t: TrendPoint, m: Pick<SeasonMatch, 'date' | 'opponent'>, index: number, count: number): string {
  const after = `After ${m.date} v ${m.opponent} (${index + 1} of ${count})`;
  return t.gap === null ? `${after}: no squad average yet` : `${after}: everyone within ${t.gap} min a game of ${t.average}`;
}

/**
 * Ruling 25: the gap for the season so far, worked out again after each
 * match, the same way as the headline. The last point is the headline.
 */
export function fairnessTrend(matches: readonly SeasonMatch[], children: readonly ChildSeason[]): TrendPoint[] {
  const sums = new Map<UUID, { ms: number; played: number }>(
    children.map((c) => [c.playerId, { ms: 0, played: 0 }])
  );
  return matches.map((match) => {
    for (const [id, m] of match.minutes) {
      const s = sums.get(id);
      if (!s) continue; // a retired child: not in the list, so not in the average
      s.ms += m.pitchMs;
      s.played++;
    }
    const soFar = children.map((c) => {
      const s = sums.get(c.playerId) as { ms: number; played: number };
      return { mainKeeper: c.mainKeeper, averageMs: s.played === 0 ? null : Math.round(s.ms / s.played) };
    });
    const avgMs = squadAverage(soFar);
    if (avgMs === null) return { matchId: match.matchId, average: null, gap: null };
    const average = wholeMinutes(avgMs);
    const counted = soFar.map((c) => (c.mainKeeper || c.averageMs === null ? null : wholeMinutes(c.averageMs)));
    return { matchId: match.matchId, average, gap: widestGap(counted, average) };
  });
}

// ============================================================================
// Going into Saturday (AC4)
// ============================================================================

export interface OwedRow {
  playerId: UUID;
  name: string;
  /** Minutes a game, whole; null before their first closed match. */
  perGame: number | null;
  played: number;
  mainKeeper: boolean;
  /**
   * Whole minutes owed over the season: above zero owed, below zero had
   * more. Null when not in the squad average (a Main keeper) or not played.
   */
  owed: number | null;
  /** Owed `OWED_MIN` or more: named (ruling 24). */
  named: boolean;
}

/**
 * (squad average − their average) × matches played, from the averages
 * themselves and rounded once at the end, as the approved prototype works it
 * out. Squad order, everyone listed.
 */
export function owedTime(season: SquadSeason): OwedRow[] {
  const avg = season.squadAverageMs;
  return season.children.map((c) => {
    const owed =
      avg === null || c.averageMs === null || c.mainKeeper
        ? null
        : Math.round(((avg - c.averageMs) * c.played) / MIN) || 0; // never "-0"
    return {
      playerId: c.playerId,
      name: c.name,
      perGame: c.averageMs === null ? null : wholeMinutes(c.averageMs),
      played: c.played,
      mainKeeper: c.mainKeeper,
      owed,
      named: owed !== null && owed >= OWED_MIN,
    };
  });
}

/** "Owed 6 min", "Had 9 min more", "Level". */
export function owedText(owed: number): string {
  if (owed > 0) return `Owed ${owed} min`;
  if (owed < 0) return `Had ${-owed} min more`;
  return 'Level';
}

// ============================================================================
// Positions tried (AC5)
// ============================================================================

export interface PositionsRow {
  playerId: UUID;
  name: string;
  keeper: KeeperPreference | null;
  played: number;
  /** Whole minutes per unit, adding up to `total` (AC10). */
  minutes: Record<PositionUnit, number>;
  total: number;
  /** "GK 38 · DEF 59 · MID 98 · FWD 21": each unit with time, back to front. */
  text: string;
  /** Outfield time with no position recorded (an early match): not in the parts. */
  unplacedMs: number;
}

export function positionsTried(
  matches: readonly SeasonMatch[],
  children: readonly ChildSeason[],
  players: readonly Player[]
): PositionsRow[] {
  return children.map((c) => {
    const ms = blankUnits();
    let pitchMs = 0;
    for (const match of matches) {
      const m = match.minutes.get(c.playerId);
      if (!m) continue;
      pitchMs += m.pitchMs;
      for (const u of UNITS) ms[u] += m.unitMs[u];
    }
    const placedMs = UNITS.reduce((sum, u) => sum + ms[u], 0);
    const parts = wholeMinuteParts(
      UNITS.map((u) => ms[u]),
      placedMs
    );
    const minutes = blankUnits();
    UNITS.forEach((u, k) => {
      minutes[u] = parts[k];
    });
    return {
      playerId: c.playerId,
      name: c.name,
      keeper: players.find((p) => p.id === c.playerId)?.keeper ?? null,
      played: c.played,
      minutes,
      total: wholeMinutes(placedMs),
      text: UNITS.filter((u) => minutes[u] > 0)
        .map((u) => `${UNIT_LABEL[u]} ${minutes[u]}`)
        .join(' · '),
      unplacedMs: Math.max(0, pitchMs - placedMs),
    };
  });
}

// ============================================================================
// The tiles on Squad (AC1): each answer before it is tapped
// ============================================================================

/** "9 matches, 8 Aug to 3 Oct". */
export function gridTile(matches: readonly SeasonMatch[]): string {
  const n = matches.length;
  if (n === 0) return 'No matches yet';
  const count = `${n} ${n === 1 ? 'match' : 'matches'}`;
  const first = matches[0].at ? matches[0].day : null;
  const last = matches[n - 1].at ? matches[n - 1].day : null;
  if (!first || !last) return count;
  return n === 1 || first === last ? `${count}, ${first}` : `${count}, ${first} to ${last}`;
}

/** "Everyone within 5 min a game". */
export function fairnessTile(f: Fairness | null): string {
  return f === null ? AFTER_FIRST_MATCH : `Everyone within ${f.gap} min a game`;
}

/** "Owed time: Dee, Gus, Ivy, Jo". */
export function saturdayTile(rows: readonly OwedRow[], f: Fairness | null): string {
  if (f === null) return AFTER_FIRST_MATCH;
  const named = rows.filter((r) => r.named).map((r) => r.name);
  return named.length > 0 ? `Owed time: ${named.join(', ')}` : `Nobody owed ${OWED_MIN} min or more`;
}

export function positionsTile(matches: readonly SeasonMatch[]): string {
  return matches.length === 0 ? AFTER_FIRST_MATCH : 'Time in GK, DEF, MID, FWD';
}

/** "Ava is Main keeper", "Ava and Hal are Main keepers". */
export function mainKeeperWords(names: readonly string[]): string {
  const list =
    names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${list} ${names.length > 1 ? 'are Main keepers' : 'is Main keeper'}`;
}

// ============================================================================
// Everything the views draw, folded once per draw
// ============================================================================

export interface SquadViews {
  /** Each child's season and the squad average, as the Squad list shows them (#121). */
  season: SquadSeason;
  matches: SeasonMatch[];
  grid: GridRow[];
  fairness: Fairness | null;
  trend: TrendPoint[];
  owed: OwedRow[];
  positions: PositionsRow[];
}

/**
 * Every squad view's figures from the ledger. `players` is everyone ever in
 * the squad; retired children are left out of every view and the average,
 * as they are from the Squad list.
 */
export function squadViews(
  ledger: Ledger | null,
  players: Player[],
  options: Pick<SeasonOptions, 'kickoffs'> = {}
): SquadViews {
  const season = squadSeason(ledger, players, options);
  const matches = seasonMatches(ledger, players, options);
  return {
    season,
    matches,
    grid: seasonGrid(matches, season.children),
    fairness: fairnessOf(season),
    trend: fairnessTrend(matches, season.children),
    owed: owedTime(season),
    positions: positionsTried(matches, season.children, players),
  };
}

// ============================================================================
// The child page's lens cards (AC6)
// ============================================================================

export type LensCard = 'playing' | 'matches' | 'positions' | 'preference';

export const LENS_TITLE: Record<LensCard, string> = {
  playing: 'Playing time',
  matches: 'Match by match',
  positions: 'Positions tried',
  preference: 'Position preference',
};

/**
 * The cards on a child's page, in order (AC6): Playing time first and always
 * there; match by match and positions once they have played a closed match;
 * their position preference last.
 */
export function lensCards(child: Pick<ChildSeason, 'played'> | undefined): LensCard[] {
  return (child?.played ?? 0) > 0
    ? ['playing', 'matches', 'positions', 'preference']
    : ['playing', 'preference'];
}

export interface ChildMatch {
  matchId: UUID;
  day: string;
  month: string;
  /** Their minutes, in goal and outfield adding up to the total; null where they were not there. */
  cell: GridCell | null;
  /** "Sat 8 Aug v Mock Albion, League: 50 min (38 in goal)", or "…: not there". */
  label: string;
}

/** One child's season match by match, oldest first: the child page's second lens card (AC6). */
export function childMatches(v: SquadViews, playerId: UUID): ChildMatch[] {
  const cells = v.grid.find((r) => r.playerId === playerId)?.cells ?? [];
  const labels = axisLabels(v.matches);
  return v.matches.map((m, j) => {
    const cell = cells[j] ?? null;
    const what = [`${m.date} v ${m.opponent}`, competitionLabel(m.competition)].filter((s) => s !== '').join(', ');
    return {
      matchId: m.matchId,
      day: labels[j].day,
      month: labels[j].month,
      cell,
      label:
        cell === null
          ? `${what}: not there`
          : `${what}: ${cell.total} min${cell.goal > 0 ? ` (${cell.goal} in goal)` : ''}`,
    };
  });
}

/** The four tiles above the Squad list, each with its answer (AC1). */
export function squadTiles(v: SquadViews): { view: SquadView; title: string; answer: string }[] {
  return [
    { view: 'grid', title: TILE_TITLE.grid, answer: gridTile(v.matches) },
    { view: 'fairness', title: TILE_TITLE.fairness, answer: fairnessTile(v.fairness) },
    { view: 'saturday', title: TILE_TITLE.saturday, answer: saturdayTile(v.owed, v.fairness) },
    { view: 'positions', title: TILE_TITLE.positions, answer: positionsTile(v.matches) },
  ];
}
