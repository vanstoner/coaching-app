/**
 * The season, league and cup side by side — #103 AC2, #105 AC2.
 *
 * Reached from Player minutes in Settings. Read-only; every figure is folded
 * from the ledger on the way in (invariant 1).
 */

import { Pressable, ScrollView, View } from 'react-native';
import { Text } from './Text';

import type { Player, UUID } from '../types/index';
import type { Ledger } from '../app/ledger';
import { seasonChart } from '../app/analysis';
import { SeasonBars } from './Charts';
import { SeasonNote } from './MatchAnalysisScreen';
import { screen } from './theme';

export function SeasonScreen({
  ledger,
  players,
  finishedIds,
  onBack,
}: {
  ledger: Ledger | null;
  players: Player[];
  finishedIds: ReadonlySet<UUID>;
  onBack: () => void;
}) {
  const chart = ledger ? seasonChart(ledger, players, { finishedIds }) : null;
  return (
    <View style={screen.flex}>
      <ScrollView contentContainerStyle={screen.scroll}>
        <Text style={screen.title} numberOfLines={1}>
          Season
        </Text>
        <Text style={screen.caption} numberOfLines={1}>
          Average minutes per match attended
        </Text>
        {chart && chart.countedMatches > 0 ? (
          <>
            <SeasonNote counted={chart.countedMatches} inferred={chart.inferredMatches} />
            <SeasonBars chart={chart} />
          </>
        ) : (
          <Text style={screen.hint}>No finished matches yet.</Text>
        )}
        <Pressable
          style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]}
          onPress={onBack}
        >
          <Text style={screen.buttonLabel}>Back to Settings</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

/** The way in, beside Player minutes in Settings. */
export function SeasonChartLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={screen.linkHit}>
      <Text style={screen.link}>Season chart: league and cup</Text>
    </Pressable>
  );
}
