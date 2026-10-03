/**
 * Every piece of text in the app — #89.
 *
 * > *"Right hand characters are chopped off in many screens"* — PO, build 69
 *
 * The fifth clipped-last-glyph defect, and the first fixed at the cause
 * rather than at the component. The app drew in the PHONE's system font, and
 * OEM fonts (Samsung, OnePlus, Xiaomi) at a raised font scale measure a
 * string one way and draw it a little wider, so the last glyph falls outside
 * the box sized to the measurement. Every earlier fix was local and every
 * new screen started again.
 *
 * So all text comes through here, and here it is:
 *
 * - **Drawn in a font the app ships** (Barlow, SIL OFL, `assets/fonts`,
 *   embedded by the expo-font config plugin). Measured and drawn by the same
 *   face on every phone. On Android the family is the file name, and each
 *   weight is its own file: a `fontWeight` is mapped to the right file and
 *   then cleared, because asking Android to bold a custom face synthesises a
 *   fake bold that measures wrong — the very bug this exists to end.
 * - **Broken simply** (`textBreakStrategy="simple"`): Android's default
 *   high-quality breaking is a known contributor to clipping.
 * - **Capped at 1.3× the system font size**, so a large accessibility setting
 *   still enlarges text but cannot push it out of the fixed boxes the theme
 *   relies on.
 *
 * `src/screens/textImports.test.ts` fails if a screen imports `Text` from
 * react-native directly, so this cannot quietly stop applying.
 */

import { Text as RNText, StyleSheet, type TextProps, type TextStyle } from 'react-native';

import { MAX_FONT_SCALE, familyFor } from '../app/fonts';

export function Text({ style, ...rest }: TextProps) {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  return (
    <RNText
      textBreakStrategy="simple"
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      {...rest}
      style={[style, { fontFamily: flat.fontFamily ?? familyFor(flat.fontWeight), fontWeight: 'normal' }]}
    />
  );
}
