/**
 * Rows, actions, the Main button and the way back — #264 V7, V8, V24 to V27,
 * V31 (Dee's One system, approved by Rob 29 Oct; Bea's criteria).
 *
 * - **Row ›**: label left, the current value right in muted text, a chevron
 *   on the far right that never turns. It opens a sheet or another screen.
 * - **Action**: mint text, no underline, no chevron. It acts on the tap.
 * - **Main button**: green, full width, at most one per screen, placed by the
 *   screen at the bottom above the tab bar.
 * - **Field row**: label left, text right, on one row.
 * - **Back or out**: top left, muted, a chevron then the destination. It never
 *   changes anything.
 *
 * Every one has a 48 dp touch (V1), a role and a name (V6), and nothing
 * changes weight or size between states (V5, the theme.ts rule).
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Text } from '../Text';

import { colours, screen, TOUCH_TARGET } from '../theme';
import { Icon } from './Icon';

/** Row › (V7, V8): opens a sheet or another screen. */
export function RowNav({
  label,
  value,
  detail,
  onPress,
  disabled = false,
  accessibilityLabel,
  first = false,
}: {
  label: string;
  /** The current value, muted, on the right. */
  value?: string;
  /** A light line under the label (the planned sub, a past season's count). */
  detail?: string;
  onPress: () => void;
  disabled?: boolean;
  /** Defaults to "label, value". Keep any name a store selector matches. */
  accessibilityLabel?: string;
  /** The first row of a group draws its top hairline too. */
  first?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={accessibilityLabel ?? [label, value, detail].filter(Boolean).join(', ')}
      style={({ pressed }) => [rows.row, first && rows.first, pressed && rows.pressed, disabled && rows.disabled]}
    >
      <View style={rows.labelCol}>
        <Text style={rows.label} numberOfLines={2}>
          {label}
        </Text>
        {detail ? (
          <Text style={rows.detail} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={rows.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      <Icon name="chevron-right" size={22} color={colours.back} style={rows.chevron} />
    </Pressable>
  );
}

/** Action (V24): mint text that acts on the tap. */
export function Action({
  label,
  onPress,
  disabled = false,
  align = 'left',
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  align?: 'left' | 'center' | 'right';
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [
        rows.action,
        align === 'center' && rows.alignCenter,
        align === 'right' && rows.alignRight,
        pressed && rows.pressed,
      ]}
    >
      <Text style={[rows.actionText, disabled && rows.actionDisabled]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A row of Actions, spread across the width, as the prototype draws Use plan · Use suggestion. */
export function ActionRow({ children }: { children: ReactNode }) {
  return <View style={rows.actionRow}>{children}</View>;
}

/** Main button (V26): the screen's one job. The screen pins it at the bottom. */
export function MainButton({
  label,
  onPress,
  disabled = false,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [rows.main, disabled && rows.mainDisabled, pressed && rows.pressed]}
    >
      <Text style={rows.mainText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Where a Main button sits: under the scroll, above the tab bar. */
export function MainFoot({ children }: { children: ReactNode }) {
  return <View style={rows.foot}>{children}</View>;
}

/** Field row (V27): label left, text right. */
export function FieldRow({ label, first = false, ...input }: { label: string; first?: boolean } & TextInputProps) {
  return (
    <View style={[rows.row, first && rows.first]}>
      <Text style={rows.fieldLabel} numberOfLines={1}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colours.inkFaint}
        {...input}
        style={[rows.field, input.style]}
      />
    </View>
  );
}

/**
 * Back or out (V31): top left, muted, a chevron then where it goes. Its
 * accessible name is "Back to *destination*" unless given, which keeps the
 * store screenshot selectors.
 */
export function BackLink({
  label,
  onPress,
  accessibilityLabel,
  chevron = true,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  /** Cancel on a form has no chevron. */
  chevron?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (chevron ? `Back to ${label}` : label)}
      style={({ pressed }) => [rows.back, pressed && rows.pressed]}
    >
      {chevron && <Icon name="chevron-left" size={22} color={colours.back} />}
      <Text style={rows.backText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The top bar: Back or out on the left, the title in the middle, and a right
 * slot (a count, or ✓ Saved on the Plan). Left and right take equal room so
 * the title stays centred.
 */
export function TopBar({ back, title, right }: { back?: ReactNode; title?: string; right?: ReactNode }) {
  return (
    <View style={rows.bar}>
      <View style={rows.barSide}>{back}</View>
      <Text style={rows.barTitle} numberOfLines={1} accessibilityRole="header">
        {title ?? ''}
      </Text>
      <View style={[rows.barSide, rows.barRight]}>{right}</View>
    </View>
  );
}

/** A group label above rows: small capitals, muted. Content, not a control. */
export function GroupLabel({ children }: { children: string }) {
  return <Text style={screen.fieldLabel}>{children}</Text>;
}

export const rows = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    minHeight: TOUCH_TARGET,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colours.hair,
  },
  first: { borderTopWidth: 1, borderTopColor: colours.hair },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
  labelCol: { flex: 1, minWidth: 0, paddingRight: 8 },
  label: { color: colours.ink, fontSize: 16, includeFontPadding: false },
  detail: { color: colours.inkMuted, fontSize: 13, includeFontPadding: false, marginTop: 2 },
  value: {
    flexShrink: 1,
    maxWidth: '55%',
    color: colours.back,
    fontSize: 15,
    includeFontPadding: false,
    textAlign: 'right',
  },
  chevron: { width: 24, marginLeft: 2, flexShrink: 0 },
  action: { minHeight: TOUCH_TARGET, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 4 },
  alignCenter: { alignSelf: 'center' },
  alignRight: { alignSelf: 'flex-end' },
  actionText: { color: colours.action, fontSize: 16, fontWeight: '600', includeFontPadding: false },
  actionDisabled: { color: colours.inkFaint },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    borderBottomWidth: 1,
    borderBottomColor: colours.hair,
  },
  main: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.main,
    borderColor: colours.edge,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: TOUCH_TARGET + 4,
    paddingVertical: 14,
  },
  mainDisabled: { opacity: 0.5 },
  mainText: {
    alignSelf: 'stretch',
    textAlign: 'center',
    color: colours.ink,
    fontSize: 18,
    fontWeight: '600',
    includeFontPadding: false,
  },
  foot: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 10, alignSelf: 'stretch' },
  fieldLabel: { color: colours.ink, fontSize: 16, includeFontPadding: false, flexShrink: 0, paddingRight: 12 },
  field: {
    flex: 1,
    minWidth: 0,
    fontFamily: 'Barlow-Regular',
    color: colours.ink,
    fontSize: 16,
    includeFontPadding: false,
    textAlign: 'right',
    paddingVertical: 10,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: TOUCH_TARGET,
    paddingRight: 8,
  },
  backText: { color: colours.back, fontSize: 16, includeFontPadding: false },
  bar: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', minHeight: TOUCH_TARGET },
  barSide: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  barRight: { justifyContent: 'flex-end' },
  barTitle: {
    flexShrink: 1,
    maxWidth: '50%',
    textAlign: 'center',
    color: colours.ink,
    fontSize: 17,
    fontWeight: '700',
    includeFontPadding: false,
  },
});
