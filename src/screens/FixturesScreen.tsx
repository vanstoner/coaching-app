/**
 * The front door — #62.
 *
 * > *"when I enter the app I should immediately see a list of Future, Current,
 * > Past Fixtures if they exist."*
 *
 * This is a Tuesday screen and a Saturday screen at once, so the ordering does
 * the work: whatever is happening NOW is at the top, then the next thing to
 * prepare for, then history. A coach opening this at 9am on a Saturday sees
 * the match they are about to play without scrolling or thinking.
 */

import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import type { Match, UUID } from '../types/index';
import {
  NO_FIXTURES_YET,
  competitionLabel,
  fixtureList,
  inBucket,
  kickoffLabel,
  opponentLabel,
  type FixtureRow,
} from '../app/fixtures';
import { colours, screen } from './theme';

export function FixturesScreen({
  squadName,
  matches,
  currentMatchId,
  now,
  onOpen,
  onAdd,
  onSettings,
  buildLabel,
}: {
  squadName: string;
  matches: Match[];
  currentMatchId: UUID | null;
  /** Injected so the list is testable and never reads the clock itself. */
  now: Date;
  onOpen: (matchId: UUID) => void;
  onAdd: () => void;
  onSettings: () => void;
  buildLabel: string;
}) {
  const rows = fixtureList(matches, now, currentMatchId);
  const current = inBucket(rows, 'current');
  const future = inBucket(rows, 'future');
  const past = inBucket(rows, 'past');

  return (
    <SafeAreaView style={screen.safe}>
      <ScrollView contentContainerStyle={screen.scroll}>
        <Text style={screen.title} numberOfLines={1}>
          {squadName}
        </Text>

        {rows.length === 0 ? (
          <Text style={screen.caption}>{NO_FIXTURES_YET}</Text>
        ) : (
          <>
            <Section title="Now" rows={current} now={now} onOpen={onOpen} />
            <Section title="Coming up" rows={future} now={now} onOpen={onOpen} />
            <Section title="Played" rows={past} now={now} onOpen={onOpen} />
          </>
        )}

        <Pressable
          style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]}
          onPress={onAdd}
        >
          <Text style={screen.buttonLabel}>Add a fixture</Text>
        </Pressable>

        <Pressable onPress={onSettings} style={screen.linkHit}>
          <Text style={screen.link}>Settings</Text>
        </Pressable>
      </ScrollView>

      <Text style={local.build} numberOfLines={1}>
        {buildLabel}
      </Text>
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

/** A bucket, omitted entirely when empty rather than shown as a bare heading. */
function Section({
  title,
  rows,
  now,
  onOpen,
}: {
  title: string;
  rows: FixtureRow[];
  now: Date;
  onOpen: (matchId: UUID) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <View style={local.section}>
      <Text style={screen.fieldLabel}>{title}</Text>
      {rows.map((row) => (
        <FixtureCard key={row.match.id} row={row} now={now} onOpen={onOpen} />
      ))}
    </View>
  );
}

function FixtureCard({
  row,
  now,
  onOpen,
}: {
  row: FixtureRow;
  now: Date;
  onOpen: (matchId: UUID) => void;
}) {
  const { match } = row;
  const competition = competitionLabel(match.competition);
  return (
    <Pressable
      onPress={() => onOpen(match.id)}
      style={({ pressed }) => [
        local.card,
        row.bucket === 'current' && local.cardCurrent,
        pressed && screen.buttonPressed,
      ]}
    >
      <Text style={local.opponent} numberOfLines={1}>
        {opponentLabel(match)}
      </Text>
      <Text style={local.meta} numberOfLines={1}>
        {kickoffLabel(match, now)}
        {competition === '' ? '' : ` · ${competition}`}
      </Text>
      {row.bucket === 'current' && <Text style={local.nowTag}>In progress</Text>}
    </Pressable>
  );
}

const local = StyleSheet.create({
  section: { alignSelf: 'stretch' },
  card: {
    alignSelf: 'stretch',
    backgroundColor: colours.pitchRaised,
    borderColor: colours.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  // Colour and border only — never a different font weight, which is what
  // clipped the last glyph off the choice boxes on a real phone.
  cardCurrent: { borderColor: colours.warn, backgroundColor: '#12543f' },
  opponent: {
    color: colours.ink,
    fontSize: 18,
    fontWeight: '600',
    includeFontPadding: false,
  },
  meta: {
    color: colours.inkMuted,
    fontSize: 14,
    includeFontPadding: false,
    marginTop: 2,
  },
  nowTag: {
    color: colours.warn,
    fontSize: 13,
    includeFontPadding: false,
    marginTop: 4,
  },
  build: {
    alignSelf: 'stretch',
    textAlign: 'center',
    includeFontPadding: false,
    color: '#4e7a67',
    fontSize: 11,
    paddingBottom: 6,
  },
});
