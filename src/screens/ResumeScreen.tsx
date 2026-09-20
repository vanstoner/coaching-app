/**
 * "There is a match in progress."
 *
 * Shown at launch when the saved match has started and not finished. Every
 * figure on it is computed here and now from the saved wall-clock anchors and
 * never read out of the file (invariant 2), which is why a phone that died
 * mid-quarter and came back ten minutes later shows the truth.
 *
 * Its way out does not commit: leaving keeps the match exactly as it is and
 * drops the coach on Home, where the in-progress fixture is at the top of the
 * list. It does NOT end the match and it does not start a new one.
 */

import { useMemo } from 'react';
import { Pressable, SafeAreaView, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { MatchEngine } from '../engine/MatchEngine';
import { formatClock, periodNounPlural } from '../app/matchClock';
import { PLACEHOLDER_SQUAD_NAME } from '../app/placeholderSquad';
import type { SavedSession } from '../app/persistence';
import { toMatchState } from '../app/persistence';
import { BuildLabel } from './BuildLabel';
import { screen } from './theme';

export function ResumeScreen({
  saved,
  onResume,
  onLeave,
}: {
  saved: SavedSession;
  onResume: () => void;
  /** Back to Home, match untouched. */
  onLeave: () => void;
}) {
  const engine = useMemo(() => new MatchEngine(), []);
  const state = useMemo(() => toMatchState(saved), [saved]);
  const elapsed = state ? engine.getMatchElapsedMs(state) : 0;
  const played = state ? state.quarters.filter((q) => q.status === 'ended').length : 0;

  return (
    <SafeAreaView style={screen.safe}>
      <View style={screen.pane}>
        <View style={screen.flex} />
        <Text style={screen.title} numberOfLines={1}>
          {saved.squadName || PLACEHOLDER_SQUAD_NAME}
        </Text>
        <Text style={screen.caption}>There is a match in progress.</Text>
        <Text style={screen.clock} numberOfLines={1} adjustsFontSizeToFit>
          {formatClock(elapsed)}
        </Text>
        <Text style={screen.caption}>
          {played} of {saved.periodCount}{' '}
          {periodNounPlural(saved.periodCount).toLowerCase()} played
        </Text>
        <Text style={screen.hint}>
          Time is worked out from the clock, so nothing was lost while the app
          was closed.
        </Text>

        <Pressable
          style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]}
          onPress={onResume}
        >
          <Text style={screen.buttonLabel}>Back to the match</Text>
        </Pressable>
        <Pressable onPress={onLeave} style={screen.linkHit}>
          <Text style={screen.link}>Not now — go to Home</Text>
        </Pressable>
        <View style={screen.flex} />
      </View>
      <BuildLabel />
      <StatusBar style="light" />
    </SafeAreaView>
  );
}
