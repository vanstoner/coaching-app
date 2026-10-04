/**
 * The two bar charts — #105, #103, ADR-016.
 *
 * Plain `View` and `Text`: a bar is a box whose width is a fraction of the
 * track. No drawing library. Every number arrives ready from
 * `src/app/analysis.ts`; these only map rows to boxes.
 *
 * **Colours (AC4).** Green and orange are taken by the app and the beta's
 * identity, so the bars use the Okabe–Ito palette, designed to stay distinct
 * under the common colour-vision deficiencies, and readable on the dark pitch
 * green: sky blue, yellow and reddish purple. Colour is never the only cue:
 *
 * - This match: one bar in two segments that differ in LIGHTNESS (pale = in
 *   goal, full = outfield), named in the legend.
 * - The shadow: an OUTLINE with no fill, drawn over the bar so it shows
 *   whether the bar falls short of it or runs past it.
 * - Season: each bar sits in a fixed order (League, Cup, Friendly, Tournament,
 *   then Other only when a competition this build does not know has a match) and carries
 *   its own text label, so the colour is a second cue, never the first.
 *
 * **Legibility (AC4).** First names at 17, values in the same line as the
 * name ("Ava 32 · avg 28"), bars 22 high. Each row carries one
 * `accessibilityLabel` reading the same text (ADR-016 §6).
 */

import { StyleSheet, View, type DimensionValue } from 'react-native';
import { Text } from './Text';

import type { MatchChart, SeasonChart, SeasonColumn } from '../app/analysis';
import { colours } from './theme';

export const chartColours = {
  /** Okabe–Ito sky blue: this match, outfield. */
  outfield: '#56B4E9',
  /** The same hue, lighter: this match, in goal. */
  goal: '#C6E7F8',
  /** The shadow's outline: no hue at all. */
  shadow: '#ffffff',
  track: '#164f3c',
  season: {
    league: '#56B4E9',
    cup: '#F0E442',
    friendly: '#E69F00',
    tournament: '#CC79A7',
    other: '#D55E00',
  } as Record<SeasonColumn, string>,
} as const;

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

/** #105 AC2, #103 AC2: season average per match attended, split by competition. */
export function SeasonBars({ chart }: { chart: SeasonChart }) {
  return (
    <View style={local.chart}>
      {chart.rows.map((row) => (
        <View key={row.playerId} style={local.group} accessible accessibilityLabel={row.label}>
          <Text style={local.label} numberOfLines={1}>
            {row.name}
            {row.averageMs === null ? ' · no matches yet' : ''}
          </Text>
          {row.averageMs !== null &&
            row.bars.map((bar) => (
              <View key={bar.column} style={local.seasonRow}>
                <Text style={local.seasonLabel} numberOfLines={1}>
                  {bar.label}
                </Text>
                <View style={local.seasonTrack}>
                  {bar.averageMs !== null && (
                    <View
                      style={[
                        local.seasonBar,
                        {
                          width: pct(bar.averageMs, chart.maxMs),
                          backgroundColor: chartColours.season[bar.column],
                        },
                      ]}
                    />
                  )}
                </View>
              </View>
            ))}
        </View>
      ))}
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
  group: {
    alignSelf: 'stretch',
    paddingVertical: 8,
    borderBottomColor: colours.line,
    borderBottomWidth: 1,
  },
  seasonRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', marginTop: 4 },
  // Fixed width, never minWidth: "Tournament 32 · n 12" and "Cup — none" share it.
  seasonLabel: {
    width: 176,
    flexShrink: 0,
    color: colours.inkMuted,
    fontSize: 15,
    includeFontPadding: false,
    paddingRight: 6,
  },
  seasonTrack: { flex: 1, height: 16, backgroundColor: chartColours.track, borderRadius: 3 },
  seasonBar: { height: '100%', borderRadius: 3 },
});
