/**
 * The name warning (#54, Rob 26 Oct; Dee's prototype): first names are the
 * default, and a name of more than one word is saved only after the coach
 * picks one of these buttons. Used by Squad › Add and the child page's Rename.
 */

import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { nameWarning } from '../app/squad';
import { colours, screen } from './theme';
/**
 * #54 AC2: the warning for a name of more than one word, before anything is
 * saved. It says why first names are the default and recommends an initial;
 * "Keep" is the quieter choice, for a nickname or a name the coach needs.
 * Also used by the child page's Rename (AC6).
 */
export function MoreThanFirstName({
  cleaned,
  onUse,
  onChange,
}: {
  cleaned: string;
  onUse: (name: string) => void;
  onChange: () => void;
}) {
  const { initial, isInitial } = nameWarning(cleaned);
  return (
    <View style={guard.box}>
      <Text style={guard.text}>“{cleaned}” is more than a first name</Text>
      <Text style={screen.hint}>
        First names are the default because these are children&apos;s details. A surname typed in once is kept in this
        phone&apos;s record and in every backup.{isInitial ? '' : ' An initial tells two children apart just as well.'}
      </Text>
      <Pressable
        onPress={() => onUse(isInitial ? cleaned : initial)}
        accessibilityRole="button"
        style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]}
      >
        <Text style={screen.buttonLabel}>Use “{isInitial ? cleaned : initial}”</Text>
      </Pressable>
      {!isInitial && (
        <Pressable
          onPress={() => onUse(cleaned)}
          accessibilityRole="button"
          style={({ pressed }) => [screen.buttonQuiet, pressed && screen.buttonPressed]}
        >
          <Text style={screen.buttonLabel}>Keep “{cleaned}”</Text>
        </Pressable>
      )}
      <Pressable onPress={onChange} accessibilityRole="button" style={screen.linkHit}>
        <Text style={screen.link}>Change it</Text>
      </Pressable>
    </View>
  );
}

export const guard = StyleSheet.create({
  box: {
    alignSelf: 'stretch',
    backgroundColor: colours.pitchRaised,
    borderColor: colours.warn,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  text: { alignSelf: 'stretch', color: colours.ink, fontSize: 16, includeFontPadding: false },
});
