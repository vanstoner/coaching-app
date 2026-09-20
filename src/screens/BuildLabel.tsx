/**
 * Which build am I looking at? — #52.
 *
 * A CI build shows its release tag verbatim, so the string on the phone can be
 * pasted into the releases page and find the exact artifact. A local run says
 * `local dev` in words and cannot be mistaken for one.
 *
 * Deliberately quiet: this is diagnostic information, not something a coach
 * reads at the touchline.
 *
 * `alignSelf: 'stretch'` and `includeFontPadding: false` are not decoration.
 * Text sized to its own measurement loses its last glyph on Android, which has
 * now happened four times on this app, and a build label missing its final
 * character is worse than no build label at all.
 */

import { Text } from 'react-native';

import { currentBuildLabel } from '../app/buildLabel';
import { screen } from './theme';

export function BuildLabel() {
  return (
    <Text style={screen.buildLabel} numberOfLines={1}>
      {currentBuildLabel()}
    </Text>
  );
}
