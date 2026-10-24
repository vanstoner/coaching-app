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

import { TAP_LABEL, eventGridRows } from '../app/matchEvents';
import type { TallyKind, TapEventKind } from '../types/index';
import { Text } from './Text';
import { BUILT_IN_TILE, TILE_INK, tallyLook } from './tallyLook';
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

const INK = TILE_INK;
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
  shot_on_target: [
    { name: 'target', size: 46, colour: '#d63a2f' },
    { name: 'soccer', size: 18, colour: BALL, x: 12, y: -12 },
  ],
  corner: [{ name: 'flag-triangle', size: 42, colour: '#d63a2f', x: 2 }],
  free_kick: [{ name: 'whistle', size: 40, colour: INK }],
  save: [{ name: 'hand-back-left', size: 40, colour: '#1f6fb2' }],
  assist: [
    { name: 'shoe-cleat', size: 34, colour: INK, x: -8, y: 4 },
    { name: 'soccer', size: 20, colour: BALL, x: 14, y: -8 },
  ],
};

const TILE = BUILT_IN_TILE;

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

/** One tile on the tap sheet: a built-in kind, or a coach's tally with its slot (#228 item 2). */
type Tile =
  | { type: 'event'; kind: TapEventKind }
  | { type: 'tally'; kind: TallyKind; label: string; team: boolean; slot: number };

/**
 * The tap sheet's buttons for one player (#185, #198, #228 item 2): ONE grid,
 * built-ins then the coach's tallies in the same rows, every tile 30% wide and
 * the same height, so a tile never changes size when a tally is added. A
 * tally's colour and icon come from its slot (tallyLook.ts); nothing is stored.
 */
export function TapButtons({
  kinds,
  tallies,
  onEvent,
  onTally,
}: {
  kinds: TapEventKind[];
  tallies: { kind: TallyKind; label: string; team: boolean; slot: number }[];
  onEvent: (kind: TapEventKind) => void;
  onTally: (kind: TallyKind, team: boolean) => void;
}) {
  const tiles: Tile[] = [
    ...kinds.map((kind): Tile => ({ type: 'event', kind })),
    ...tallies.map((t): Tile => ({ type: 'tally', ...t })),
  ];
  // Rows of equal tiles, the last one centred: never a lone tile stranded at the left.
  return (
    <View style={local.grid}>
      {eventGridRows(tiles).map((row, r) => (
        <View key={r} style={local.row}>
          {row.map((tile) => {
            const event = tile.type === 'event';
            const look = event ? null : tallyLook(tile.slot);
            const label = event ? TAP_LABEL[tile.kind] : tile.label;
            return (
              <Pressable
                key={tile.kind}
                accessibilityRole="button"
                accessibilityLabel={!event && tile.team ? `${label}, for the team` : label}
                onPress={() => (tile.type === 'event' ? onEvent(tile.kind) : onTally(tile.kind, tile.team))}
                style={({ pressed }) => [
                  local.tile,
                  { backgroundColor: event ? TILE[tile.kind] : look!.colour },
                  pressed && local.pressed,
                ]}
              >
                <Sticker
                  glyphs={event ? PICTURE[tile.kind] : [{ name: look!.icon, size: 36, colour: INK }]}
                  size={TILE_STICKER}
                />
                <Text style={local.label} numberOfLines={1} ellipsizeMode="tail">
                  {label}
                </Text>
              </Pressable>
            );
          })}
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
  tile: {
    // #228 item 2: every tile, built-in or the coach's, is the same 30%; none is wider.
    width: '30%',
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
  label: {
    color: INK,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 6,
    includeFontPadding: false,
    // A long tally name ends in an ellipsis inside the tile (Dee); the tile never grows.
    alignSelf: 'stretch',
    textAlign: 'center',
    flexShrink: 0,
  },
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
