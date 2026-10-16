/**
 * The picture buttons on the clock's tap sheet — #185.
 *
 * One big tile per thing that can be recorded for a player: a cartoon
 * "sticker" (a white disc with a thick outline) built from a ready-made icon
 * set (Rob's ruling: ready-made, not drawn here), with the word under it. The
 * free sets have no goal net, so the net is a grid with the ball in front.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { TAP_LABEL, eventGridColumns, eventGridRows } from '../app/matchEvents';
import type { TapEventKind } from '../types/index';
import { Text } from './Text';
import { TOUCH_TARGET, colours, screen } from './theme';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** One glyph placed on the sticker: offsets from the centre, in dp. */
interface Glyph {
  name: IconName;
  size: number;
  colour: string;
  x?: number;
  y?: number;
  /** Faces the other way: the second boot in a tackle. */
  flip?: boolean;
}

const INK = '#1b2a24';
const BALL = INK;
const NET = '#9aa7a1';

/** The pictures. Exported so the assist sheet can draw boot-and-ball. */
export const PICTURE: Record<TapEventKind | 'assist', Glyph[]> = {
  goal: [
    { name: 'grid', size: 46, colour: NET },
    { name: 'soccer', size: 24, colour: BALL, x: 8, y: 8 },
  ],
  conceded: [
    { name: 'grid', size: 46, colour: NET },
    { name: 'soccer', size: 24, colour: '#c0392b', x: 8, y: 8 },
  ],
  tackle: [
    { name: 'shoe-cleat', size: 30, colour: INK, x: -10, y: 4 },
    { name: 'shoe-cleat', size: 30, colour: '#b5462a', x: 10, y: -4, flip: true },
  ],
  corner: [{ name: 'flag-triangle', size: 42, colour: '#d63a2f', x: 2 }],
  free_kick: [{ name: 'whistle', size: 40, colour: INK }],
  save: [{ name: 'hand-back-left', size: 40, colour: '#1f6fb2' }],
  assist: [
    { name: 'shoe-cleat', size: 34, colour: INK, x: -8, y: 4 },
    { name: 'soccer', size: 20, colour: BALL, x: 14, y: -8 },
  ],
};

/** A bright tile per kind; Conceded is the one that reads as against us. */
const TILE: Record<TapEventKind, string> = {
  goal: '#ffd166',
  tackle: '#f4a259',
  corner: '#ef8a80',
  free_kick: '#7cc6fe',
  save: '#8be0c3',
  conceded: '#d9d9d9',
};

const STICKER = 60;
/** On the tiles the sticker is drawn smaller than its design size (PO: "feel free to size them smaller"). */
const TILE_STICKER = 48;

export function Sticker({ glyphs, size = STICKER }: { glyphs: Glyph[]; size?: number }) {
  const scale = size / STICKER;
  return (
    <View style={[local.sticker, { width: size, height: size, borderRadius: size / 2 }]}>
      {glyphs.map((g, i) => (
        <View
          key={i}
          style={[
            local.glyph,
            {
              transform: [
                { translateX: (g.x ?? 0) * scale },
                { translateY: (g.y ?? 0) * scale },
                { scaleX: g.flip ? -1 : 1 },
              ],
            },
          ]}
        >
          <MaterialCommunityIcons name={g.name} size={g.size * scale} color={g.colour} />
        </View>
      ))}
    </View>
  );
}

/** The grid of picture buttons for one player. */
export function EventButtons({
  kinds,
  onPress,
}: {
  kinds: TapEventKind[];
  onPress: (kind: TapEventKind) => void;
}) {
  // Rows of equal tiles, the last one centred: four make a 2 x 2 square and
  // five a 3 + 2, never a lone tile stranded at the left.
  const wide = eventGridColumns(kinds.length) <= 2;
  return (
    <View style={local.grid}>
      {eventGridRows(kinds).map((row, r) => (
        <View key={r} style={local.row}>
          {row.map((kind) => (
            <Pressable
              key={kind}
              accessibilityRole="button"
              accessibilityLabel={TAP_LABEL[kind]}
              onPress={() => onPress(kind)}
              style={({ pressed }) => [
                local.tile,
                wide ? local.tileWide : local.tileThird,
                { backgroundColor: TILE[kind] },
                pressed && local.pressed,
              ]}
            >
              <Sticker glyphs={PICTURE[kind]} size={TILE_STICKER} />
              <Text style={local.label} numberOfLines={1}>
                {TAP_LABEL[kind]}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

/** A teammate to credit with the assist: boot and ball, then the name. */
export function AssistButton({ name, onPress }: { name: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Assist: ${name}`}
      onPress={onPress}
      style={({ pressed }) => [local.assist, pressed && screen.buttonPressed]}
    >
      <Sticker glyphs={PICTURE.assist} size={40} />
      <Text style={local.assistName} numberOfLines={1}>
        {name}
      </Text>
    </Pressable>
  );
}

const local = StyleSheet.create({
  grid: { marginBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'stretch' },
  tileThird: { width: '30%' },
  tileWide: { width: '44%' },
  tile: {
    minHeight: TOUCH_TARGET * 2.1,
    marginHorizontal: 5,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginBottom: 10,
    // The cartoon drop shadow: a hard offset edge, no blur.
    shadowColor: INK,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 4,
  },
  pressed: { transform: [{ translateY: 3 }], shadowOffset: { width: 0, height: 1 } },
  sticker: {
    backgroundColor: '#ffffff',
    borderWidth: 3,
    borderColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  glyph: { position: 'absolute' },
  label: { color: INK, fontSize: 15, fontWeight: '700', marginTop: 6, includeFontPadding: false },
  assist: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colours.line,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  assistName: { color: colours.ink, fontSize: 18, fontWeight: '600', marginLeft: 12, includeFontPadding: false },
});
