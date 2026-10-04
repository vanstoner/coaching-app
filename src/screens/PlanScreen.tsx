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

import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from './Text';

import type { Format, Match, Player, UUID } from '../types/index';
import { formatClock, periodNoun } from '../app/matchClock';
import {
  addSwap,
  formatDelta,
  nudgeSwap,
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
import { editSheet } from '../app/teamSheet';
import { colours, screen, TOUCH_TARGET } from './theme';

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
  };

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
            : 'Drag a player into place, or tap one and then where they go.'}
        </Text>
        <PitchView
          format={format}
          sheet={period.slots}
          bench={players
            .map((p) => p.id)
            .filter((id) => !Object.values(period.slots).includes(id))}
          nameOf={name}
          selected={pitchPick}
          onSelect={setPitchPick}
          onDragging={setDragging}
          onMove={(id, target) =>
            change(setPeriodSlots(plan, periodIndex, editSheet(period.slots, id, target)))
          }
        />

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

        <Text style={screen.fieldLabel}>
          {live ? 'Minutes so far, plus the plan' : 'Minutes if played to plan'}
        </Text>
        <Text style={local.summary}>
          Fair share {formatClock(projection.fairShareMs)} · spread{' '}
          {formatClock(projection.spreadMs)}
        </Text>
        {projection.rows.map((row) => (
          <View key={row.playerId} style={screen.playerRow}>
            <Text style={screen.playerName} numberOfLines={1}>
              {row.firstName}
            </Text>
            <Text style={local.minutes} numberOfLines={1}>
              {formatClock(row.outfieldMs)}
              {row.goalkeeperMs > 0 ? ` · GK ${formatClock(row.goalkeeperMs)}` : ''}
            </Text>
            <Text
              style={[local.delta, row.deltaMs !== null && row.deltaMs < 0 && local.owed]}
              numberOfLines={1}
            >
              {row.deltaMs === null ? 'in goal' : formatDelta(row.deltaMs)}
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
    </View>
  );
}

const local = StyleSheet.create({
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
});
