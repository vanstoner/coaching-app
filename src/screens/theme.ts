/**
 * The shared visual language. Every screen lives in this folder and draws from
 * here; App.tsx is the router and holds no styles of its own.
 *
 * The rules encoded below are scars, not taste:
 *
 * - **Identical metrics in both states.** Changing `fontWeight` on selection
 *   makes Android re-measure late and clip the last glyph. That shipped "50,
 *   6, 7, 9" to a real phone. Selection changes COLOUR, nothing else — and
 *   that goes for an overtime warning as much as for a chip.
 * - **`includeFontPadding: false`** so a text box matches its glyphs.
 * - **Fixed widths, never `minWidth`**, wherever two different strings share
 *   a slot. A box sized to its own text loses its last glyph.
 * - **`flexShrink: 0` on anything that shows a time**, so a `flex: 1` sibling
 *   cannot squeeze the tail off it.
 * - **`flexGrow: 1` inside a ScrollView**, so a short screen centres and a
 *   tall one scrolls. A centred screen that cannot scroll hides everything
 *   below the fold, which shipped a Settings link nobody could reach.
 * - **`TOUCH_TARGET` on everything tappable.** A 30px link is a miss with a
 *   cold thumb on a wet touchline.
 */

import { StyleSheet } from 'react-native';

export const colours = {
  pitch: '#0b3d2e',
  pitchRaised: '#0f4a38',
  line: '#1c6349',
  ink: '#ffffff',
  inkMuted: '#8fb3a5',
  inkFaint: '#6e9787',
  accent: '#12855a',
  warn: '#ffd166',
  danger: '#ffb4a2',
  urgent: '#c47f1a',
} as const;

/**
 * The smallest a tappable thing may be, in dp — #70.
 *
 * 44 is the floor both platform guidelines land on, and it is applied as
 * `minHeight`/`minWidth` on the PRESSABLE rather than as padding on the text,
 * so a short label still has a full target.
 */
export const TOUCH_TARGET = 44;

export const screen = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colours.pitch },
  flex: { flex: 1 },
  /** A screen that fills the space and manages its own scrolling inside. */
  pane: { flex: 1, paddingHorizontal: 18, paddingVertical: 14 },
  centre: { alignItems: 'center', justifyContent: 'center' },
  /** Centres a short screen, scrolls a tall one. Never one without the other. */
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingVertical: 14,
    paddingBottom: 28,
  },
  title: {
    alignSelf: 'stretch',
    textAlign: 'center',
    includeFontPadding: false,
    color: colours.ink,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 4,
  },
  caption: {
    alignSelf: 'stretch',
    textAlign: 'center',
    includeFontPadding: false,
    color: colours.inkMuted,
    fontSize: 15,
    marginBottom: 10,
  },
  hint: {
    alignSelf: 'stretch',
    textAlign: 'center',
    includeFontPadding: false,
    color: colours.inkFaint,
    fontSize: 13,
    marginTop: 6,
  },
  fieldLabel: {
    alignSelf: 'stretch',
    includeFontPadding: false,
    color: colours.inkMuted,
    fontSize: 13,
    marginTop: 16,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  input: {
    alignSelf: 'stretch',
    backgroundColor: colours.pitchRaised,
    borderColor: colours.line,
    borderWidth: 1,
    borderRadius: 10,
    color: colours.ink,
    fontSize: 17,
    includeFontPadding: false,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  button: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.accent,
    borderRadius: 12,
    marginTop: 18,
    minHeight: TOUCH_TARGET,
    paddingVertical: 15,
  },
  /** The second button on a screen: same target, less shout. */
  buttonQuiet: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.pitchRaised,
    borderColor: colours.line,
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 10,
    minHeight: TOUCH_TARGET,
    paddingVertical: 15,
  },
  buttonDisabled: { backgroundColor: '#2f6b55', opacity: 0.6 },
  buttonUrgent: { backgroundColor: colours.urgent },
  buttonPressed: { opacity: 0.7 },
  buttonLabel: {
    color: colours.ink,
    fontSize: 18,
    fontWeight: '600',
    includeFontPadding: false,
  },
  linkHit: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    minHeight: TOUCH_TARGET,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  link: {
    color: colours.inkMuted,
    fontSize: 15,
    textDecorationLine: 'underline',
    includeFontPadding: false,
  },
  dangerLink: { color: colours.danger, fontSize: 15, includeFontPadding: false },

  // --- things more than one screen draws -----------------------------------

  /** "Quarter 2 of 4". */
  period: {
    alignSelf: 'stretch',
    textAlign: 'center',
    includeFontPadding: false,
    color: colours.inkMuted,
    fontSize: 16,
    marginTop: 2,
  },
  /**
   * The big figure. No `fontVariant: ['tabular-nums']` — on a real phone it
   * clipped the last glyph and the first release read "00:0".
   */
  clock: {
    color: colours.ink,
    fontSize: 68,
    fontWeight: '300',
    letterSpacing: 2,
    width: '100%',
    textAlign: 'center',
    paddingHorizontal: 8,
    marginTop: 4,
  },
  /** Colour ONLY. A weight change here re-measures and clips. */
  overtime: { color: colours.warn },
  error: { color: colours.danger, fontSize: 14, marginTop: 8, includeFontPadding: false },
  list: { flex: 1, marginTop: 10 },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOUCH_TARGET,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#164f3c',
  },
  playerName: { color: colours.ink, fontSize: 17, flex: 1, includeFontPadding: false },
  /**
   * A time beside a `flex: 1` name. Android measures a Text once; squeezed by
   * a flexible sibling it loses its tail. A FIXED width, never `minWidth`,
   * because the string swaps between "12:30" and "12:30 · GK 03:00".
   */
  rowTime: {
    color: colours.inkMuted,
    fontSize: 13,
    includeFontPadding: false,
    flexShrink: 0,
    width: 148,
    paddingRight: 4,
    textAlign: 'right',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  /** Quiet, diagnostic, and never clipped: see BuildLabel. */
  buildLabel: {
    alignSelf: 'stretch',
    textAlign: 'center',
    includeFontPadding: false,
    color: '#4e7a67',
    fontSize: 11,
    paddingBottom: 6,
    paddingHorizontal: 12,
  },
});
