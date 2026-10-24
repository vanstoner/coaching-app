/**
 * The tap sheet's tile colours and the coach's tallies' look — #228 item 2
 * (Dee's design, approved by Rob 23 Oct). Kept apart from the component so a
 * Node test reads the very values drawn. No React Native here.
 *
 * Each coach's tally has a slot: its place in the order tallies were created,
 * retired ones included (Q3 (a)). Colour = slot mod 8, icon = slot mod 12, so
 * the first 8 never share a colour, the first 12 never share an icon, and a
 * retired tally's look is never handed on. Worked out from the tally list on
 * every draw: nothing is stored (invariant 1).
 */

import type { TapEventKind } from '../types/index';

/** A bright tile per built-in kind; Conceded is the one that reads as against us. Unchanged by #228. */
export const BUILT_IN_TILE: Record<TapEventKind, string> = {
  goal: '#ffd166',
  shot_on_target: '#c9b8f0',
  tackle: '#f4a259',
  corner: '#ef8a80',
  free_kick: '#7cc6fe',
  save: '#8be0c3',
  conceded: '#d9d9d9',
};

/** The built-ins' main glyphs (EventButtons' PICTURE), for the "never reuse" check. */
export const BUILT_IN_ICONS: readonly string[] = [
  'grid',
  'soccer',
  'shoe-cleat',
  'target',
  'flag-triangle',
  'whistle',
  'hand-back-left',
];

/** Dee's palette, slots 1 to 8: Pink, Lime, Teal, Periwinkle, Sand, Leaf, Orchid, Ice. */
export const TALLY_PALETTE: readonly string[] = [
  '#f5a8c8',
  '#cfe57a',
  '#7fd6d6',
  '#a9b6f6',
  '#e3cfa0',
  '#a6dd8f',
  '#e2a8ef',
  '#cde9f0',
];

/** Dee's icons, slots 1 to 12, from MaterialCommunityIcons (each in the installed glyph map). */
export const TALLY_ICONS = [
  'star',
  'lightning-bolt',
  'arm-flex',
  'run-fast',
  'shield-half-full',
  'thumb-up-outline',
  'flag-checkered',
  'handshake-outline',
  'eye-outline',
  'rocket-launch',
  'swap-horizontal-bold',
  'medal-outline',
] as const;

export type TallyIcon = (typeof TALLY_ICONS)[number];

/** The dark ink on every tile. */
export const TILE_INK = '#1b2a24';

/** A coach's tally's look, from its slot (0-based: the first tally created is slot 0). */
export function tallyLook(slot: number): { colour: string; icon: TallyIcon } {
  const s = Math.max(0, Math.floor(slot));
  return { colour: TALLY_PALETTE[s % TALLY_PALETTE.length], icon: TALLY_ICONS[s % TALLY_ICONS.length] };
}
