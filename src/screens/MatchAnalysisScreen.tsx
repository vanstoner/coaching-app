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

import { useEffect, useReducer, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { BackLink, TopBar } from './controls';
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
  pitch = null,
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
  /** #254 AC12, AC20: the "Pitch and referee" row for this match. */
  pitch?: ReactNode;
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
        {/* #264 V31: one way back, top left; the back link and the back button at the foot went. */}
        <TopBar
          back={<BackLink label={backLabel.replace(/^Back to /, '')} accessibilityLabel={backLabel} onPress={onBack} />}
        />
        <Text style={screen.title} numberOfLines={1}>
          Playing time
        </Text>
        <Text style={screen.caption} numberOfLines={1}>
          {opponentLabel(state.match)}
          {running ? ' · live, the clock keeps running' : ''}
        </Text>
        {pitch}

        <Text style={screen.fieldLabel}>This match, minutes</Text>
        <Text style={screen.hint}>
          Outline: their average per match attended, from the other matches. Tap a heading to sort by it.
        </Text>
        <MatchBars chart={chart} table="analysisMinutes" />

        <Text style={[screen.caption, local.pointer]}>{SEASON_POINTER}</Text>

      </ScrollView>
    </View>
  );
}

const local = StyleSheet.create({
  pointer: { marginTop: 18 },
});
