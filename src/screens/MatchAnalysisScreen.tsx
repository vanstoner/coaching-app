/**
 * Match analysis — #105.
 *
 * This match's playing time per player, each bar over a shadow of their
 * season average from the other matches (AC1), then the season itself with
 * league, cup and other side by side (AC2, #103).
 *
 * Opened from the report and, during a match, from the clock (AC3). Opening
 * it stops nothing: the clock is wall-clock anchors, not a timer this screen
 * could starve. While a period runs it repaints each second, and every
 * repaint recomputes from the anchors (invariant 2).
 */

import { useEffect, useReducer } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from './Text';

import type { MatchEngine, MatchState } from '../engine/MatchEngine';
import type { Format, Player, UUID } from '../types/index';
import type { Ledger } from '../app/ledger';
import { matchChart, matchReport, seasonChart } from '../app/analysis';
import { opponentLabel } from '../app/fixtures';
import { MatchBars, SeasonBars } from './Charts';
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
  const season = ledger ? seasonChart(ledger, players, { kickoffs }) : null;

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

        <Text style={screen.fieldLabel}>Season, average minutes per match</Text>
        {season && season.rows.length > 0 ? (
          <>
            <SeasonNote counted={season.countedMatches} inferred={season.inferredMatches} />
            <SeasonBars chart={season} />
          </>
        ) : (
          <Text style={screen.hint}>No closed matches yet. Close a match with End match on its report.</Text>
        )}

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

/** How many matches the averages rest on, and how many were inferred (ADR-015 §5). */
export function SeasonNote({ counted, inferred }: { counted: number; inferred: number }) {
  return (
    <Text style={screen.hint}>
      {counted} closed {counted === 1 ? 'match' : 'matches'}.
      {inferred > 0
        ? ` For ${inferred} of them attendance was not recorded, so "attended" means played.`
        : ''}
    </Text>
  );
}
