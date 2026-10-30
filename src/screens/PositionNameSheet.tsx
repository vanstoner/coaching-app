/**
 * Rename a position for this match — #166, as in the mock Rob approved.
 *
 * Tap a gold position name on the Plan or lineup pitch; this rises with the
 * name in a text box, suggestions under it, the hint that a name is a cue and
 * never a child, and "Use these names for new matches", off unless ticked.
 * Never offered on the live clock (ruling Q1).
 *
 * The rules are `src/app/positionNames.ts`, tested there. This draws them.
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from './Text';

import type { Format, UUID } from '../types/index';
import {
  POSITION_NAME_HINT,
  POSITION_NAME_MAX,
  nameSuggestions,
  renameScopeHint,
} from '../app/positionNames';
import { FormSheet, SegmentedRow } from './controls';
import { colours, screen, TOUCH_TARGET } from './theme';

/** What a screen that may rename positions is handed (#166). */
export interface PositionNaming {
  /** Rename one. The reason when refused, else null. */
  onRename: (positionId: UUID, typed: string, keep: boolean) => string | null;
  /** Reset names: the shape's standard names, for this match. */
  onReset: () => void;
  /** Whether "Use these names for new matches" can apply. */
  offerKeep: boolean;
}

export function PositionNameSheet({
  format,
  positionId,
  offerKeep,
  onSave,
  onClose,
}: {
  /** The format of THIS match. */
  format: Format;
  /** The position being renamed; null when the sheet is closed. */
  positionId: UUID | null;
  /** Whether "Use these names for new matches" can apply (same shape as the default). */
  offerKeep: boolean;
  /** Save it. The reason when refused, else null. */
  onSave: (positionId: UUID, typed: string, keep: boolean) => string | null;
  onClose: () => void;
}) {
  const position = format.positions.find((p) => p.id === positionId) ?? null;
  const [typed, setTyped] = useState('');
  const [keep, setKeep] = useState(false);
  const [problem, setProblem] = useState('');

  // Fresh each time it opens: off unless ticked (ruling Q2), every time.
  useEffect(() => {
    setTyped(position?.label ?? '');
    setKeep(false);
    setProblem('');
  }, [positionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    if (!position) return;
    const refused = onSave(position.id, typed, keep);
    if (refused) setProblem(refused);
    else onClose();
  };

  return (
    // #264: a sheet with Cancel and Save; a tap outside is Cancel and renames nothing.
    <FormSheet
      visible={position !== null}
      title={position ? `Rename ${position.label}` : ''}
      onCancel={onClose}
      onSave={save}
    >
      {position && (
        <>
          <Text style={local.line}>{renameScopeHint(position.unit)}</Text>
          <TextInput
            style={screen.input}
            value={typed}
            onChangeText={(t) => {
              setTyped(t);
              setProblem('');
            }}
            maxLength={POSITION_NAME_MAX}
            autoCorrect={false}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={save}
            placeholder="Empty puts the usual name back"
            placeholderTextColor={colours.inkFaint}
            accessibilityLabel="Position name"
          />
          <View style={local.chips}>
            {nameSuggestions(format, position.id).map((s) => (
              <Pressable
                key={s}
                onPress={() => {
                  setTyped(s);
                  setProblem('');
                }}
                accessibilityRole="button"
                style={({ pressed }) => [local.chip, pressed && screen.buttonPressed]}
              >
                <Text style={local.chipLabel} numberOfLines={1}>
                  {s}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={local.line}>{POSITION_NAME_HINT}</Text>
          {problem !== '' && <Text style={local.problem}>{problem}</Text>}
          {/* #264: the bespoke tick box is a segmented choice. */}
          {offerKeep && (
            <SegmentedRow
              label="Use these names for new matches"
              stacked
              options={[
                { value: false, label: 'No' },
                { value: true, label: 'Yes' },
              ]}
              value={keep}
              onChange={(k) => k !== null && setKeep(k)}
            />
          )}
        </>
      )}
    </FormSheet>
  );
}

const local = StyleSheet.create({
  line: {
    alignSelf: 'stretch',
    color: colours.inkMuted,
    fontSize: 14,
    includeFontPadding: false,
    marginVertical: 8,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'stretch', marginTop: 10 },
  // A fixed width, never sized to its own text (theme.ts): two to a row.
  chip: {
    width: 150,
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colours.edge,
    borderRadius: TOUCH_TARGET / 2,
    paddingHorizontal: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  chipLabel: {
    color: colours.ink,
    fontSize: 15,
    includeFontPadding: false,
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  problem: {
    alignSelf: 'stretch',
    color: colours.warn,
    fontSize: 14,
    includeFontPadding: false,
    marginBottom: 8,
  },
});
