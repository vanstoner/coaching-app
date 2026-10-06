/**
 * Player minutes: the season, export and import — #75.
 *
 * Drawn inside Settings. The ledger it shows is kept apart from everything
 * else the app stores, so this is the one list that survives an upgrade, a
 * reset of the working data, or a move to a new phone by way of the file.
 *
 * The export warning is the PO's ruling 3A in words the coach reads at the
 * moment it matters: the file carries children's first names.
 *
 * Invariant 3 (ADR-015, #101): Total, goal plus outfield, is the fairness
 * figure; Out and GK are its breakdown. The list is in squad order, never
 * ranked by minutes (PO ruling Q1, #143 AC7). A player's
 * outfield-share target is shown under their name as on track or below, and
 * is never a fairness input.
 */

import {
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from './Text';

import { formatClock } from '../app/matchClock';
import { inSquadOrder, minutesRowSeconds } from '../app/analysis';
import { UNIT_LABEL, seasonRows, type Ledger } from '../app/ledger';
import { seasonOutfieldShares, shareLabel } from '../app/outfieldTarget';
import type { Player, UUID } from '../types/index';
import { inferredMatchCount, seasonAttendance, type SeasonAttendance } from '../app/attendance';
import { colours, screen } from './theme';

export function MinutesSection({
  ledger,
  players,
  kickoffs,
  message,
  busy,
  onExport,
  onImport,
}: {
  ledger: Ledger | null;
  /** The working squad, for each player's outfield-share target (#101). */
  players: Player[];
  /** Kick-off of each match without a `kickoffAt`, for ruling E (`kickoffTimes`). */
  kickoffs: ReadonlyMap<UUID, string>;
  /** The outcome of the last export or import, in plain English. */
  message: string;
  busy: boolean;
  onExport: () => void;
  onImport: () => void;
}) {
  // PO ruling Q1 (#143 AC7): squad order, never by minutes. Anyone the
  // ledger knows who is not in this squad follows.
  const rows = inSquadOrder(ledger ? seasonRows(ledger) : [], players);
  const shares = ledger ? seasonOutfieldShares(ledger, players) : new Map();
  const matches = ledger?.matches.length ?? 0;
  // #102 AC3, AC4: derived from the ledger every time, never stored.
  const attendance = ledger ? seasonAttendance(ledger, { players, kickoffs }) : new Map<string, SeasonAttendance>();
  const inferred = ledger ? inferredMatchCount(ledger) : 0;

  return (
    <View style={local.section}>
      <Text style={screen.fieldLabel}>Player minutes</Text>
      <Text style={screen.hint}>
        Kept separately from everything else, so it survives updates.{' '}
        {matches === 0
          ? 'Nothing played yet.'
          : `${matches} ${matches === 1 ? 'match' : 'matches'} so far.`}
        {inferred > 0
          ? ` Attendance for ${inferred} ${inferred === 1 ? 'match was' : 'matches was'} worked out from who played.`
          : ''}
      </Text>

      {rows.length > 0 && (
        <View style={local.head}>
          <Text style={[local.name, local.headText]}>Player</Text>
          <Text style={[local.figure, local.headText]}>Out</Text>
          <Text style={[local.figure, local.headText]}>GK</Text>
          <Text style={[local.figure, local.headText]}>Total</Text>
        </View>
      )}
      {rows.map((row) => {
        // #142, #143 AC10: Out and GK add up to Total, and the units to Out.
        const sec = minutesRowSeconds(row);
        return (
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
                  .map((u) => `${UNIT_LABEL[u]} ${formatClock(sec.byUnit[u] * 1000)}`)
                  .join(' · ')}
              </Text>
              {/* #102 AC4: matches attended and missed; AC3: average per match attended. */}
              <Text style={local.units} numberOfLines={1}>
                {attendanceLine(attendance.get(row.playerId))}
              </Text>
              {shareLabel(shares.get(row.playerId)) !== '' && (
                <Text
                  style={[
                    local.units,
                    shares.get(row.playerId)?.status === 'below' && local.below,
                  ]}
                  numberOfLines={1}
                >
                  {shareLabel(shares.get(row.playerId))}
                </Text>
              )}
            </View>
            <Text style={local.figure} numberOfLines={1}>
              {formatClock(sec.outfield * 1000)}
            </Text>
            <Text style={[local.figure, row.goalkeeperMs === 0 && local.faint]} numberOfLines={1}>
              {row.goalkeeperMs === 0 ? '-' : formatClock(sec.goal * 1000)}
            </Text>
            <Text style={local.figure} numberOfLines={1}>
              {formatClock(sec.total * 1000)}
            </Text>
          </View>
        );
      })}

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
        Adds matches recorded after this phone's. A file from a phone that
        recorded its own matches is refused. Nothing here is ever overwritten
        or deleted.
      </Text>

      {message !== '' && <Text style={local.message}>{message}</Text>}
    </View>
  );
}

function attendanceLine(a: SeasonAttendance | undefined): string {
  if (!a) return '';
  const avg = a.averageMs === null ? '' : ` · ${formatClock(Math.round(a.averageMs))} a match`;
  return `Attended ${a.attended} · missed ${a.missed}${avg}`;
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
  below: { color: colours.warn },
  message: {
    alignSelf: 'stretch',
    color: colours.warn,
    fontSize: 14,
    includeFontPadding: false,
    marginTop: 10,
  },
});
