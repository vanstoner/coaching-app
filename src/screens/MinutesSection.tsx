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
 * figure; Out and GK are its breakdown. The table sorts by its numbers, Total
 * most first by default, and a tap on a heading re-sorts it (#208, which
 * overturned PO ruling Q1's squad order here). Ties keep squad order. A player's
 * outfield-share target is shown under their name as on track or below, and
 * is never a fairness input.
 */

import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from './Text';

import { formatClock } from '../app/matchClock';
import { inSquadOrder, minutesRowSeconds } from '../app/analysis';
import { NAME, sortSettingsMinutes } from '../app/tableSort';
import { UNIT_LABEL, isExcluded, seasonRows, type Ledger } from '../app/ledger';
import { seasonOutfieldShares, shareLabel } from '../app/outfieldTarget';
import type { Player, UUID } from '../types/index';
import { SQUAD_OPTIONS, type SquadMatching, type SquadOption } from '../app/squadMatch';
import { inferredMatchCount, seasonAttendance, type SeasonAttendance } from '../app/attendance';
import { colours, screen } from './theme';
import { SortHeading, useTableSort } from './TableSort';

export function MinutesSection({
  ledger,
  players,
  kickoffs,
  message,
  busy,
  onExport,
  onImport,
  matching = null,
  onChoose,
  onCancelImport,
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
  /** #195 (QA N1): the phone's squad against the file's, waiting on the coach's choice. */
  matching?: SquadMatching | null;
  onChoose?: (option: SquadOption) => void;
  onCancelImport?: () => void;
}) {
  // #208: sorted by the heading the coach chose, Total most first by default.
  // Squad order underneath, so ties keep it; anyone the ledger knows who is
  // not in this squad follows them on a tie.
  const { sort, onSort } = useTableSort('settingsMinutes');
  const rows = sortSettingsMinutes(inSquadOrder(ledger ? seasonRows(ledger) : [], players), sort);
  const shares = ledger ? seasonOutfieldShares(ledger, players) : new Map();
  const matches = ledger?.matches.length ?? 0;
  // ADR-020: matches the coach left out are in the record, not in the figures.
  const leftOut = ledger?.matches.filter(isExcluded).length ?? 0;
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
        {leftOut > 0 ? ` ${leftOut} left out of the figures.` : ''}
        {inferred > 0
          ? ` Attendance for ${inferred} ${inferred === 1 ? 'match was' : 'matches was'} worked out from who played.`
          : ''}
      </Text>

      {rows.length > 0 && (
        <View style={local.head}>
          <SortHeading label="Player" column={NAME} sort={sort} onSort={onSort} align="left" style={local.nameCol} />
          <SortHeading label="Out" column="out" sort={sort} onSort={onSort} style={local.figureHead} />
          <SortHeading label="GK" column="gk" sort={sort} onSort={onSort} style={local.figureHead} />
          <SortHeading label="Total" column="total" sort={sort} onSort={onSort} style={local.figureHead} />
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
              {/* #102 AC4: matches attended and missed; AC3: average per match attended.
                  #208: wraps rather than losing its tail beside the three figures. */}
              <Text style={local.units}>{attendanceLine(attendance.get(row.playerId))}</Text>
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
        disabled={busy || matching !== null}
        onPress={onImport}
        style={({ pressed }) => [
          screen.buttonQuiet,
          (busy || matching !== null) && screen.buttonDisabled,
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

      {matching !== null && onChoose && onCancelImport && (
        <MatchStep
          // A fresh step, defaulting to Match by name, for each file chosen.
          key={matching.pairs.map((p) => p.file.id).join(',')}
          matching={matching}
          onChoose={onChoose}
          onCancel={onCancelImport}
        />
      )}

      {message !== '' && <Text style={local.message}>{message}</Text>}
    </View>
  );
}

const nameOf = (p: { firstName: string; displaySuffix?: string | null }) =>
  p.displaySuffix ? `${p.firstName} ${p.displaySuffix}` : p.firstName;

const childWord = (n: number) => (n === 1 ? 'child' : 'children');

/**
 * #195 (QA N1): before anything is applied, this phone's squad against the
 * file's, and the coach's choice. Match by name is selected by default.
 * Cancel imports nothing. Every line wraps: names and notes must not lose
 * their tail on a narrow phone.
 */
function MatchStep({
  matching,
  onChoose,
  onCancel,
}: {
  matching: SquadMatching;
  onChoose: (option: SquadOption) => void;
  onCancel: () => void;
}) {
  const [option, setOption] = useState<SquadOption>('match');
  const { pairs, fileOnly, phoneOnly, notMatched } = matching;
  return (
    <View style={local.step}>
      <Text style={screen.fieldLabel}>Children in this file</Text>
      <Text style={local.stepHead}>
        {pairs.length} {childWord(pairs.length)} match by name
      </Text>
      {pairs.map((p) => {
        const phone = nameOf(p.phone).trim();
        const file = nameOf(p.file);
        return (
          <Text key={p.file.id} style={local.stepLine}>
            {phone === file ? file : `${phone} → ${file}`}
            {p.notes.length > 0 ? ` (${p.notes.join('; ')})` : ''}
          </Text>
        );
      })}
      {fileOnly.length > 0 && (
        <>
          <Text style={local.stepHead}>
            {fileOnly.length} only in the file, added
          </Text>
          <Text style={local.stepLine}>{fileOnly.map(nameOf).join(', ')}</Text>
        </>
      )}
      {phoneOnly.length > 0 && (
        <>
          <Text style={local.stepHead}>{phoneOnly.length} only on this phone</Text>
          <Text style={local.stepLine}>{phoneOnly.map(nameOf).join(', ')}</Text>
        </>
      )}
      {notMatched.length > 0 && (
        <>
          <Text style={local.stepHead}>Not matched, the name appears more than once</Text>
          <Text style={local.stepLine}>
            {notMatched.map((x) => `${x.name} (${x.side === 'phone' ? 'this phone' : 'the file'})`).join(', ')}
          </Text>
        </>
      )}

      {SQUAD_OPTIONS.map((o) => {
        const selected = option === o.option;
        return (
          <Pressable
            key={o.option}
            onPress={() => setOption(o.option)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={({ pressed }) => [local.option, selected && local.optionOn, pressed && screen.buttonPressed]}
          >
            {/* Colour only between states: a weight change re-measures and clips (theme.ts). */}
            <Text style={[local.optionLabel, selected && local.optionLabelOn]}>{o.label}</Text>
            <Text style={[local.optionHint, selected && local.optionLabelOn]}>{o.hint}</Text>
          </Pressable>
        );
      })}

      <Pressable
        onPress={() => onChoose(option)}
        style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]}
      >
        <Text style={screen.buttonLabel}>Import</Text>
      </Pressable>
      <Pressable onPress={onCancel} style={screen.linkHit} accessibilityRole="button">
        <Text style={screen.link}>Cancel</Text>
      </Pressable>
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
  // The heading over a figure: the figure's width, no shrink.
  figureHead: { width: 64, flexShrink: 0 },
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
  step: {
    alignSelf: 'stretch',
    marginTop: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colours.line,
    borderRadius: 10,
    backgroundColor: colours.pitchRaised,
  },
  stepHead: { color: colours.ink, fontSize: 15, includeFontPadding: false, marginTop: 8 },
  stepLine: { color: colours.inkMuted, fontSize: 13, includeFontPadding: false, marginTop: 2 },
  option: {
    alignSelf: 'stretch',
    marginTop: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: colours.line,
    borderRadius: 10,
  },
  optionOn: { backgroundColor: colours.accent, borderColor: colours.accent },
  optionLabel: { color: colours.inkMuted, fontSize: 15, fontWeight: '600', includeFontPadding: false },
  optionLabelOn: { color: colours.ink },
  optionHint: { color: colours.inkFaint, fontSize: 12, includeFontPadding: false, marginTop: 2 },
  message: {
    alignSelf: 'stretch',
    color: colours.warn,
    fontSize: 14,
    includeFontPadding: false,
    marginTop: 10,
  },
});
