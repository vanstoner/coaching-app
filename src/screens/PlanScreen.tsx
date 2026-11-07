/**
 * Plan a match before kick-off — #72.
 *
 * > *"I feel we've not yet got to the point where we can plan the halfs or
 * > quaters"* — PO, 2026-10-03.
 *
 * The coach's spreadsheet, on the phone: every period's lineup by named
 * position, the subs inside each period, and what every player's minutes add
 * up to — recomputed on every tap, so the fair-share question is answered on
 * Tuesday rather than at the touchline.
 *
 * Every edit is handed straight up and saved; there is no Save button to
 * forget. A plan that does not add up says so and is kept anyway (AC5),
 * because a Tuesday plan is usually a draft.
 *
 * #264: each save shows ✓ Saved right-justified on the top bar for two
 * seconds (Dee: the plan saves as one, so its tick belongs to the screen).
 * The period is a segmented choice. Each sub is a Row › opening "name comes
 * on": At on the compact stepper at the Plan's own 15 s step (Rob, Q2), and
 * For as a list with a tick; Cancel changes nothing. Done is the top-left
 * way out; Share plan is the one Main button.
 *
 * All the rules live in `src/app/matchPlan.ts` and are tested there. This
 * file draws them.
 */

import { NOT_IN_SHARE_SHORT } from '../app/fairShare';
import { InfoTap } from './FiguresHelp';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import type { Format, Match, Player, UUID } from '../types/index';
import { displayName } from '../app/squad';
import { formatClock, formatSubTime, periodNoun } from '../app/matchClock';
import { plannedSubText, subsPlannedSummary } from '../app/plannedSubSheet';
import {
  formatDelta,
  periodLengthMs,
  planFor,
  projectPlan,
  sameAsPrevious,
  setPeriodSlots,
  type MatchPlan,
} from '../app/matchPlan';
import { opponentLabel } from '../app/fixtures';
import {
  Action,
  BackLink,
  RowNav,
  SavedTick,
  Segmented,
  TopBar,
  useSavedTick,
} from './controls';
import { PitchView } from './PitchView';
import { PlannedSubPanel, subRequestFor, type SubRequest } from './PlannedSubPanel';
import { useEdgeScroll } from './useEdgeScroll';
import { PositionNameSheet, type PositionNaming } from './PositionNameSheet';
import { hasRenamedPositions } from '../app/positionNames';
import { editSheet } from '../app/teamSheet';
import { colours, screen } from './theme';
import { SharePlanFoot } from './SharePlan';

/** The sub sheet's draft (#264 V20): which sub (-1 for a new one), and its picks. */
export function PlanScreen({
  match,
  format,
  players,
  plan: stored,
  live,
  squadName,
  onChange,
  onBack,
  names,
  absent,
}: {
  match: Match;
  /** Our team's name, so the header reads "Us v Them" as the clock does. */
  squadName: string;
  /** The shape THIS match is played in (ADR-012), not the squad default. */
  format: Format;
  players: Player[];
  plan: MatchPlan | undefined;
  onChange: (plan: MatchPlan) => void;
  onBack: () => void;
  /**
   * Rename this match's positions (#166). Given before kick-off only: once a
   * period has started, names change on the lineup between periods.
   */
  names?: PositionNaming;
  /** Who is marked unavailable for this match: kept off the shared image's bench (#165). */
  absent?: ReadonlySet<UUID>;
  /**
   * Re-planning during play (#88): the first period still to come, and what
   * each player already has. Earlier periods are locked.
   */
  live?: {
    fromPeriod: number;
    baseline: Map<UUID, { outfieldMs: number; goalkeeperMs: number }>;
    /** Who finished each period already played or under way (#111); null for those to come. */
    recordedEnd?: (Record<UUID, UUID | null> | null)[];
  };
}) {
  const periodCount = match.quarterCount;
  const plan = planFor(stored, periodCount);
  const periodMs = periodLengthMs(match.totalMinutes, periodCount);
  const noun = periodNoun(periodCount);
  // #262: the absent are out of the share, with no gap.
  const projection = projectPlan(plan, format, match.totalMinutes, periodCount, players, live ?? null, absent);
  const firstOpen = Math.min(live?.fromPeriod ?? 0, periodCount - 1);
  const allPlayed = (live?.fromPeriod ?? 0) >= periodCount;

  const [periodIndex, setPeriodIndex] = useState(firstOpen);
  /** The pitch's first tap, waiting for where that player goes (#83). */
  const [pitchPick, setPitchPick] = useState<UUID | null>(null);
  const [dragging, setDragging] = useState(false);
  // #276: drag near the scrolling area's edge to scroll it; the pitch fits with the bench.
  const edge = useEdgeScroll(dragging);
  /** The position whose name is being changed (#166). */
  const [renaming, setRenaming] = useState<UUID | null>(null);
  /** The sub sheet (#120, #264): a draft until Save. */
  const [subAsk, setSubAsk] = useState<SubRequest | null>(null);
  const tick = useSavedTick();

  const period = plan.periods[periodIndex];
  const nameOf = new Map(players.map((p) => [p.id, displayName(p)]));
  const name = (id: UUID | null) =>
    id === null ? 'Pick' : (nameOf.get(id) ?? 'Removed player');
  const problemsHere = projection.problems.filter((p) => p.periodIndex === periodIndex);

  const change = (next: MatchPlan) => {
    onChange(next);
    tick.mark();
  };
  // "Same as" the previous period (#111): what was on the pitch at its end if
  // it has been played, else its plan. Null means there is nothing to copy.
  const sameAs =
    periodIndex > 0
      ? sameAsPrevious(plan, periodIndex, live?.recordedEnd?.[periodIndex - 1] ?? null)
      : null;

  const choosePeriod = (i: number) => {
    setPeriodIndex(i);
    setPitchPick(null);
    setSubAsk(null);
  };

  const benchIds = players
    .map((p) => p.id)
    .filter((id) => !Object.values(period.slots).includes(id));

  /** Open an existing sub, or a new one (#264 V20). */
  const openSub = (swapIndex: number, onId: UUID | null) =>
    setSubAsk({ swapIndex, onId, offId: swapIndex === -1 ? null : period.subs[swapIndex].offId });

  // #120: a tap on a bench player opens their sub; a tap on a player in a
  // position selects them for tap-then-place, as before. Dragging is unchanged.
  const tapPlayer = (id: UUID) => {
    if (!benchIds.includes(id)) {
      setPitchPick(id);
      return;
    }
    setSubAsk(subRequestFor(period, id, false));
  };

  const flaggedPeriods = plan.periods
    .map((_, i) => i)
    .filter((i) => !(live && i < live.fromPeriod) && projection.problems.some((p) => p.periodIndex === i));

  return (
    <View style={screen.flex}>
      <ScrollView contentContainerStyle={screen.scroll} {...edge.scrollProps}>
        {/* #264: the way out top left; ✓ Saved right-justified on the top bar (Dee: the plan saves as one). */}
        <TopBar
          back={<BackLink label="Done" accessibilityLabel="Done" onPress={onBack} />}
          title="Plan"
          right={<SavedTick visible={tick.visible} />}
        />
        <Text style={screen.caption} numberOfLines={1}>
          {squadName} v {opponentLabel(match)}
        </Text>

        {/* Dee: the period row is a choice, so a segmented control. */}
        <Segmented
          name="Period"
          options={plan.periods.map((_, i) => ({
            value: i,
            label: periodCount === 4 ? `Q${i + 1}` : `${noun} ${i + 1}`,
            accessibilityLabel: `${noun} ${i + 1}${live && i < live.fromPeriod ? ', played' : flaggedPeriods.includes(i) ? ', needs a look' : ''}`,
          }))}
          value={periodIndex}
          onChange={(i) => i !== null && choosePeriod(i)}
        />
        {flaggedPeriods.length > 0 && (
          <Text style={local.flagged}>
            Needs a look: {flaggedPeriods.map((i) => `${noun} ${i + 1}`).join(', ')}
          </Text>
        )}

        {live && periodIndex < live.fromPeriod ? (
          <Text style={screen.hint}>
            {noun} {periodIndex + 1} has started, so it is the match record now and
            cannot be planned. {allPlayed ? '' : `Plan from ${noun.toLowerCase()} ${live.fromPeriod + 1}.`}
          </Text>
        ) : (
          <>
        {periodIndex > 0 &&
          (sameAs ? (
            <Action label={`Same as ${noun.toLowerCase()} ${periodIndex}`} onPress={() => change(sameAs)} />
          ) : (
            <Text style={screen.hint}>
              {noun} {periodIndex} has no lineup to copy yet.
            </Text>
          ))}

        <Text style={screen.fieldLabel}>Starting</Text>
        <Text style={screen.hint}>
          {pitchPick
            ? `Now tap where ${name(pitchPick)} goes, or tap them again to cancel. Or sub them off below.`
            : 'Drag a player into place, or tap one and then where they go. Tap a bench player to plan their sub.'}
        </Text>
        <PitchView
          format={format}
          sheet={period.slots}
          bench={benchIds}
          nameOf={name}
          selected={pitchPick}
          onSelect={setPitchPick}
          onTapPlayer={tapPlayer}
          onDragging={setDragging}
          {...edge.pitchProps}
          onMove={(id, target) =>
            change(setPeriodSlots(plan, periodIndex, editSheet(period.slots, id, target)))
          }
          onRenamePosition={names ? setRenaming : undefined}
        />
        {/* Rob, 7 Nov: a child on the pitch can be subbed off from a tap too. */}
        {pitchPick && Object.values(period.slots).includes(pitchPick) && (
          <Action
            label={`Sub ${name(pitchPick)} off`}
            onPress={() => {
              setSubAsk(subRequestFor(period, pitchPick, true));
              setPitchPick(null);
            }}
          />
        )}
        {names && (
          <Text style={screen.hint}>Tap a gold position name to rename it for this match.</Text>
        )}
        {names && hasRenamedPositions(format) && <Action label="Reset position names" onPress={names.onReset} />}

        <Text style={screen.fieldLabel}>Subs this {noun.toLowerCase()}</Text>
        <Text style={local.note}>{subsPlannedSummary(period.subs.length)}</Text>
        {/* #264 V20 to V22: each sub is a Row ›, the plan in light text by the name. */}
        {period.subs.map((swap, swapIndex) => (
          <RowNav
            key={swapIndex}
            first={swapIndex === 0}
            label={name(swap.onId)}
            detail={
              swap.offId === null
                ? `on at ${formatSubTime(swap.atMs)}, nobody picked to come off`
                : plannedSubText(swap.atMs, name(swap.offId))
            }
            onPress={() => openSub(swapIndex, swap.onId)}
          />
        ))}
        <RowNav label="Add a sub" first={period.subs.length === 0} onPress={() => openSub(-1, null)} />

        {problemsHere.map((p, i) => (
          <Text key={i} style={local.problem}>
            {p.message}
          </Text>
        ))}

          </>
        )}

        <Text style={screen.fieldLabel}>
          {live ? 'Minutes so far, plus the plan' : 'Minutes if played to plan'}
        </Text>
        <View style={local.shareRow}>
          <Text style={[local.summary, local.shareText]}>
            Fair share {formatClock(projection.fairShareMs)} · spread{' '}
            {formatClock(projection.spreadMs)}
          </Text>
          {/* #261 AC15. */}
          <InfoTap figure="planShare" />
        </View>
        {/* #101 / ADR-015: the share and the +/- are goal plus outfield. */}
        <Text style={screen.hint}>Fair share counts time in goal and outfield together.</Text>
        {projection.rows.map((row) => (
          <View key={row.playerId} style={screen.playerRow}>
            <Text style={screen.playerName} numberOfLines={1}>
              {row.name}
            </Text>
            <Text style={local.minutes} numberOfLines={1}>
              {formatClock(row.outfieldMs)}
              {row.goalkeeperMs > 0 ? ` · GK ${formatClock(row.goalkeeperMs)}` : ''}
            </Text>
            {/* #261 AC7: a shortfall is neutral text, never the warning colour. */}
            <Text style={[local.delta, row.deltaMs === null && local.faint]} numberOfLines={1}>
              {row.deltaMs === null ? NOT_IN_SHARE_SHORT[row.notInShare ?? 'absent'] : formatDelta(row.deltaMs)}
            </Text>
          </View>
        ))}
        <Text style={screen.hint}>
          A plan, not a record. Minutes played always come from the match itself.
        </Text>
      </ScrollView>

      <SharePlanFoot
        match={match}
        squadName={squadName}
        format={format}
        plan={plan}
        players={players}
        absent={absent ?? new Set()}
        periodCount={periodCount}
        noun={noun}
      />

      {names && (
        <PositionNameSheet
          format={format}
          positionId={renaming}
          offerKeep={names.offerKeep}
          onSave={names.onRename}
          onClose={() => setRenaming(null)}
        />
      )}

      <PlannedSubPanel
        request={subAsk}
        plan={plan}
        periodIndex={periodIndex}
        periodMs={periodMs}
        format={format}
        players={players}
        noun={noun}
        name={(id) => name(id)}
        onChange={change}
        onClose={() => setSubAsk(null)}
        onPutInLineup={setPitchPick}
      />
    </View>
  );
}

const local = StyleSheet.create({
  shareRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  shareText: { flex: 1 },
  // Far off to the left: laid out and drawn for the capture, never seen.
  note: { color: colours.inkFaint, fontSize: 14, includeFontPadding: false, marginBottom: 4 },
  flagged: { alignSelf: 'stretch', color: colours.warn, fontSize: 13, includeFontPadding: false, marginTop: 2 },
  problem: {
    alignSelf: 'stretch',
    color: colours.warn,
    fontSize: 14,
    includeFontPadding: false,
    marginTop: 6,
  },
  summary: {
    alignSelf: 'stretch',
    color: colours.ink,
    fontSize: 15,
    includeFontPadding: false,
    marginBottom: 4,
  },
  minutes: {
    color: colours.inkMuted,
    fontSize: 13,
    includeFontPadding: false,
    flexShrink: 0,
    width: 112,
    textAlign: 'right',
  },
  delta: {
    color: colours.inkMuted,
    fontSize: 13,
    includeFontPadding: false,
    flexShrink: 0,
    width: 64,
    textAlign: 'right',
  },
  faint: { color: colours.inkFaint },
});
