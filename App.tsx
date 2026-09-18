import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { MatchEngine } from './src/engine/MatchEngine';
import { deriveClockView, formatClock, currentQuarter } from './src/app/matchClock';
import {
  makePlaceholderSquad,
  PLACEHOLDER_SQUAD_NAME,
  DEFAULT_TOTAL_MINUTES,
  DEFAULT_QUARTER_COUNT,
} from './src/app/placeholderSquad';

/**
 * REQ-01 (#1): the match clock.
 *
 * Invariant 2 in practice. The interval below is a REPAINT trigger and nothing
 * else — it calls `forceRepaint`, which holds no time and accumulates nothing.
 * Every figure on screen is recomputed by `deriveClockView` from the engine's
 * wall-clock anchors on each render. Drop every one of these ticks and the
 * clock is still right the moment it repaints, which is exactly what happens
 * when Android throttles a backgrounded app.
 *
 * The AppState listener exists for the same reason from the other direction:
 * on return to the foreground it repaints immediately rather than waiting up
 * to a full interval to stop showing a stale figure.
 *
 * Not yet built, and deliberately: the squad is a placeholder (REQ-09, #9),
 * there is no persistence so a relaunch starts a fresh match (part of #1's
 * resume criterion), and there are no substitutions (REQ-04, #4).
 */
export default function App() {
  const [, forceRepaint] = useReducer((n: number) => n + 1, 0);

  // Built exactly once. Two calls to makePlaceholderSquad() would mint two
  // different formats, and the match would be created against one while the
  // team sheet belonged to the other.
  const { engine, state, squad } = useMemo(() => {
    const s = makePlaceholderSquad();
    const e = new MatchEngine();
    return {
      engine: e,
      squad: s,
      state: e.createMatch(s.squadId, s.format.id, {
        totalMinutes: DEFAULT_TOTAL_MINUTES,
        quarterCount: DEFAULT_QUARTER_COUNT,
      }),
    };
  }, []);

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

  return (
    <View style={styles.container}>
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
            ? 'Quarter over — end it when play stops'
            : `${formatClock(view.quarterRemainingMs)} left in this quarter`}
        </Text>
      )}

      <Text style={styles.caption}>
        Match total {formatClock(view.matchElapsedMs)} of {DEFAULT_TOTAL_MINUTES}:00
      </Text>

      <View style={styles.actions}>
        {view.canStart && (
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={onStart}
          >
            <Text style={styles.buttonLabel}>Start quarter</Text>
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
            <Text style={styles.buttonLabel}>End quarter</Text>
          </Pressable>
        )}
      </View>

      <Text style={styles.footnote}>
        Placeholder squad. Substitutions and fairness are not built yet.
      </Text>

      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b3d2e',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  squad: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '600',
  },
  quarter: {
    color: '#cfe3da',
    fontSize: 16,
    marginTop: 4,
    marginBottom: 8,
  },
  // No `fontVariant: ['tabular-nums']`. On a real phone that clipped the last
  // glyph and the first release read "00:0" instead of "00:00". The width is
  // explicit and the text is allowed to shrink rather than be cut.
  clock: {
    color: '#ffffff',
    fontSize: 88,
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
  actions: {
    flexDirection: 'row',
    marginTop: 28,
  },
  button: {
    backgroundColor: '#12855a',
    paddingVertical: 16,
    paddingHorizontal: 32,
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
  footnote: {
    color: '#8fb3a5',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 32,
  },
});
