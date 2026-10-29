/**
 * #252: the score as a band on the pitch (in play) or under the strip (a
 * break, full time). White on the pitch greens, no warning colour (AC7); a
 * fixed-width box so 12–10 never clips and nothing moves when a goal goes in
 * (AC5, AC6); it takes no taps or drops (AC9).
 */

import { StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { colours } from './theme';

export function ScoreBand({ text, label, onPitch = false }: { text: string; label: string; onPitch?: boolean }) {
  return (
    <View
      style={[local.band, onPitch && local.onPitch]}
      pointerEvents="none"
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      <Text style={local.digits} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const local = StyleSheet.create({
  band: {
    alignSelf: 'stretch',
    alignItems: 'center',
    backgroundColor: colours.pitchRaised,
    borderColor: colours.line,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 4,
    marginTop: 8,
  },
  // Joined to the top of the formation box below it.
  onPitch: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomWidth: 0, marginBottom: -1 },
  digits: {
    // A fixed box, never sized to the digits it shows (the clipped-glyph trap).
    width: 160,
    textAlign: 'center',
    color: colours.ink,
    fontSize: 46,
    fontWeight: '700',
    includeFontPadding: false,
  },
});
