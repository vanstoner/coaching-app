/**
 * The team sheet's overviews — #277 C13–C18 (Dee's prototype; Rob, 5 and
 * 6 Nov). The real pitch, one quarter at a time, is on TeamSheetScreen.
 *
 * - **All quarters:** every period at once, 2 × 2 in portrait and four in a
 *   row in landscape, each as white pills with its bench below. Open shows
 *   that period on the full pitch, where dragging works as on the Lineup.
 * - **Table:** a row per position, front to back, then Bench rows; a column
 *   per period. The position column stays put when the table scrolls.
 *
 * In both: tap one child, then another in the same period, and they swap,
 * the bench included; tap a child, then an empty place, and they go there
 * (C17). Every name and note is worked out from the plan each draw.
 */

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from './Text';
import type { Format, UUID } from '../types/index';
import { formatSubTime } from '../app/matchClock';
import { slotSpots } from '../app/pitchLayout';
import type { MatchPlan } from '../app/matchPlan';
import { benchOf, sheetTable, shortLabel } from '../app/teamSheetEdit';
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
  onSwap,
  onPlace,
  onOpen,
}: {
  plan: MatchPlan;
  format: Format;
  /** The children coming, in squad order. */
  coming: readonly UUID[];
  name: (id: UUID) => string;
  /** "Q" or "H". */
  short: string;
  /** Side by side, or the table. */
  view: 'formation' | 'table';
  onSwap: (periodIndex: number, a: UUID, b: UUID) => void;
  /** A picked child onto an empty place. */
  onPlace: (periodIndex: number, id: UUID, positionId: UUID) => void;
  /** Show this period on the full pitch. */
  onOpen: (periodIndex: number) => void;
}) {
  // The first tap of a swap: which period, and who.
  const [picked, setPicked] = useState<{ period: number; id: UUID } | null>(null);
  const tap = (period: number, id: UUID | null, positionId: UUID | null = null) => {
    if (id === null) {
      // An empty place: the picked child goes there.
      if (picked && picked.period === period && positionId) onPlace(period, picked.id, positionId);
      setPicked(null);
      return;
    }
    if (picked && picked.period === period) {
      if (picked.id !== id) onSwap(period, picked.id, id);
      setPicked(null);
      return;
    }
    setPicked({ period, id });
  };
  const noun = short === 'Q' ? 'quarter' : 'half';
  const isPicked = (period: number, id: UUID | null) => id !== null && picked?.period === period && picked.id === id;

  return (
    <View>
      <Text style={local.hint}>
        {picked
          ? `Now tap who they swap with, in the same ${noun}.`
          : `Tap one child, then another in the same ${noun}, to swap them, bench included.`}
      </Text>
      {view === 'formation' ? (
        <Formation plan={plan} format={format} coming={coming} name={name} short={short} tap={tap} isPicked={isPicked} onOpen={onOpen} />
      ) : (
        <Table plan={plan} format={format} coming={coming} name={name} short={short} tap={tap} isPicked={isPicked} />
      )}
    </View>
  );
}

type Tap = (period: number, id: UUID | null, positionId?: UUID | null) => void;
type IsPicked = (period: number, id: UUID | null) => boolean;

function Formation({
  plan,
  format,
  coming,
  name,
  short,
  tap,
  isPicked,
  onOpen,
}: {
  plan: MatchPlan;
  format: Format;
  coming: readonly UUID[];
  name: (id: UUID) => string;
  short: string;
  tap: Tap;
  isPicked: IsPicked;
  onOpen: (periodIndex: number) => void;
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
              <Text style={local.cardTitle} numberOfLines={1}>
                {`${short}${p + 1}`}
                {sub ? <Text style={local.cardSub}>{` · ${name(sub.onId!)} on ${formatSubTime(sub.atMs)}`}</Text> : null}
              </Text>
              <Pressable
                onPress={() => onOpen(p)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${short}${p + 1} on the pitch`}
                style={local.enlarge}
              >
                <Text style={local.enlargeText}>Open</Text>
              </Pressable>
            </View>
            <View style={local.pitch}>
              {spots.map((spot) => {
                const who = period.slots[spot.positionId] ?? null;
                const position = format.positions.find((x) => x.id === spot.positionId)!;
                const off = sub && who === sub.offId;
                const keeper = position.kind === 'goalkeeper';
                return (
                  <Pressable
                    key={spot.positionId}
                    onPress={() => tap(p, who, spot.positionId)}
                    accessibilityRole="button"
                    accessibilityLabel={`${short}${p + 1}, ${position.label}, ${who ? name(who) : 'empty'}${off ? `, off at ${formatSubTime(sub.atMs)}` : ''}`}
                    style={[local.chipHit, { width: `${chipPct}%`, left: `${spot.x * 100 - chipPct / 2}%`, top: `${spot.y * 100 - 9}%` }]}
                  >
                    <View style={[local.chip, keeper && local.chipKeeper, isPicked(p, who) && local.chipPicked]}>
                      <Text style={local.chipName} numberOfLines={1} ellipsizeMode="tail">
                        {who ? name(who) : '–'}
                      </Text>
                      <Text style={local.chipRole} numberOfLines={1}>
                        {off ? `${shortLabel(position)} · off ${formatSubTime(sub.atMs)}` : shortLabel(position)}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <Text style={local.benchLabelSmall}>Bench</Text>
            <View style={local.bench}>
              {bench.length === 0 && <Text style={local.benchNone}>Nobody</Text>}
              {bench.map((id) => (
                <Pressable
                  key={id}
                  onPress={() => tap(p, id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${short}${p + 1}, bench, ${name(id)}${sub && sub.onId === id ? `, on at ${formatSubTime(sub.atMs)}` : ''}`}
                  style={local.benchHit}
                >
                  <View style={[local.benchChip, isPicked(p, id) && local.chipPicked]}>
                    <Text style={local.benchName} numberOfLines={1}>
                      {name(id)}
                    </Text>
                  </View>
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
                  onPress={() => tap(p, cell.playerId, row.positionId)}
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
  cardTitle: { flex: 1, color: colours.ink, fontSize: 15, fontWeight: '600', includeFontPadding: false },
  cardSub: { color: colours.inkMuted, fontSize: 12, fontWeight: '400' },
  enlarge: { minHeight: TOUCH_TARGET, justifyContent: 'center', paddingLeft: 6 },
  enlargeText: { color: colours.action, fontSize: 13, fontWeight: '600', includeFontPadding: false },
  pitch: {
    position: 'relative',
    aspectRatio: 0.75,
    backgroundColor: colours.pitchRaised,
    borderWidth: 1,
    borderColor: colours.line,
    borderRadius: 8,
  },
  // The hit area is a full touch target; the pill inside it is drawn smaller (C18).
  chipHit: { position: 'absolute', minHeight: TOUCH_TARGET, justifyContent: 'center', alignItems: 'center' },
  // Prototype (Dee, 1 Nov): a white pill, the position under the name; the keeper gold.
  chip: {
    alignSelf: 'stretch',
    backgroundColor: colours.ink,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'transparent',
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  chipKeeper: { backgroundColor: colours.warn },
  // Colour only: metrics never change between states (theme.ts).
  chipPicked: { borderColor: colours.warn },
  chipName: { alignSelf: 'stretch', textAlign: 'center', color: '#0b3d2e', fontSize: 12, fontWeight: '700', includeFontPadding: false, flexShrink: 0 },
  chipRole: { alignSelf: 'stretch', textAlign: 'center', color: '#3f6b5b', fontSize: 9, fontWeight: '600', includeFontPadding: false },
  benchLabelSmall: { color: colours.inkMuted, fontSize: 11, letterSpacing: 1, marginTop: 6, includeFontPadding: false },
  bench: { flexDirection: 'row', flexWrap: 'wrap' },
  benchNone: { color: colours.inkFaint, fontSize: 12, paddingVertical: 8 },
  benchHit: { width: '50%', minHeight: TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 2 },
  benchChip: { borderRadius: 14, borderWidth: 2, borderColor: colours.line, borderStyle: 'dashed', paddingVertical: 4 },
  benchName: { alignSelf: 'stretch', textAlign: 'center', color: colours.ink, fontSize: 12, includeFontPadding: false },
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
