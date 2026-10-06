/**
 * A past season for the Test kit — Heart FC Beta Coach only (#106).
 *
 * > *"would like more historical data in the beta so I can see averages"* — PO
 *
 * One tap adds nine matches on the Saturdays before today — six league, two
 * cup (in halves) and a friendly — each PLAYED through the real path, so the
 * match report, the analysis shadow and the season columns have real-shaped
 * history to show (AC2):
 *
 * - created by `newMatch` and opened by `openMatch`, as a fixture is;
 * - absences marked before kick-off (`markAbsent`), the squad filled at
 *   kick-off (`fillSquadAtKickoff`);
 * - every period started, subbed, scored and ended through `MatchEngine`,
 *   on a clock that moves through the match's own Saturday morning;
 * - recorded into the ledger at kick-off (the attendance snapshot), after
 *   every period and after End match (`endMatch`), exactly as each save does
 *   — so the chain only ever grows and its head stays valid.
 *
 * A dedicated keeper (Ava, target 25 % outfield) keeps goal for most of each
 * match and plays roughly the last quarter outfield; she misses one match.
 * Absences differ between children, so their absence-adjusted averages do.
 *
 * Synthetic first names only (`TEST_NAMES`). Deterministic: no randomness,
 * so a beta tester and a test see the same season.
 */

import { MatchEngine } from '../engine/MatchEngine';
import type { Competition, Format, Player, Quarter, UUID } from '../types/index';
import { fillSquadAtKickoff, markAbsent } from './absence';
import { kickoffIso, startOfDay } from './kickoff';
import { recordMatches, type Ledger } from './ledger';
import { teamSheetFor } from './lineup';
import { withLiveMatch } from './liveMatch';
import { endMatch } from './matchClosing';
import { newMatch, openMatch } from './matchLifecycle';
import type { SavedMatch } from './persistence';
import { makePlayer } from './squad';
import { TEST_NAMES } from './testKit';

const MIN = 60_000;
const DAY = 86_400_000;

/** The dedicated keeper, and who keeps goal when she is outfield or away. */
export const SEASON_KEEPER = 'Ava';
const BACKUP_KEEPERS = ['Hal', 'Gus', 'Eli'];
export const SEASON_KEEPER_TARGET = 25;

interface SeasonMatch {
  opponent: string;
  competition: Competition;
  /** Halves for a cup, the squad's periods otherwise. */
  halves: boolean;
  weeksAgo: number;
  absent: string[];
  /** The keeper's share of this match outfield, as a fraction. */
  keeperOutfield: number;
  goals: number;
  conceded: number;
  saves: number;
}

/** Oldest first. Made-up opponents, distinct from the Test kit's fixtures. */
export const SEASON: readonly SeasonMatch[] = [
  { opponent: 'Mock Albion', competition: 'league', halves: false, weeksAgo: 9, absent: [], keeperOutfield: 0.25, goals: 3, conceded: 1, saves: 3 },
  { opponent: 'Practice Park', competition: 'league', halves: false, weeksAgo: 8, absent: ['Jo'], keeperOutfield: 0.25, goals: 1, conceded: 2, saves: 5 },
  { opponent: 'Example Wanderers', competition: 'cup', halves: true, weeksAgo: 7, absent: ['Ben', 'Gus'], keeperOutfield: 0.25, goals: 2, conceded: 2, saves: 4 },
  { opponent: 'Dummy Athletic', competition: 'league', halves: false, weeksAgo: 6, absent: ['Cal'], keeperOutfield: 0.3, goals: 0, conceded: 1, saves: 2 },
  { opponent: 'Trial Town', competition: 'league', halves: false, weeksAgo: 5, absent: ['Jo', 'Fay'], keeperOutfield: 0.25, goals: 4, conceded: 0, saves: 1 },
  { opponent: 'Fixture Forest', competition: 'friendly', halves: false, weeksAgo: 4, absent: ['Ava'], keeperOutfield: 0, goals: 2, conceded: 3, saves: 6 },
  { opponent: 'Demo Dynamos', competition: 'league', halves: false, weeksAgo: 3, absent: ['Ben'], keeperOutfield: 0.2, goals: 1, conceded: 1, saves: 3 },
  { opponent: 'Placeholder City', competition: 'cup', halves: true, weeksAgo: 2, absent: ['Jo'], keeperOutfield: 0.25, goals: 3, conceded: 2, saves: 4 },
  { opponent: 'Sample United', competition: 'league', halves: false, weeksAgo: 1, absent: ['Dee', 'Ben'], keeperOutfield: 0.25, goals: 2, conceded: 1, saves: 2 },
];

export interface TestSeason {
  players: Player[];
  matches: SavedMatch[];
  /** The ledger with the season recorded; null when there was none to write to. */
  ledger: Ledger | null;
  /** What was added, for the message on screen. */
  summary: string;
}

export interface TestSeasonInput {
  players: Player[];
  matches: SavedMatch[];
  squadId: UUID;
  squadName: string;
  format: Format;
  totalMinutes: number;
  periodCount: number;
  /** The ledger the app holds; null when it may not be written (#99 AC2). */
  ledger: Ledger | null;
  now: Date;
}

/** The Saturday before today (never today), at midnight local time. */
export function lastSaturdayBefore(now: Date): Date {
  const today = startOfDay(now);
  const back = (today.getDay() + 1) % 7 || 7;
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
}

/** True when this season is already in the list: a second tap adds nothing. */
export function hasTestSeason(matches: readonly SavedMatch[]): boolean {
  const opponents = new Set(SEASON.map((s) => s.opponent));
  return matches.some((m) => m.match.opponent !== null && opponents.has(m.match.opponent));
}

/**
 * Add the test squad (if missing) and a played season. Additive: nothing
 * already there is changed, except that the keeper and a backup get a keeper
 * preference and the keeper a 25 % target when they have none. A second tap
 * adds nothing.
 */
export function addTestSeason(input: TestSeasonInput): TestSeason {
  const unchanged = (summary: string): TestSeason => ({
    players: input.players,
    matches: input.matches,
    ledger: input.ledger,
    summary,
  });
  if (!input.ledger) {
    return unchanged('Player minutes cannot be written on this phone, so no season was added.');
  }
  if (hasTestSeason(input.matches)) return unchanged('The test season is already there.');

  const first = lastSaturdayBefore(input.now);
  const seasonStart = new Date(first.getTime() - (SEASON[0].weeksAgo + 1) * 7 * DAY);

  // The test squad, joined before the season began (ruling E reads createdAt).
  const have = new Set(input.players.filter((p) => p.active).map((p) => p.firstName));
  const added = TEST_NAMES.filter((n) => !have.has(n)).map((n) => ({
    ...makePlayer(input.squadId, n),
    createdAt: seasonStart.toISOString(),
  }));
  const players = [...input.players, ...added].map((p) => {
    if (!p.active || !TEST_NAMES.includes(p.firstName)) return p;
    if (p.firstName === SEASON_KEEPER && p.keeper == null && p.outfieldTargetPct == null) {
      return { ...p, keeper: 'main' as const, outfieldTargetPct: SEASON_KEEPER_TARGET };
    }
    if (p.firstName === BACKUP_KEEPERS[0] && p.keeper == null) return { ...p, keeper: 'backup' as const };
    return p;
  });
  const squad = players.filter((p) => p.active && TEST_NAMES.includes(p.firstName));

  let matches = input.matches;
  let ledger = input.ledger;
  SEASON.forEach((spec, index) => {
    const day = new Date(first.getFullYear(), first.getMonth(), first.getDate() - 7 * (spec.weeksAgo - 1));
    const played = playSeasonMatch(spec, index, {
      ...input,
      squad,
      players,
      matches,
      ledger,
      kickoffAt: kickoffIso(day, '10:00'),
    });
    matches = played.matches;
    ledger = played.ledger;
  });

  const count = (c: Competition) => SEASON.filter((s) => s.competition === c).length;
  return {
    players,
    matches,
    ledger,
    summary:
      `Added ${added.length} test player${added.length === 1 ? '' : 's'} and a past season: ` +
      `${SEASON.length} matches (${count('league')} league, ${count('cup')} cup, ` +
      `${count('friendly')} friendly) on the Saturdays before today.`,
  };
}

interface PlayContext extends TestSeasonInput {
  squad: Player[];
  ledger: Ledger;
  kickoffAt: string;
}

/** One match, kick-off to End match, through the engine and the ledger. */
function playSeasonMatch(
  spec: SeasonMatch,
  index: number,
  ctx: PlayContext
): { matches: SavedMatch[]; ledger: Ledger } {
  const kickoff = Date.parse(ctx.kickoffAt);
  let t = kickoff - 3 * DAY; // the fixture is saved midweek
  const nowFn = () => new Date(t);
  const { format } = ctx;
  const periods = spec.halves ? 2 : ctx.periodCount;
  const totalMs = ctx.totalMinutes * MIN;
  const periodMs = Math.round(totalMs / periods);
  const idOf = (name: string) => ctx.squad.find((p) => p.firstName === name)?.id;

  const { stored } = newMatch(
    {
      squadId: ctx.squadId,
      format,
      totalMinutes: ctx.totalMinutes,
      periodCount: periods,
      players: ctx.squad,
      opponent: spec.opponent,
      competition: spec.competition,
      kickoffAt: ctx.kickoffAt,
    },
    nowFn
  );
  let matches = [...ctx.matches, stored];

  // Saturday morning: opened, absences marked, the squad filled at kick-off.
  t = kickoff - 30 * MIN;
  const engine = new MatchEngine({ nowFn });
  const opened = openMatch(matches, null, stored.match.id, ctx.squad, format);
  if (opened.kind !== 'open') return { matches, ledger: ctx.ledger };
  const state = opened.held.state;
  // Never so many away that a team cannot be put out, with one on the bench.
  let present = ctx.squad.length;
  for (const name of spec.absent) {
    const id = idOf(name);
    if (id && present > format.onFieldCount + 1 && markAbsent(engine, state, id, true)) present--;
  }
  fillSquadAtKickoff(engine, state, ctx.squad);
  const here = ctx.squad.filter((p) => state.playerAvailability.get(p.id) === 'available').map((p) => p.id);

  const keeper = idOf(SEASON_KEEPER);
  const keeperHere = keeper !== undefined && here.includes(keeper);
  const backup = BACKUP_KEEPERS.map(idOf).find((id) => id !== undefined && here.includes(id)) ?? here[1];
  const mainKeeper = keeperHere ? keeper : backup;
  /** Match-elapsed at which the keeper goes outfield; never, when she is away. */
  const swapAt = keeperHere && spec.keeperOutfield > 0 ? Math.round((1 - spec.keeperOutfield) * totalMs) : Infinity;

  const record = () => {
    ctx.ledger = recordMatches(ctx.ledger, [state], ctx.players, ctx.squadName, ctx.now);
  };
  const timed = (count: number) =>
    Array.from({ length: count }, (_, k) => {
      const at = Math.round(((k + 0.5) / count) * totalMs) + 37_000 * ((index + k) % 3);
      return at % periodMs === 0 ? at + 1_000 : at;
    });
  const happenings = [
    ...timed(spec.goals).map((at) => ({ at, kind: 'goal' as const })),
    ...timed(spec.saves).map((at) => ({ at: at + 11_000, kind: 'save' as const })),
    ...timed(spec.conceded).map((at) => ({ at: at + 23_000, kind: 'conceded' as const })),
  ];

  const onPitch = (quarter: Quarter, kind: 'goalkeeper' | 'outfield') =>
    state.appearances
      .filter((a) => a.quarterId === quarter.id && a.endElapsedMs === null && a.positionKind === kind)
      .map((a) => a.playerId);

  let periodWallStart = kickoff;
  for (let p = 0; p < periods; p++) {
    const quarter = [...state.quarters].sort((a, b) => a.index - b.index)[p];
    const start = p * periodMs;
    const end = start + periodMs;
    const inGoal = start >= swapAt ? backup : mainKeeper;
    // Who must be on: the keeper outfield after the swap, and the backup
    // before a swap due inside this period.
    const must = [
      ...(start >= swapAt && keeper ? [keeper] : []),
      ...(swapAt > start && swapAt < end ? [backup] : []),
    ].filter((id) => id !== inGoal);
    const others = here.filter((id) => id !== inGoal && !must.includes(id));
    const shift = (index * 3 + p * 2) % Math.max(1, others.length);
    const rotated = [...others.slice(shift), ...others.slice(0, shift)];
    const outfield = [...must, ...rotated].slice(0, format.onFieldCount - 1);

    t = periodWallStart;
    engine.startQuarter(state, quarter, teamSheetFor([inGoal, ...outfield], inGoal, format), format);
    record(); // the first is the kick-off: attendance is snapshotted here

    const subCount = (index + p) % 2 === 0 ? 2 : 1;
    const subAt = start + Math.round(periodMs * (0.4 + 0.2 * ((index + p) % 2)));
    const actions = [
      ...happenings.filter((h) => h.at > start && h.at < end),
      ...(swapAt > start && swapAt < end ? [{ at: swapAt, kind: 'swap' as const }] : []),
      { at: subAt, kind: 'subs' as const },
    ].sort((a, b) => a.at - b.at);

    for (const action of actions) {
      t = periodWallStart + (action.at - start);
      const gk = onPitch(quarter, 'goalkeeper')[0];
      const field = onPitch(quarter, 'outfield');
      if (action.kind === 'goal') {
        engine.recordEvent(state, quarter, 'goal', field[(index * 7 + action.at) % field.length]);
      } else if (action.kind === 'save' || action.kind === 'conceded') {
        if (gk) engine.recordEvent(state, quarter, action.kind, gk);
      } else if (action.kind === 'swap') {
        if (gk && backup && field.includes(backup)) engine.swapPositions(state, quarter, gk, backup);
      } else {
        // Outfield subs only: never the keeper, never the backup due in goal.
        const bench = here.filter((id) => !onPitch(quarter, 'goalkeeper').includes(id) && !field.includes(id));
        const off = field.filter((id) => id !== keeper && !must.includes(id)).reverse();
        for (let s = 0; s < Math.min(subCount, bench.length, off.length); s++) {
          engine.substitute(state, quarter, off[s], bench[s]);
        }
      }
    }

    t = periodWallStart + periodMs;
    engine.endQuarter(state, quarter);
    record();
    periodWallStart = t + 5 * MIN; // the break
  }

  // The report read, then End match.
  t += 2 * MIN;
  endMatch(engine, state);
  record();
  matches = withLiveMatch(matches, { state, format });
  return { matches, ledger: ctx.ledger };
}
