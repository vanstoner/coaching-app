/**
 * The action sheet: a menu that rises from the bottom over a dimmed screen.
 *
 * First drawn on the clock for a tapped player (#84), and shared with the
 * plan's bench menu (#120) so the two look and behave the same. Tapping the
 * scrim or the back button closes it; nothing is ever committed by closing.
 */

import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet } from 'react-native';
import { Text } from './Text';

import { CONTENT_MAX_WIDTH, colours, screen } from './theme';

export function ActionSheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={local.scrim} onPress={onClose}>
        <Pressable style={local.sheet} onPress={() => {}}>
          {visible && (
            <>
              <Text style={local.sheetTitle} numberOfLines={1}>
                {title}
              </Text>
              {children}
              <Pressable onPress={onClose} style={screen.linkHit}>
                <Text style={screen.link}>Cancel</Text>
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
}: {
  label: string;
  onPress: () => void;
  strong?: boolean;
  against?: boolean;
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
      <Text style={[local.sheetButtonText, against && local.againstText]}>{label}</Text>
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
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colours.line,
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sheetButtonStrong: { backgroundColor: colours.accent, borderColor: colours.accent },
  sheetButtonAgainst: { borderColor: colours.danger },
  sheetButtonText: { color: colours.ink, fontSize: 17, fontWeight: '600', includeFontPadding: false },
  againstText: { color: colours.danger },
});
