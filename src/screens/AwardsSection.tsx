/**
 * Settings › Awards — #197 AC1.
 *
 * The kinds of award the coach gives: Player of the Week and Mr Assister by
 * default, and any they add. Each can be renamed or retired. Retiring stops
 * it being offered; every award already given stays on its match. Each
 * change is a record (`award-type`); nothing is deleted (invariant 5).
 *
 * #264: each award is a Row › opening a sheet (Cancel, Save) to rename it,
 * with Retire or Bring back as an Action inside; Add an award is a Row ›
 * opening the same kind of sheet. Nothing is written until Save or the
 * Action.
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';

import type { UUID } from '../types/index';
import { Action, FieldRow, FormSheet, RowNav } from './controls';
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
  /** The award open in the sheet, or 'new'. */
  const [editing, setEditing] = useState<UUID | 'new' | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const open = (id: UUID | 'new', name: string) => {
    setEditing(id);
    setDraft(name);
    setError('');
  };
  const close = () => {
    setEditing(null);
    setError('');
  };
  const done = (refused: string | null) => {
    if (refused) setError(refused);
    else close();
  };
  const current = editing !== null && editing !== 'new' ? types.find((t) => t.id === editing) : undefined;
  return (
    <View style={local.section}>
      <Text style={local.hint}>
        Given during a match (tap a player, or at a break), when you End match, or later on a played match’s
        page. They never count towards minutes or fairness.
      </Text>
      {types.map((t) => (
        <RowNav
          key={t.id}
          label={`${t.name}${t.active ? '' : ' (retired)'}`}
          value={t.active ? 'Offered' : 'Retired'}
          onPress={() => open(t.id, t.name)}
        />
      ))}
      <RowNav label="Add an award" onPress={() => open('new', '')} />
      <FormSheet
        visible={editing !== null}
        title={editing === 'new' ? 'Add an award' : 'Award'}
        onCancel={close}
        saveDisabled={draft.trim() === '' || (current !== undefined && draft === current.name)}
        dirty={editing !== null && draft !== (current?.name ?? '')}
        thing="award"
        onSave={() =>
          done(editing === 'new' ? onAdd(draft) : current ? onUpdate(current.id, { name: draft }) : null)
        }
      >
        <FieldRow
          label="Name"
          value={draft}
          onChangeText={(t) => {
            setDraft(t);
            if (error) setError('');
          }}
          placeholder="A new award"
          autoFocus
        />
        {current && (
          <Action
            label={current.active ? 'Retire' : 'Bring back'}
            onPress={() => done(onUpdate(current.id, { active: !current.active }))}
          />
        )}
        {error !== '' && <Text style={screen.error}>{error}</Text>}
      </FormSheet>
    </View>
  );
}

const local = StyleSheet.create({
  section: { alignSelf: 'stretch' },
  hint: { alignSelf: 'stretch', color: colours.inkFaint, fontSize: 13, includeFontPadding: false, marginBottom: 6 },
});
