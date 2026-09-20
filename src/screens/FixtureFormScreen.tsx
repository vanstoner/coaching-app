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
 */

import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Competition } from '../types/index';
import { COMPETITIONS, competitionLabel } from '../app/fixtures';
import { nextSaturday, toDateInput, toIso, toTimeInput } from '../app/kickoff';
import { PERIOD_COUNT_CHOICES, TOTAL_MINUTES_CHOICES, periodNounPlural } from '../app/matchClock';
import { SHAPES, shapeLabel, type ShapeCode } from '../app/shapes';
import { Chip, ChipRow } from './Chip';
import { colours, screen } from './theme';

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
}

export function FixtureFormScreen({
  initial,
  onSave,
  onCancel,
}: {
  initial: FixtureDraft;
  onSave: (draft: FixtureDraft) => void;
  onCancel: () => void;
}) {
  const [opponent, setOpponent] = useState(initial.opponent);
  const [competition, setCompetition] = useState<Competition | null>(initial.competition);
  const [totalMinutes, setTotalMinutes] = useState(initial.totalMinutes);
  const [periodCount, setPeriodCount] = useState(initial.periodCount);
  const [shape, setShape] = useState<ShapeCode>(initial.shape);
  const [kickoffAt, setKickoffAt] = useState<string | null>(initial.kickoffAt);

  return (
    <View style={screen.flex}>
      <KeyboardAvoidingView
        style={screen.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={screen.scroll} keyboardShouldPersistTaps="handled">
          <Text style={screen.title}>New fixture</Text>

          <Text style={screen.fieldLabel}>Opposition</Text>
          <TextInput
            style={screen.input}
            value={opponent}
            onChangeText={setOpponent}
            placeholder="Who are you playing?"
            placeholderTextColor={colours.inkFaint}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={40}
            returnKeyType="done"
          />

          <Text style={screen.fieldLabel}>Competition</Text>
          <ChipRow>
            {COMPETITIONS.map((c) => (
              <Chip
                key={c}
                label={competitionLabel(c)}
                selected={c === competition}
                // Tapping the chosen one clears it: a coach who picked wrongly
                // should not have to remember which value means "unset".
                onPress={() => setCompetition(competition === c ? null : c)}
              />
            ))}
          </ChipRow>

          <Text style={screen.fieldLabel}>Kick-off</Text>
          <KickoffField value={kickoffAt} onChange={setKickoffAt} />

          <Text style={screen.fieldLabel}>This match's length</Text>
          <ChipRow>
            {TOTAL_MINUTES_CHOICES.map((m) => (
              <Chip
                key={m}
                label={`${m}`}
                selected={m === totalMinutes}
                onPress={() => setTotalMinutes(m)}
                narrow
              />
            ))}
          </ChipRow>
          <Text style={screen.hint}>minutes</Text>

          <Text style={screen.fieldLabel}>Played in</Text>
          <ChipRow>
            {PERIOD_COUNT_CHOICES.map((p) => (
              <Chip
                key={p}
                label={periodNounPlural(p)}
                selected={p === periodCount}
                onPress={() => setPeriodCount(p)}
              />
            ))}
          </ChipRow>

          <Text style={screen.fieldLabel}>Shape</Text>
          <ChipRow>
            {SHAPES.map((s) => (
              <Chip
                key={s.code}
                label={shapeLabel(s.code)}
                detail={s.description}
                selected={s.code === shape}
                onPress={() => setShape(s.code)}
                wide
              />
            ))}
          </ChipRow>
          <Text style={screen.hint}>
            Just for this match. Your default stays as it is.
          </Text>

          <Pressable
            style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]}
            onPress={() =>
              onSave({ opponent, competition, kickoffAt, totalMinutes, periodCount, shape })
            }
          >
            <Text style={screen.buttonLabel}>Save fixture</Text>
          </Pressable>

          <Pressable onPress={onCancel} style={screen.linkHit}>
            <Text style={screen.link}>Cancel — nothing is saved</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * Kick-off, entered as a date and a time.
 *
 * Deliberately NOT a native date picker: that means a dependency, and this
 * project's proportionality ruling says prefer the least machinery that
 * satisfies the criterion. Two plain fields with a "next Saturday" shortcut
 * fit how this squad actually works — one match a week, nearly always a
 * Saturday morning.
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

  const [date, setDate] = useState(valid ? toDateInput(parsed!) : '');
  const [time, setTime] = useState(valid ? toTimeInput(parsed!) : '10:00');
  /** True once the coach has typed something, so an empty field stays quiet. */
  const typed = date.trim() !== '';

  const push = (d: string, t: string) => {
    const iso = toIso(d, t);
    onChange(iso);
  };

  return (
    <View style={local.kickoff}>
      <View style={local.kickoffRow}>
        <TextInput
          style={[screen.input, local.dateInput]}
          value={date}
          onChangeText={(t) => {
            setDate(t);
            push(t, time);
          }}
          placeholder="DD/MM/YYYY"
          placeholderTextColor={colours.inkFaint}
          keyboardType="numbers-and-punctuation"
          maxLength={10}
        />
        <TextInput
          style={[screen.input, local.timeInput]}
          value={time}
          onChangeText={(t) => {
            setTime(t);
            push(date, t);
          }}
          placeholder="HH:MM"
          placeholderTextColor={colours.inkFaint}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
        />
      </View>
      <Pressable
        onPress={() => {
          const sat = nextSaturday(new Date());
          const d = toDateInput(sat);
          setDate(d);
          push(d, time);
        }}
        style={screen.linkHit}
      >
        <Text style={screen.link}>Next Saturday</Text>
      </Pressable>
      {/*
        Say WHY a date was not accepted. It used to fail silently: typing
        31/02/2026 left the fixture with no kick-off and no explanation, so a
        coach would save it believing the date had taken.
      */}
      <Text style={[screen.hint, typed && !value && local.rejected]}>
        {value
          ? ''
          : typed
            ? 'That is not a real date and time — check the day and the month.'
            : 'Leave blank if you do not know yet — you can add it later.'}
      </Text>
    </View>
  );
}

const local = StyleSheet.create({
  kickoff: { alignSelf: 'stretch' },
  rejected: { color: colours.danger },
  kickoffRow: { flexDirection: 'row', alignSelf: 'stretch' },
  dateInput: { flex: 1, marginRight: 8 },
  timeInput: { width: 104 },
});
