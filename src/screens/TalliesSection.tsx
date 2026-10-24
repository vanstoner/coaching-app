/**
 * Settings › Tallies — #198 AC2.
 *
 * The coach's tallies: the built-in ones, and kinds the coach adds without a
 * release (an `event-type` record), each credited to the child tapped or to
 * the team. An added kind gets its own button on the clock's tap sheet
 * (PO ruling 12). A tally is never validated and never feeds the score,
 * minutes or fairness.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from './Text';

import type { UUID } from '../types/index';
import { BUILT_IN_TALLIES, TALLY_CAPTION } from '../app/tallies';
import { Chip, ChipRow } from './Chip';
import { colours, screen } from './theme';

export interface TallyTypeRow {
  id: UUID;
  label: string;
  credited: 'child' | 'team';
  active: boolean;
}

export function TalliesSection({
  types,
  onAdd,
  onActive,
}: {
  types: TallyTypeRow[];
  /** A reason when refused, else null. */
  onAdd: (label: string, credited: 'child' | 'team') => string | null;
  onActive: (id: UUID, active: boolean) => string | null;
}) {
  const [draft, setDraft] = useState('');
  const [credited, setCredited] = useState<'child' | 'team'>('child');
  const [error, setError] = useState('');
  const add = () => {
    const refused = onAdd(draft, credited);
    if (refused) setError(refused);
    else {
      setDraft('');
      setError('');
    }
  };
  return (
    <View style={local.section}>
      <Text style={screen.fieldLabel}>Tallies</Text>
      <Text style={screen.hint}>
        {TALLY_CAPTION}: shown under More stats, never in the score, minutes or fairness.
      </Text>
      <Text style={local.builtIn}>
        Built in: {BUILT_IN_TALLIES.map((t) => t.one).join(', ')}
      </Text>
      {types.map((t) => (
        <View key={t.id} style={local.row}>
          <Text style={[local.name, !t.active && local.retired]} numberOfLines={1}>
            {t.label} · {t.credited === 'team' ? 'the team' : 'a child'}
            {t.active ? '' : ' (not offered)'}
          </Text>
          <Pressable
            onPress={() => {
              const refused = onActive(t.id, !t.active);
              setError(refused ?? '');
            }}
            style={local.action}
          >
            <Text style={screen.link}>{t.active ? 'Stop offering' : 'Offer again'}</Text>
          </Pressable>
        </View>
      ))}
      <View style={local.row}>
        <TextInput
          style={[screen.input, local.input]}
          value={draft}
          onChangeText={(t) => {
            setDraft(t);
            if (error) setError('');
          }}
          placeholder="A new tally, e.g. Throw-in won"
          placeholderTextColor={colours.inkFaint}
        />
        <Pressable onPress={add} style={local.action}>
          <Text style={screen.link}>Add</Text>
        </Pressable>
      </View>
      <ChipRow>
        <Chip label="For the child tapped" selected={credited === 'child'} onPress={() => setCredited('child')} />
        <Chip label="For the team" selected={credited === 'team'} onPress={() => setCredited('team')} />
      </ChipRow>
      {error !== '' && <Text style={screen.error}>{error}</Text>}
    </View>
  );
}

const local = StyleSheet.create({
  section: { alignSelf: 'stretch', marginTop: 8 },
  builtIn: { alignSelf: 'stretch', color: colours.inkMuted, fontSize: 13, includeFontPadding: false, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', marginTop: 6 },
  name: { flex: 1, minWidth: 0, color: colours.ink, fontSize: 15, includeFontPadding: false },
  retired: { color: colours.inkFaint },
  input: { flex: 1, alignSelf: 'auto' },
  action: { flexShrink: 0, paddingVertical: 8, paddingLeft: 12 },
});
