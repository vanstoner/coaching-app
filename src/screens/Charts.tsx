/**
 * The match bar chart — #105, ADR-016. The season chart it sat beside was
 * removed by #121: season figures live on each child's page in Squad. The
 * squad views' charts (#143) are drawn the same way, below.
 *
 * Plain `View` and `Text`: a bar is a box whose width is a fraction of the
 * track. No drawing library. Every number arrives ready from
 * `src/app/analysis.ts`; these only map rows to boxes.
 *
 * **Colours (AC4).** Green and orange are taken by the app and the beta's
 * identity, so the bars use the Okabe–Ito palette, designed to stay distinct
 * under the common colour-vision deficiencies, and readable on the dark pitch
 * green: sky blue. Colour is never the only cue:
 *
 * - This match: one bar in two segments that differ in LIGHTNESS (pale = in
 *   goal, full = outfield), named in the legend.
 * - The shadow: an OUTLINE with no fill, drawn over the bar so it shows
 *   whether the bar falls short of it or runs past it.
 *
 * **Legibility (AC4).** First names at 17, values in the same line as the
 * name ("Ava 32 · avg 28"), bars 22 high. Each row carries one
 * `accessibilityLabel` reading the same text (ADR-016 §6).
 */

import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type DimensionValue } from 'react-native';
import { Text } from './Text';

import type { MatchChart } from '../app/analysis';
import type { PositionUnit } from '../types/index';
import { colours } from './theme';

export const chartColours = {
  /** Okabe–Ito sky blue: this match, outfield. */
  outfield: '#56B4E9',
  /** The same hue, lighter: this match, in goal. */
  goal: '#C6E7F8',
  /** The shadow's outline: no hue at all. */
  shadow: '#ffffff',
  track: '#164f3c',
  /** The fairness band: the outfield hue, washed out. */
  band: 'rgba(86, 180, 233, 0.18)',
  bandEdge: 'rgba(86, 180, 233, 0.5)',
  /** A bar that is only context: had more time, or owed under 5 min. */
  quiet: colours.inkFaint,
} as const;

/**
 * Positions, back to front: one hue, light to dark (#138 prototype, checked
 * on both pitch greens). GK is the in-goal colour above.
 */
export const unitColours: Record<PositionUnit, string> = {
  GK: '#C6E7F8',
  DEF: '#8DCDF0',
  MID: '#56B4E9',
  ATT: '#2B86C5',
};

const pct = (ms: number, max: number): DimensionValue =>
  `${Math.max(0, Math.min(100, max > 0 ? (ms / max) * 100 : 0))}%`;

/** #105 AC1: this match, over the shadow of the season average. */
export function MatchBars({ chart }: { chart: MatchChart }) {
  return (
    <View style={local.chart}>
      <View style={local.legend}>
        <Swatch fill={chartColours.outfield} label="Outfield" />
        <Swatch fill={chartColours.goal} label="In goal" />
        <Swatch outline label="Their average" />
      </View>
      {chart.rows.map((row) => (
        <View key={row.playerId} style={local.row} accessible accessibilityLabel={row.label}>
          <Text style={local.label} numberOfLines={1}>
            {row.label}
          </Text>
          <View style={local.track}>
            <View style={local.solid}>
              {row.goalMs > 0 && (
                <View
                  style={[local.segment, { width: pct(row.goalMs, chart.maxMs), backgroundColor: chartColours.goal }]}
                />
              )}
              {row.outfieldMs > 0 && (
                <View
                  style={[
                    local.segment,
                    { width: pct(row.outfieldMs, chart.maxMs), backgroundColor: chartColours.outfield },
                  ]}
                />
              )}
            </View>
            {row.shadowMs !== null && row.shadowMs > 0 && (
              <View style={[local.shadow, { width: pct(row.shadowMs, chart.maxMs) }]} />
            )}
          </View>
        </View>
      ))}
      {chart.absent.length > 0 && (
        <Text style={local.absent}>Not here: {chart.absent.join(', ')}</Text>
      )}
    </View>
  );
}

/**
 * #121: one child's minutes a game against a reference line — the squad
 * average on the Squad list, the target on a keeper's share. No line when
 * there is no reference (a Main keeper is not in the squad average).
 */
export function AverageBar({
  value,
  line,
  scale,
  wide = false,
}: {
  value: number;
  line: number | null;
  scale: number;
  wide?: boolean;
}) {
  const height = wide ? 14 : 8;
  return (
    <View style={[local.mini, { height }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[local.miniFill, { width: pct(value, scale) }]} />
      {line !== null && <View style={[local.miniTick, { left: pct(line, scale) }]} />}
    </View>
  );
}

// ============================================================================
// The squad views (#143): columns, a band of dots, owed bars, position stacks
// ============================================================================

export interface Column {
  /** Stacked from the bottom up; null where there is no column (not there). */
  segments: { value: number; colour: string }[] | null;
  /** Written under the column. */
  value: string;
  /** The day of the month, and the month under the first match of each month. */
  day: string;
  month: string;
  /** Read out for the column, and shown when it is tapped. */
  label: string;
}

/** A column is never narrower than this: past it the chart scrolls sideways, opening on the newest. */
const MIN_SLOT = 32;
const Y_AXIS = 26;

/**
 * One column per match, oldest first (#143 AC3; a child's match by match).
 * Gridlines every `step`, each value written under its column, an optional
 * reference line. Tapping a column calls `onSelect` with its index.
 */
export function ColumnChart({
  columns,
  max,
  step,
  height = 120,
  reference = null,
  onSelect,
}: {
  columns: Column[];
  max: number;
  step: number;
  height?: number;
  reference?: number | null;
  onSelect?: (index: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const scroller = useRef<ScrollView>(null);
  const slot = width > 0 ? Math.max(MIN_SLOT, width / Math.max(1, columns.length)) : MIN_SLOT;
  const usable = height - 4;
  const y = (v: number) => Math.round((Math.max(0, Math.min(v, max)) / Math.max(1, max)) * usable);
  const ticks: number[] = [];
  for (let t = 0; t <= max; t += step) ticks.push(t);

  return (
    <View style={local.cchart}>
      <View style={[local.yAxis, { height }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {ticks.map((t) => (
          <Text key={t} style={[local.yLabel, { bottom: y(t) - 7 }]} numberOfLines={1}>
            {t}
          </Text>
        ))}
      </View>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
      >
        <View style={{ width: Math.max(width, slot * columns.length) }}>
          <View style={[local.plot, { height }]}>
            {ticks.map((t) => (
              <View key={t} style={[local.gridline, { bottom: y(t) }]} />
            ))}
            <View style={local.slots}>
              {columns.map((c, j) => {
                const total = (c.segments ?? []).reduce((sum, s) => sum + s.value, 0);
                return (
                  <Pressable
                    key={j}
                    style={[local.slot, { width: slot }]}
                    onPress={onSelect ? () => onSelect(j) : undefined}
                    accessibilityRole={onSelect ? 'button' : undefined}
                    accessibilityLabel={c.label}
                  >
                    {total > 0 && (
                      <View style={[local.colm, { height: y(total) }]}>
                        {(c.segments ?? [])
                          .filter((s) => s.value > 0)
                          .map((s, k) => (
                            <View key={k} style={{ flexGrow: s.value, flexBasis: 0, backgroundColor: s.colour }} />
                          ))}
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
            {reference !== null && <View pointerEvents="none" style={[local.ref, { bottom: y(reference) }]} />}
          </View>
          {(['value', 'day', 'month'] as const).map((line) => (
            <View
              key={line}
              style={local.xRow}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {columns.map((c, j) => (
                <Text key={j} style={[local.xText, line === 'value' && local.xValue, { width: slot }]} numberOfLines={1}>
                  {c[line]}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * Fairness at a glance (#143 AC3): one child's minutes a game as a dot,
 * against the band of everyone within `gap` of the squad average.
 */
export function BandDot({
  value,
  average,
  gap,
  lo,
  hi,
}: {
  value: number;
  average: number;
  gap: number;
  lo: number;
  hi: number;
}) {
  const span = Math.max(1, hi - lo);
  const at = (v: number): DimensionValue => `${Math.max(0, Math.min(100, ((v - lo) / span) * 100))}%`;
  return (
    <View style={local.dtrack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={local.dline} />
      <View style={[local.band, { left: at(average - gap), width: `${Math.min(100, ((2 * gap) / span) * 100)}%` }]} />
      <View style={[local.dmid, { left: at(average) }]} />
      <View style={[local.dot, { left: at(value) }]} />
    </View>
  );
}

/**
 * Going into Saturday (#143 AC4): owed time to the left of level, more than
 * the average to the right. `strong`: owed 5 min or more (ruling 24).
 */
export function OwedBar({ owed, max, strong }: { owed: number; max: number; strong: boolean }) {
  const width: DimensionValue = `${Math.max(0, Math.min(50, (Math.abs(owed) / Math.max(1, max)) * 50))}%`;
  return (
    <View style={local.otrack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {owed > 0 && (
        <View
          style={[
            local.obar,
            local.owedSide,
            { width, backgroundColor: strong ? chartColours.outfield : chartColours.quiet },
          ]}
        />
      )}
      {owed < 0 && <View style={[local.obar, local.moreSide, { width }]} />}
      <View style={local.ozero} />
    </View>
  );
}

/** Positions tried (#143 AC5): one child's own time, GK to FWD, as a full-width stack. */
export function UnitStack({ minutes }: { minutes: Record<PositionUnit, number> }) {
  const units = (['GK', 'DEF', 'MID', 'ATT'] as const).filter((u) => minutes[u] > 0);
  return (
    <View style={local.ustack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {units.map((u, k) => (
        <View
          key={u}
          style={[
            local.useg,
            { flexGrow: minutes[u], backgroundColor: unitColours[u] },
            k > 0 && local.usegGap,
            k === units.length - 1 && local.usegLast,
          ]}
        />
      ))}
    </View>
  );
}

/** A legend entry: a swatch (box, tick, line, band or in-goal mark) and its words. */
export function KeyItem({
  label,
  fill,
  shape = 'box',
}: {
  label: string;
  fill?: string;
  shape?: 'box' | 'tick' | 'line' | 'band' | 'mark';
}) {
  const swatch = {
    box: local.keyBox,
    tick: local.keyTick,
    line: local.keyLine,
    band: local.keyBand,
    mark: local.keyMark,
  }[shape];
  return (
    <View style={local.keyItem}>
      <View style={[swatch, fill ? { backgroundColor: fill } : null]} />
      <Text style={local.keyText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function Swatch({ fill, outline, label }: { fill?: string; outline?: boolean; label: string }) {
  return (
    <View style={local.swatchItem}>
      <View style={[local.swatch, fill ? { backgroundColor: fill } : null, outline ? local.swatchOutline : null]} />
      <Text style={local.swatchLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const BAR = 22;

const local = StyleSheet.create({
  chart: { alignSelf: 'stretch' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'stretch', marginBottom: 8 },
  swatchItem: { flexDirection: 'row', alignItems: 'center', marginRight: 14, marginBottom: 4 },
  swatch: { width: 18, height: 14, borderRadius: 2, marginRight: 6, flexShrink: 0 },
  swatchOutline: { borderColor: chartColours.shadow, borderWidth: 2 },
  swatchLabel: { color: colours.inkMuted, fontSize: 14, includeFontPadding: false, flexShrink: 0 },
  row: { alignSelf: 'stretch', paddingVertical: 6 },
  label: {
    alignSelf: 'stretch',
    color: colours.ink,
    fontSize: 17,
    includeFontPadding: false,
    marginBottom: 4,
  },
  track: {
    alignSelf: 'stretch',
    height: BAR,
    backgroundColor: chartColours.track,
    borderRadius: 3,
    justifyContent: 'center',
  },
  solid: { flexDirection: 'row', height: BAR - 8, marginHorizontal: 0 },
  segment: { height: '100%' },
  shadow: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderColor: chartColours.shadow,
    borderWidth: 2,
    borderRadius: 3,
  },
  absent: {
    alignSelf: 'stretch',
    color: colours.inkFaint,
    fontSize: 15,
    includeFontPadding: false,
    marginTop: 8,
  },
  mini: {
    alignSelf: 'stretch',
    backgroundColor: chartColours.track,
    borderRadius: 2,
    marginTop: 7,
  },
  miniFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: chartColours.outfield,
    borderRadius: 2,
  },
  miniTick: { position: 'absolute', top: -4, bottom: -4, width: 2, marginLeft: -1, backgroundColor: colours.ink },

  // --- the squad views (#143) ------------------------------------------------
  cchart: { flexDirection: 'row', alignSelf: 'stretch', marginTop: 10 },
  yAxis: { width: Y_AXIS, flexShrink: 0 },
  yLabel: {
    position: 'absolute',
    right: 6,
    width: 20,
    textAlign: 'right',
    color: colours.inkFaint,
    fontSize: 11,
    includeFontPadding: false,
  },
  plot: { borderBottomWidth: 1, borderBottomColor: colours.inkFaint },
  gridline: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: chartColours.track },
  slots: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row' },
  slot: { alignItems: 'center', justifyContent: 'flex-end' },
  colm: {
    width: '62%',
    maxWidth: 24,
    flexDirection: 'column-reverse',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    overflow: 'hidden',
  },
  ref: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: colours.ink },
  xRow: { flexDirection: 'row' },
  xText: {
    textAlign: 'center',
    color: colours.inkFaint,
    fontSize: 11,
    includeFontPadding: false,
    flexShrink: 0,
    paddingTop: 2,
  },
  xValue: { color: colours.ink, fontSize: 13, paddingTop: 5 },
  dtrack: { flex: 1, height: 26, justifyContent: 'center' },
  dline: { position: 'absolute', left: 0, right: 0, top: 13, height: 1, backgroundColor: colours.line },
  band: { position: 'absolute', top: 4, bottom: 4, backgroundColor: chartColours.band, borderRadius: 3 },
  dmid: { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1, backgroundColor: colours.ink },
  dot: {
    position: 'absolute',
    top: 6,
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: 7,
    backgroundColor: chartColours.outfield,
    borderWidth: 2,
    borderColor: colours.pitch,
  },
  otrack: { alignSelf: 'stretch', height: 16, backgroundColor: chartColours.track, borderRadius: 3, marginTop: 5 },
  obar: { position: 'absolute', top: 3, bottom: 3 },
  owedSide: { right: '50%', borderTopLeftRadius: 4, borderBottomLeftRadius: 4 },
  moreSide: { left: '50%', backgroundColor: chartColours.quiet, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  ozero: { position: 'absolute', left: '50%', top: -3, bottom: -3, width: 2, marginLeft: -1, backgroundColor: colours.ink },
  ustack: { flexDirection: 'row', alignSelf: 'stretch', height: 18, marginTop: 5 },
  useg: { flexBasis: 0, minWidth: 2 },
  usegGap: { marginLeft: 2 },
  usegLast: { borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  keyItem: { flexDirection: 'row', alignItems: 'center', marginRight: 14, marginBottom: 4 },
  keyBox: { width: 14, height: 14, borderRadius: 3, marginRight: 6 },
  keyTick: { width: 2, height: 14, backgroundColor: colours.ink, marginRight: 6 },
  keyLine: { width: 18, height: 2, backgroundColor: colours.ink, marginRight: 6 },
  keyBand: {
    width: 18,
    height: 12,
    borderRadius: 2,
    backgroundColor: chartColours.band,
    borderWidth: 1,
    borderColor: chartColours.bandEdge,
    marginRight: 6,
  },
  keyMark: { width: 3, height: 14, borderRadius: 2, backgroundColor: chartColours.goal, marginRight: 6 },
  keyText: { color: colours.inkMuted, fontSize: 13, includeFontPadding: false, flexShrink: 0 },
});
