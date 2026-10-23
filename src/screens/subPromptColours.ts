/**
 * The colours of the clock's sub prompt (#203) and the Undo toast that
 * follows a Done, kept apart from the components so a Node test computes
 * their contrast from the very values drawn (#227 AC3). No React Native here.
 *
 * Each band: `bg` is the panel; `ink` is the text on it (the question, the
 * names, Not now) and also fills the countdown, the chosen name and Done;
 * `onInk` is the text on those filled shapes.
 */

import type { SubBand } from '../app/clockSubs';
import { colours } from './colours';

export const SUB_PROMPT: Record<SubBand, { bg: string; ink: string; onInk: string }> = {
  green: { bg: colours.accent, ink: colours.ink, onInk: '#075236' },
  // #227: amber's fills are its dark ink, so their text is the amber itself
  // (7.9:1). The old #8a5600 read at 2.67:1.
  amber: { bg: colours.amber, ink: colours.amberInk, onInk: colours.amber },
  red: { bg: colours.late, ink: colours.ink, onInk: '#7a1c13' },
};

/** The Undo toast on the clock: its message, and the Undo button. */
export const UNDO_TOAST = {
  bg: '#1d2a25',
  text: colours.ink,
  buttonBg: colours.warn,
  buttonText: '#3a2a00',
} as const;
