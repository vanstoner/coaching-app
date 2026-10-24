/**
 * The Test kit — Heart FC Beta Coach and development builds (#95, #134). Drawn by
 * Settings only when `showTestKit` in testKit.ts says so.
 */

import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { colours, screen } from './theme';

export function TestKitSection({
  onAddTestData,
  onAddTestSeason,
  onTimeSigning,
  message,
}: {
  onAddTestData: () => void;
  /** A played season on past Saturdays, for the averages (#106). */
  onAddTestSeason: () => void;
  /** #193 AC6: measure signing on this phone. */
  onTimeSigning: () => void;
  message: string;
}) {
  return (
    <View style={local.section}>
      <Text style={screen.fieldLabel}>Test kit (beta only)</Text>
      <Text style={screen.hint}>
        For trying a build before approving it. Only in Heart FC Beta Coach, which keeps its own data, so
        nothing here reaches the real squad.
      </Text>

      {/* #228 item 5: no Clock speed here; Start a test match has its own ×1/×5/×10. */}
      <Pressable
        style={({ pressed }) => [screen.buttonQuiet, pressed && screen.buttonPressed]}
        onPress={onAddTestData}
      >
        <Text style={screen.buttonLabel}>Add test squad and fixtures</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [screen.buttonQuiet, pressed && screen.buttonPressed]}
        onPress={onAddTestSeason}
      >
        <Text style={screen.buttonLabel}>Add a past season</Text>
      </Pressable>
      <Text style={screen.hint}>
        Nine played matches on the Saturdays before today: league, cup and a friendly, with
        absences, subs, goals and a keeper.
      </Text>
      <Pressable
        style={({ pressed }) => [screen.buttonQuiet, pressed && screen.buttonPressed]}
        onPress={onTimeSigning}
      >
        <Text style={screen.buttonLabel}>Time signing on this phone</Text>
      </Pressable>
      {message !== '' && <Text style={screen.hint}>{message}</Text>}
    </View>
  );
}

const local = StyleSheet.create({
  section: {
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colours.line,
  },
});
