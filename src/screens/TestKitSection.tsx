/**
 * The Test kit — Heart FC Beta Coach and development builds (#95, #134). Drawn by
 * Settings only when `showTestKit` in testKit.ts says so.
 *
 * #264: each is an Action, acting on the tap. The heading is Settings' own (#263).
 */

import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { Action } from './controls';
import { colours } from './theme';

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
      <Text style={local.hint}>
        For trying a build before approving it. Only in Heart FC Beta Coach, which keeps its own data, so nothing here
        reaches the real squad.
      </Text>

      {/* #228 item 5: no Clock speed here; Start a test match has its own ×1/×5/×10. */}
      <Action label="Add test squad and fixtures" onPress={onAddTestData} />
      <Action label="Add a past season" onPress={onAddTestSeason} />
      <Text style={local.hint}>
        Nine played matches on the Saturdays before today: league, cup and a friendly, with absences, subs, goals and
        a keeper.
      </Text>
      <Action label="Time signing on this phone" onPress={onTimeSigning} />
      {message !== '' && <Text style={local.hint}>{message}</Text>}
    </View>
  );
}

const local = StyleSheet.create({
  section: { alignSelf: 'stretch' },
  hint: { alignSelf: 'stretch', color: colours.inkFaint, fontSize: 13, includeFontPadding: false, marginVertical: 4 },
});
