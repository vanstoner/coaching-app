/**
 * The name warning (#54, Rob 26 Oct; Dee's prototype): first names are the
 * default, and a name of more than one word is saved only after the coach
 * picks one of these buttons. Used by Squad › Add and the child page's Rename.
 */

import { StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { nameWarning } from '../app/squad';
import { Action, BackLink } from './controls';
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
        {/* #54, Rob 30 Oct ("approve … 3"): since ruling 1 the plan picture shows the name too. */}
        First names are the default because these are children&apos;s details. A surname typed in once is kept in this
        phone&apos;s record, in every backup and on the plan picture you share.{isInitial ? '' : ' An initial tells two children apart just as well.'}
      </Text>
      {/* #264: each choice acts at once (an Action); Change it goes back to the field.
          #54 AC2 (QA on #260, D13): Keep is the quieter third button. */}
      <Action label={`Use “${isInitial ? cleaned : initial}”`} onPress={() => onUse(isInitial ? cleaned : initial)} />
      <BackLink label="Change it" chevron={false} onPress={onChange} />
      {!isInitial && <Action label={`Keep “${cleaned}”`} quiet onPress={() => onUse(cleaned)} />}
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
