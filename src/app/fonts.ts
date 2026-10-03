/**
 * The bundled typeface — #89. Pure, so the weight mapping is tested in Node.
 *
 * On Android a font embedded by the expo-font config plugin is addressed by
 * its file name, and each weight is a separate file. See src/screens/Text.tsx.
 */

export const FONT = {
  regular: 'Barlow-Regular',
  semibold: 'Barlow-SemiBold',
  bold: 'Barlow-Bold',
} as const;

/** System font scaling still applies, up to this. */
export const MAX_FONT_SCALE = 1.3;

/** The bundled file for a requested weight; never a synthesised bold. */
export function familyFor(weight: string | number | undefined): string {
  const w = weight === 'bold' ? 700 : weight === 'normal' || weight === undefined ? 400 : Number(weight);
  if (Number.isNaN(w)) return FONT.regular;
  if (w >= 700) return FONT.bold;
  if (w >= 600) return FONT.semibold;
  return FONT.regular;
}
