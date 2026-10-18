/**
 * A choice a coach taps: a match length, halves or quarters, a shape.
 *
 * One component, because the fixture form and Settings offer the same choices
 * and a second copy is how the two drift apart — the fixture form got fixed
 * widths and Settings kept the old boxes that clipped.
 *
 * **Selection changes colour and nothing else.** Every metric is identical in
 * both states: a `fontWeight` flip makes Android re-measure late and clip the
 * last glyph, which shipped "50, 6, 7, 9" to a real phone.
 */

import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from './Text';

import { colours, screen, TOUCH_TARGET } from './theme';

export function Chip({
  label,
  /** The cue under the label, e.g. "7-a-side · 2 defence · 3 midfield · 1 attack". */
  detail,
  selected,
  onPress,
  /** For a row of numbers, where a full-width chip wastes the row. */
  narrow,
  /**
   * Narrower still, for a row of two-digit numbers that must fit one line:
   * the five match lengths (#223 AC8) at 56 + 8 each are 320dp, inside a
   * 360dp phone's 324dp pane, where `narrow` would push the fifth onto a
   * line of its own.
   */
  compact,
  /** For a chip whose label needs the room, e.g. a shape and its cue. */
  wide,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
  narrow?: boolean;
  compact?: boolean;
  wide?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        local.chip,
        narrow && local.narrow,
        compact && local.compact,
        wide && local.wide,
        selected && local.selected,
        pressed && screen.buttonPressed,
      ]}
    >
      <Text style={[local.label, selected && local.labelOn]} numberOfLines={1}>
        {label}
      </Text>
      {/* Two lines allowed on the cue: the box has a FIXED width, so wrapping
          is safe where sizing a box to its own text is not. */}
      {detail !== undefined && (
        <Text style={[local.detail, selected && local.detailOn]} numberOfLines={2}>
          {detail}
        </Text>
      )}
    </Pressable>
  );
}

/** A row of chips that wraps rather than squeezing them. */
export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={local.row}>{children}</View>;
}

const local = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'stretch' },
  chip: {
    width: 108,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.pitchRaised,
    borderColor: colours.line,
    borderWidth: 1,
    borderRadius: 10,
    minHeight: TOUCH_TARGET,
    paddingVertical: 10,
    paddingHorizontal: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  narrow: { width: 66 },
  compact: { width: 56 },
  wide: { width: 164 },
  selected: { backgroundColor: colours.accent, borderColor: colours.accent },
  label: {
    color: colours.inkMuted,
    fontSize: 15,
    fontWeight: '600',
    includeFontPadding: false,
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  labelOn: { color: colours.ink },
  detail: {
    color: colours.inkFaint,
    fontSize: 11,
    includeFontPadding: false,
    alignSelf: 'stretch',
    textAlign: 'center',
    marginTop: 2,
  },
  detailOn: { color: colours.ink },
});
