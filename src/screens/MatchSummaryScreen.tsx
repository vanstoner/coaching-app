/**
 * What happened in a match that has been played — #62.
 *
 * > *"At the end of a match there should be a summary of the match, the final
 * > score, who scored initially and then something we build on later."*
 *
 * This is the "later" half of that, built now because opening a played fixture
 * had nowhere to go and landed on the LIVE CLOCK screen — a running-match UI
 * for a game that finished weeks ago.
 *
 * It shows what the app actually knows: who played, and for how long. There is
 * no score and no goalscorer yet, because no event is recorded (#6), and this
 * screen says so rather than leaving a coach wondering where it went. Inventing
 * a placeholder score would be worse than an honest gap.
 *
 * Read-only by construction. A played match is history, and invariant 5 says
 * corrections are explicit, noted and never destructive — so this screen
 * cannot edit anything until there is a correction flow that records who
 * changed what and why.
 */

import { useMemo } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { MatchEngine, type MatchState } from '../engine/MatchEngine';
import type { Player } from '../types/index';
import { foldPlayerMinutes } from '../app/playerMinutes';
import { formatClock } from '../app/matchClock';
import { competitionLabel, kickoffLabel, opponentLabel } from '../app/fixtures';
import { displayName } from '../app/squad';
import { colours, screen } from './theme';

export function MatchSummaryScreen({
  engine,
  state,
  players,
  now,
  onBack,
}: {
  engine: MatchEngine;
  state: MatchState;
  players: Player[];
  now: Date;
  onBack: () => void;
}) {
  // Folded from the intervals, like every other figure in this app. Nothing
  // here is read back from a stored total (invariant 1).
  const minutes = useMemo(
    () => foldPlayerMinutes(engine, state, players),
    [engine, state, players]
  );

  // Most outfield time first: the question a coach asks of a finished match is
  // who got a game, and the answer is easiest to read from the top.
  const rows = useMemo(
    () => [...minutes].sort((a, b) => b.outfieldMs - a.outfieldMs),
    [minutes]
  );

  const played = rows.filter((r) => r.totalMs > 0);
  const missed = rows.filter((r) => r.totalMs === 0);
  const competition = competitionLabel(state.match.competition);

  return (
    <SafeAreaView style={screen.safe}>
      <ScrollView contentContainerStyle={screen.scroll}>
        <Text style={screen.title} numberOfLines={1}>
          {opponentLabel(state.match)}
        </Text>
        <Text style={screen.caption} numberOfLines={1}>
          {kickoffLabel(state.match, now)}
          {competition === '' ? '' : ` · ${competition}`}
        </Text>

        <Text style={screen.fieldLabel}>Minutes played</Text>
        <View style={local.head}>
          <Text style={[local.name, local.headText]}>Player</Text>
          <Text style={[local.figure, local.headText]}>Out</Text>
          <Text style={[local.figure, local.headText]}>GK</Text>
        </View>

        {played.map((row) => {
          const player = players.find((p) => p.id === row.playerId);
          return (
            <View key={row.playerId} style={local.row}>
              <Text style={local.name} numberOfLines={1}>
                {player ? displayName(player) : 'Unknown'}
              </Text>
              <Text style={local.figure} numberOfLines={1}>
                {formatClock(row.outfieldMs)}
              </Text>
              <Text style={[local.figure, row.goalkeeperMs === 0 && local.figureFaint]}
                numberOfLines={1}
              >
                {row.goalkeeperMs === 0 ? '—' : formatClock(row.goalkeeperMs)}
              </Text>
            </View>
          );
        })}

        {missed.length > 0 && (
          <>
            <Text style={screen.fieldLabel}>Did not play</Text>
            {missed.map((row) => {
              const player = players.find((p) => p.id === row.playerId);
              return (
                <Text key={row.playerId} style={local.absent} numberOfLines={1}>
                  {player ? displayName(player) : 'Unknown'}
                </Text>
              );
            })}
          </>
        )}

        {/* Said plainly rather than left as a blank space a coach has to
            interpret. Goals, assists, tackles and saves are #6. */}
        <Text style={screen.hint}>
          Goals and other events are not recorded yet, so there is no score here.
        </Text>

        <Pressable
          style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]}
          onPress={onBack}
        >
          <Text style={screen.buttonLabel}>Back to fixtures</Text>
        </Pressable>
      </ScrollView>
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

const local = StyleSheet.create({
  head: { flexDirection: 'row', alignSelf: 'stretch', paddingBottom: 4 },
  headText: { color: colours.inkFaint, fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomColor: colours.line,
    borderBottomWidth: 1,
  },
  name: {
    flex: 1,
    color: colours.ink,
    fontSize: 16,
    includeFontPadding: false,
  },
  // Fixed width, never minWidth: two different strings share this slot
  // ("12:30" and "—"), and a box sized to its own text loses its last glyph
  // on Android. That has happened four times on this project.
  figure: {
    width: 62,
    textAlign: 'right',
    color: colours.ink,
    fontSize: 16,
    includeFontPadding: false,
    flexShrink: 0,
    paddingRight: 4,
  },
  figureFaint: { color: colours.inkFaint },
  absent: {
    alignSelf: 'stretch',
    color: colours.inkFaint,
    fontSize: 15,
    includeFontPadding: false,
    paddingVertical: 4,
  },
});
