/**
 * The shared visual language, lifted out of App.tsx so new screens can use it
 * without that file growing every time one is added.
 *
 * App.tsx is 1,550 lines and holds every screen. Splitting it is slice 3's
 * real structural job; this is the first cut, and new screens land here rather
 * than there from now on.
 *
 * The rules encoded below are scars, not taste:
 *
 * - **Identical metrics in both states.** Changing `fontWeight` on selection
 *   makes Android re-measure late and clip the last glyph. That shipped "50,
 *   6, 7, 9" to a real phone.
 * - **`includeFontPadding: false`** so a text box matches its glyphs.
 * - **Fixed widths, never `minWidth`**, wherever two different strings share
 *   a slot.
 * - **`flexGrow: 1` inside a ScrollView**, so a short screen centres and a
 *   tall one scrolls. A centred screen that cannot scroll hides everything
 *   below the fold, which shipped a Settings link nobody could reach.
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
} as const;

export const screen = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colours.pitch },
  flex: { flex: 1 },
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
    backgroundColor: colours.accent,
    borderRadius: 12,
    marginTop: 18,
    paddingVertical: 15,
  },
  buttonDisabled: { backgroundColor: '#2f6b55', opacity: 0.6 },
  buttonPressed: { opacity: 0.7 },
  buttonLabel: {
    color: colours.ink,
    fontSize: 18,
    fontWeight: '600',
    includeFontPadding: false,
  },
  linkHit: { paddingVertical: 12, paddingHorizontal: 8, alignSelf: 'center' },
  link: {
    color: colours.inkMuted,
    fontSize: 15,
    textDecorationLine: 'underline',
    includeFontPadding: false,
  },
  dangerLink: { color: colours.danger, fontSize: 15, includeFontPadding: false },
});
