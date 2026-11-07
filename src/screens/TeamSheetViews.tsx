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
import { benchOf, canRearrange, isPinned, sheetTable, shortLabel } from '../app/teamSheetEdit';
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
  onRearrange,
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
  /** ⟳ Rearrange one period: same children, new places (Rob, 6 Nov). */
  onRearrange: (periodIndex: number) => void;
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
        <Formation plan={plan} format={format} coming={coming} name={name} short={short} tap={tap} isPicked={isPicked} onOpen={onOpen} onRearrange={onRearrange} />
      ) : (
        <Table plan={plan} format={format} coming={coming} name={name} short={short} tap={tap} isPicked={isPicked} onRearrange={onRearrange} />
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
  onRearrange,
}: {
  plan: MatchPlan;
  format: Format;
  coming: readonly UUID[];
  name: (id: UUID) => string;
  short: string;
  tap: Tap;
  isPicked: IsPicked;
  onOpen: (periodIndex: number) => void;
  onRearrange: (periodIndex: number) => void;
}) {
  const { width, height } = useWindowDimensions();
  // C14: 2 × 2 in portrait, four in a row in landscape.
  const perRow = width > height ? Math.min(4, plan.periods.length) : Math.min(2, plan.periods.length);
  const spots = slotSpots(format);
  // A row of four (11-a-side) takes narrower chips, so none overlap.
  const widest = Math.max(1, ...[...new Set(spots.map((s) => s.y))].map((y) => spots.filter((s) => s.y === y).length));
  const chipPct = widest >= 4 ? 24 : 32;
  // One bench row per quarter (mock v2): as many names as fit, then "+n",
  // which opens that quarter on the full pitch where the whole bench shows.
  const cardWidth = (width - 36) / perRow - 6;
  const chipWidth = (n: string) => n.length * 7 + 22;
  const benchRow = (bench: UUID[]) => {
    let used = 0;
    const shown: UUID[] = [];
    for (const id of bench) {
      const w = chipWidth(name(id)) + 4;
      const room = cardWidth - (shown.length + 1 < bench.length ? 40 : 0);
      if (used + w > room) break;
      shown.push(id);
      used += w;
    }
    return { shown, more: bench.length - shown.length };
  };
  return (
    <View style={local.grid}>
      {plan.periods.map((period, p) => {
        const subs = period.subs.filter((s) => s.onId && s.offId);
        const offAt = (id: UUID | null) => subs.find((s) => id !== null && s.offId === id);
        const bench = benchOf(period, coming);
        const row = benchRow(bench);
        return (
          <View key={p} style={[local.card, { width: `${100 / perRow}%` }]}>
            <View style={local.cardHead}>
              <Text style={local.cardTitle} numberOfLines={1}>
                {`${short}${p + 1}`}
                {subs.length ? <Text style={local.cardSub}>{` · ${subs.length} ${subs.length === 1 ? 'sub' : 'subs'}`}</Text> : null}
              </Text>
              <Pressable
                onPress={() => onRearrange(p)}
                disabled={!canRearrange(period, format)}
                // 48 dp, drawn (#277 C13; QA on #279, D5: slop past the parent is ignored).
                accessibilityRole="button"
                accessibilityLabel={`Rearrange ${short}${p + 1}: same children, new places`}
                style={({ pressed }) => [local.rearrange, !canRearrange(period, format) && local.off, pressed && local.pressed]}
              >
                <Text style={local.rearrangeText}>⟳ Rearrange</Text>
              </Pressable>
            </View>
            <View style={local.pitch}>
              {spots.map((spot) => {
                const who = period.slots[spot.positionId] ?? null;
                const position = format.positions.find((x) => x.id === spot.positionId)!;
                const offSub = offAt(who);
                const keeper = position.kind === 'goalkeeper';
                return (
                  <Pressable
                    key={spot.positionId}
                    onPress={() => tap(p, who, spot.positionId)}
                    accessibilityRole="button"
                    accessibilityLabel={`${short}${p + 1}, ${position.label}, ${who ? name(who) : 'empty'}${offSub ? `, off at ${formatSubTime(offSub.atMs)}` : ''}`}
                    style={[local.chipHit, { width: `${chipPct}%`, left: `${spot.x * 100 - chipPct / 2}%`, top: `${spot.y * 100 - 9}%` }]}
                  >
                    <View style={[local.chip, keeper && local.chipKeeper, isPicked(p, who) && local.chipPicked]}>
                      {!keeper && isPinned(period, spot.positionId) && <View style={local.mark} />}
                      <Text style={local.chipName} numberOfLines={1} ellipsizeMode="tail">
                        {who ? name(who) : '–'}
                      </Text>
                      <Text style={local.chipRole} numberOfLines={1}>
                        {offSub ? 'off' : shortLabel(position)}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            {/* The bench, small: one row on a plank; whoever comes on in gold (mock v2). */}
            <View style={local.bench}>
              {bench.length === 0 && <Text style={local.benchNone}>Nobody on the bench</Text>}
              {row.shown.map((id) => (
                <Pressable
                  key={id}
                  onPress={() => tap(p, id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${short}${p + 1}, bench, ${name(id)}${subs.some((x) => x.onId === id) ? ', comes on at the sub' : ''}`}
                  style={local.benchHit}
                >
                  <View style={[local.benchChip, subs.some((x) => x.onId === id) && local.benchGold, isPicked(p, id) && local.chipPicked]}>
                    <Text style={local.benchName} numberOfLines={1}>
                      {name(id)}
                    </Text>
                  </View>
                </Pressable>
              ))}
              {row.more > 0 && (
                <Pressable
                  onPress={() => onOpen(p)}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.more} more on the bench: open ${short}${p + 1} on the pitch`}
                  style={local.benchHit}
                >
                  <View style={[local.benchChip, local.moreChip]}>
                    <Text style={local.moreText}>{`+${row.more}`}</Text>
                  </View>
                </Pressable>
              )}
            </View>
            <View style={local.plank} />
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
  onRearrange,
}: {
  plan: MatchPlan;
  format: Format;
  coming: readonly UUID[];
  name: (id: UUID) => string;
  short: string;
  tap: Tap;
  isPicked: IsPicked;
  onRearrange: (periodIndex: number) => void;
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
              <Pressable
                key={p}
                onPress={() => onRearrange(p)}
                disabled={!canRearrange(plan.periods[p], format)}
                // 48 dp, drawn (#277 C13; QA on #279, D5).
                accessibilityRole="button"
                accessibilityLabel={`Rearrange ${short}${p + 1}: same children, new places`}
                style={[local.headCell, { width: CELL_W }]}
              >
                <Text style={local.head}>{`${short}${p + 1} ⟳`}</Text>
              </Pressable>
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
  bench: { flexDirection: 'row', flexWrap: 'nowrap', overflow: 'hidden', marginTop: 4 },
  benchNone: { color: colours.inkFaint, fontSize: 12, paddingVertical: 12 },
  benchHit: { minHeight: TOUCH_TARGET, justifyContent: 'flex-end', paddingRight: 4, flexShrink: 0 },
  benchChip: {
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    borderWidth: 1,
    borderColor: colours.line,
    backgroundColor: colours.pitchRaised,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  benchGold: { borderColor: colours.warn },
  benchName: { color: colours.ink, fontSize: 12, includeFontPadding: false },
  moreChip: { borderColor: colours.action },
  moreText: { color: colours.action, fontSize: 12, fontWeight: '600', includeFontPadding: false },
  plank: { height: 7, borderRadius: 3, backgroundColor: colours.wood, marginTop: -2, marginBottom: 8 },
  rearrange: { minHeight: TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 8, borderRadius: 10, borderWidth: 1, borderColor: colours.line },
  rearrangeText: { color: colours.action, fontSize: 12, fontWeight: '600', includeFontPadding: false },
  off: { opacity: 0.35 },
  pressed: { opacity: 0.6 },
  mark: { position: 'absolute', top: 3, right: 5, width: 5, height: 5, borderRadius: 3, backgroundColor: colours.main },
  table: { flexDirection: 'row', marginTop: 4 },
  headRow: { flexDirection: 'row' },
  headCell: { height: TOUCH_TARGET, justifyContent: 'center' },
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
