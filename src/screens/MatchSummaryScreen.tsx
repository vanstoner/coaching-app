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

import { AwardCard } from './AwardCard';
import type { AwardRow } from '../app/matchAwards';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text } from './Text';

import type { MatchEngine, MatchState } from '../engine/MatchEngine';
import type { AvailabilityStatus, Format, Player, UUID } from '../types/index';
import { isExcluded, type Ledger } from '../app/ledger';
import { goalOutfieldSplit, matchChart, matchReport, wholeMinutes } from '../app/analysis';
import { SEASON_POINTER } from '../app/childSeason';
import { recordOnlyGoals, resultOf, scoreWithRecord } from '../app/matchRecord';
import { TALLY_CAPTION, matchTalliesWithGoals, tallyLineText } from '../app/tallies';
import type { ProvenanceInfo } from '../app/provenance';
import { TrustRow } from './RecordMatchScreen';
import { formatClock, periodNounPlural } from '../app/matchClock';
import { competitionLabel, kickoffLabel, opponentLabel } from '../app/fixtures';
import { displayName } from '../app/squad';
import { Chip, ChipRow } from './Chip';
import { MatchBars } from './Charts';
import { NAME, sortReportMinutes } from '../app/tableSort';
import { SortHeading, useTableSort } from './TableSort';
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
  onSetExcluded,
  onVoid,
  backLabel = 'Back to Home',
  onOpenRecord,
  trust = null,
  awards = null,
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
  /**
   * Leave this match out of the figures, or count it again, with a note
   * (#187, ADR-020): the reason if refused, else null. Works on a match
   * already played.
   */
  onSetExcluded?: (excluded: boolean, note: string) => string | null;
  /**
   * Void this played match, with a note (#194, PO ruling 18 Oct): hidden from
   * every screen, kept in the record, listed in Settings › Test matches with
   * Show it again. The reason if refused, else null.
   */
  onVoid?: (note: string) => string | null;
  /** The way back: Home, or Settings for a test match (#194). */
  backLabel?: string;
  /** #196: the match as the record holds it: how it was played, positions, goals with time unknown. */
  onOpenRecord?: () => void;
  /** How far it can be trusted, and why (#199 AC3); null while it is not in the record. */
  trust?: ProvenanceInfo | null;
  /**
   * #228 item 6: awards for this match before it is closed, or null when they
   * are not offered (a test match, no award types, no record to write). `due`
   * is whether End match asks first (Q5).
   */
  awards?: {
    rows: AwardRow[];
    childrenInMatch: { playerId: UUID; name: string }[];
    due: boolean;
    onGive: (typeId: UUID, playerId: UUID, note: string) => string | null;
    onTakeBack: (typeId: UUID, playerId: UUID, note: string) => string | null;
  } | null;
  onBack: () => void;
}) {
  /** #228 Q5: End match was tapped with an award still to give; the card asks first. */
  const [askingAwards, setAskingAwards] = useState(false);
  // #208: the minutes table sorts by its numbers, Total most first by default.
  const minutesSort = useTableSort('reportMinutes');
  const [marking, setMarking] = useState<{ note: string; error: string } | null>(null);
  const [voiding, setVoiding] = useState<{ note: string; error: string } | null>(null);
  const scroller = useRef<ScrollView>(null);
  // Where the note box sits in the scrolled content, to bring it into view.
  const panelY = useRef(0);
  const [correcting, setCorrecting] = useState<{
    playerId: UUID | null;
    status: 'available' | 'absent';
    note: string;
    error: string;
  } | null>(null);
  // The keyboard covers the lower half of the screen (Android draws edge to
  // edge and the window does not resize for it, #174), so while a note is
  // being typed, bring its box to the top of what is left. Without this the
  // coach types blind.
  const typing = correcting !== null || marking !== null || voiding !== null;
  useEffect(() => {
    if (!typing) return;
    const toBox = () => scroller.current?.scrollTo({ y: Math.max(0, panelY.current - 12), animated: true });
    const later = setTimeout(toBox, 60);
    const shown = Keyboard.addListener('keyboardDidShow', toBox);
    return () => {
      clearTimeout(later);
      shown.remove();
    };
  }, [typing]);
  const closed = state.match.status === 'completed';
  // Only a match the ledger holds can be left out or counted (ADR-020).
  const inLedger = ledger?.matches.find((m) => m.id === state.match.id);
  const excluded = inLedger ? isExcluded(inLedger) : false;
  const report = matchReport(engine, state, players, format);
  const [moreStats, setMoreStats] = useState(false);
  // #196 AC1: the phone's events plus any the record holds that it does not.
  const phoneIds = new Set((state.events ?? []).map((e) => e.id));
  const score = scoreWithRecord(report.score, phoneIds, inLedger);
  const extraGoals = recordOnlyGoals(phoneIds, inLedger);
  const chart = matchChart(report, ledger, players, { kickoffs });
  const nameOf = (id: string | null) =>
    (id && report.players.find((p) => p.playerId === id)?.name) ||
    (id && players.find((p) => p.id === id)?.firstName) ||
    'someone';
  const tallies = matchTalliesWithGoals(state.events, ledger?.eventTypes ?? [], (id) => nameOf(id));

  const competition = competitionLabel(report.competition);
  const details = [
    kickoffLabel(state.match, now, state.quarters),
    competition === '' ? 'League' : competition,
    report.formatName,
    `${report.totalMinutes} min, ${periodNounPlural(report.periodCount).toLowerCase()}`,
  ].filter((x): x is string => !!x);

  return (
    <View style={screen.flex}>
      <KeyboardAvoidingView
        style={screen.flex}
        // #174: padding on both platforms, as the fixture form does.
        behavior="padding"
      >
      <ScrollView ref={scroller} contentContainerStyle={screen.scroll} keyboardShouldPersistTaps="handled">
        {/* #228 (Dee's clutter fix 3): opponent and score on one line, details, one status pill. */}
        <View style={local.reportHead}>
          <Text style={local.headName} numberOfLines={1}>
            v {opponentLabel(state.match)}
          </Text>
          <Text style={local.headScore} numberOfLines={1}>
            {closed ? `${resultOf(score)} ` : ''}
            {score.us} – {score.them}
          </Text>
        </View>
        <Text style={[screen.caption, local.left]}>{details.join(' · ')}</Text>
        {closed && (
          <View style={[local.pill, local.pillClosed]}>
            <Text style={local.pillClosedText}>Closed · counts towards season averages</Text>
          </View>
        )}
        {!closed && onEndMatch && (
          <View style={[local.pill, local.pillOpen]}>
            <Text style={local.pillOpenText}>Not closed · End match is at the bottom ↓</Text>
          </View>
        )}
        {closed && trust && <TrustRow trust={trust} />}

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
        {/* #228: a goal added in the record with time unknown is marked on its own line. */}
        {extraGoals
          .filter((g) => g.kind === 'goal')
          .map((g) => (
            <Text key={g.id} style={local.line} numberOfLines={1}>
              {g.playerId ? nameOf(g.playerId) : 'Scorer not recorded'} · 1 goal · time unknown, from the record
            </Text>
          ))}

        {/* #198: an assist is core, so it sits with the goals. */}
        {report.play.some((p) => p.assists > 0) && (
          <Text style={local.lineFaint} numberOfLines={2}>
            Assists:{' '}
            {report.play
              .filter((p) => p.assists > 0)
              .map((p) => `${p.name} ${p.assists}`)
              .join(', ')}
          </Text>
        )}

        <Text style={screen.fieldLabel}>In goal</Text>
        <Text style={local.line}>{report.conceded} conceded</Text>
        {extraGoals
          .filter((g) => g.kind === 'conceded')
          .map((g) => (
            <Text key={g.id} style={local.lineFaint} numberOfLines={1}>
              1 conceded · time unknown, from the record
            </Text>
          ))}
        {report.keepers
          .filter((k) => k.conceded > 0)
          .map((k) => (
            <Text key={k.playerId} style={local.lineFaint} numberOfLines={1}>
              {k.name} · {k.conceded} conceded
            </Text>
          ))}

        {/* #198 AC3: the coach's tallies, collapsed, never mixed into the core. */}
        {tallies.length > 0 && (
          <>
            <Pressable onPress={() => setMoreStats((v) => !v)} style={screen.linkHit} accessibilityRole="button">
              <Text style={screen.link}>
                {moreStats ? 'Hide more stats' : `More stats (${tallies.length})`}
              </Text>
            </Pressable>
            {moreStats && (
              <>
                <Text style={local.lineFaint}>{TALLY_CAPTION}.</Text>
                {tallies.map((t) => (
                  <Text key={t.kind} style={local.line} numberOfLines={3}>
                    {tallyLineText(t)}
                  </Text>
                ))}
                <Text style={local.lineFaint} numberOfLines={1}>
                  Their shots on target: {report.theirShotsOnTarget} (saves and goals against)
                </Text>
              </>
            )}
          </>
        )}

        <Text style={screen.fieldLabel}>Minutes on the pitch</Text>
        <Text style={local.lineFaint}>
          Fair share {formatClock(report.fairShareMs)} each, goal and outfield together.
        </Text>
        <View style={local.head}>
          <SortHeading label="Player" column={NAME} {...minutesSort} align="left" style={local.nameHead} />
          <SortHeading label="Total" column="total" {...minutesSort} style={local.figureHead} />
          <SortHeading label="GK" column="gk" {...minutesSort} style={local.figureHead} />
          <SortHeading label="Out" column="out" {...minutesSort} style={local.figureHead} />
          <SortHeading label="vs fair" column="delta" {...minutesSort} style={local.figureHead} />
        </View>
        {sortReportMinutes(report.players, minutesSort.sort).map((row) => {
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
          Outline: their average per match attended, from the other matches. Tap a heading to sort by it.
        </Text>
        <MatchBars chart={{ ...chart, absent: [] }} table="reportAverage" />
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
            <View style={local.panel} onLayout={(e) => (panelY.current = e.nativeEvent.layout.y)}>
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
              <NoteActions
                saveLabel="Save correction"
                disabled={correcting.playerId === null || correcting.note.trim() === ''}
                onSave={() => {
                  if (correcting.playerId === null) return;
                  const refused = onCorrectAttendance(correcting.playerId, correcting.status, correcting.note);
                  if (refused === null) setCorrecting(null);
                  else setCorrecting({ ...correcting, error: refused });
                }}
                onCancel={() => setCorrecting(null)}
              />
            </View>
          ))}

        {inLedger && (
          <>
            <Text style={screen.fieldLabel}>In the season figures</Text>
            <Text style={local.line}>
              {excluded
                ? 'Left out: not in averages or season totals.'
                : 'Counted in averages and season totals.'}
            </Text>
            {inLedger.excluded?.note != null && (
              <Text style={local.lineFaint} numberOfLines={2}>
                {`Why: ${inLedger.excluded.note}`}
              </Text>
            )}
            {onSetExcluded &&
              voiding === null &&
              (marking === null ? (
                <Pressable onPress={() => setMarking({ note: '', error: '' })} style={screen.linkHit}>
                  <Text style={screen.link}>{excluded ? 'Count this match' : 'Leave this match out'}</Text>
                </Pressable>
              ) : (
                <View style={local.panel} onLayout={(e) => (panelY.current = e.nativeEvent.layout.y)}>
                  <Text style={screen.fieldLabel}>{excluded ? 'Count this match' : 'Leave this match out'}</Text>
                  <Text style={screen.hint}>
                    Its minutes stay on record either way. The record keeps this change and why.
                  </Text>
                  <TextInput
                    style={screen.input}
                    value={marking.note}
                    onChangeText={(note) => setMarking({ note, error: '' })}
                    placeholder="Why? (needed)"
                    placeholderTextColor={colours.inkFaint}
                    maxLength={120}
                    autoFocus
                  />
                  {marking.error !== '' && <Text style={screen.error}>{marking.error}</Text>}
                  <NoteActions
                    saveLabel="Save"
                    disabled={marking.note.trim() === ''}
                    onSave={() => {
                      const refused = onSetExcluded(!excluded, marking.note);
                      if (refused === null) setMarking(null);
                      else setMarking({ ...marking, error: refused });
                    }}
                    onCancel={() => setMarking(null)}
                  />
                </View>
              ))}
            {/* #194: a played match is never deleted. Voiding hides it and keeps it. */}
            {onVoid &&
              marking === null &&
              (voiding === null ? (
                <Pressable onPress={() => setVoiding({ note: '', error: '' })} style={screen.linkHit}>
                  <Text style={screen.link}>Void, with a note</Text>
                </Pressable>
              ) : (
                <View style={local.panel} onLayout={(e) => (panelY.current = e.nativeEvent.layout.y)}>
                  <Text style={screen.fieldLabel}>Void this match</Text>
                  <Text style={screen.hint}>
                    It goes from every screen and every figure. The record keeps it and why, and Settings › Test
                    matches can show it again.
                  </Text>
                  <TextInput
                    style={screen.input}
                    value={voiding.note}
                    onChangeText={(note) => setVoiding({ note, error: '' })}
                    placeholder="Why? (needed)"
                    placeholderTextColor={colours.inkFaint}
                    maxLength={120}
                    autoFocus
                  />
                  {voiding.error !== '' && <Text style={screen.error}>{voiding.error}</Text>}
                  <NoteActions
                    saveLabel="Void"
                    disabled={voiding.note.trim() === ''}
                    onSave={() => {
                      const refused = onVoid(voiding.note);
                      if (refused === null) setVoiding(null);
                      else setVoiding({ ...voiding, error: refused });
                    }}
                    onCancel={() => setVoiding(null)}
                  />
                </View>
              ))}
          </>
        )}

        {/* #228: the record's link moved to the foot, shortened. */}
        {inLedger && onOpenRecord && (
          <Pressable onPress={onOpenRecord} style={screen.linkHit} accessibilityRole="link">
            <Text style={screen.link}>In the record ›</Text>
          </Pressable>
        )}
        {onAnalysis && (
          <Pressable
            style={({ pressed }) => [screen.buttonQuiet, pressed && screen.buttonPressed]}
            onPress={onAnalysis}
          >
            <Text style={screen.buttonLabel}>Match analysis</Text>
          </Pressable>
        )}
        {/* #228 AC24: awards already given, from the record. */}
        {(inLedger?.awards ?? []).length > 0 && !(askingAwards && awards) && (
          <>
            <Text style={screen.fieldLabel}>Awards</Text>
            {(inLedger?.awards ?? []).map((a) => (
              <Text key={`${a.awardTypeId}:${a.playerId}`} style={local.line} numberOfLines={2}>
                {ledger?.awardTypes.find((t) => t.id === a.awardTypeId)?.name ?? 'Award'}: {nameOf(a.playerId)}
                {a.note ? ` (${a.note})` : ''}
              </Text>
            ))}
          </>
        )}
        {/* #228 AC19–AC22 (Q5): End match asks for awards first while one is still to give. */}
        {onEndMatch && askingAwards && awards && (
          <AwardCard
            rows={awards.rows}
            childrenInMatch={awards.childrenInMatch}
            onGive={awards.onGive}
            onTakeBack={awards.onTakeBack}
            footer={
              <>
                <Pressable
                  style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]}
                  onPress={onEndMatch}
                  accessibilityRole="button"
                >
                  <Text style={screen.buttonLabel}>End match</Text>
                </Pressable>
                <Pressable onPress={onEndMatch} style={screen.linkHit} accessibilityRole="button">
                  <Text style={screen.link}>Give them later</Text>
                </Pressable>
              </>
            }
          />
        )}
        {onEndMatch && !(askingAwards && awards) && (
          <Pressable
            style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]}
            onPress={() => (awards?.due ? setAskingAwards(true) : onEndMatch())}
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
          <Text style={screen.buttonLabel}>{backLabel}</Text>
        </Pressable>
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * Save and Cancel for a note box: two buttons of one height, side by side,
 * each half the width. (Save used to be the full-width button style dropped
 * into a centred row beside a text link: it shrank to its label and sat lower
 * than Cancel.)
 */
function NoteActions({
  saveLabel,
  disabled,
  onSave,
  onCancel,
}: {
  saveLabel: string;
  disabled: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={local.noteActions}>
      <Pressable
        onPress={onCancel}
        accessibilityRole="button"
        style={({ pressed }) => [screen.buttonQuiet, local.noteButton, local.noteGap, pressed && screen.buttonPressed]}
      >
        <Text style={screen.buttonLabel}>Cancel</Text>
      </Pressable>
      <Pressable
        disabled={disabled}
        onPress={onSave}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        style={({ pressed }) => [
          screen.button,
          local.noteButton,
          disabled && screen.buttonDisabled,
          pressed && screen.buttonPressed,
        ]}
      >
        <Text style={screen.buttonLabel}>{saveLabel}</Text>
      </Pressable>
    </View>
  );
}

const local = StyleSheet.create({
  line: { alignSelf: 'stretch', color: colours.ink, fontSize: 16, paddingVertical: 3, includeFontPadding: false },
  lineFaint: {
    alignSelf: 'stretch',
    color: colours.inkMuted,
    fontSize: 15,
    paddingVertical: 3,
    includeFontPadding: false,
  },
  head: { flexDirection: 'row', alignSelf: 'stretch', alignItems: 'center', paddingTop: 2 },
  nameHead: { flex: 1, flexShrink: 1 },
  // The heading over a figure: the figure's slot, no shrink.
  figureHead: { width: 50, paddingRight: 4, flexShrink: 0 },
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
  reportHead: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  headName: { flex: 1, color: colours.ink, fontSize: 24, fontWeight: '700', includeFontPadding: false },
  headScore: { flexShrink: 0, marginLeft: 10, color: colours.ink, fontSize: 30, fontWeight: '700', includeFontPadding: false },
  left: { alignSelf: 'stretch', textAlign: 'left' },
  pill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 6 },
  pillOpen: { backgroundColor: '#3b2f12' },
  pillOpenText: { color: colours.warn, fontSize: 13, includeFontPadding: false },
  pillClosed: { borderWidth: 1, borderColor: colours.line },
  pillClosedText: { color: colours.inkMuted, fontSize: 13, includeFontPadding: false },
  panel: { alignSelf: 'stretch', marginTop: 8 },
  noteActions: { flexDirection: 'row', alignSelf: 'stretch', marginTop: 12 },
  // Same margin and height on both, so they line up; the gap is on Cancel.
  noteButton: { flex: 1, marginTop: 0 },
  noteGap: { marginRight: 10 },
  pointer: { marginTop: 14 },
});

