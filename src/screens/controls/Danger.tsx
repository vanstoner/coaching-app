/**
 * Danger and Undo — #264 V25, V33; #263 AC11 to AC13.
 *
 * **Danger** is for what cannot be undone: danger-coloured text with a
 * warning sign. The first tap shows a plain sentence of what goes, then
 * "Yes, …" and "Keep it". It lives in the Danger zone, and (Rob, Q1(a)) by
 * the two deletes that sit next to what they delete: an unplayed fixture and
 * the test matches. Remove a player, Archive, Retire and Void can be undone,
 * so they are not Danger.
 *
 * **UndoToast**: after an Action that changes what the coach can't see (Use
 * plan, Use suggestion, Remove a player), a toast with Undo. Undo runs the
 * existing inverse the caller gives; it never deletes or rewrites a record
 * (invariant 5).
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';

import { colours, TOUCH_TARGET } from '../theme';
import { Icon } from './Icon';

/** A row that opens something dangerous elsewhere (Remove *team* asks for its name). */
export function DangerRow({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [danger.row, pressed && danger.pressed]}
    >
      <Icon name="alert-outline" size={20} color={colours.danger} style={danger.icon} />
      <Text style={danger.label} numberOfLines={2}>
        {label}
      </Text>
      <Icon name="chevron-right" size={22} color={colours.danger} />
    </Pressable>
  );
}

/** Two taps: the label, then a sentence of what goes, "Yes, …" and "Keep it". */
export function Danger({
  label,
  confirmLabel,
  warning,
  onConfirm,
  keepLabel = 'Keep it',
  onArmed,
}: {
  label: string;
  confirmLabel: string;
  /** What goes, in plain words; absent where the confirm says it already. */
  warning?: string;
  onConfirm: () => void;
  keepLabel?: string;
  /** Told when the confirm opens or closes, for a caller that must know. */
  onArmed?: (armed: boolean) => void;
}) {
  const [armed, setArmed] = useState(false);
  const arm = (on: boolean) => {
    setArmed(on);
    onArmed?.(on);
  };
  if (!armed) {
    return (
      <Pressable
        onPress={() => arm(true)}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [danger.row, pressed && danger.pressed]}
      >
        <Icon name="alert-outline" size={20} color={colours.danger} style={danger.icon} />
        <Text style={danger.label} numberOfLines={2}>
          {label}
        </Text>
      </Pressable>
    );
  }
  return (
    <View>
      {warning ? <Text style={danger.warning}>{warning}</Text> : null}
      <Pressable
        onPress={onConfirm}
        accessibilityRole="button"
        accessibilityLabel={confirmLabel}
        style={({ pressed }) => [danger.row, pressed && danger.pressed]}
      >
        <Icon name="alert" size={20} color={colours.danger} style={danger.icon} />
        <Text style={danger.label} numberOfLines={2}>
          {confirmLabel}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => arm(false)}
        accessibilityRole="button"
        accessibilityLabel={keepLabel}
        style={({ pressed }) => [danger.row, pressed && danger.pressed]}
      >
        <Text style={danger.keep}>{keepLabel}</Text>
      </Pressable>
    </View>
  );
}

/** How long an Undo toast stays. */
export const UNDO_TOAST_MS = 6_000;

/**
 * A toast with Undo (V25). Shown while `message` is set; it goes by itself
 * after a few seconds, or when Undo is tapped.
 */
export function UndoToast({
  message,
  onUndo,
  onDone,
}: {
  message: string | null;
  onUndo?: () => void;
  onDone: () => void;
}) {
  useEffect(() => {
    if (message === null) return;
    const t = setTimeout(onDone, UNDO_TOAST_MS);
    return () => clearTimeout(t);
  }, [message, onDone]);
  if (message === null) return null;
  return (
    <View style={danger.toast} accessibilityLiveRegion="polite">
      <Text style={danger.toastText} numberOfLines={2}>
        {message}
      </Text>
      {onUndo && (
        <Pressable
          onPress={() => {
            onUndo();
            onDone();
          }}
          accessibilityRole="button"
          accessibilityLabel="Undo"
          style={({ pressed }) => [danger.undo, pressed && danger.pressed]}
        >
          <Text style={danger.undoText}>Undo</Text>
        </Pressable>
      )}
    </View>
  );
}

const danger = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    minHeight: TOUCH_TARGET,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colours.hair,
  },
  pressed: { opacity: 0.6 },
  icon: { width: 26, flexShrink: 0 },
  label: { flex: 1, minWidth: 0, color: colours.danger, fontSize: 16, includeFontPadding: false },
  keep: { color: colours.back, fontSize: 16, includeFontPadding: false },
  warning: { color: colours.saved, fontSize: 14, includeFontPadding: false, marginTop: 8, marginBottom: 4 },
  toast: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colours.toast,
    borderRadius: 10,
    paddingLeft: 14,
    paddingRight: 6,
    minHeight: TOUCH_TARGET,
  },
  toastText: { flex: 1, minWidth: 0, color: colours.pitch, fontSize: 15, fontWeight: '600', includeFontPadding: false },
  undo: { minHeight: TOUCH_TARGET, minWidth: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  undoText: { color: colours.pitch, fontSize: 15, fontWeight: '700', includeFontPadding: false },
});
