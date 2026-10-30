/**
 * Settings › Tallies — #198 AC2.
 *
 * The coach's tallies: the built-in ones, and kinds the coach adds without a
 * release (an `event-type` record), each credited to the child tapped or to
 * the team. An added kind gets its own button on the clock's tap sheet
 * (PO ruling 12). A tally is never validated and never feeds the score,
 * minutes or fairness.
 *
 * #264: Stop offering and Offer again are Actions; Add a tally is a Row ›
 * opening a sheet (Cancel, Save) with the name and who it is credited to.
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';

import type { UUID } from '../types/index';
import { BUILT_IN_TALLIES, TALLY_CAPTION } from '../app/tallies';
import { Action, FieldRow, FormSheet, RowNav, SegmentedRow } from './controls';
import { colours, screen, TOUCH_TARGET } from './theme';

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
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [credited, setCredited] = useState<'child' | 'team'>('child');
  const [error, setError] = useState('');
  const close = () => {
    setAdding(false);
    setError('');
  };
  const add = () => {
    const refused = onAdd(draft, credited);
    if (refused) setError(refused);
    else {
      setDraft('');
      close();
    }
  };
  return (
    <View style={local.section}>
      <Text style={local.hint}>{TALLY_CAPTION}: shown under More stats, never in the score, minutes or fairness.</Text>
      <Text style={local.builtIn}>Built in: {BUILT_IN_TALLIES.map((t) => t.one).join(', ')}</Text>
      {types.map((t) => (
        <View key={t.id} style={local.row}>
          <Text style={[local.name, !t.active && local.retired]} numberOfLines={1}>
            {t.label} · {t.credited === 'team' ? 'the team' : 'a child'}
            {t.active ? '' : ' (not offered)'}
          </Text>
          <Action
            label={t.active ? 'Stop offering' : 'Offer again'}
            onPress={() => setError(onActive(t.id, !t.active) ?? '')}
          />
        </View>
      ))}
      <RowNav
        label="Add a tally"
        onPress={() => {
          setAdding(true);
          setError('');
        }}
      />
      {!adding && error !== '' && <Text style={screen.error}>{error}</Text>}
      <FormSheet
        visible={adding}
        title="Add a tally"
        onCancel={close}
        dirty={draft.trim() !== ''}
        thing="tally"
        onSave={add}
        saveDisabled={draft.trim() === ''}
      >
        <FieldRow
          label="Name"
          value={draft}
          onChangeText={(t) => {
            setDraft(t);
            if (error) setError('');
          }}
          placeholder="e.g. Throw-in won"
          autoFocus
        />
        <SegmentedRow
          label="For"
          stacked
          options={[
            { value: 'child' as const, label: 'The child tapped' },
            { value: 'team' as const, label: 'The team' },
          ]}
          value={credited}
          onChange={(c) => c && setCredited(c)}
        />
        {error !== '' && <Text style={screen.error}>{error}</Text>}
      </FormSheet>
    </View>
  );
}

const local = StyleSheet.create({
  section: { alignSelf: 'stretch' },
  hint: { alignSelf: 'stretch', color: colours.inkFaint, fontSize: 13, includeFontPadding: false },
  builtIn: { alignSelf: 'stretch', color: colours.inkMuted, fontSize: 13, includeFontPadding: false, marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    minHeight: TOUCH_TARGET,
    borderBottomWidth: 1,
    borderBottomColor: colours.hair,
  },
  name: { flex: 1, minWidth: 0, color: colours.ink, fontSize: 15, includeFontPadding: false },
  retired: { color: colours.inkFaint },
});
