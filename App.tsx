import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import {
  AppState,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { MatchEngine } from './src/engine/MatchEngine';
import type { MatchState } from './src/engine/MatchEngine';
import {
  deriveClockView,
  formatClock,
  currentQuarter,
  periodNoun,
  periodNounPlural,
  TOTAL_MINUTES_CHOICES,
  PERIOD_COUNT_CHOICES,
} from './src/app/matchClock';
import {
  makePlaceholderSquad,
  PLACEHOLDER_SQUAD_NAME,
  DEFAULT_TOTAL_MINUTES,
  DEFAULT_QUARTER_COUNT,
  type PlaceholderSquad,
} from './src/app/placeholderSquad';

/**
 * REQ-01 (#1): the match clock. REQ-10 (#10): the match shape is the coach's
 * to choose.
 *
 * Invariant 2 in practice. The interval below is a REPAINT trigger and nothing
 * else — it calls `forceRepaint`, which holds no time and accumulates nothing.
 * Every figure on screen is recomputed by `deriveClockView` from the engine's
 * wall-clock anchors on each render. Drop every one of these ticks and the
 * clock is still right the moment it repaints, which is what happens when
 * Android throttles a backgrounded app. The AppState listener repaints on
 * return to the foreground rather than waiting up to a full interval.
 *
 * `SafeAreaView` matters more than it looks: React Native 0.86 activities are
 * edge-to-edge, so without it content slides under the status and navigation
 * bars. That is both a UI fault on a real phone and why a control can sit
 * outside the region the emulator smoke test reads.
 *
 * Not built yet, deliberately: the squad is a placeholder (REQ-09, #9), nothing
 * persists so a relaunch starts fresh, and there are no substitutions
 * (REQ-04, #4).
 */

interface Match {
  engine: MatchEngine;
  state: MatchState;
  squad: PlaceholderSquad;
}

function createMatch(totalMinutes: number, periodCount: number): Match {
  const squad = makePlaceholderSquad();
  const engine = new MatchEngine();
  const state = engine.createMatch(squad.squadId, squad.format.id, {
    totalMinutes,
    quarterCount: periodCount,
  });
  return { engine, state, squad };
}

export default function App() {
  const [totalMinutes, setTotalMinutes] = useState<number>(DEFAULT_TOTAL_MINUTES);
  const [periodCount, setPeriodCount] = useState<number>(DEFAULT_QUARTER_COUNT);
  const [match, setMatch] = useState<Match | null>(null);

  if (match === null) {
    return (
      <SetupScreen
        totalMinutes={totalMinutes}
        periodCount={periodCount}
        onTotalMinutes={setTotalMinutes}
        onPeriodCount={setPeriodCount}
        onConfirm={() => setMatch(createMatch(totalMinutes, periodCount))}
      />
    );
  }

  return <ClockScreen match={match} onChangeSetup={() => setMatch(null)} />;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function SetupScreen({
  totalMinutes,
  periodCount,
  onTotalMinutes,
  onPeriodCount,
  onConfirm,
}: {
  totalMinutes: number;
  periodCount: number;
  onTotalMinutes: (n: number) => void;
  onPeriodCount: (n: number) => void;
  onConfirm: () => void;
}) {
  // Shown so the coach sees the consequence of the choice before committing,
  // rather than discovering the period length after kick-off.
  const periodMs = (totalMinutes * 60_000) / periodCount;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.squad}>{PLACEHOLDER_SQUAD_NAME}</Text>
        <Text style={styles.caption}>Set up the match</Text>

        <Text style={styles.fieldLabel}>Match length</Text>
        <View style={styles.choiceRow}>
          {TOTAL_MINUTES_CHOICES.map((m) => (
            <Choice
              key={m}
              label={`${m}`}
              selected={m === totalMinutes}
              onPress={() => onTotalMinutes(m)}
            />
          ))}
        </View>
        <Text style={styles.hint}>minutes</Text>

        <Text style={styles.fieldLabel}>Played in</Text>
        <View style={styles.choiceRow}>
          {PERIOD_COUNT_CHOICES.map((p) => (
            <Choice
              key={p}
              label={periodNounPlural(p)}
              selected={p === periodCount}
              onPress={() => onPeriodCount(p)}
              wide
            />
          ))}
        </View>

        <Text style={styles.summary}>
          {periodCount} × {formatClock(periodMs)} {periodNounPlural(periodCount).toLowerCase()}
        </Text>

        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={onConfirm}
        >
          <Text style={styles.buttonLabel}>Start match</Text>
        </Pressable>
      </View>
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

function Choice({
  label,
  selected,
  onPress,
  wide,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  wide?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        wide && styles.choiceWide,
        selected && styles.choiceSelected,
        pressed && styles.buttonPressed,
      ]}
    >
      <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

function ClockScreen({
  match,
  onChangeSetup,
}: {
  match: Match;
  onChangeSetup: () => void;
}) {
  const [, forceRepaint] = useReducer((n: number) => n + 1, 0);
  const { engine, state, squad } = match;

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

  // Changing the match shape mid-game would silently rewrite what has already
  // been played, so the way back is offered only before the first whistle.
  const notStartedYet = useMemo(
    () => state.quarters.every((q) => q.status === 'pending'),
    [state, view.isRunning, view.matchElapsedMs]
  );

  const onStart = useCallback(() => {
    const quarter = currentQuarter(state);
    if (!quarter) return;
    engine.startQuarter(state, quarter, squad.teamSheet, squad.format);
    forceRepaint();
  }, [engine, state, squad]);

  const onEnd = useCallback(() => {
    const quarter = currentQuarter(state);
    if (!quarter) return;
    engine.endQuarter(state, quarter);
    forceRepaint();
  }, [engine, state]);

  const noun = periodNoun(state.match.quarterCount).toLowerCase();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.squad}>{PLACEHOLDER_SQUAD_NAME}</Text>
        <Text style={styles.quarter}>{view.quarterLabel}</Text>

        <Text style={styles.clock} numberOfLines={1} adjustsFontSizeToFit>
          {formatClock(view.quarterElapsedMs)}
        </Text>

        {view.isMatchOver ? (
          <Text style={styles.caption}>
            Match elapsed {formatClock(view.matchElapsedMs)}
          </Text>
        ) : (
          <Text style={[styles.caption, view.isOvertime && styles.overtime]}>
            {view.isOvertime
              ? `${periodNoun(state.match.quarterCount)} over — end it when play stops`
              : `${formatClock(view.quarterRemainingMs)} left in this ${noun}`}
          </Text>
        )}

        <Text style={styles.caption}>
          Match total {formatClock(view.matchElapsedMs)} of {state.match.totalMinutes}:00
        </Text>

        <View style={styles.actions}>
          {view.canStart && (
            <Pressable
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              onPress={onStart}
            >
              <Text style={styles.buttonLabel}>
                Start {noun}
              </Text>
            </Pressable>
          )}
          {view.canEnd && (
            <Pressable
              style={({ pressed }) => [
                styles.button,
                view.isOvertime && styles.buttonUrgent,
                pressed && styles.buttonPressed,
              ]}
              onPress={onEnd}
            >
              <Text style={styles.buttonLabel}>End {noun}</Text>
            </Pressable>
          )}
        </View>

        {notStartedYet && (
          <Pressable onPress={onChangeSetup} style={styles.linkHit}>
            <Text style={styles.link}>Change match setup</Text>
          </Pressable>
        )}

        <Text style={styles.footnote}>
          Placeholder squad. Substitutions and fairness are not built yet.
        </Text>
      </View>
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b3d2e',
  },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  squad: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '600',
  },
  quarter: {
    color: '#cfe3da',
    fontSize: 16,
    marginTop: 4,
    marginBottom: 4,
  },
  // No `fontVariant: ['tabular-nums']`. On a real phone that clipped the last
  // glyph and the first release read "00:0" instead of "00:00".
  clock: {
    color: '#ffffff',
    fontSize: 80,
    fontWeight: '300',
    letterSpacing: 2,
    width: '100%',
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  caption: {
    color: '#cfe3da',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 4,
  },
  overtime: {
    color: '#ffd166',
    fontWeight: '600',
  },
  fieldLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 24,
    marginBottom: 8,
  },
  choiceRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  choice: {
    minWidth: 60,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2f6b55',
    margin: 4,
    alignItems: 'center',
  },
  choiceWide: {
    minWidth: 104,
  },
  choiceSelected: {
    backgroundColor: '#12855a',
    borderColor: '#12855a',
  },
  choiceLabel: {
    color: '#cfe3da',
    fontSize: 16,
  },
  choiceLabelSelected: {
    color: '#ffffff',
    fontWeight: '700',
  },
  hint: {
    color: '#8fb3a5',
    fontSize: 12,
    marginTop: 2,
  },
  summary: {
    color: '#ffffff',
    fontSize: 17,
    marginTop: 24,
    marginBottom: 20,
  },
  actions: {
    flexDirection: 'row',
    marginTop: 24,
  },
  button: {
    backgroundColor: '#12855a',
    paddingVertical: 15,
    paddingHorizontal: 28,
    borderRadius: 10,
  },
  buttonUrgent: {
    backgroundColor: '#c47f1a',
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonLabel: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
  linkHit: {
    marginTop: 18,
    padding: 8,
  },
  link: {
    color: '#8fb3a5',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  footnote: {
    color: '#8fb3a5',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 20,
  },
});
