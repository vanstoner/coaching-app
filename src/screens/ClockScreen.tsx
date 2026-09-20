/**
 * Saturday. The clock, who is on, and who comes off next — REQ-01 (#1).
 *
 * **Full-screen, no tabs** (PO ruling, 2026-09-20, #70). One hand, a running
 * game, rain. A tab bar here is three ways to lose the match you are keeping
 * time for, so the only way off this screen is an explicit Leave — which
 * returns to Home and leaves the match running.
 *
 * Invariant 2: the interval below is a REPAINT trigger and nothing else. Every
 * figure is recomputed from the engine's wall-clock anchors on each pass, so a
 * throttled or dead app is still right the moment it repaints. Nothing here
 * increments anything.
 *
 * Invariant 3: the per-player figure is OUTFIELD minutes. Goalkeeping is shown
 * separately and never added to it.
 */

import { useEffect, useReducer } from 'react';
import { AppState, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { MatchEngine, type MatchState } from '../engine/MatchEngine';
import type { Player, UUID } from '../types/index';
import { currentQuarter, deriveClockView, formatClock, periodNoun } from '../app/matchClock';
import { PLACEHOLDER_SQUAD_NAME } from '../app/placeholderSquad';
import { foldPlayerMinutes } from '../app/playerMinutes';
import { dueSubs, msUntilNextSub, whoComesOff, type PlannedSub } from '../app/subPlan';
import { colours, screen, TOUCH_TARGET } from './theme';

export function ClockScreen({
  engine,
  state,
  players,
  squadName,
  subPlan,
  onMakeSub,
  onEndQuarter,
  onFinish,
  onLeave,
}: {
  engine: MatchEngine;
  state: MatchState;
  players: Player[];
  squadName: string;
  subPlan: PlannedSub[];
  onMakeSub: (outPlayerId: UUID, inPlayerId: UUID) => void;
  onEndQuarter: () => void;
  /** At full time: read the summary. */
  onFinish: () => void;
  /** Back to Home with the match still on. Does NOT end it. */
  onLeave: () => void;
}) {
  const [, forceRepaint] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const id = setInterval(forceRepaint, 500);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') forceRepaint();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);

  const view = deriveClockView(engine, state);
  const minutes = foldPlayerMinutes(engine, state, players);
  const onPitch = minutes.filter((m) => m.onPitchNow);
  const noun = periodNoun(state.match.quarterCount).toLowerCase();
  const nameOf = (id: UUID) => players.find((p) => p.id === id)?.firstName ?? '—';

  // The reminder. `quarterElapsedMs` is capped at the planned length, so the
  // raw period elapsed is used here — a sub due at 6:15 must still show when
  // the coach is three minutes over.
  const periodElapsedMs = view.isRunning
    ? engine.getQuarterElapsedMs(currentQuarter(state)!)
    : 0;
  const due = view.isRunning ? dueSubs(subPlan, periodElapsedMs) : [];
  const untilNext = view.isRunning ? msUntilNextSub(subPlan, periodElapsedMs) : null;

  return (
    <SafeAreaView style={screen.safe}>
      <View style={screen.pane}>
        <Text style={screen.title} numberOfLines={1}>
          {squadName || PLACEHOLDER_SQUAD_NAME}
        </Text>
        <Text style={screen.period}>{view.quarterLabel}</Text>

        <Text style={screen.clock} numberOfLines={1} adjustsFontSizeToFit>
          {formatClock(view.quarterElapsedMs)}
        </Text>

        {view.isMatchOver ? (
          <Text style={screen.caption}>
            Full time — {formatClock(view.matchElapsedMs)} played
          </Text>
        ) : (
          <Text style={[screen.caption, view.isOvertime && screen.overtime]}>
            {view.isOvertime
              ? `${periodNoun(state.match.quarterCount)} over — end it when play stops`
              : `${formatClock(view.quarterRemainingMs)} left in this ${noun}`}
          </Text>
        )}

        <Text style={screen.hint}>
          Match total {formatClock(view.matchElapsedMs)} of {state.match.totalMinutes}:00
        </Text>

        {due.map((sub) => {
          const off = whoComesOff(sub, onPitch);
          return (
            <View key={sub.playerId} style={local.subDue}>
              <Text style={local.subDueText} numberOfLines={2}>
                Bring on {nameOf(sub.playerId)}
                {off ? ` for ${nameOf(off)}` : ''}
              </Text>
              {off && (
                <Pressable
                  onPress={() => onMakeSub(off, sub.playerId)}
                  style={({ pressed }) => [local.subDueButton, pressed && screen.buttonPressed]}
                >
                  <Text style={local.subDueButtonLabel}>Done</Text>
                </Pressable>
              )}
            </View>
          );
        })}

        {due.length === 0 && untilNext !== null && (
          <Text style={screen.hint}>Next substitution in {formatClock(untilNext)}</Text>
        )}

        <ScrollView style={screen.list}>
          {(view.isMatchOver ? minutes : onPitch).map((m) => (
            <View key={m.playerId} style={screen.playerRow}>
              <Text style={screen.playerName} numberOfLines={1}>
                {nameOf(m.playerId)}
              </Text>
              {/*
                No minWidth, a fixed width, and flexShrink: 0 — see
                `screen.rowTime`. This figure sits beside a flexible name and
                lost its last character on a real phone until it did not.
              */}
              <Text style={screen.rowTime} numberOfLines={1}>
                {formatClock(m.outfieldMs)}
                {m.goalkeeperMs > 0 ? ` · GK ${formatClock(m.goalkeeperMs)}` : ''}
              </Text>
            </View>
          ))}
        </ScrollView>

        {view.canEnd && (
          <Pressable
            style={({ pressed }) => [
              screen.button,
              view.isOvertime && screen.buttonUrgent,
              pressed && screen.buttonPressed,
            ]}
            onPress={onEndQuarter}
          >
            <Text style={screen.buttonLabel}>End {noun}</Text>
          </Pressable>
        )}
        {view.isMatchOver && (
          <Pressable
            style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]}
            onPress={onFinish}
          >
            <Text style={screen.buttonLabel}>See the minutes</Text>
          </Pressable>
        )}

        {/*
          The way out. It does NOT end the match: the quarter keeps running on
          its wall-clock anchor and the fixture stays at the top of Home as
          "In progress", so the coach can go and look at something and come
          back to the true elapsed time.
        */}
        <Pressable onPress={onLeave} style={screen.linkHit}>
          <Text style={screen.link}>
            {view.isMatchOver ? 'Leave — go to Home' : 'Leave — the match keeps running'}
          </Text>
        </Pressable>
      </View>
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

const local = StyleSheet.create({
  subDue: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colours.urgent,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 10,
  },
  subDueText: {
    color: colours.ink,
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    includeFontPadding: false,
  },
  subDueButton: {
    backgroundColor: colours.ink,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    minHeight: TOUCH_TARGET,
    minWidth: 76,
    paddingHorizontal: 14,
  },
  subDueButtonLabel: {
    color: '#8a5600',
    fontSize: 15,
    fontWeight: '700',
    includeFontPadding: false,
  },
});
