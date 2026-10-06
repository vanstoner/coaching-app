/**
 * The Test kit — Heart FC Beta Coach and development builds (#95, #134). Drawn by
 * Settings only when `showTestKit` in testKit.ts says so.
 */

import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { Chip, ChipRow } from './Chip';
import { CLOCK_SPEEDS, type ClockSpeed } from '../app/appClock';
import { colours, screen } from './theme';

export function TestKitSection({
  speed,
  onSpeed,
  onAddTestData,
  onAddTestSeason,
  message,
}: {
  speed: ClockSpeed;
  onSpeed: (speed: ClockSpeed) => void;
  onAddTestData: () => void;
  /** A played season on past Saturdays, for the averages (#106). */
  onAddTestSeason: () => void;
  message: string;
}) {
  return (
    <View style={local.section}>
      <Text style={screen.fieldLabel}>Test kit (beta only)</Text>
      <Text style={screen.hint}>
        For trying a build before approving it. Only in Heart FC Beta Coach, which keeps its own data, so
        nothing here reaches the real squad.
      </Text>

      <Text style={screen.fieldLabel}>Clock speed</Text>
      <ChipRow>
        {CLOCK_SPEEDS.map((s) => (
          <Chip key={s} label={`×${s}`} selected={s === speed} onPress={() => onSpeed(s)} />
        ))}
      </ChipRow>
      <Text style={screen.hint}>
        At ×10 a 50-minute match takes 5 minutes. Minutes stay exact at any speed.
      </Text>

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
