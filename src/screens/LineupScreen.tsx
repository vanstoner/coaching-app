/**
 * The lineup. This is the substitution reminder — REQ-02 (#2), REQ-05 (#5).
 *
 * Between quarters, not mid-play: this squad rotates at the boundaries, so the
 * app stops here and says who is owed minutes, sorted so the top of the list
 * is who should come on. The coach can take the suggestion or ignore it; the
 * override is what happens.
 *
 * ---------------------------------------------------------------------------
 * A list of named positions — PO ruling, 2026-09-20 (#70)
 * ---------------------------------------------------------------------------
 *
 * > *"actually I like setting up as a pitch... Can live with lists and names
 * > of positions for the time being."*
 *
 * A pitch is the target and it is #2/#10, not this slice. What this shows is
 * the team sheet as named slots — the same `teamSheetFor` the engine is handed,
 * read out loud — so the shape the match is being played in is visible without
 * kicking off to find out.
 *
 * Invariant 3 is untouched: which outfield slot a player takes is not a
 * fairness input. The fairness column is OUTFIELD minutes and goalkeeping is
 * shown separately, never added to it.
 *
 * **There is a way out that does not commit.** This screen used to have one
 * exit and it was "Start quarter", so a coach who arrived with the wrong squad
 * was stuck until they started a period they did not mean to start.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { MatchEngine, type MatchState } from '../engine/MatchEngine';
import type { Format, Player, UUID } from '../types/index';
import { currentQuarter, formatClock, periodNoun } from '../app/matchClock';
import { PLACEHOLDER_SQUAD_NAME } from '../app/placeholderSquad';
import { foldPlayerMinutes, type PlayerMinutes } from '../app/playerMinutes';
import { lineupIsComplete, namedSlots, suggestLineup } from '../app/lineup';
import {
  NO_SUB_PLANNED,
  nudgeSubTime,
  planSubs,
  type PlannedSub,
} from '../app/subPlan';
import { shapeOfFormat } from '../app/shapes';
import { colours, screen, TOUCH_TARGET } from './theme';

export function LineupScreen({
  engine,
  state,
  format,
  players,
  squadName,
  onStart,
  onLeave,
}: {
  engine: MatchEngine;
  state: MatchState;
  /** The shape THIS match is played in, not the squad default. */
  format: Format;
  players: Player[];
  squadName: string;
  onStart: (onPitch: UUID[], goalkeeper: UUID | null, plan: PlannedSub[]) => void;
  /** Back to Home. Does not kick off and does not end anything. */
  onLeave: () => void;
}) {
  const quarter = currentQuarter(state);
  const minutes = useMemo(
    () => foldPlayerMinutes(engine, state, players),
    [engine, state, players]
  );
  const suggestion = useMemo(
    () => suggestLineup(players, minutes, format),
    [players, minutes, format]
  );

  const [onPitch, setOnPitch] = useState<UUID[]>(suggestion.onPitch);
  const [goalkeeper, setGoalkeeper] = useState<UUID | null>(suggestion.goalkeeper);
  const suggestedFor = useRef(quarter?.id);

  // How long this period will run, which is what a sub time is an offset into.
  const periodMs = engine.getPlannedQuarterMs(state.match);
  const [plan, setPlan] = useState<PlannedSub[]>(() => planSubs(suggestion.bench, periodMs));

  // A new period means a new suggestion.
  useEffect(() => {
    if (suggestedFor.current !== quarter?.id) {
      suggestedFor.current = quarter?.id;
      setOnPitch(suggestion.onPitch);
      setGoalkeeper(suggestion.goalkeeper);
      setPlan(planSubs(suggestion.bench, periodMs));
    }
  }, [quarter?.id, suggestion, periodMs]);

  // The bench changes as the coach taps names, so the plan follows it: a new
  // bench player gets the default time, and one brought on loses their entry.
  useEffect(() => {
    const bench = players.map((p) => p.id).filter((id) => !onPitch.includes(id));
    setPlan((current) => {
      const kept = current.filter((entry) => bench.includes(entry.playerId));
      const added = bench.filter((id) => !current.some((e) => e.playerId === id));
      return [...kept, ...planSubs(added, periodMs)];
    });
  }, [onPitch, players, periodMs]);

  const byId = useMemo(() => {
    const m = new Map<UUID, PlayerMinutes>();
    for (const row of minutes) m.set(row.playerId, row);
    return m;
  }, [minutes]);

  const selected = new Set(onPitch);
  const complete = lineupIsComplete(onPitch, format);
  const noun = periodNoun(state.match.quarterCount);
  const shape = shapeOfFormat(format);
  const slots = namedSlots(onPitch, goalkeeper, format, players);

  const toggle = (id: UUID) => {
    if (selected.has(id)) {
      setOnPitch(onPitch.filter((x) => x !== id));
      if (goalkeeper === id) setGoalkeeper(null);
    } else if (onPitch.length < format.onFieldCount) {
      setOnPitch([...onPitch, id]);
    }
  };

  // Players owed the most time first — the answer to "who comes on".
  const ordered = useMemo(
    () =>
      [...players].sort(
        (a, b) => (byId.get(a.id)?.outfieldMs ?? 0) - (byId.get(b.id)?.outfieldMs ?? 0)
      ),
    [players, byId]
  );

  const timeOf = (id: UUID) => plan.find((e) => e.playerId === id)?.atMs ?? 0;

  return (
    <SafeAreaView style={screen.safe}>
      <View style={screen.pane}>
        <Text style={screen.title} numberOfLines={1}>
          {squadName || PLACEHOLDER_SQUAD_NAME}
        </Text>
        <Text style={screen.period}>
          {noun} {quarter?.index ?? 1} of {state.match.quarterCount}
          {shape ? ` · ${shape}` : ''}
        </Text>

        <ScrollView style={screen.list}>
          {/* The shape, named. A pitch is #2/#10; this is the list the PO said
              he can live with, and it makes 2-2-2 visibly different. */}
          <Text style={screen.fieldLabel}>On the pitch</Text>
          {slots.map((slot) => (
            <View key={slot.positionId} style={local.slotRow}>
              <Text style={local.slotLabel} numberOfLines={1}>
                {slot.label}
              </Text>
              <Text
                style={[local.slotName, slot.firstName === null && local.slotEmpty]}
                numberOfLines={1}
              >
                {slot.firstName ?? 'not picked yet'}
              </Text>
            </View>
          ))}

          <Text style={screen.fieldLabel}>Who is on?</Text>
          <Text style={screen.hint}>{suggestion.rationale}</Text>
          <Text style={screen.hint}>
            Tap a name to pick them. The time beside a substitute is when you
            will be reminded to bring them on.
          </Text>

          {ordered.map((p) => {
            const m = byId.get(p.id);
            const on = selected.has(p.id);
            const isKeeper = goalkeeper === p.id;
            return (
              <Pressable
                key={p.id}
                onPress={() => toggle(p.id)}
                style={({ pressed }) => [
                  local.pickRow,
                  on && local.pickRowOn,
                  pressed && screen.buttonPressed,
                ]}
              >
                <View style={local.pickMain}>
                  <Text style={screen.playerName} numberOfLines={1}>
                    {p.firstName}
                  </Text>
                  <Text style={local.pickMinutes} numberOfLines={1}>
                    {formatClock(m?.outfieldMs ?? 0)} outfield
                    {(m?.goalkeeperMs ?? 0) > 0
                      ? ` · ${formatClock(m!.goalkeeperMs)} in goal`
                      : ''}
                  </Text>
                </View>
                {on ? (
                  <Pressable
                    onPress={() => setGoalkeeper(isKeeper ? null : p.id)}
                    style={[local.gkChip, isKeeper && local.gkChipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isKeeper }}
                  >
                    <Text style={[local.gkLabel, isKeeper && local.gkLabelOn]}>GK</Text>
                  </Pressable>
                ) : (
                  // A bench player carries the time they come on. The PO asked
                  // for exactly this: "set that time for a sub next to their
                  // name and that's the anchor for a reminder".
                  <View style={local.subTimeRow}>
                    <Pressable
                      onPress={() => setPlan((c) => nudgeSubTime(c, p.id, -30_000, periodMs))}
                      style={local.stepHit}
                    >
                      <Text style={local.step}>−</Text>
                    </Pressable>
                    <Text
                      style={[
                        local.subTime,
                        timeOf(p.id) === NO_SUB_PLANNED && local.subTimeOff,
                      ]}
                      numberOfLines={1}
                    >
                      {timeOf(p.id) === NO_SUB_PLANNED ? 'No sub' : formatClock(timeOf(p.id))}
                    </Text>
                    <Pressable
                      onPress={() => setPlan((c) => nudgeSubTime(c, p.id, 30_000, periodMs))}
                      style={local.stepHit}
                    >
                      <Text style={local.step}>+</Text>
                    </Pressable>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={[screen.caption, !complete && screen.overtime]}>
          {onPitch.length} of {format.onFieldCount} picked
          {goalkeeper === null ? ' · no goalkeeper chosen' : ''}
        </Text>

        <Pressable
          disabled={!complete}
          style={({ pressed }) => [
            screen.button,
            !complete && screen.buttonDisabled,
            pressed && screen.buttonPressed,
          ]}
          onPress={() => onStart(onPitch, goalkeeper, plan)}
        >
          <Text style={screen.buttonLabel}>Start {noun.toLowerCase()}</Text>
        </Pressable>

        <View style={screen.actions}>
          <Pressable
            onPress={() => {
              setOnPitch(suggestion.onPitch);
              setGoalkeeper(suggestion.goalkeeper);
            }}
            style={screen.linkHit}
          >
            <Text style={screen.link}>Use suggestion</Text>
          </Pressable>
          {/* Always. Between periods too: the match stays exactly as it is. */}
          <Pressable onPress={onLeave} style={screen.linkHit}>
            <Text style={screen.link}>Leave</Text>
          </Pressable>
        </View>
      </View>
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

const local = StyleSheet.create({
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#164f3c',
  },
  // A FIXED width: the labels are 2-3 characters and a box sized to its own
  // text is what clipped the last glyph off the clock.
  slotLabel: {
    color: colours.warn,
    fontSize: 14,
    fontWeight: '600',
    includeFontPadding: false,
    flexShrink: 0,
    width: 48,
  },
  slotName: { color: colours.ink, fontSize: 16, flex: 1, includeFontPadding: false },
  slotEmpty: { color: colours.inkFaint },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOUCH_TARGET + 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginBottom: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#164f3c',
  },
  pickRowOn: { backgroundColor: colours.accent, borderColor: colours.accent },
  pickMain: { flex: 1 },
  // Every right-hand character was missing from the per-player times once.
  // Android measures a Text once; sitting beside a `flex: 1` sibling it gets
  // squeezed and the tail is cut. `flexShrink: 0` stops the squeeze.
  pickMinutes: {
    color: '#cfe3da',
    fontSize: 12,
    marginTop: 2,
    includeFontPadding: false,
    flexShrink: 0,
    paddingRight: 4,
  },
  subTimeRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  // Same metrics as subTime — only the colour changes.
  subTimeOff: { color: colours.inkFaint },
  stepHit: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
  },
  step: { color: colours.ink, fontSize: 22, includeFontPadding: false },
  subTime: {
    color: colours.warn,
    fontSize: 15,
    fontWeight: '600',
    includeFontPadding: false,
    flexShrink: 0,
    paddingHorizontal: 2,
    textAlign: 'center',
    // A FIXED width, not minWidth. "No sub" is wider than "06:15", and a box
    // that sizes itself to its own text is what clipped the last glyph off
    // the clock and the choice boxes.
    width: 68,
  },
  gkChip: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cfe3da',
    flexShrink: 0,
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
  },
  gkChipOn: { backgroundColor: colours.warn, borderColor: colours.warn },
  gkLabel: { color: '#cfe3da', fontSize: 14, fontWeight: '600', includeFontPadding: false },
  gkLabelOn: { color: '#3a2a00', fontSize: 14, fontWeight: '600', includeFontPadding: false },
});
