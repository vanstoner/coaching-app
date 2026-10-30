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
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Text } from './Text';

import type { Format, Match, Player, UUID } from '../types/index';
import { displayName } from '../app/squad';
import { formatClock, formatSubTime, periodNoun } from '../app/matchClock';
import { plannedSubText, subsPlannedSummary } from '../app/plannedSubSheet';
import {
  addSwap,
  benchSubIndex,
  clampSwapTime,
  formatDelta,
  newSubTimeMs,
  SUB_STEP_MS,
  periodLengthMs,
  planFor,
  projectPlan,
  removeSwap,
  sameAsPrevious,
  swapChoices,
  setPeriodSlots,
  updateSwap,
  longestOnAt,
  type MatchPlan,
} from '../app/matchPlan';
import { opponentLabel } from '../app/fixtures';
import {
  Action,
  BackLink,
  CheckLine,
  FormSheet,
  MainButton,
  MainFoot,
  RowNav,
  SavedTick,
  Segmented,
  Stepper,
  TopBar,
  useSavedTick,
} from './controls';
import { PitchView } from './PitchView';
import { ActionSheet, SheetButton } from './Sheet';
import { PositionNameSheet, type PositionNaming } from './PositionNameSheet';
import { hasRenamedPositions } from '../app/positionNames';
import { editSheet } from '../app/teamSheet';
import { colours, screen, TOUCH_TARGET } from './theme';
import { PLAN_IMAGE_WIDTH, planImage, shareFirstStep, type PlanImageLayout } from '../app/planImage';
import { currentDistribution } from '../app/distribution';
import { releasePlanImage, sharePlanImage } from '../app/planImageFile';
import { PlanImageView } from './PlanImageView';

/** The sub sheet's draft (#264 V20): which sub (-1 for a new one), and its picks. */
interface SubDraft {
  swapIndex: number;
  onId: UUID | null;
  offId: UUID | null;
  /** "Whoever is on longest" ticked: resolved to a name on Save (`longestOnAt`). */
  longest: boolean;
  atMs: number;
}

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
  /** The position whose name is being changed (#166). */
  const [renaming, setRenaming] = useState<UUID | null>(null);
  /** The sub sheet (#120, #264): a draft until Save. */
  const [subSheet, setSubSheet] = useState<SubDraft | null>(null);
  const tick = useSavedTick();

  // Share plan (#165): which image is laid out off-screen for capture, if
  // any, and whether the layout question is open.
  const [shareAsk, setShareAsk] = useState(false);
  const [shareLayout, setShareLayout] = useState<PlanImageLayout | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const imageRef = useRef<View>(null);
  const captured = useRef(false);
  // The capture lives only for the share; let it go when the plan closes.
  useEffect(() => releasePlanImage, []);

  const startShare = (layout: PlanImageLayout) => {
    setShareAsk(false);
    setShareNote(null);
    captured.current = false;
    setShareLayout(layout);
  };
  // Quarters offer 2×2 or four in a row; halves sit side by side either way.
  // The store build alone skips the question (shareFirstStep, #226).
  const askShare = () =>
    shareFirstStep(periodCount, currentDistribution()) === 'ask' ? setShareAsk(true) : startShare('grid');
  const onImageLayout = (e: LayoutChangeEvent) => {
    if (captured.current || !shareLayout) return;
    captured.current = true;
    const { width, height } = e.nativeEvent.layout;
    const target = PLAN_IMAGE_WIDTH[shareLayout];
    // One frame after layout, so the capture sees what was drawn.
    requestAnimationFrame(() => {
      void sharePlanImage(imageRef, target, { width, height }).then((outcome) => {
        setShareLayout(null);
        if (!outcome.ok) setShareNote(outcome.reason);
      });
    });
  };

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
    setSubSheet(null);
  };

  const benchIds = players
    .map((p) => p.id)
    .filter((id) => !Object.values(period.slots).includes(id));

  /** Open "name comes on" for an existing sub, a bench player, or a new sub (#264 V20). */
  const openSub = (swapIndex: number, onId: UUID | null) => {
    const swap = swapIndex === -1 ? null : period.subs[swapIndex];
    setSubSheet({
      swapIndex,
      onId: swap ? swap.onId : onId,
      offId: swap ? swap.offId : null,
      longest: false,
      atMs: swap ? swap.atMs : newSubTimeMs(periodMs),
    });
  };

  // #120: a tap on a bench player opens their sub; a tap on a player in a
  // position selects them for tap-then-place, as before. Dragging is unchanged.
  const tapPlayer = (id: UUID) => {
    if (!benchIds.includes(id)) {
      setPitchPick(id);
      return;
    }
    openSub(benchSubIndex(period, id), id);
  };

  /** Who the sheet's sub can bring on and take off at its time (`swapChoices`, match day 4). */
  const sheetChoices = (() => {
    if (!subSheet) return { on: [] as Player[], off: [] as Player[] };
    const probe = { onId: subSheet.onId, offId: subSheet.offId, atMs: subSheet.atMs };
    const subs =
      subSheet.swapIndex === -1 ? [...period.subs, probe] : period.subs.map((s, i) => (i === subSheet.swapIndex ? probe : s));
    const index = subSheet.swapIndex === -1 ? subs.length - 1 : subSheet.swapIndex;
    const c = swapChoices({ ...period, subs }, index, players);
    return { on: c.on, off: c.off.filter((p) => p.id !== subSheet.onId) };
  })();

  // QA on #260 (D12): who "whoever is on longest" is at the sheet's time, by the plan.
  const longestId = subSheet
    ? longestOnAt(period, subSheet.swapIndex, clampSwapTime(subSheet.atMs, periodMs), format)
    : null;
  const forId = subSheet ? (subSheet.longest ? longestId : subSheet.offId) : null;

  const saveSub = () => {
    if (!subSheet || forId === null) return;
    const draft = { onId: subSheet.onId, offId: forId, atMs: clampSwapTime(subSheet.atMs, periodMs) };
    if (subSheet.swapIndex === -1) {
      const added = addSwap(plan, periodIndex, periodMs);
      change(updateSwap(added, periodIndex, added.periods[periodIndex].subs.length - 1, draft));
    } else {
      change(updateSwap(plan, periodIndex, subSheet.swapIndex, draft));
    }
    setSubSheet(null);
  };

  const flaggedPeriods = plan.periods
    .map((_, i) => i)
    .filter((i) => !(live && i < live.fromPeriod) && projection.problems.some((p) => p.periodIndex === i));

  return (
    <View style={screen.flex}>
      <ScrollView contentContainerStyle={screen.scroll} scrollEnabled={!dragging}>
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
            ? `Now tap where ${name(pitchPick)} goes, or tap them again to cancel.`
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
          onMove={(id, target) =>
            change(setPeriodSlots(plan, periodIndex, editSheet(period.slots, id, target)))
          }
          onRenamePosition={names ? setRenaming : undefined}
        />
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

      {/* #264 V26: Share plan is the screen's one job, pinned at the bottom (label kept: SHARE_PLAN). */}
      <MainFoot>
        <MainButton label="Share plan" onPress={askShare} disabled={shareLayout !== null} />
        <Text style={screen.hint}>
          {shareNote ??
            'One picture of every ' +
              noun.toLowerCase() +
              ' and its subs, for parents. No minutes, and nobody marked absent.'}
        </Text>
      </MainFoot>

      {/* The image being shared (#165): laid out off-screen, captured, gone. */}
      {shareLayout && (
        <View style={local.offscreen} pointerEvents="none">
          <PlanImageView
            ref={imageRef}
            layout={shareLayout}
            onLayout={onImageLayout}
            image={planImage({ match, squadName, format, plan, players, absent })}
          />
        </View>
      )}

      <ActionSheet visible={shareAsk} title="Share plan" onClose={() => setShareAsk(false)}>
        <SheetButton label="2 × 2, best on a phone" strong onPress={() => startShare('grid')} />
        <SheetButton label="Four in a row" onPress={() => startShare('row')} />
      </ActionSheet>

      {names && (
        <PositionNameSheet
          format={format}
          positionId={renaming}
          offerKeep={names.offerKeep}
          onSave={names.onRename}
          onClose={() => setRenaming(null)}
        />
      )}

      {/* #264 V20, V21: "name comes on": At on the 15 s stepper (Q2), For as a list with a tick. */}
      <FormSheet
        visible={subSheet !== null}
        title={subSheet?.onId ? `${name(subSheet.onId)} comes on` : 'A sub'}
        onCancel={() => setSubSheet(null)}
        onSave={saveSub}
        // Save waits for who comes on and For (QA on #260, D12).
        saveDisabled={subSheet === null || subSheet.onId === null || forId === null}
      >
        {subSheet && (
          <>
            {(subSheet.swapIndex !== -1 || subSheet.onId === null) && (
              <>
                <Text style={screen.fieldLabel}>Who comes on</Text>
                {sheetChoices.on.map((p) => (
                  <CheckLine
                    key={p.id}
                    label={displayName(p)}
                    checked={subSheet.onId === p.id}
                    onPress={() => setSubSheet({ ...subSheet, onId: p.id })}
                  />
                ))}
              </>
            )}
            <View style={local.atRow}>
              <Text style={local.atLabel}>At</Text>
              <Text style={local.atValue} numberOfLines={1}>
                {formatSubTime(subSheet.atMs)}
              </Text>
              <Stepper
                minusLabel="15 seconds earlier"
                plusLabel="15 seconds later"
                onMinus={() =>
                  setSubSheet({ ...subSheet, atMs: clampSwapTime(subSheet.atMs - SUB_STEP_MS, periodMs) })
                }
                onPlus={() =>
                  setSubSheet({ ...subSheet, atMs: clampSwapTime(subSheet.atMs + SUB_STEP_MS, periodMs) })
                }
              />
            </View>
            <Text style={screen.fieldLabel}>For</Text>
            {sheetChoices.off.length === 0 ? (
              <Text style={local.note}>
                Nobody is on the pitch yet this {noun.toLowerCase()}. Pick the starters first.
              </Text>
            ) : (
              <>
                {/* First, as on the lineup's planned-sub sheet (#264 V20). */}
                <CheckLine
                  label="Whoever is on longest"
                  detail={longestId !== null ? name(longestId) : undefined}
                  checked={subSheet.longest}
                  onPress={() => setSubSheet({ ...subSheet, longest: true, offId: null })}
                />
                {sheetChoices.off.map((p) => (
                  <CheckLine
                    key={p.id}
                    label={displayName(p)}
                    checked={!subSheet.longest && subSheet.offId === p.id}
                    onPress={() => setSubSheet({ ...subSheet, longest: false, offId: p.id })}
                  />
                ))}
              </>
            )}
            {subSheet.swapIndex !== -1 && (
              <Action
                label="Remove this sub"
                onPress={() => {
                  change(removeSwap(plan, periodIndex, subSheet.swapIndex));
                  setSubSheet(null);
                }}
              />
            )}
            {subSheet.onId !== null && benchIds.includes(subSheet.onId) && (
              <Action
                label="Put in the starting lineup…"
                onPress={() => {
                  setPitchPick(subSheet.onId);
                  setSubSheet(null);
                }}
              />
            )}
          </>
        )}
      </FormSheet>
    </View>
  );
}

const local = StyleSheet.create({
  shareRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  shareText: { flex: 1 },
  // Far off to the left: laid out and drawn for the capture, never seen.
  offscreen: { position: 'absolute', left: -10000, top: 0 },
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
  atRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOUCH_TARGET,
    borderBottomWidth: 1,
    borderBottomColor: colours.hair,
  },
  atLabel: { flex: 1, color: colours.ink, fontSize: 16, includeFontPadding: false },
  // A fixed width: "6:15" and "12:30" share the slot (theme.ts).
  atValue: {
    width: 68,
    flexShrink: 0,
    textAlign: 'right',
    paddingRight: 8,
    color: colours.ink,
    fontSize: 16,
    includeFontPadding: false,
  },
});
