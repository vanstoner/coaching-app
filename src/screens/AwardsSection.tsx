/**
 * Settings › Awards — #197 AC1.
 *
 * The kinds of award the coach gives: Player of the Week and Mr Assister by
 * default, and any they add. Each can be renamed or retired. Retiring stops
 * it being offered; every award already given stays on its match. Each
 * change is a record (`award-type`); nothing is deleted (invariant 5).
 */

import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from './Text';

import type { UUID } from '../types/index';
import { colours, screen } from './theme';

export interface AwardTypeRow {
  id: UUID;
  name: string;
  active: boolean;
}

export function AwardsSection({
  types,
  onAdd,
  onUpdate,
}: {
  types: AwardTypeRow[];
  /** A reason when refused, else null. */
  onAdd: (name: string) => string | null;
  onUpdate: (id: UUID, change: { name?: string; active?: boolean }) => string | null;
}) {
  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState<{ id: UUID; name: string } | null>(null);
  const [error, setError] = useState('');
  const done = (refused: string | null, after: () => void) => {
    if (refused) setError(refused);
    else {
      setError('');
      after();
    }
  };
  return (
    <View style={local.section}>
      <Text style={screen.fieldLabel}>Awards</Text>
      <Text style={screen.hint}>Given on a played match’s page. They never count towards minutes or fairness.</Text>
      {types.map((t) =>
        renaming?.id === t.id ? (
          <View key={t.id} style={local.row}>
            <TextInput
              style={[screen.input, local.input]}
              value={renaming.name}
              onChangeText={(name) => setRenaming({ id: t.id, name })}
              autoFocus
            />
            <Pressable
              onPress={() => done(onUpdate(t.id, { name: renaming.name }), () => setRenaming(null))}
              style={local.action}
            >
              <Text style={screen.link}>Save</Text>
            </Pressable>
            <Pressable onPress={() => setRenaming(null)} style={local.action}>
              <Text style={screen.link}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <View key={t.id} style={local.row}>
            <Text style={[local.name, !t.active && local.retired]} numberOfLines={1}>
              {t.name}
              {t.active ? '' : ' (retired)'}
            </Text>
            <Pressable onPress={() => setRenaming({ id: t.id, name: t.name })} style={local.action}>
              <Text style={screen.link}>Rename</Text>
            </Pressable>
            <Pressable onPress={() => done(onUpdate(t.id, { active: !t.active }), () => {})} style={local.action}>
              <Text style={screen.link}>{t.active ? 'Retire' : 'Bring back'}</Text>
            </Pressable>
          </View>
        )
      )}
      <View style={local.row}>
        <TextInput
          style={[screen.input, local.input]}
          value={draft}
          onChangeText={(t) => {
            setDraft(t);
            if (error) setError('');
          }}
          placeholder="A new award"
          placeholderTextColor={colours.inkFaint}
        />
        <Pressable onPress={() => done(onAdd(draft), () => setDraft(''))} style={local.action}>
          <Text style={screen.link}>Add</Text>
        </Pressable>
      </View>
      {error !== '' && <Text style={screen.error}>{error}</Text>}
    </View>
  );
}

const local = StyleSheet.create({
  section: { alignSelf: 'stretch', marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', marginTop: 6 },
  name: { flex: 1, minWidth: 0, color: colours.ink, fontSize: 15, includeFontPadding: false },
  retired: { color: colours.inkFaint },
  input: { flex: 1, alignSelf: 'auto' },
  action: { flexShrink: 0, paddingVertical: 8, paddingLeft: 12 },
});
