/**
 * #254: the pitch surface, condition and referee rows (Dee's prototype). One
 * component for the fixture form and the "Pitch and referee" sheet, so the
 * two cannot drift apart. Tapping the chosen segment clears it, as Competition
 * does (#264 V13).
 *
 * #264 C3, Rob's Q2: the sheet has Cancel and Save, and **only Save writes**.
 * It used to commit its draft in `onClose`, so Done, a tap outside and Back
 * all wrote to the match; now a tap outside, Cancel and Android Back write
 * nothing (`sheetCommit`), as every other sheet.
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';

import {
  CONDITIONS,
  REFEREE_MAX_LENGTH,
  SURFACES,
  conditionOf,
  keepUnknown,
  pitchAndRefereeLine,
  pitchTags,
  surfaceOf,
  type PitchCondition,
  type PitchSurface,
} from '../app/pitch';
import { sheetCommit } from '../app/saveState';
import { FieldRow, FormSheet, RowNav, SegmentedRow } from './controls';
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
      {/* Stacked: the whole row width under the label, so "Excellent" fits at 360 dp (QA D3). */}
      <SegmentedRow
        label="Surface"
        stacked
        options={SURFACES}
        value={value.surface}
        allowClear
        onChange={(surface) => onChange({ ...value, surface })}
      />
      <SegmentedRow
        label="Condition"
        stacked
        options={CONDITIONS}
        value={value.condition}
        allowClear
        onChange={(condition) => onChange({ ...value, condition })}
      />
    </>
  );
}

/** The referee, which sits after Kick-off: this phone and the coach's backup only (Q2). */
export function RefereeField({
  value,
  onChange,
  autoFocus = false,
}: {
  value: PitchValue;
  onChange: (v: PitchValue) => void;
  /** The sheet opens with the keyboard on this field (#264 V32). */
  autoFocus?: boolean;
}) {
  return (
    <>
      <FieldRow
        label="Referee"
        value={value.referee}
        onChangeText={(referee) => onChange({ ...value, referee })}
        placeholder="Optional"
        autoCapitalize="words"
        autoCorrect={false}
        maxLength={REFEREE_MAX_LENGTH}
        returnKeyType="done"
        autoFocus={autoFocus}
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
 * set; a tap opens the same rows as the form in a sheet, saved on Save, with
 * no note (Q4). `onChange` null: read-only (a match from the record, AC14).
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
      <RowNav label="Pitch and referee" value={line ?? 'Add'} onPress={open} />
      <FormSheet
        visible={draft !== null}
        title="Pitch and referee"
        onCancel={() => setDraft(null)}
        onSave={() => {
          const saved = draft && sheetCommit('save', draft);
          if (saved) onChange(keepUnknown(match, saved));
          setDraft(null);
        }}
      >
        {draft && (
          <>
            <PitchChips value={draft} onChange={setDraft} />
            <RefereeField value={draft} onChange={setDraft} autoFocus />
          </>
        )}
      </FormSheet>
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
