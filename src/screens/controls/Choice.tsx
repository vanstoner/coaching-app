/**
 * Choosing — #264 V12, V13, V17 (Dee's One system, approved by Rob 29 Oct).
 *
 * - **Segmented**: 2 to 5 short options in one row; 32 dp to look at, 48 to
 *   touch. The chosen segment fills green **and** shows a tick in a slot that
 *   is always reserved, so colour is never the only signal and nothing moves.
 *   Each segment takes an equal share of the row: a box never sized to its
 *   own text (the theme.ts rule).
 * - **Stepper**: a −|+ pair, each half 44 × 30 to look at and 48 to touch.
 *   What a press does is the screen's rule (`plannedSubSheet.ts`, the Plan's
 *   15 s step); this only draws it.
 */

import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';

import { colours, screen, TOUCH_TARGET } from '../theme';
import { Icon } from './Icon';

export interface Option<T> {
  value: T;
  label: string;
  /** Read out instead of the label, e.g. "50 minutes". */
  accessibilityLabel?: string;
}

/** A row of segments. With `allowClear`, tapping the chosen one clears it (V13). */
export function Segmented<T>({
  options,
  value,
  onChange,
  allowClear = false,
  name,
}: {
  options: readonly Option<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  allowClear?: boolean;
  /** What is being chosen, read before each option: "Periods, Quarters". */
  name?: string;
}) {
  return (
    <View style={choice.segRow} accessibilityRole="radiogroup" accessibilityLabel={name}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(on ? (allowClear ? null : o.value) : o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, checked: on }}
            accessibilityLabel={[name, o.accessibilityLabel ?? o.label].filter(Boolean).join(', ')}
            style={({ pressed }) => [choice.segHit, pressed && choice.pressed]}
          >
            <View
              style={[
                choice.seg,
                i === 0 && choice.segFirst,
                i === options.length - 1 && choice.segLast,
                i > 0 && choice.segJoined,
                on && choice.segOn,
              ]}
            >
              <View style={choice.tickSlot}>{on && <Icon name="check-bold" size={13} color={colours.ink} />}</View>
              <Text style={choice.segText} numberOfLines={1}>
                {o.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A labelled segmented row. Inline (label left) for short sets; `stacked`
 * puts the label above, for a set that needs the whole width.
 */
export function SegmentedRow<T>({
  label,
  stacked = false,
  ...props
}: {
  label: string;
  stacked?: boolean;
  options: readonly Option<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  allowClear?: boolean;
}) {
  return (
    <View style={[choice.labelled, stacked && choice.stacked]}>
      <Text style={stacked ? choice.stackedLabel : choice.label} numberOfLines={1}>
        {label}
      </Text>
      <View style={stacked ? choice.fullWidth : choice.segWrap}>
        <Segmented name={label} {...props} />
      </View>
    </View>
  );
}

/** The compact −|+ stepper (V17). */
export function Stepper({
  onMinus,
  onPlus,
  minusLabel,
  plusLabel,
  minusDisabled = false,
}: {
  onMinus: () => void;
  onPlus: () => void;
  /** "30 seconds earlier". */
  minusLabel: string;
  /** "30 seconds later". */
  plusLabel: string;
  minusDisabled?: boolean;
}) {
  return (
    <View style={choice.stepper}>
      <Pressable
        onPress={onMinus}
        disabled={minusDisabled}
        accessibilityRole="button"
        accessibilityLabel={minusLabel}
        accessibilityState={{ disabled: minusDisabled }}
        style={({ pressed }) => [choice.stepHit, pressed && choice.pressed]}
      >
        <View style={[choice.stepHalf, choice.stepLeft, minusDisabled && choice.stepDisabled]}>
          <Icon name="minus" size={20} color={colours.ink} />
        </View>
      </Pressable>
      <Pressable
        onPress={onPlus}
        accessibilityRole="button"
        accessibilityLabel={plusLabel}
        style={({ pressed }) => [choice.stepHit, pressed && choice.pressed]}
      >
        <View style={[choice.stepHalf, choice.stepRight]}>
          <Icon name="plus" size={20} color={colours.ink} />
        </View>
      </Pressable>
    </View>
  );
}

const choice = StyleSheet.create({
  pressed: { opacity: 0.6 },
  segRow: { flexDirection: 'row', alignSelf: 'stretch' },
  segHit: { flex: 1, minHeight: TOUCH_TARGET, justifyContent: 'center' },
  seg: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: colours.edge,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderRightWidth: 1,
    paddingHorizontal: 4,
  },
  segFirst: { borderLeftWidth: 1, borderTopLeftRadius: 7, borderBottomLeftRadius: 7 },
  segLast: { borderTopRightRadius: 7, borderBottomRightRadius: 7 },
  segJoined: {},
  segOn: { backgroundColor: colours.main },
  tickSlot: { width: 15, alignItems: 'center', flexShrink: 0 },
  segText: {
    flexShrink: 1,
    color: colours.ink,
    fontSize: 15,
    fontWeight: '600',
    includeFontPadding: false,
    textAlign: 'center',
  },
  labelled: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    minHeight: TOUCH_TARGET,
    borderBottomWidth: 1,
    borderBottomColor: colours.hair,
  },
  stacked: { flexDirection: 'column', alignItems: 'stretch', paddingBottom: 4 },
  label: { color: colours.ink, fontSize: 16, includeFontPadding: false, flexShrink: 0, width: 104, paddingRight: 8 },
  stackedLabel: { ...screen.fieldLabel, marginTop: 10 },
  segWrap: { flex: 1, minWidth: 0 },
  fullWidth: { alignSelf: 'stretch' },
  stepper: { flexDirection: 'row', flexShrink: 0 },
  stepHit: { minHeight: TOUCH_TARGET, width: 48, alignItems: 'center', justifyContent: 'center' },
  stepHalf: {
    width: 44,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: colours.edge,
    borderWidth: 1,
  },
  stepLeft: { borderTopLeftRadius: 7, borderBottomLeftRadius: 7, marginRight: -2 },
  stepRight: { borderTopRightRadius: 7, borderBottomRightRadius: 7, marginLeft: -2 },
  stepDisabled: { opacity: 0.4 },
});
