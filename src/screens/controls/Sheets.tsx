/**
 * Sheets — #264 V14 to V16, V30, V32.
 *
 * A sheet rises from the bottom: **Cancel** top-left, the title in the middle,
 * **Save** top-right. A tap outside, Cancel or Android Back writes **nothing**
 * (`sheetCommit`): only Save does. That is `Sheet.tsx`'s own contract, which
 * the Pitch and referee sheet broke by saving on close (C3).
 *
 * - **FormSheet**: the general one, for a form or a note (Rename, a fill-in,
 *   a correction). Its Save is off until the caller says the draft is valid.
 * - **ListSheet**: a list with a tick. Single: tapping a line picks it and
 *   closes, no Save. Multi (Here today): each line its own tick, then Save.
 * - **LeaveAsk**: "Leave without saving this *thing*?", Keep editing or Leave
 *   without saving (V30).
 *
 * A Modal is its own window, drawn edge to edge on Android, so each pads
 * itself with the safe-area insets (#174), and pads for the keyboard on both
 * platforms.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../Text';

import { CONTENT_MAX_WIDTH, colours, TOUCH_TARGET } from '../theme';
import { Icon } from './Icon';

export function FormSheet({
  visible,
  title,
  onCancel,
  onSave,
  saveLabel = 'Save',
  saveDisabled = false,
  children,
}: {
  visible: boolean;
  title: string;
  /** Cancel, a tap outside and Android Back: nothing is written. */
  onCancel: () => void;
  /** Absent for a single-choice list, which picks on the tap. */
  onSave?: () => void;
  saveLabel?: string;
  saveDisabled?: boolean;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={sheet.flex} behavior="padding">
        <Pressable
          style={sheet.scrim}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Close without saving"
        >
          <Pressable style={[sheet.sheet, { paddingBottom: 16 + insets.bottom }]} onPress={() => {}}>
            {visible && (
              <>
                <View style={sheet.head}>
                  <View style={sheet.side}>
                    <Pressable
                      onPress={onCancel}
                      accessibilityRole="button"
                      style={({ pressed }) => [sheet.headHit, pressed && sheet.pressed]}
                    >
                      <Text style={sheet.cancel}>Cancel</Text>
                    </Pressable>
                  </View>
                  <Text style={sheet.title} numberOfLines={1} accessibilityRole="header">
                    {title}
                  </Text>
                  <View style={[sheet.side, sheet.sideRight]}>
                    {onSave && (
                      <Pressable
                        onPress={onSave}
                        disabled={saveDisabled}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: saveDisabled }}
                        style={({ pressed }) => [sheet.headHit, sheet.headHitRight, pressed && sheet.pressed]}
                      >
                        <Text style={[sheet.save, saveDisabled && sheet.saveOff]}>{saveLabel}</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
                <ScrollView style={sheet.body} keyboardShouldPersistTaps="handled">
                  {children}
                </ScrollView>
              </>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** One line of a list sheet: a tick on the chosen line (V16). */
export function CheckLine({
  label,
  detail,
  checked,
  onPress,
  multi = false,
}: {
  label: string;
  detail?: string;
  checked: boolean;
  onPress: () => void;
  multi?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked, selected: checked }}
      accessibilityLabel={[label, detail].filter(Boolean).join(', ')}
      style={({ pressed }) => [sheet.line, pressed && sheet.pressed]}
    >
      <View style={sheet.lineWords}>
        <Text style={[sheet.lineLabel, checked && sheet.lineOn]} numberOfLines={1}>
          {label}
        </Text>
        {detail ? (
          <Text style={sheet.lineDetail} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      <View style={sheet.tickSlot}>{checked && <Icon name="check-bold" size={20} color={colours.action} />}</View>
    </Pressable>
  );
}

export interface ListItem<T> {
  value: T;
  label: string;
  detail?: string;
}

/** Single-choice list sheet (V14): tap a line to pick it and close. */
export function ListSheet<T>({
  visible,
  title,
  items,
  value,
  onPick,
  onCancel,
  footer,
}: {
  visible: boolean;
  title: string;
  items: readonly ListItem<T>[];
  value: T | null;
  onPick: (value: T) => void;
  onCancel: () => void;
  /** A line under the list, e.g. what a choice changes. */
  footer?: ReactNode;
}) {
  return (
    <FormSheet visible={visible} title={title} onCancel={onCancel}>
      {items.map((it) => (
        <CheckLine
          key={String(it.value)}
          label={it.label}
          detail={it.detail}
          checked={it.value === value}
          onPress={() => onPick(it.value)}
        />
      ))}
      {footer}
    </FormSheet>
  );
}

/** Multi-choice list sheet (V15): nothing changes until Save. */
export function MultiListSheet<T>({
  visible,
  title,
  items,
  chosen,
  onSave,
  onCancel,
  footer,
}: {
  visible: boolean;
  title: string;
  items: readonly ListItem<T>[];
  chosen: ReadonlySet<T>;
  onSave: (chosen: Set<T>) => void;
  onCancel: () => void;
  footer?: ReactNode;
}) {
  const [draft, setDraft] = useState<Set<T>>(() => new Set(chosen));
  // A fresh draft each time it opens: a cancelled one leaves nothing behind.
  useEffect(() => {
    if (visible) setDraft(new Set(chosen));
    // Only on opening; `chosen` may be a new Set every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  return (
    <FormSheet visible={visible} title={title} onCancel={onCancel} onSave={() => onSave(new Set(draft))}>
      {items.map((it) => (
        <CheckLine
          key={String(it.value)}
          multi
          label={it.label}
          detail={it.detail}
          checked={draft.has(it.value)}
          onPress={() =>
            setDraft((d) => {
              const next = new Set(d);
              if (next.has(it.value)) next.delete(it.value);
              else next.add(it.value);
              return next;
            })
          }
        />
      ))}
      {footer}
    </FormSheet>
  );
}

/** "Leave without saving this fixture?" (V30). */
export function LeaveAsk({
  visible,
  thing,
  onKeep,
  onLeave,
}: {
  visible: boolean;
  /** "fixture", "team", "name". */
  thing: string;
  onKeep: () => void;
  onLeave: () => void;
}) {
  return (
    <FormSheet visible={visible} title={`Leave without saving this ${thing}?`} onCancel={onKeep}>
      <Pressable
        onPress={onKeep}
        accessibilityRole="button"
        style={({ pressed }) => [sheet.line, pressed && sheet.pressed]}
      >
        <Text style={sheet.keep}>Keep editing</Text>
      </Pressable>
      <Pressable
        onPress={onLeave}
        accessibilityRole="button"
        style={({ pressed }) => [sheet.line, pressed && sheet.pressed]}
      >
        <Text style={sheet.leave}>Leave without saving</Text>
      </Pressable>
    </FormSheet>
  );
}

/** A line of plain words in a sheet: what a choice does, a warning. */
export function SheetNote({ children, warn = false }: { children: ReactNode; warn?: boolean }) {
  return <Text style={[sheet.note, warn && sheet.noteWarn]}>{children}</Text>;
}

const sheet = StyleSheet.create({
  flex: { flex: 1 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    maxHeight: '88%',
    alignSelf: 'center',
    backgroundColor: colours.pitchRaised,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  head: { flexDirection: 'row', alignItems: 'center', minHeight: TOUCH_TARGET },
  side: { flex: 1, minWidth: 0, flexDirection: 'row' },
  sideRight: { justifyContent: 'flex-end' },
  headHit: { minHeight: TOUCH_TARGET, minWidth: TOUCH_TARGET, justifyContent: 'center' },
  headHitRight: { alignItems: 'flex-end' },
  pressed: { opacity: 0.6 },
  title: {
    flexShrink: 1,
    maxWidth: '60%',
    textAlign: 'center',
    color: colours.ink,
    fontSize: 17,
    fontWeight: '700',
    includeFontPadding: false,
  },
  cancel: { color: colours.back, fontSize: 16, includeFontPadding: false },
  save: { color: colours.action, fontSize: 16, fontWeight: '600', includeFontPadding: false },
  saveOff: { color: colours.inkFaint },
  body: { flexGrow: 0 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOUCH_TARGET,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colours.hair,
  },
  lineWords: { flex: 1, minWidth: 0 },
  lineLabel: { color: colours.ink, fontSize: 16, includeFontPadding: false },
  lineOn: { color: colours.action },
  lineDetail: { color: colours.inkMuted, fontSize: 13, includeFontPadding: false, marginTop: 2 },
  tickSlot: { width: 28, alignItems: 'flex-end', flexShrink: 0 },
  keep: { color: colours.action, fontSize: 16, fontWeight: '600', includeFontPadding: false },
  leave: { color: colours.danger, fontSize: 16, includeFontPadding: false },
  note: { color: colours.inkMuted, fontSize: 14, includeFontPadding: false, marginTop: 8, marginBottom: 4 },
  noteWarn: { color: colours.saved },
});
