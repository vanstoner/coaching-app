/**
 * Back up this app, and restore it from a backup — #192.
 *
 * Drawn inside Settings. The backup is this app's data only — squad, players,
 * fixtures, plans, settings and the minutes record — never anything else on
 * the phone. Restoring shows what the file holds and asks first; what is on
 * the phone now is kept aside, so a restore never deletes anything.
 */

import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { ActionSheet, SheetButton } from './Sheet';
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
    <View style={local.section}>
      {!restoreOnly && (
        <>
          <Text style={screen.fieldLabel}>Backup</Text>
          <Text style={screen.hint}>
            Everything this app keeps — squad, fixtures, plans, settings and the
            minutes record — in one file. Nothing else on the phone.
          </Text>

          <Pressable
            disabled={busy}
            onPress={onBackup}
            style={({ pressed }) => [screen.buttonQuiet, busy && screen.buttonDisabled, pressed && screen.buttonPressed]}
          >
            <Text style={screen.buttonLabel}>Back up this app</Text>
          </Pressable>
          <Text style={[screen.hint, screen.overtime]}>
            The file contains the children's first names. Keep it somewhere private.
          </Text>
        </>
      )}

      <Pressable
        disabled={busy}
        onPress={onPick}
        style={({ pressed }) => [screen.buttonQuiet, busy && screen.buttonDisabled, pressed && screen.buttonPressed]}
      >
        <Text style={screen.buttonLabel}>Restore from a backup</Text>
      </Pressable>
      <Text style={screen.hint}>
        Shows what the backup holds before anything changes. What is on this
        phone now is kept aside first; nothing is deleted.
      </Text>

      {message !== '' && <Text style={local.message}>{message}</Text>}

      <ActionSheet visible={pending !== null} title="Restore this backup?" onClose={onCancel}>
        {pending !== null && (
          <>
            <Text style={local.preview}>{pending}</Text>
            <Text style={local.preview}>
              This app's squad, fixtures, settings and minutes will be replaced
              by the backup's. What is here now is kept aside on this phone.
            </Text>
            <SheetButton label="Restore" strong onPress={onConfirm} />
          </>
        )}
      </ActionSheet>
    </View>
  );
}

const local = StyleSheet.create({
  section: { alignSelf: 'stretch', marginTop: 20 },
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
    marginBottom: 12,
  },
});
