/**
 * The action sheet: a menu that rises from the bottom over a dimmed screen.
 *
 * First drawn on the clock for a tapped player (#84), and shared with the
 * plan's bench menu (#120) so the two look and behave the same. Tapping the
 * scrim or the back button closes it; nothing is ever committed by closing.
 */

import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './Text';

import { CONTENT_MAX_WIDTH, colours, screen, TOUCH_TARGET } from './theme';
import { Icon } from './controls/Icon';

export function ActionSheet({
  visible,
  title,
  onClose,
  children,
  closeLabel = 'Cancel',
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** The words on the way out, which never commits anything. */
  closeLabel?: string;
}) {
  // #174: a Modal is a window of its own, drawn edge to edge on Android, so
  // the shell's padding does not reach it: Cancel would sit under the
  // navigation bar.
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={local.scrim} onPress={onClose}>
        <Pressable style={[local.sheet, { paddingBottom: 28 + insets.bottom }]} onPress={() => {}}>
          {visible && (
            <>
              <Text style={local.sheetTitle} numberOfLines={1}>
                {title}
              </Text>
              {children}
              <Pressable onPress={onClose} style={screen.linkHit} accessibilityRole="button">
                {/* #264 V31: a way out, muted, never underlined. */}
                <Text style={local.close}>{closeLabel}</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function SheetButton({
  label,
  onPress,
  strong,
  against,
  more,
}: {
  label: string;
  onPress: () => void;
  strong?: boolean;
  against?: boolean;
  /** #264 V2, V7: it opens something more: a chevron icon on the right, never "›" text. */
  more?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        local.sheetButton,
        strong && local.sheetButtonStrong,
        against && local.sheetButtonAgainst,
        pressed && screen.buttonPressed,
      ]}
    >
      <View style={local.sheetButtonRow}>
        <Text style={[local.sheetButtonText, local.sheetButtonLabel, against && local.againstText]}>{label}</Text>
        {more && <Icon name="chevron-right" size={22} color={colours.back} />}
      </View>
    </Pressable>
  );
}

const local = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  // #143 AC9: in the content column on a wide screen; the whole width on a phone.
  sheet: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    backgroundColor: colours.pitchRaised,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 28,
  },
  sheetTitle: { color: colours.ink, fontSize: 22, fontWeight: '700', marginBottom: 8, includeFontPadding: false },
  sheetButton: {
    minHeight: TOUCH_TARGET + 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colours.edge,
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sheetButtonStrong: { backgroundColor: colours.accent, borderColor: colours.accent },
  sheetButtonAgainst: { borderColor: colours.danger },
  sheetButtonText: { color: colours.ink, fontSize: 17, fontWeight: '600', includeFontPadding: false },
  againstText: { color: colours.danger },
  sheetButtonRow: { flexDirection: 'row', alignItems: 'center' },
  sheetButtonLabel: { flex: 1 },
  close: { color: colours.back, fontSize: 16, includeFontPadding: false },
});
