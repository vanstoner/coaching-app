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
import {
  KICKOFF_TIMES,
  dayLabel,
  daysInMonth,
  kickoffIso,
  monthLabel,
  sameDay,
  startOfDay,
  toTimeInput,
  upcomingMonths,
  upcomingSaturdays,
} from '../app/kickoff';
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
 * Kick-off, picked — #80 (PO ruling 2026-10-03: option A).
 *
 * > *"entering fixture date pain, needs a picker or restricted dropdowns"*
 *
 * The next 8 Saturdays and the usual kick-off times, one tap each. "Other
 * date" opens a month and a day, still without a keyboard. No dependency: the
 * rules are tested in `src/app/kickoff.ts`.
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
  const [other, setOther] = useState(false);
  const [now] = useState(() => new Date());
  const saturdays = upcomingSaturdays(now);
  // AC4: a saved day that is not one of the coming Saturdays still shows,
  // selected, rather than as a blank.
  const offList = day !== null && !saturdays.some((s) => sameDay(s, day));
  const [month, setMonth] = useState<[number, number]>(() =>
    day ? [day.getFullYear(), day.getMonth()] : [now.getFullYear(), now.getMonth()]
  );
  const times = KICKOFF_TIMES.includes(time) ? KICKOFF_TIMES : [...KICKOFF_TIMES, time].sort();

  const pick = (d: Date | null, t: string) => {
    setDay(d);
    setTime(t);
    onChange(d ? kickoffIso(d, t) : null);
  };

  return (
    <View style={local.kickoff}>
      <ChipRow>
        {saturdays.map((s) => (
          <Chip
            key={s.toISOString()}
            label={dayLabel(s)}
            selected={day !== null && sameDay(s, day)}
            onPress={() => {
              setOther(false);
              pick(day !== null && sameDay(s, day) ? null : s, time);
            }}
          />
        ))}
        {offList && <Chip label={dayLabel(day!)} selected onPress={() => setOther(true)} />}
        <Chip label="Other date" selected={other} onPress={() => setOther(!other)} />
      </ChipRow>

      {other && (
        <>
          <Text style={screen.hint}>Month, then day.</Text>
          <ChipRow>
            {upcomingMonths(now).map(([y, m]) => (
              <Chip
                key={`${y}-${m}`}
                label={monthLabel(y, m)}
                selected={month[0] === y && month[1] === m}
                onPress={() => setMonth([y, m])}
              />
            ))}
          </ChipRow>
          <ChipRow>
            {Array.from({ length: daysInMonth(month[0], month[1]) }, (_, i) => {
              const d = new Date(month[0], month[1], i + 1);
              return (
                <Chip
                  key={i}
                  label={`${i + 1}`}
                  selected={day !== null && sameDay(d, day)}
                  onPress={() => {
                    pick(d, time);
                    setOther(false);
                  }}
                  narrow
                />
              );
            })}
          </ChipRow>
        </>
      )}

      <Text style={screen.hint}>Kick-off time</Text>
      <ChipRow>
        {times.map((t) => (
          <Chip key={t} label={t} selected={t === time} onPress={() => pick(day, t)} narrow />
        ))}
      </ChipRow>

      <Text style={screen.hint}>
        {day
          ? `${dayLabel(day)} at ${time}`
          : 'No date yet — you can add it later.'}
      </Text>
    </View>
  );
}

const local = StyleSheet.create({
  kickoff: { alignSelf: 'stretch' },
});
