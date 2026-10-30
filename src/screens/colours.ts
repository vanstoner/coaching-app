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
  /**
   * #264 V4 (QA on PR #260, D4): every text colour at least 4.5:1 on both
   * surfaces. Was #8fb3a5 (4.45 on `pitchRaised`, the sheet ground); the same
   * hue, lighter: 6.26 on the pitch, 5.24 raised.
   */
  inkMuted: '#a0c1b4',
  /**
   * Was #6e9787 (3.74 on the pitch, 3.13 raised). The same hue, as light as
   * V4 needs on the raised surface: 5.46 and 4.57. It sits closer to
   * `inkMuted` than before; size and place now carry the difference.
   */
  inkFaint: '#96b4a8',
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

  // --- the control vocabulary (#264, Dee's One system v6, Bea's V3) --------
  /** A control's edge: segments, steppers, the Main button's outline. 4.97:1 on the pitch. */
  edge: '#4fb88a',
  /** An Action: mint text that acts on the tap. */
  action: '#7fe0b0',
  /**
   * Back or out, a row's current value: muted grey-green. v6 drew #8fb3a5,
   * which is 4.45:1 on `pitchRaised`, under V4's 4.5, where a sheet's Cancel
   * sits; this is the nearest that passes on both (5.63 and 4.71).
   */
  back: '#94b8aa',
  /**
   * The Main button's and a chosen segment's fill, under white text (4.64:1).
   * The fill is 2.63:1 on the pitch, under V4's 3, so both keep an `edge`
   * outline (4.97:1) to mark their boundary.
   */
  main: '#12855a',
  /** ✓ Saved and "Not saved yet". */
  saved: '#ffd166',
  /** A row's divider in a grouped list. Decoration, not a control edge. */
  hair: '#24694f',
  /** An Undo toast's light fill, under `pitch` ink. */
  toast: '#e8f3ee',
} as const;
