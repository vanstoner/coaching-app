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
import { Icon } from './controls/Icon';

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
  /**
   * #264 V2: a tick drawn as an icon, never "✓" as text (Barlow has none).
   * When given, true or false, its slot is always kept so nothing moves.
   */
  tick,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
  narrow?: boolean;
  compact?: boolean;
  wide?: boolean;
  tick?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected, ...(tick === undefined ? {} : { checked: tick }) }}
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      style={({ pressed }) => [
        local.chip,
        narrow && local.narrow,
        compact && local.compact,
        wide && local.wide,
        selected && local.selected,
        pressed && screen.buttonPressed,
      ]}
    >
      {tick === undefined ? (
        <Text style={[local.label, selected && local.labelOn]} numberOfLines={1}>
          {label}
        </Text>
      ) : (
        <View style={local.tickRow}>
          <View style={local.tickSlot}>{tick && <Icon name="check-bold" size={13} color={colours.ink} />}</View>
          <Text style={[local.label, local.tickLabel, selected && local.labelOn]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
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
    // #264 V3, V4: the edge reads at 4.16:1 on this fill (the old line was 1.7:1).
    borderColor: colours.edge,
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
  selected: { backgroundColor: colours.accent },
  label: {
    // #264 V3: white whether chosen or not (the muted label was 4.45:1).
    color: colours.ink,
    fontSize: 15,
    fontWeight: '600',
    includeFontPadding: false,
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  labelOn: { color: colours.ink },
  tickRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  tickSlot: { width: 15, flexShrink: 0, alignItems: 'center' },
  tickLabel: { flex: 1, alignSelf: 'auto' },
  detail: {
    color: colours.inkMuted,
    fontSize: 11,
    includeFontPadding: false,
    alignSelf: 'stretch',
    textAlign: 'center',
    marginTop: 2,
  },
  detailOn: { color: colours.ink },
});
