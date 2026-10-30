/**
 * Back up this app, and restore it from a backup — #192.
 *
 * Drawn inside Settings. The backup is this app's data only — squad, players,
 * fixtures, plans, settings and the minutes record — never anything else on
 * the phone. Restoring shows what the file holds and asks first; what is on
 * the phone now is kept aside, so a restore never deletes anything.
 *
 * #264: Back up acts at once (an Action); Restore opens the file picker and
 * then a sheet (a Row ›), and only the sheet's Restore changes anything.
 */

import { StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { Action, FormSheet, RowNav } from './controls';
import { colours, screen } from './theme';

export function BackupSection({
  message,
  busy,
  pending,
  onBackup,
  onPick,
  onConfirm,
  onCancel,
  restoreOnly = false,
}: {
  /** The outcome of the last backup or restore, in plain English. */
  message: string;
  busy: boolean;
  /** What a picked backup holds, in words, while the coach decides; null otherwise. */
  pending: string | null;
  onBackup: () => void;
  onPick: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  /** The first screen, with no team to back up: restore alone (Rob, 29 Oct). */
  restoreOnly?: boolean;
}) {
  return (
    <View style={restoreOnly ? local.first : local.section}>
      {!restoreOnly && (
        <>
          <Text style={local.hint}>
            Everything this app keeps — squad, fixtures, plans, settings and the minutes record — in one file.
            Nothing else on the phone.
          </Text>
          <Action label="Back up this app" onPress={onBackup} disabled={busy} />
          <Text style={[local.hint, screen.overtime]}>
            The file contains the children's first names. Keep it somewhere private.
          </Text>
        </>
      )}

      <RowNav label="Restore from a backup" onPress={onPick} disabled={busy} first={restoreOnly} />
      <Text style={local.hint}>
        Shows what the backup holds before anything changes. What is on this phone now is kept aside first;
        nothing is deleted.
      </Text>

      {message !== '' && <Text style={local.message}>{message}</Text>}

      <FormSheet
        visible={pending !== null}
        title="Restore this backup?"
        onCancel={onCancel}
        onSave={onConfirm}
        saveLabel="Restore"
      >
        {pending !== null && (
          <>
            <Text style={local.preview}>{pending}</Text>
            <Text style={local.preview}>
              This app's squad, fixtures, settings and minutes will be replaced by the backup's. What is here now is
              kept aside on this phone.
            </Text>
          </>
        )}
      </FormSheet>
    </View>
  );
}

const local = StyleSheet.create({
  section: { alignSelf: 'stretch' },
  first: { alignSelf: 'stretch', marginTop: 20 },
  hint: { alignSelf: 'stretch', color: colours.inkFaint, fontSize: 13, includeFontPadding: false, marginVertical: 4 },
  message: {
    alignSelf: 'stretch',
    color: colours.warn,
    fontSize: 14,
    includeFontPadding: false,
    marginTop: 10,
  },
  preview: {
    alignSelf: 'stretch',
    color: colours.ink,
    fontSize: 15,
    includeFontPadding: false,
    marginVertical: 6,
  },
});
