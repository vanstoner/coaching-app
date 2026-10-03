/**
 * Player minutes: the season, export and import — #75.
 *
 * Drawn inside Settings. The ledger it shows is kept apart from everything
 * else the app stores, so this is the one list that survives an upgrade, a
 * reset of the working data, or a move to a new phone by way of the file.
 *
 * The export warning is the PO's ruling 3A in words the coach reads at the
 * moment it matters: the file carries children's first names.
 */

import {
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from './Text';

import { formatClock } from '../app/matchClock';
import { UNIT_LABEL, seasonRows, type Ledger } from '../app/ledger';
import { colours, screen } from './theme';

export function MinutesSection({
  ledger,
  message,
  busy,
  onExport,
  onImport,
}: {
  ledger: Ledger | null;
  /** The outcome of the last export or import, in plain English. */
  message: string;
  busy: boolean;
  onExport: () => void;
  onImport: () => void;
}) {
  const rows = ledger ? seasonRows(ledger) : [];
  const matches = ledger?.matches.length ?? 0;

  return (
    <View style={local.section}>
      <Text style={screen.fieldLabel}>Player minutes</Text>
      <Text style={screen.hint}>
        Kept separately from everything else, so it survives updates.{' '}
        {matches === 0
          ? 'Nothing played yet.'
          : `${matches} ${matches === 1 ? 'match' : 'matches'} so far.`}
      </Text>

      {rows.length > 0 && (
        <View style={local.head}>
          <Text style={[local.name, local.headText]}>Player</Text>
          <Text style={[local.figure, local.headText]}>Out</Text>
          <Text style={[local.figure, local.headText]}>GK</Text>
        </View>
      )}
      {rows.map((row) => (
        <View key={row.playerId} style={local.row}>
          <View style={local.nameCol}>
            <Text style={[local.name, row.retired && local.faint]} numberOfLines={1}>
              {row.name}
              {row.retired ? ' (removed)' : ''}
            </Text>
            {/* #83 AC6: where the time was played, at unit level. */}
            <Text style={local.units} numberOfLines={1}>
              {(['DEF', 'MID', 'ATT'] as const)
                .filter((u) => row.byUnit[u] > 0)
                .map((u) => `${UNIT_LABEL[u]} ${formatClock(row.byUnit[u])}`)
                .join(' · ')}
            </Text>
          </View>
          <Text style={local.figure} numberOfLines={1}>
            {formatClock(row.outfieldMs)}
          </Text>
          <Text style={[local.figure, row.goalkeeperMs === 0 && local.faint]} numberOfLines={1}>
            {row.goalkeeperMs === 0 ? '-' : formatClock(row.goalkeeperMs)}
          </Text>
        </View>
      ))}

      <Pressable
        disabled={busy || matches === 0}
        onPress={onExport}
        style={({ pressed }) => [
          screen.buttonQuiet,
          (busy || matches === 0) && screen.buttonDisabled,
          pressed && screen.buttonPressed,
        ]}
      >
        <Text style={screen.buttonLabel}>Export minutes file</Text>
      </Pressable>
      <Text style={[screen.hint, screen.overtime]}>
        The file contains the children's first names. Keep it somewhere private.
      </Text>

      <Pressable
        disabled={busy}
        onPress={onImport}
        style={({ pressed }) => [
          screen.buttonQuiet,
          busy && screen.buttonDisabled,
          pressed && screen.buttonPressed,
        ]}
      >
        <Text style={screen.buttonLabel}>Import minutes file</Text>
      </Pressable>
      <Text style={screen.hint}>
        Adds what is missing. Never overwrites or deletes anything here.
      </Text>

      {message !== '' && <Text style={local.message}>{message}</Text>}
    </View>
  );
}

const local = StyleSheet.create({
  section: { alignSelf: 'stretch', marginTop: 8 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: colours.line,
  },
  headText: { color: colours.inkMuted, fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#164f3c',
  },
  nameCol: { flex: 1, minWidth: 0 },
  name: { color: colours.ink, fontSize: 15, includeFontPadding: false },
  units: { color: colours.inkMuted, fontSize: 11, includeFontPadding: false, marginTop: 2 },
  // Fixed width and no shrink: a time beside a flex sibling loses its tail.
  figure: {
    width: 64,
    flexShrink: 0,
    textAlign: 'right',
    color: colours.ink,
    fontSize: 15,
    includeFontPadding: false,
  },
  // Colour only: a weight change re-measures and clips (theme.ts).
  faint: { color: colours.inkFaint },
  message: {
    alignSelf: 'stretch',
    color: colours.warn,
    fontSize: 14,
    includeFontPadding: false,
    marginTop: 10,
  },
});
