/**
 * The team sheet's two views — #277 C13–C18 (Dee's prototype; Rob, 5 Nov).
 *
 * - **Formation:** every period at once, 2 × 2 in portrait and four in a row
 *   in landscape, each pitch with its bench below. ⤢ enlarges one period to
 *   the full pitch, where dragging works as on the Lineup (TeamSheetScreen).
 * - **Table:** a row per position, front to back, then Bench rows; a column
 *   per period. The position column stays put when the table scrolls.
 *
 * In both: tap one child, then another in the same period, and they swap,
 * the bench included (C17). The choice of view is remembered on this phone
 * only (C13, D5). Every name and note is worked out from the plan each draw.
 */

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from './Text';
import type { Format, UUID } from '../types/index';
import { formatSubTime } from '../app/matchClock';
import { slotSpots } from '../app/pitchLayout';
import type { MatchPlan } from '../app/matchPlan';
import { benchOf, sheetTable, shortLabel, type SheetView } from '../app/teamSheetEdit';
import { Segmented } from './controls';
import { colours, TOUCH_TARGET } from './theme';

/** The table's column widths, in dp: a 320 dp phone shows the labels and most of four columns. */
const LABEL_W = 52;
const CELL_W = 84;

export function TeamSheetViews({
  plan,
  format,
  coming,
  name,
  short,
  view,
  onView,
  onSwap,
  onEnlarge,
}: {
  plan: MatchPlan;
  format: Format;
  /** The children coming, in squad order. */
  coming: readonly UUID[];
  name: (id: UUID) => string;
  /** "Q" or "H". */
  short: string;
  view: SheetView;
  onView: (view: SheetView) => void;
  onSwap: (periodIndex: number, a: UUID, b: UUID) => void;
  onEnlarge: (periodIndex: number) => void;
}) {
  // The first tap of a swap: which period, and who.
  const [picked, setPicked] = useState<{ period: number; id: UUID } | null>(null);
  const tap = (period: number, id: UUID | null) => {
    if (id === null) return;
    if (picked && picked.period === period) {
      if (picked.id !== id) onSwap(period, picked.id, id);
      setPicked(null);
      return;
    }
    setPicked({ period, id });
  };
  const isPicked = (period: number, id: UUID | null) => id !== null && picked?.period === period && picked.id === id;

  return (
    <View>
      <Segmented<SheetView>
        name="View"
        options={[
          { value: 'formation', label: 'Formation' },
          { value: 'table', label: 'Table' },
        ]}
        value={view}
        onChange={(v) => v && onView(v)}
      />
      <Text style={local.hint}>
        {picked ? 'Now tap who they swap with, in the same period.' : 'Tap one child, then another in the same period, to swap them.'}
      </Text>
      {view === 'formation' ? (
        <Formation plan={plan} format={format} coming={coming} name={name} short={short} tap={tap} isPicked={isPicked} onEnlarge={onEnlarge} />
      ) : (
        <Table plan={plan} format={format} coming={coming} name={name} short={short} tap={tap} isPicked={isPicked} />
      )}
    </View>
  );
}

type Tap = (period: number, id: UUID | null) => void;
type IsPicked = (period: number, id: UUID | null) => boolean;

function Formation({
  plan,
  format,
  coming,
  name,
  short,
  tap,
  isPicked,
  onEnlarge,
}: {
  plan: MatchPlan;
  format: Format;
  coming: readonly UUID[];
  name: (id: UUID) => string;
  short: string;
  tap: Tap;
  isPicked: IsPicked;
  onEnlarge: (periodIndex: number) => void;
}) {
  const { width, height } = useWindowDimensions();
  // C14: 2 × 2 in portrait, four in a row in landscape.
  const perRow = width > height ? Math.min(4, plan.periods.length) : Math.min(2, plan.periods.length);
  const spots = slotSpots(format);
  // A row of four (11-a-side) takes narrower chips, so none overlap.
  const widest = Math.max(1, ...[...new Set(spots.map((s) => s.y))].map((y) => spots.filter((s) => s.y === y).length));
  const chipPct = widest >= 4 ? 24 : 32;
  return (
    <View style={local.grid}>
      {plan.periods.map((period, p) => {
        const sub = period.subs.find((s) => s.onId && s.offId);
        const bench = benchOf(period, coming);
        return (
          <View key={p} style={[local.card, { width: `${100 / perRow}%` }]}>
            <View style={local.cardHead}>
              <Text style={local.cardTitle}>{`${short}${p + 1}`}</Text>
              <Pressable
                onPress={() => onEnlarge(p)}
                accessibilityRole="button"
                accessibilityLabel={`Enlarge ${short}${p + 1}`}
                hitSlop={8}
                style={local.enlarge}
              >
                <Text style={local.enlargeText}>⤢</Text>
              </Pressable>
            </View>
            <Text style={local.cardSub} numberOfLines={1}>
              {sub ? `${name(sub.onId!)} on ${formatSubTime(sub.atMs)}` : ' '}
            </Text>
            <View style={local.pitch}>
              {spots.map((spot) => {
                const who = period.slots[spot.positionId] ?? null;
                const off = sub && who === sub.offId;
                return (
                  <Pressable
                    key={spot.positionId}
                    onPress={() => tap(p, who)}
                    accessibilityRole="button"
                    accessibilityLabel={`${short}${p + 1}, ${spot.label}, ${who ? name(who) : 'empty'}${off ? ', comes off' : ''}`}
                    style={[
                      local.chip,
                      { width: `${chipPct}%`, left: `${spot.x * 100 - chipPct / 2}%`, top: `${spot.y * 100 - 9}%` },
                      isPicked(p, who) && local.chipPicked,
                    ]}
                  >
                    <Text style={local.chipName} numberOfLines={1} ellipsizeMode="tail">
                      {who ? name(who) : '–'}
                    </Text>
                    {off && <Text style={local.chipSub}>{`${shortLabel(format.positions.find((x) => x.id === spot.positionId)!)} ⇄`}</Text>}
                  </Pressable>
                );
              })}
            </View>
            <View style={local.bench}>
              {bench.map((id) => (
                <Pressable
                  key={id}
                  onPress={() => tap(p, id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${short}${p + 1}, bench, ${name(id)}`}
                  style={[local.benchChip, isPicked(p, id) && local.chipPicked]}
                >
                  <Text style={local.benchName} numberOfLines={1}>
                    {name(id)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Table({
  plan,
  format,
  coming,
  name,
  short,
  tap,
  isPicked,
}: {
  plan: MatchPlan;
  format: Format;
  coming: readonly UUID[];
  name: (id: UUID) => string;
  short: string;
  tap: Tap;
  isPicked: IsPicked;
}) {
  const rows = sheetTable(plan, format, coming, name);
  return (
    <View style={local.table}>
      {/* C15: the position column stays put; the periods scroll. */}
      <View style={{ width: LABEL_W }}>
        <View style={local.headCell} />
        {rows.map((row, r) => (
          <View key={r} style={local.labelCell}>
            <Text style={[local.label, row.positionId === null && local.benchLabel]} numberOfLines={1}>
              {row.label}
            </Text>
          </View>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={local.headRow}>
            {plan.periods.map((_, p) => (
              <View key={p} style={[local.headCell, { width: CELL_W }]}>
                <Text style={local.head}>{`${short}${p + 1}`}</Text>
              </View>
            ))}
          </View>
          {rows.map((row, r) => (
            <View key={r} style={local.tableRow}>
              {row.cells.map((cell, p) => (
                <Pressable
                  key={p}
                  onPress={() => tap(p, cell.playerId)}
                  accessibilityRole="button"
                  accessibilityLabel={`${short}${p + 1}, ${row.label}, ${cell.playerId ? name(cell.playerId) : 'empty'}${cell.note ? `, ${cell.note}` : ''}`}
                  style={[local.cell, { width: CELL_W }, isPicked(p, cell.playerId) && local.chipPicked]}
                >
                  <Text style={[local.cellName, row.positionId === null && local.benchName]} numberOfLines={1}>
                    {cell.playerId ? name(cell.playerId) : '–'}
                  </Text>
                  {cell.note && (
                    <Text style={local.cellNote} numberOfLines={1}>
                      {cell.note}
                    </Text>
                  )}
                </Pressable>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const local = StyleSheet.create({
  hint: { color: colours.inkMuted, fontSize: 13, includeFontPadding: false, marginVertical: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 },
  card: { padding: 3 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: colours.ink, fontSize: 15, fontWeight: '600', includeFontPadding: false },
  enlarge: { minWidth: TOUCH_TARGET, minHeight: TOUCH_TARGET, alignItems: 'flex-end', justifyContent: 'center' },
  enlargeText: { color: colours.action, fontSize: 20, includeFontPadding: false },
  cardSub: { color: colours.inkMuted, fontSize: 12, includeFontPadding: false, marginBottom: 2 },
  pitch: {
    position: 'relative',
    aspectRatio: 0.72,
    backgroundColor: colours.pitchRaised,
    borderWidth: 1,
    borderColor: colours.line,
    borderRadius: 6,
  },
  chip: {
    position: 'absolute',
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  chipPicked: { backgroundColor: colours.accent },
  chipName: { alignSelf: 'stretch', textAlign: 'center', color: colours.ink, fontSize: 12, includeFontPadding: false, flexShrink: 0 },
  chipSub: { color: colours.saved, fontSize: 10, includeFontPadding: false },
  bench: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 },
  benchChip: { width: '50%', minHeight: TOUCH_TARGET, justifyContent: 'center', borderRadius: 8 },
  benchName: { alignSelf: 'stretch', textAlign: 'center', color: colours.inkMuted, fontSize: 12, includeFontPadding: false },
  table: { flexDirection: 'row', marginTop: 4 },
  headRow: { flexDirection: 'row' },
  headCell: { height: 32, justifyContent: 'center' },
  head: { color: colours.inkMuted, fontSize: 13, fontWeight: '600', textAlign: 'center', includeFontPadding: false },
  labelCell: { height: TOUCH_TARGET, justifyContent: 'center', borderTopWidth: 1, borderTopColor: colours.hair },
  label: { color: colours.saved, fontSize: 13, fontWeight: '600', includeFontPadding: false },
  benchLabel: { color: colours.inkMuted },
  tableRow: { flexDirection: 'row' },
  cell: {
    height: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: colours.hair,
  },
  cellName: { color: colours.ink, fontSize: 14, includeFontPadding: false },
  cellNote: { color: colours.inkMuted, fontSize: 11, includeFontPadding: false },
});
