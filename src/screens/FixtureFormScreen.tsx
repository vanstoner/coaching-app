/**
 * Plan a match before the week starts — #62.
 *
 * > *"A fixture should have an opposition team, formation (7x7 right now),
 * > format (cup, league), date and time. I should be able to create a fixture
 * > in advance."*
 *
 * A Tuesday screen: kitchen table, two hands, no hurry. That is why it asks
 * for everything up front rather than drip-feeding questions the way the
 * Saturday screens do.
 *
 * Every field is optional except the opponent, and even that falls back. A
 * fixture with only a name is still useful — it is something in the list to
 * fill in later — and refusing to save one would mean a coach who does not yet
 * know the kick-off time cannot record the game at all.
 *
 * #264: a form. Opposition is a Field row; minutes and periods are
 * Segmented; Shape and Competition are Rows › to list sheets; the pitch,
 * referee and stats sit in a closed Section. Save fixture is the pinned Main
 * button under "Not saved yet"; Cancel is top left, and leaving a changed
 * form asks first (V29, V30).
 */

import { useEffect, useReducer, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import type { Competition } from '../types/index';
import { COMPETITIONS, competitionLabel } from '../app/fixtures';
import {
  KICKOFF_TIMES,
  dayLabel,
  daysInMonth,
  kickoffIso,
  sameDay,
  startOfDay,
  toTimeInput,
  upcomingMonths,
  upcomingSaturdays,
} from '../app/kickoff';
import { PERIOD_COUNT_CHOICES, TOTAL_MINUTES_CHOICES, periodNounPlural } from '../app/matchClock';
import { SHAPES, shapeLabel, type ShapeCode } from '../app/shapes';
import { pitchAndRefereeLine } from '../app/pitch';
import { canSaveForm, formReducer, initialFormPhase, leaveNeedsAsking } from '../app/saveState';
import {
  BackLink,
  FieldRow,
  FormStatus,
  LeaveAsk,
  ListSheet,
  MainButton,
  MainFoot,
  RowNav,
  Section,
  SegmentedRow,
  TopBar,
} from './controls';
import { PitchChips, RefereeField, type PitchValue } from './PitchFields';
import { colours, screen } from './theme';
import { appNow } from '../app/appClock';

export interface FixtureDraft {
  opponent: string;
  competition: Competition | null;
  kickoffAt: string | null;
  /**
   * THIS match's length, periods and shape — PO ruling, 2026-09-20 (#70).
   *
   * > *"the match length and format are probably match specific - but happy
   * > to have defaults in the settings."*
   *
   * Seeded from the defaults and owned by the fixture from then on. Saving a
   * cup game as halves does not change next Saturday's league default.
   */
  totalMinutes: number;
  periodCount: number;
  shape: ShapeCode;
  /**
   * Leave this match out of averages and season totals (#187, ADR-020), for a
   * one-off or ad hoc game. Its minutes are still recorded.
   */
  excludeFromStats: boolean;
  /** #254: the pitch, and the referee (this phone only). */
  pitch: PitchValue;
}

export function FixtureFormScreen({
  initial,
  onSave,
  onCancel,
  creates = true,
}: {
  initial: FixtureDraft;
  onSave: (draft: FixtureDraft) => void;
  onCancel: () => void;
  /** A new fixture (Rob, 30 Oct): Not saved yet from the start, Save on. False when editing one. */
  creates?: boolean;
}) {
  const [opponent, setOpponent] = useState(initial.opponent);
  const [competition, setCompetition] = useState<Competition | null>(initial.competition);
  const [totalMinutes, setTotalMinutes] = useState(initial.totalMinutes);
  const [periodCount, setPeriodCount] = useState(initial.periodCount);
  const [shape, setShape] = useState<ShapeCode>(initial.shape);
  const [kickoffAt, setKickoffAt] = useState<string | null>(initial.kickoffAt);
  const [excludeFromStats, setExcludeFromStats] = useState(initial.excludeFromStats);
  const [pitch, setPitch] = useState<PitchValue>(initial.pitch);
  // #264 V29, V30: a form. "Nothing to save yet" until the first change,
  // then "Not saved yet"; Save writes once; leaving a changed form asks.
  // Rob, 30 Oct: a NEW fixture is "Not saved yet" from the start, Save on.
  const [phase, dispatch] = useReducer(formReducer, creates, initialFormPhase);
  const [touched, setTouched] = useState(false);
  const [asking, setAsking] = useState(false);
  const [sheet, setSheet] = useState<'shape' | 'competition' | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const changed =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setTouched(true);
      dispatch({ type: 'change' });
    };
  // An untouched form leaves at once (V30), even a new one that could be saved.
  const leave = () => (touched && leaveNeedsAsking(phase) ? setAsking(true) : onCancel());
  // Android Back is a way out too, and asks the same question (V30).
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      leaveRef.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  const pitchLine = pitchAndRefereeLine(pitch.surface, pitch.condition, pitch.referee);

  return (
    <View style={screen.flex}>
      <KeyboardAvoidingView
        style={screen.flex}
        // #174: Android draws edge to edge, so the window no longer resizes for
        // the keyboard; pad on both platforms.
        behavior="padding"
      >
        <ScrollView contentContainerStyle={screen.scroll} keyboardShouldPersistTaps="handled">
          <TopBar back={<BackLink label="Cancel" chevron={false} onPress={leave} />} title="New fixture" />

          <FieldRow
            first
            label="Opposition"
            value={opponent}
            onChangeText={changed(setOpponent)}
            placeholder="Who are you playing?"
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={40}
            returnKeyType="done"
          />

          <KickoffField value={kickoffAt} onChange={changed(setKickoffAt)} />

          <SegmentedRow
            label="Minutes"
            options={TOTAL_MINUTES_CHOICES.map((m) => ({
              value: m as number,
              label: `${m}`,
              accessibilityLabel: `${m} minutes`,
            }))}
            value={totalMinutes}
            onChange={(m) => m !== null && changed(setTotalMinutes)(m)}
          />
          <SegmentedRow
            label="Periods"
            options={PERIOD_COUNT_CHOICES.map((p) => ({ value: p as number, label: periodNounPlural(p) }))}
            value={periodCount}
            onChange={(p) => p !== null && changed(setPeriodCount)(p)}
          />
          <RowNav label="Shape" value={shapeLabel(shape)} onPress={() => setSheet('shape')} />
          <Text style={local.hint}>Just for this match. Your default stays as it is.</Text>
          <RowNav
            label="Competition"
            value={competition ? competitionLabel(competition) : 'None'}
            onPress={() => setSheet('competition')}
          />

          <Section
            title="Pitch, referee and stats"
            summary={`${pitchLine ?? 'Not set'} · ${excludeFromStats ? 'left out' : 'counts'}`}
            open={moreOpen}
            onToggle={() => setMoreOpen((o) => !o)}
          >
            <PitchChips value={pitch} onChange={changed(setPitch)} />
            <RefereeField value={pitch} onChange={changed(setPitch)} />
            <SegmentedRow
              label="Stats"
              options={[
                { value: false, label: 'Counts' },
                { value: true, label: 'Leave out' },
              ]}
              value={excludeFromStats}
              onChange={(v) => v !== null && changed(setExcludeFromStats)(v)}
            />
            <Text style={local.hint}>
              Leave out a one-off or ad hoc game: its minutes stay on record but are not in averages or season
              totals. You can change this later from the match report.
            </Text>
          </Section>
        </ScrollView>
        <MainFoot>
          <FormStatus phase={phase} />
          <MainButton
            label="Save fixture"
            disabled={!canSaveForm(phase, true)}
            onPress={() => {
              dispatch({ type: 'save' });
              onSave({ opponent, competition, kickoffAt, totalMinutes, periodCount, shape, excludeFromStats, pitch });
            }}
          />
        </MainFoot>
      </KeyboardAvoidingView>

      <ListSheet
        visible={sheet === 'shape'}
        title="Shape"
        items={SHAPES.map((s) => ({ value: s.code, label: shapeLabel(s.code), detail: s.description }))}
        value={shape}
        onPick={(code) => {
          changed(setShape)(code);
          setSheet(null);
        }}
        onCancel={() => setSheet(null)}
      />
      <ListSheet<Competition | 'none'>
        visible={sheet === 'competition'}
        title="Competition"
        items={[
          { value: 'none' as Competition | 'none', label: 'None' },
          ...COMPETITIONS.map((c) => ({ value: c as Competition | 'none', label: competitionLabel(c) })),
        ]}
        value={competition ?? 'none'}
        onPick={(c) => {
          changed<Competition | null>(setCompetition)(c === 'none' ? null : (c as Competition));
          setSheet(null);
        }}
        onCancel={() => setSheet(null)}
      />
      <LeaveAsk visible={asking} thing="fixture" onKeep={() => setAsking(false)} onLeave={onCancel} />
    </View>
  );
}

/** How many coming Saturdays are offered as segments (Dee: "the next three"). */
const DAY_SEGMENTS = 3;

/**
 * Kick-off, picked — #80 (PO ruling 2026-10-03: option A), on the #264
 * controls.
 *
 * > *"entering fixture date pain, needs a picker or restricted dropdowns"*
 *
 * The next three Saturdays as segments (a second tap clears the day), "Other
 * date" a Row › opening a list of every day in the coming months, and the
 * time a Row › opening the usual kick-off times. Still no keyboard and no
 * dependency: the rules are tested in `src/app/kickoff.ts`.
 */
function KickoffField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
}) {
  const parsed = value ? new Date(value) : null;
  const valid = parsed !== null && !Number.isNaN(parsed.getTime());

  const [day, setDay] = useState<Date | null>(valid ? startOfDay(parsed!) : null);
  const [time, setTime] = useState(valid ? toTimeInput(parsed!) : '10:00');
  const [sheet, setSheet] = useState<'day' | 'time' | null>(null);
  const [now] = useState(() => appNow());
  const saturdays = upcomingSaturdays(now, DAY_SEGMENTS);
  // AC4: a saved day that is not one of the coming Saturdays still shows,
  // on the Other date row, rather than as a blank.
  const offList = day !== null && !saturdays.some((s) => sameDay(s, day));
  const times = KICKOFF_TIMES.includes(time) ? KICKOFF_TIMES : [...KICKOFF_TIMES, time].sort();
  const allDays = upcomingMonths(now).flatMap(([y, m]) =>
    Array.from({ length: daysInMonth(y, m) }, (_, i) => new Date(y, m, i + 1))
  ).filter((d) => d.getTime() >= startOfDay(now).getTime());

  const pick = (d: Date | null, t: string) => {
    setDay(d);
    setTime(t);
    onChange(d ? kickoffIso(d, t) : null);
  };

  return (
    <View style={local.kickoff}>
      <SegmentedRow
        label="Day"
        stacked
        options={saturdays.map((s) => ({ value: s.getTime(), label: dayLabel(s) }))}
        value={day !== null && !offList ? day.getTime() : null}
        allowClear
        onChange={(t) => pick(t === null ? null : new Date(t), time)}
      />
      <RowNav label="Other date" value={offList ? dayLabel(day!) : ''} onPress={() => setSheet('day')} />
      <RowNav label="Kick-off time" value={time} onPress={() => setSheet('time')} />
      <Text style={local.hint}>{day ? `${dayLabel(day)} at ${time}` : 'No date yet — you can add it later.'}</Text>

      <ListSheet
        visible={sheet === 'day'}
        title="Other date"
        items={allDays.map((d) => ({ value: d.getTime(), label: dayLabel(d) }))}
        value={day ? day.getTime() : null}
        onPick={(t) => {
          pick(new Date(t), time);
          setSheet(null);
        }}
        onCancel={() => setSheet(null)}
      />
      <ListSheet
        visible={sheet === 'time'}
        title="Kick-off time"
        items={times.map((t) => ({ value: t, label: t }))}
        value={time}
        onPick={(t) => {
          pick(day, t);
          setSheet(null);
        }}
        onCancel={() => setSheet(null)}
      />
    </View>
  );
}

const local = StyleSheet.create({
  kickoff: { alignSelf: 'stretch' },
  hint: { alignSelf: 'stretch', color: colours.inkFaint, fontSize: 13, includeFontPadding: false, marginVertical: 4 },
});
