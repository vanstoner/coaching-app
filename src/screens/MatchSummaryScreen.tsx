/**
 * The match report — #104, superseding the #62 summary it grew from.
 *
 * > *"After a match concludes i want a mini match report that summarises some
 * > data collected about the game."* — PO, 2026-10-04
 *
 * Shown at full time and on opening any Played match (AC1). Score, scorers,
 * saves and goals conceded, each player's minutes (total, goal, outfield)
 * against the match's fair share, subs made, absentees, and the format,
 * competition and date (AC2). Every figure is folded by `matchReport` from
 * the match record each time it is drawn; nothing is stored (AC3). No
 * player-of-the-week rating (AC4).
 *
 * This match only (#121 AC1): each child's minutes over the outline of their
 * average from the other matches, and one plain line saying the season
 * figures are on each child's page in Squad.
 *
 * A played match is history. Two acts only, each explicit (PO rulings D and
 * F, #98): **End match** closes it, the counterpart of End quarter, so it
 * counts towards season averages; **Correct attendance** writes a noted
 * correction (invariant 5). Leaving without either keeps everything.
 */

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text } from './Text';

import type { MatchEngine, MatchState } from '../engine/MatchEngine';
import type { AvailabilityStatus, Format, Player, UUID } from '../types/index';
import type { Ledger } from '../app/ledger';
import { goalOutfieldSplit, matchChart, matchReport, wholeMinutes } from '../app/analysis';
import { SEASON_POINTER } from '../app/childSeason';
import { formatClock, periodNounPlural } from '../app/matchClock';
import { competitionLabel, kickoffLabel, opponentLabel } from '../app/fixtures';
import { displayName } from '../app/squad';
import { Chip, ChipRow } from './Chip';
import { MatchBars } from './Charts';
import { colours, screen } from './theme';

const STATUS_LABEL: Record<string, string> = {
  absent: 'absent',
  injured: 'injured',
  unavailable: 'unavailable',
};

/** "+4", "-6", "0": whole minutes from the fair share. */
function signed(ms: number): string {
  const m = wholeMinutes(ms);
  return m > 0 ? `+${m}` : `${m}`;
}

export function MatchSummaryScreen({
  engine,
  state,
  format,
  players,
  ledger,
  kickoffs,
  now,
  onAnalysis,
  onEndMatch,
  onCorrectAttendance,
  onBack,
}: {
  engine: MatchEngine;
  state: MatchState;
  format?: Format | null;
  players: Player[];
  /** For the outline of each child's average from the other matches (#121 AC1). */
  ledger: Ledger | null;
  /** Kick-off of each match without a `kickoffAt`, for ruling E (`kickoffTimes`). */
  kickoffs: ReadonlyMap<UUID, string>;
  now: Date;
  /** Match analysis (#105 AC3). */
  onAnalysis?: () => void;
  /** Close the match (ruling D). Absent when it cannot be closed. */
  onEndMatch?: () => void;
  /** A noted attendance correction (ruling F): the reason if refused, else null. */
  onCorrectAttendance?: (playerId: UUID, status: AvailabilityStatus, note: string) => string | null;
  onBack: () => void;
}) {
  const [correcting, setCorrecting] = useState<{
    playerId: UUID | null;
    status: 'available' | 'absent';
    note: string;
    error: string;
  } | null>(null);
  const closed = state.match.status === 'completed';
  const report = matchReport(engine, state, players, format);
  const chart = matchChart(report, ledger, players, { kickoffs });
  const nameOf = (id: string | null) =>
    (id && report.players.find((p) => p.playerId === id)?.name) ||
    (id && players.find((p) => p.id === id)?.firstName) ||
    'someone';

  const competition = competitionLabel(report.competition);
  const details = [
    kickoffLabel(state.match, now, state.quarters),
    competition === '' ? 'League' : competition,
    report.formatName,
    `${report.totalMinutes} min, ${periodNounPlural(report.periodCount).toLowerCase()}`,
  ].filter((x): x is string => !!x);

  return (
    <View style={screen.flex}>
      <ScrollView contentContainerStyle={screen.scroll}>
        <Text style={screen.title} numberOfLines={1}>
          {opponentLabel(state.match)}
        </Text>
        <Text style={screen.caption}>{details.join(' · ')}</Text>
        {closed && <Text style={screen.caption}>Closed. It counts towards season averages.</Text>}
        {!closed && onEndMatch && (
          <Text style={[screen.caption, local.notClosed]}>
            Not closed yet. Read it through, then End match at the bottom.
          </Text>
        )}

        <Text style={local.score}>
          {report.score.us} – {report.score.them}
        </Text>

        <Text style={screen.fieldLabel}>Goals</Text>
        {report.scorers.length === 0 ? (
          <Text style={local.line}>No goals recorded.</Text>
        ) : (
          report.scorers.map((s) => (
            <Text key={s.playerId} style={local.line} numberOfLines={1}>
              {s.name} · {s.goals} {s.goals === 1 ? 'goal' : 'goals'}
            </Text>
          ))
        )}

        <Text style={screen.fieldLabel}>In goal</Text>
        <Text style={local.line}>
          {report.saves} {report.saves === 1 ? 'save' : 'saves'} · {report.conceded} conceded
        </Text>
        {report.keepers.map((k) => (
          <Text key={k.playerId} style={local.lineFaint} numberOfLines={1}>
            {k.name} · {k.saves} {k.saves === 1 ? 'save' : 'saves'} · {k.conceded} conceded
          </Text>
        ))}

        <Text style={screen.fieldLabel}>Minutes on the pitch</Text>
        <Text style={local.lineFaint}>
          Fair share {formatClock(report.fairShareMs)} each, goal and outfield together.
        </Text>
        <View style={local.head}>
          <Text style={[local.name, local.headText]}>Player</Text>
          <Text style={[local.figure, local.headText]}>Total</Text>
          <Text style={[local.figure, local.headText]}>GK</Text>
          <Text style={[local.figure, local.headText]}>Out</Text>
          <Text style={[local.figure, local.headText]}>vs fair</Text>
        </View>
        {report.players.map((row) => {
          // #142: GK and Out add up to the Total beside them.
          const { goal, outfield } = goalOutfieldSplit(row.goalMs, row.outfieldMs, row.totalMs);
          return (
            <View
              key={row.playerId}
              style={local.row}
              accessible
              accessibilityLabel={`${row.name}, ${wholeMinutes(row.totalMs)} minutes, ${signed(row.deltaMs)} against the fair share`}
            >
              <Text style={local.name} numberOfLines={1}>
                {row.name}
              </Text>
              <Text style={local.figure} numberOfLines={1}>
                {wholeMinutes(row.totalMs)}
              </Text>
              <Text style={[local.figure, row.goalMs === 0 && local.faint]} numberOfLines={1}>
                {row.goalMs === 0 ? '—' : goal}
              </Text>
              <Text style={[local.figure, row.outfieldMs === 0 && local.faint]} numberOfLines={1}>
                {row.outfieldMs === 0 ? '—' : outfield}
              </Text>
              <Text style={local.figure} numberOfLines={1}>
                {signed(row.deltaMs)}
              </Text>
            </View>
          );
        })}

        <Text style={screen.fieldLabel}>Against their average</Text>
        <Text style={screen.hint}>
          Outline: their average per match attended, from the other matches. Furthest below it first.
        </Text>
        <MatchBars chart={{ ...chart, absent: [] }} />
        <Text style={[screen.caption, local.pointer]}>{SEASON_POINTER}</Text>

        <Text style={screen.fieldLabel}>Subs made: {report.subs.length}</Text>
        {report.subs.map((s, i) => (
          <Text key={i} style={local.lineFaint} numberOfLines={1}>
            {formatClock(s.atMs)} · {nameOf(s.onId)} on for {nameOf(s.offId)}
          </Text>
        ))}

        <Text style={screen.fieldLabel}>Not here</Text>
        {report.absentees.length === 0 ? (
          <Text style={local.lineFaint}>Nobody recorded absent.</Text>
        ) : (
          report.absentees.map((a) => (
            <Text key={a.playerId} style={local.line} numberOfLines={1}>
              {a.name} · {STATUS_LABEL[a.status] ?? a.status}
            </Text>
          ))
        )}

        {onCorrectAttendance &&
          (correcting === null ? (
            <Pressable
              onPress={() => setCorrecting({ playerId: null, status: 'available', note: '', error: '' })}
              style={screen.linkHit}
            >
              <Text style={screen.link}>Correct attendance</Text>
            </Pressable>
          ) : (
            <View style={local.panel}>
              <Text style={screen.fieldLabel}>Correct attendance</Text>
              <Text style={screen.hint}>Who, here or not, and why. The record keeps both.</Text>
              <ChipRow>
                {players.map((p) => (
                  <Chip
                    key={p.id}
                    label={displayName(p)}
                    selected={correcting.playerId === p.id}
                    onPress={() => setCorrecting({ ...correcting, playerId: p.id, error: '' })}
                  />
                ))}
              </ChipRow>
              <ChipRow>
                <Chip
                  label="Was here"
                  selected={correcting.status === 'available'}
                  onPress={() => setCorrecting({ ...correcting, status: 'available', error: '' })}
                />
                <Chip
                  label="Absent"
                  selected={correcting.status === 'absent'}
                  onPress={() => setCorrecting({ ...correcting, status: 'absent', error: '' })}
                />
              </ChipRow>
              <TextInput
                style={screen.input}
                value={correcting.note}
                onChangeText={(note) => setCorrecting({ ...correcting, note, error: '' })}
                placeholder="Why? (needed)"
                placeholderTextColor={colours.inkFaint}
                maxLength={120}
              />
              {correcting.error !== '' && <Text style={screen.error}>{correcting.error}</Text>}
              <View style={screen.actions}>
                <Pressable
                  disabled={correcting.playerId === null || correcting.note.trim() === ''}
                  onPress={() => {
                    if (correcting.playerId === null) return;
                    const refused = onCorrectAttendance(
                      correcting.playerId,
                      correcting.status,
                      correcting.note
                    );
                    if (refused === null) setCorrecting(null);
                    else setCorrecting({ ...correcting, error: refused });
                  }}
                  style={({ pressed }) => [
                    screen.button,
                    (correcting.playerId === null || correcting.note.trim() === '') && screen.buttonDisabled,
                    pressed && screen.buttonPressed,
                  ]}
                >
                  <Text style={screen.buttonLabel}>Save correction</Text>
                </Pressable>
                <Pressable onPress={() => setCorrecting(null)} style={screen.linkHit}>
                  <Text style={screen.link}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          ))}

        {onAnalysis && (
          <Pressable
            style={({ pressed }) => [screen.buttonQuiet, pressed && screen.buttonPressed]}
            onPress={onAnalysis}
          >
            <Text style={screen.buttonLabel}>Match analysis</Text>
          </Pressable>
        )}
        {onEndMatch && (
          <Pressable
            style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]}
            onPress={onEndMatch}
            accessibilityRole="button"
          >
            <Text style={screen.buttonLabel}>End match</Text>
          </Pressable>
        )}
        <Pressable
          style={({ pressed }) => [
            onEndMatch ? screen.buttonQuiet : screen.button,
            pressed && screen.buttonPressed,
          ]}
          onPress={onBack}
        >
          <Text style={screen.buttonLabel}>Back to Home</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const local = StyleSheet.create({
  score: {
    alignSelf: 'stretch',
    textAlign: 'center',
    color: colours.ink,
    fontSize: 40,
    fontWeight: '700',
    includeFontPadding: false,
    marginTop: 4,
  },
  line: { alignSelf: 'stretch', color: colours.ink, fontSize: 16, paddingVertical: 3, includeFontPadding: false },
  lineFaint: {
    alignSelf: 'stretch',
    color: colours.inkMuted,
    fontSize: 15,
    paddingVertical: 3,
    includeFontPadding: false,
  },
  head: { flexDirection: 'row', alignSelf: 'stretch', paddingTop: 6, paddingBottom: 4 },
  headText: { color: colours.inkFaint, fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomColor: colours.line,
    borderBottomWidth: 1,
  },
  name: { flex: 1, color: colours.ink, fontSize: 16, includeFontPadding: false },
  // Fixed width, never minWidth: "24", "—" and "-12" share these slots.
  figure: {
    width: 50,
    textAlign: 'right',
    color: colours.ink,
    fontSize: 16,
    includeFontPadding: false,
    flexShrink: 0,
    paddingRight: 4,
  },
  faint: { color: colours.inkFaint },
  notClosed: { color: colours.warn },
  panel: { alignSelf: 'stretch', marginTop: 8 },
  pointer: { marginTop: 14 },
});
