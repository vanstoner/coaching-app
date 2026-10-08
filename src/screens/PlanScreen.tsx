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
 * All the rules live in `src/app/matchPlan.ts` and are tested there. This
 * file draws them.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Text } from './Text';

import type { Format, Match, Player, UUID } from '../types/index';
import { formatClock, periodNoun } from '../app/matchClock';
import {
  addSwap,
  benchSubIndex,
  benchSubOffChoices,
  clampSwapTime,
  formatDelta,
  nextFreeSwapTimeMs,
  nudgeSwap,
  planBenchSub,
  SUB_STEP_MS,
  periodLengthMs,
  planFor,
  projectPlan,
  removeSwap,
  sameAsPrevious,
  swapChoices,
  setPeriodSlots,
  setSlot,
  updateSwap,
  type MatchPlan,
} from '../app/matchPlan';
import { opponentLabel } from '../app/fixtures';
import { Chip, ChipRow } from './Chip';
import { PitchView } from './PitchView';
import { ActionSheet, SheetButton } from './Sheet';
import { PositionNameSheet, type PositionNaming } from './PositionNameSheet';
import { hasRenamedPositions } from '../app/positionNames';
import { editSheet } from '../app/teamSheet';
import { colours, screen, TOUCH_TARGET } from './theme';
import { PLAN_IMAGE_WIDTH, planImage, type PlanImageLayout } from '../app/planImage';
import { releasePlanImage, sharePlanImage } from '../app/planImageFile';
import { PlanImageView } from './PlanImageView';

/** What the picker is choosing for, when it is open. */
type Picking =
  | { kind: 'slot'; positionId: UUID }
  | { kind: 'on' | 'off'; swapIndex: number }
  | null;

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
  const projection = projectPlan(plan, format, match.totalMinutes, periodCount, players, live ?? null);
  const firstOpen = Math.min(live?.fromPeriod ?? 0, periodCount - 1);
  const allPlayed = (live?.fromPeriod ?? 0) >= periodCount;

  const [periodIndex, setPeriodIndex] = useState(firstOpen);
  const [picking, setPicking] = useState<Picking>(null);
  /** The pitch's first tap, waiting for where that player goes (#83). */
  const [pitchPick, setPitchPick] = useState<UUID | null>(null);
  const [dragging, setDragging] = useState(false);
  /** The position whose name is being changed (#166). */
  const [renaming, setRenaming] = useState<UUID | null>(null);
  /**
   * The bench player's menu (#120): who, the time it offers, and whether it
   * is asking for a time and who comes off (`editing`) or showing the sub
   * they already have.
   */
  const [benchMenu, setBenchMenu] = useState<
    { playerId: UUID; atMs: number; editing: boolean } | null
  >(null);

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
  const askShare = () => (periodCount === 4 ? setShareAsk(true) : startShare('grid'));
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
  const positions = [...format.positions].sort((a, b) => a.sortOrder - b.sortOrder);
  const nameOf = new Map(players.map((p) => [p.id, p.firstName]));
  const name = (id: UUID | null) =>
    id === null ? 'Pick' : (nameOf.get(id) ?? 'Removed player');
  const problemsHere = projection.problems.filter((p) => p.periodIndex === periodIndex);

  const change = onChange;
  // "Same as" the previous period (#111): what was on the pitch at its end if
  // it has been played, else its plan. Null means there is nothing to copy.
  const sameAs =
    periodIndex > 0
      ? sameAsPrevious(plan, periodIndex, live?.recordedEnd?.[periodIndex - 1] ?? null)
      : null;

  const pick = (playerId: UUID | null) => {
    if (!picking) return;
    if (picking.kind === 'slot') {
      change(setSlot(plan, periodIndex, picking.positionId, playerId));
    } else {
      const field = picking.kind === 'on' ? 'onId' : 'offId';
      change(updateSwap(plan, periodIndex, picking.swapIndex, { [field]: playerId }));
    }
    setPicking(null);
  };

  const choosePeriod = (i: number) => {
    setPeriodIndex(i);
    setPicking(null);
    setPitchPick(null);
    setBenchMenu(null);
  };

  const benchIds = players
    .map((p) => p.id)
    .filter((id) => !Object.values(period.slots).includes(id));

  // #120: a tap on a bench player opens their menu; a tap on a player in a
  // position selects them for tap-then-place, as before. Placing a bench
  // player by tap is one button in the menu; dragging is unchanged.
  const tapPlayer = (id: UUID) => {
    if (!benchIds.includes(id)) {
      setPitchPick(id);
      return;
    }
    setPicking(null);
    const existing = benchSubIndex(period, id);
    setBenchMenu(
      existing === -1
        ? { playerId: id, atMs: nextFreeSwapTimeMs(period, periodMs), editing: true }
        : { playerId: id, atMs: period.subs[existing].atMs, editing: false }
    );
  };
  const menuSubIndex = benchMenu ? benchSubIndex(period, benchMenu.playerId) : -1;
  const menuSub = menuSubIndex === -1 ? null : period.subs[menuSubIndex];
  const offChoices = benchMenu?.editing
    ? benchSubOffChoices(period, benchMenu.playerId, benchMenu.atMs, players)
    : [];
  const nudgeMenu = (steps: number) =>
    benchMenu &&
    setBenchMenu({
      ...benchMenu,
      atMs: clampSwapTime(benchMenu.atMs + steps * SUB_STEP_MS, periodMs),
    });

  // A sub only offers who can come on or go off at that moment; a starting
  // slot offers the whole squad (match day 4).
  const choices =
    picking && picking.kind !== 'slot'
      ? swapChoices(period, picking.swapIndex, players)[picking.kind]
      : players;

  const picker = (
    <View style={local.picker}>
      <ChipRow>
        {choices.map((p) => (
          <Chip key={p.id} label={p.firstName} selected={false} onPress={() => pick(p.id)} />
        ))}
        <Chip label="Nobody" selected={false} onPress={() => pick(null)} />
      </ChipRow>
    </View>
  );

  return (
    <View style={screen.flex}>
      <ScrollView contentContainerStyle={screen.scroll} scrollEnabled={!dragging}>
        <Text style={screen.title} numberOfLines={1}>
          Plan
        </Text>
        <Text style={screen.caption} numberOfLines={1}>
          {squadName} v {opponentLabel(match)}
        </Text>

        <ChipRow>
          {plan.periods.map((_, i) => {
            const flagged = projection.problems.some((p) => p.periodIndex === i);
            return (
              <Chip
                key={i}
                label={`${noun} ${i + 1}`}
                detail={
                  live && i < live.fromPeriod ? 'played' : flagged ? 'needs a look' : 'ok'
                }
                selected={i === periodIndex}
                onPress={() => choosePeriod(i)}
              />
            );
          })}
        </ChipRow>

        {live && periodIndex < live.fromPeriod ? (
          <Text style={screen.hint}>
            {noun} {periodIndex + 1} has started, so it is the match record now and
            cannot be planned. {allPlayed ? '' : `Plan from ${noun.toLowerCase()} ${live.fromPeriod + 1}.`}
          </Text>
        ) : (
          <>
        {periodIndex > 0 &&
          (sameAs ? (
            <Pressable style={screen.linkHit} onPress={() => change(sameAs)}>
              <Text style={screen.link}>
                Same as {noun.toLowerCase()} {periodIndex}
              </Text>
            </Pressable>
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
        {names && hasRenamedPositions(format) && (
          <Pressable style={screen.linkHit} onPress={names.onReset}>
            <Text style={screen.link}>Reset position names</Text>
          </Pressable>
        )}

        <Text style={screen.fieldLabel}>Subs this {noun.toLowerCase()}</Text>
        {period.subs.length === 0 && (
          <Text style={local.note}>None planned.</Text>
        )}
        {period.subs.map((swap, swapIndex) => {
          const openOn = picking?.kind === 'on' && picking.swapIndex === swapIndex;
          const openOff = picking?.kind === 'off' && picking.swapIndex === swapIndex;
          return (
            <View key={swapIndex} style={local.swap}>
              <View style={local.swapTime}>
                <Pressable
                  style={local.nudge}
                  onPress={() => change(nudgeSwap(plan, periodIndex, swapIndex, -1, periodMs))}
                  accessibilityLabel="15 seconds earlier"
                >
                  <Text style={local.nudgeLabel}>-</Text>
                </Pressable>
                <Text style={local.time}>{formatClock(swap.atMs)}</Text>
                <Pressable
                  style={local.nudge}
                  onPress={() => change(nudgeSwap(plan, periodIndex, swapIndex, 1, periodMs))}
                  accessibilityLabel="15 seconds later"
                >
                  <Text style={local.nudgeLabel}>+</Text>
                </Pressable>
                <Pressable
                  style={local.removeHit}
                  onPress={() => {
                    setPicking(null);
                    change(removeSwap(plan, periodIndex, swapIndex));
                  }}
                >
                  <Text style={local.remove}>Remove</Text>
                </Pressable>
              </View>
              <Pressable
                style={screen.playerRow}
                onPress={() => setPicking(openOn ? null : { kind: 'on', swapIndex })}
              >
                <Text style={local.slotLabel}>On</Text>
                <Text
                  style={[screen.playerName, swap.onId === null && local.unset]}
                  numberOfLines={1}
                >
                  {name(swap.onId)}
                </Text>
              </Pressable>
              {openOn && picker}
              <Pressable
                style={screen.playerRow}
                onPress={() => setPicking(openOff ? null : { kind: 'off', swapIndex })}
              >
                <Text style={local.slotLabel}>Off</Text>
                <Text
                  style={[screen.playerName, swap.offId === null && local.unset]}
                  numberOfLines={1}
                >
                  {name(swap.offId)}
                </Text>
              </Pressable>
              {openOff && picker}
            </View>
          );
        })}
        <Pressable
          style={({ pressed }) => [screen.buttonQuiet, pressed && screen.buttonPressed]}
          onPress={() => change(addSwap(plan, periodIndex, periodMs))}
        >
          <Text style={screen.buttonLabel}>Add a sub</Text>
        </Pressable>

        {problemsHere.map((p, i) => (
          <Text key={i} style={local.problem}>
            {p.message}
          </Text>
        ))}

          </>
        )}

        <Pressable
          style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]}
          onPress={askShare}
          disabled={shareLayout !== null}
        >
          <Text style={screen.buttonLabel}>Share plan</Text>
        </Pressable>
        <Text style={screen.hint}>
          {shareNote ??
            'One picture of every ' +
              noun.toLowerCase() +
              ' and its subs, for parents. No minutes, and nobody marked absent.'}
        </Text>

        <Text style={screen.fieldLabel}>
          {live ? 'Minutes so far, plus the plan' : 'Minutes if played to plan'}
        </Text>
        <Text style={local.summary}>
          Fair share {formatClock(projection.fairShareMs)} · spread{' '}
          {formatClock(projection.spreadMs)}
        </Text>
        {/* #101 / ADR-015: the share and the +/- are goal plus outfield. */}
        <Text style={screen.hint}>Fair share counts time in goal and outfield together.</Text>
        {projection.rows.map((row) => (
          <View key={row.playerId} style={screen.playerRow}>
            <Text style={screen.playerName} numberOfLines={1}>
              {row.firstName}
            </Text>
            <Text style={local.minutes} numberOfLines={1}>
              {formatClock(row.outfieldMs)}
              {row.goalkeeperMs > 0 ? ` · GK ${formatClock(row.goalkeeperMs)}` : ''}
            </Text>
            <Text style={[local.delta, row.deltaMs < 0 && local.owed]} numberOfLines={1}>
              {formatDelta(row.deltaMs)}
            </Text>
          </View>
        ))}
        <Text style={screen.hint}>
          A plan, not a record. Minutes played always come from the match itself.
        </Text>

        <Pressable
          style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]}
          onPress={onBack}
        >
          <Text style={screen.buttonLabel}>Done</Text>
        </Pressable>
      </ScrollView>

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

      {/* The bench player's menu (#120): plan their sub without Add a sub. */}
      <ActionSheet
        visible={benchMenu !== null}
        title={benchMenu ? name(benchMenu.playerId) : ''}
        onClose={() => setBenchMenu(null)}
      >
        {benchMenu && !benchMenu.editing && menuSub && (
          <>
            <Text style={local.menuLine} numberOfLines={1}>
              On at {formatClock(menuSub.atMs)}
              {menuSub.offId === null ? ', nobody picked to come off' : ` for ${name(menuSub.offId)}`}
            </Text>
            <SheetButton
              label="Change"
              strong
              onPress={() =>
                setBenchMenu({
                  ...benchMenu,
                  atMs: menuSub.atMs,
                  editing: true,
                })
              }
            />
            <SheetButton
              label="Remove"
              against
              onPress={() => {
                change(removeSwap(plan, periodIndex, menuSubIndex));
                setBenchMenu(null);
              }}
            />
          </>
        )}
        {benchMenu && benchMenu.editing && (
          <>
            <View style={local.swapTime}>
              <Pressable
                style={local.nudge}
                onPress={() => nudgeMenu(-1)}
                accessibilityLabel="15 seconds earlier"
              >
                <Text style={local.nudgeLabel}>-</Text>
              </Pressable>
              <Text style={local.menuTime} numberOfLines={1}>
                Bring on at {formatClock(benchMenu.atMs)}
              </Text>
              <Pressable
                style={local.nudge}
                onPress={() => nudgeMenu(1)}
                accessibilityLabel="15 seconds later"
              >
                <Text style={local.nudgeLabel}>+</Text>
              </Pressable>
            </View>
            <Text style={local.menuLine}>Who comes off?</Text>
            {offChoices.length === 0 ? (
              <Text style={local.note}>
                Nobody is on the pitch yet this {noun.toLowerCase()}. Pick the starters first.
              </Text>
            ) : (
              <View style={local.picker}>
                <ChipRow>
                  {offChoices.map((p) => (
                    <Chip
                      key={p.id}
                      label={p.firstName}
                      selected={false}
                      onPress={() => {
                        change(
                          planBenchSub(plan, periodIndex, benchMenu.playerId, p.id, benchMenu.atMs, periodMs)
                        );
                        setBenchMenu(null);
                      }}
                    />
                  ))}
                </ChipRow>
              </View>
            )}
          </>
        )}
        {benchMenu && (
          <SheetButton
            label="Put in the starting lineup…"
            onPress={() => {
              setPitchPick(benchMenu.playerId);
              setBenchMenu(null);
            }}
          />
        )}
      </ActionSheet>
    </View>
  );
}

const local = StyleSheet.create({
  // Far off to the left: laid out and drawn for the capture, never seen.
  offscreen: { position: 'absolute', left: -10000, top: 0 },
  slotLabel: {
    color: colours.inkMuted,
    fontSize: 15,
    includeFontPadding: false,
    width: 56,
    flexShrink: 0,
  },
  // Colour only: a weight change re-measures and clips (theme.ts).
  unset: { color: colours.inkFaint },
  note: { color: colours.inkFaint, fontSize: 14, includeFontPadding: false },
  picker: { paddingVertical: 8 },
  swap: {
    alignSelf: 'stretch',
    borderColor: colours.line,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  swapTime: { flexDirection: 'row', alignItems: 'center' },
  nudge: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudgeLabel: {
    color: colours.ink,
    fontSize: 22,
    includeFontPadding: false,
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  time: {
    color: colours.ink,
    fontSize: 20,
    includeFontPadding: false,
    width: 72,
    flexShrink: 0,
    textAlign: 'center',
  },
  removeHit: {
    marginLeft: 'auto',
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingLeft: 12,
  },
  remove: { color: colours.inkFaint, fontSize: 13, includeFontPadding: false },
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
  owed: { color: colours.warn },
  menuLine: {
    alignSelf: 'stretch',
    color: colours.inkMuted,
    fontSize: 15,
    includeFontPadding: false,
    marginVertical: 8,
  },
  menuTime: {
    flex: 1,
    color: colours.ink,
    fontSize: 20,
    includeFontPadding: false,
    textAlign: 'center',
  },
});
