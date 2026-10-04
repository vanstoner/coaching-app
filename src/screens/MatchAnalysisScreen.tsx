/**
 * Match analysis — #105.
 *
 * This match's playing time per player, each bar over a shadow of their
 * season average from the other matches (AC1). This match only (#121 AC1):
 * the season figures live on each child's page in Squad, and the screen says
 * so in one plain line.
 *
 * Opened from the report and, during a match, from the clock (AC3). Opening
 * it stops nothing: the clock is wall-clock anchors, not a timer this screen
 * could starve. While a period runs it repaints each second, and every
 * repaint recomputes from the anchors (invariant 2).
 */

import { useEffect, useReducer } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import type { MatchEngine, MatchState } from '../engine/MatchEngine';
import type { Format, Player, UUID } from '../types/index';
import type { Ledger } from '../app/ledger';
import { matchChart, matchReport } from '../app/analysis';
import { SEASON_POINTER } from '../app/childSeason';
import { opponentLabel } from '../app/fixtures';
import { MatchBars } from './Charts';
import { screen } from './theme';

export function MatchAnalysisScreen({
  engine,
  state,
  format,
  players,
  ledger,
  kickoffs,
  backLabel,
  onBack,
}: {
  engine: MatchEngine;
  state: MatchState;
  format: Format | null;
  players: Player[];
  ledger: Ledger | null;
  /** Kick-off of each match without a `kickoffAt`, for ruling E (`kickoffTimes`). */
  kickoffs: ReadonlyMap<UUID, string>;
  backLabel: string;
  onBack: () => void;
}) {
  const running = state.quarters.some((q) => q.status === 'running');
  const [, repaint] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!running) return;
    // A repaint only. The minutes are recomputed from anchors on each one.
    const id = setInterval(repaint, 1000);
    return () => clearInterval(id);
  }, [running]);

  const report = matchReport(engine, state, players, format);
  const chart = matchChart(report, ledger, players, { kickoffs });

  return (
    <View style={screen.flex}>
      <ScrollView contentContainerStyle={screen.scroll}>
        <Text style={screen.title} numberOfLines={1}>
          Playing time
        </Text>
        <Text style={screen.caption} numberOfLines={1}>
          {opponentLabel(state.match)}
          {running ? ' · live, the clock keeps running' : ''}
        </Text>

        <Pressable onPress={onBack} style={screen.linkHit}>
          <Text style={screen.link}>{backLabel}</Text>
        </Pressable>

        <Text style={screen.fieldLabel}>This match, minutes</Text>
        <Text style={screen.hint}>
          Outline: their average per match attended, from the other matches. Furthest below it first.
        </Text>
        <MatchBars chart={chart} />

        <Text style={[screen.caption, local.pointer]}>{SEASON_POINTER}</Text>

        <Pressable
          style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]}
          onPress={onBack}
        >
          <Text style={screen.buttonLabel}>{backLabel}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const local = StyleSheet.create({
  pointer: { marginTop: 18 },
});
