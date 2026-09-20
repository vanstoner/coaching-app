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

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Match, UUID } from '../types/index';
import {
  NO_FIXTURES_YET,
  competitionLabel,
  fixtureList,
  inBucket,
  kickoffLabel,
  lengthLabel,
  opponentLabel,
  type FixtureRow,
} from '../app/fixtures';
import { colours, screen, TOUCH_TARGET } from './theme';

export function FixturesScreen({
  squadName,
  matches,
  currentMatchId,
  now,
  onOpen,
  onDelete,
  onAdd,
  onPlayNow,
  buildLabel,
}: {
  squadName: string;
  matches: Match[];
  currentMatchId: UUID | null;
  /** Injected so the list is testable and never reads the clock itself. */
  now: Date;
  onOpen: (matchId: UUID) => void;
  /** Only offered on a fixture that has never been played. */
  onDelete: (matchId: UUID) => void;
  onAdd: () => void;
  /**
   * Kick off now, from the defaults, with no fixture form — PO ruling,
   * 2026-09-20: *Play now: **yes.***
   *
   * Null while a match is already underway. Starting a second one would
   * orphan the first, and the In-progress card above is the way back into it.
   */
  onPlayNow: (() => void) | null;
  buildLabel: string;
}) {
  const rows = fixtureList(matches, now, currentMatchId);
  const current = inBucket(rows, 'current');
  const future = inBucket(rows, 'future');
  const past = inBucket(rows, 'past');

  return (
    <View style={screen.flex}>
      <ScrollView contentContainerStyle={screen.scroll}>
        <Text style={screen.title} numberOfLines={1}>
          {squadName}
        </Text>

        {rows.length === 0 ? (
          <Text style={screen.caption}>{NO_FIXTURES_YET}</Text>
        ) : (
          <>
            <Section title="Now" rows={current} now={now} onOpen={onOpen} />
            <Section
              title="Coming up"
              rows={future}
              now={now}
              onOpen={onOpen}
              onDelete={onDelete}
            />
            <Section title="Played" rows={past} now={now} onOpen={onOpen} />
          </>
        )}

        {onPlayNow && (
          <Pressable
            style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]}
            onPress={onPlayNow}
          >
            <Text style={screen.buttonLabel}>Play now</Text>
          </Pressable>
        )}
        {onPlayNow && (
          <Text style={screen.hint}>
            An unplanned kickabout, using your defaults. No form to fill in.
          </Text>
        )}

        <Pressable
          style={({ pressed }) => [screen.buttonQuiet, pressed && screen.buttonPressed]}
          onPress={onAdd}
        >
          <Text style={screen.buttonLabel}>Add a fixture</Text>
        </Pressable>
      </ScrollView>

      <Text style={screen.buildLabel} numberOfLines={1}>
        {buildLabel}
      </Text>
    </View>
  );
}

/** A bucket, omitted entirely when empty rather than shown as a bare heading. */
function Section({
  title,
  rows,
  now,
  onOpen,
  onDelete,
}: {
  title: string;
  rows: FixtureRow[];
  now: Date;
  onOpen: (matchId: UUID) => void;
  /** Absent on buckets where deleting would destroy a played record. */
  onDelete?: (matchId: UUID) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <View style={local.section}>
      <Text style={screen.fieldLabel}>{title}</Text>
      {rows.map((row) => (
        <FixtureCard
          key={row.match.id}
          row={row}
          now={now}
          onOpen={onOpen}
          onDelete={onDelete}
        />
      ))}
    </View>
  );
}

function FixtureCard({
  row,
  now,
  onOpen,
  onDelete,
}: {
  row: FixtureRow;
  now: Date;
  onOpen: (matchId: UUID) => void;
  onDelete?: (matchId: UUID) => void;
}) {
  const { match } = row;
  const competition = competitionLabel(match.competition);
  // Two taps, in place, no dialog module. A fixture is cheap to re-add, but
  // deleting one the coach meant to keep is not cheap to undo.
  const [confirming, setConfirming] = useState(false);
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
      {/* This match's OWN length and periods, not the squad default (#70). */}
      <Text style={local.meta} numberOfLines={1}>
        {lengthLabel(match)}
      </Text>
      {row.bucket === 'current' && <Text style={local.nowTag}>In progress</Text>}

      {onDelete &&
        (confirming ? (
          <View style={local.confirmRow}>
            <Pressable onPress={() => onDelete(match.id)} style={local.confirmHit}>
              <Text style={local.deleteConfirm}>Delete this fixture</Text>
            </Pressable>
            <Pressable onPress={() => setConfirming(false)} style={local.confirmHit}>
              <Text style={local.keep}>Keep</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setConfirming(true)} style={local.confirmHit}>
            <Text style={local.remove}>Remove</Text>
          </Pressable>
        ))}
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
  confirmRow: { flexDirection: 'row', alignItems: 'center' },
  // A real target rather than hitSlop: 13px text with 8px slop measured about
  // 31dp, under the 44 floor, on the control that deletes a fixture.
  confirmHit: {
    justifyContent: 'center',
    minHeight: TOUCH_TARGET,
    paddingRight: 16,
  },
  remove: {
    color: colours.inkFaint,
    fontSize: 13,
    includeFontPadding: false,
  },
  deleteConfirm: {
    color: colours.danger,
    fontSize: 13,
    includeFontPadding: false,
  },
  keep: { color: colours.inkMuted, fontSize: 13, includeFontPadding: false },
  nowTag: {
    color: colours.warn,
    fontSize: 13,
    includeFontPadding: false,
    marginTop: 4,
  },
});
