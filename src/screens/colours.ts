/**
 * The theme's palette, on its own so a Node test can read the colours the
 * screens actually draw with (#227). `theme.ts` re-exports it; import from
 * there in screens. No React Native here.
 */

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
  /**
   * End quarter once the period runs over. #228 item 4 (Dee, approved 23 Oct):
   * the same sand as `amber` with dark ink, so the app has one warning colour.
   * The old #c47f1a under white read at 3.28:1.
   */
  urgent: '#e2c27d',
  /** Dark ink on `urgent` (9.58:1). */
  urgentInk: '#2b1d00',
  /**
   * A planned sub's warning, 15 s to go (#203 C3): brighter, under dark ink, for
   * sunshine. Also the text on the prompt's dark fills (#227). #228 item 4
   * (Dee, approved 23 Oct): the calmer sand #e2c27d replaces the garish
   * #f0a43a; subPromptColours.test.ts fails any choice under 4.5:1.
   */
  amber: '#e2c27d',
  /** Dark ink on `amber`. */
  amberInk: '#2b1d00',
  /** A planned sub now late (#203 C4): the theme's one red background. */
  late: '#a8322a',
  /** Reconstructed: entered after the event (#195, #199). One tone, used everywhere. */
  taint: '#c9ad6a',
} as const;
