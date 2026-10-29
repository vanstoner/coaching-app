/**
 * #254: the pitch surface, condition and referee rows (Dee's prototype). One
 * component for the fixture form and the "Pitch and referee" sheet, so the
 * two cannot drift apart. Tapping the chosen chip clears it, as Competition
 * does.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from './Text';

import {
  CONDITIONS,
  REFEREE_MAX_LENGTH,
  SURFACES,
  conditionOf,
  pitchAndRefereeLine,
  pitchTags,
  surfaceOf,
  type PitchCondition,
  type PitchSurface,
} from '../app/pitch';
import { ActionSheet } from './Sheet';
import { Chip, ChipRow } from './Chip';
import { colours, screen } from './theme';

export interface PitchValue {
  surface: PitchSurface | null;
  condition: PitchCondition | null;
  referee: string;
}

/** Surface and condition, the rows that sit after Competition. */
export function PitchChips({ value, onChange }: { value: PitchValue; onChange: (v: PitchValue) => void }) {
  return (
    <>
      <Text style={screen.fieldLabel}>Surface</Text>
      <ChipRow>
        {SURFACES.map((s) => (
          <Chip
            key={s.value}
            label={s.label}
            selected={value.surface === s.value}
            onPress={() => onChange({ ...value, surface: value.surface === s.value ? null : s.value })}
          />
        ))}
      </ChipRow>
      <Text style={screen.fieldLabel}>Pitch condition</Text>
      <ChipRow>
        {CONDITIONS.map((c) => (
          <Chip
            key={c.value}
            label={c.label}
            selected={value.condition === c.value}
            onPress={() => onChange({ ...value, condition: value.condition === c.value ? null : c.value })}
          />
        ))}
      </ChipRow>
    </>
  );
}

/** The referee, which sits after Kick-off: this phone and the coach's backup only (Q2). */
export function RefereeField({ value, onChange }: { value: PitchValue; onChange: (v: PitchValue) => void }) {
  return (
    <>
      <Text style={screen.fieldLabel}>Referee</Text>
      <TextInput
        style={screen.input}
        value={value.referee}
        onChangeText={(referee) => onChange({ ...value, referee })}
        placeholder="Referee's name (stays on this phone)"
        placeholderTextColor={colours.inkFaint}
        autoCapitalize="words"
        autoCorrect={false}
        maxLength={REFEREE_MAX_LENGTH}
        returnKeyType="done"
      />
      <Text style={screen.hint}>
        Optional. Kept on this phone and in your own backup; never in a shared picture or the minutes file.
      </Text>
    </>
  );
}

/** The card's tag line (Dee): outlined tags, "Poor pitch" in amber; nothing when neither is set. */
export function PitchTags({ surface, condition }: { surface: unknown; condition: unknown }) {
  const tags = pitchTags(surface, condition);
  if (tags.length === 0) return null;
  return (
    <View style={local.tags}>
      {tags.map((t) => (
        <Text key={t} style={[local.tag, t === 'Poor pitch' && local.poor]} numberOfLines={1}>
          {t}
        </Text>
      ))}
    </View>
  );
}

/**
 * #254 AC12, AC20: the "Pitch and referee" row on a match's own screens
 * (pre-match, between periods, the summary, the analysis). It shows what is
 * set; a tap opens the same rows as the form, saved on Done, with no note
 * (Q4). `onChange` null: read-only (a match from the record, AC14).
 */
export function PitchAndReferee({
  match,
  onChange,
}: {
  match: { surface?: unknown; condition?: unknown; referee?: string };
  onChange: ((v: PitchValue) => void) | null;
}) {
  const line = pitchAndRefereeLine(match.surface, match.condition, match.referee);
  const [draft, setDraft] = useState<PitchValue | null>(null);
  if (!onChange) return line ? <Text style={screen.hint}>{line}</Text> : null;
  const open = () =>
    setDraft({ surface: surfaceOf(match.surface), condition: conditionOf(match.condition), referee: match.referee ?? '' });
  return (
    <>
      <Pressable onPress={open} style={screen.linkHit} accessibilityRole="button">
        <Text style={screen.link}>{line ? `${line} ›` : 'Add pitch and referee ›'}</Text>
      </Pressable>
      <ActionSheet
        visible={draft !== null}
        title="Pitch and referee"
        closeLabel="Done"
        onClose={() => {
          if (draft) onChange(draft);
          setDraft(null);
        }}
      >
        {draft && (
          <>
            <PitchChips value={draft} onChange={setDraft} />
            <RefereeField value={draft} onChange={setDraft} />
          </>
        )}
      </ActionSheet>
    </>
  );
}

const local = StyleSheet.create({
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'stretch', marginTop: 4 },
  tag: {
    color: colours.inkMuted,
    fontSize: 13,
    includeFontPadding: false,
    borderColor: colours.line,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginRight: 6,
    marginTop: 2,
  },
  poor: { color: colours.warn, borderColor: colours.warn },
});
