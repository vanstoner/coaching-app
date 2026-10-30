/**
 * "How the figures are worked out" (#261 item 2, AC13; text approved by Rob,
 * 29 Oct: "approve … 3"). Numbered steps a coach can reproduce in a
 * spreadsheet, one column per step. The same words are in
 * docs/feature-specs.md ("How the figures are worked out"), and a test fails
 * if the two differ (AC14). Pure: no React.
 */

export interface FigureStep {
  /** Which figure this step explains, for the info tap beside it (AC15). */
  figure:
    | 'minutes'
    | 'matches'
    | 'childMatches'
    | 'perGame'
    | 'squadAverage'
    | 'gap'
    | 'underOver'
    | 'matchShare'
    | 'planShare'
    | 'playerMinutes';
  title: string;
  text: string;
}

export const ABOUT_FIGURES: readonly FigureStep[] = [
  {
    figure: 'minutes',
    title: 'Minutes on the pitch in a match.',
    text: 'Add up every spell on the pitch, in goal and outfield together. Bench time does not count. The clock runs through stoppages, so everyone on the pitch keeps gaining time. If a period ran over and was ended "at planned time", the overrun is left out.',
  },
  {
    figure: 'matches',
    title: 'Matches that count.',
    text: 'This season\'s matches you ended with End match, not left out, not test or void, in the season\'s format (another format only if you counted it, with a note). The Squad tab\'s "Include reconstructed matches" switch can leave reconstructed ones out.',
  },
  {
    figure: 'childMatches',
    title: 'A child\'s matches.',
    text: 'The counted matches they were at: here at kick-off (even if on the bench all match), played, or arrived late. A missed match is left out of everything below.',
  },
  {
    figure: 'perGame',
    title: 'Minutes a game.',
    text: 'Their minutes in those matches ÷ how many there were. Shown to the whole minute.',
  },
  {
    figure: 'squadAverage',
    title: 'The squad average.',
    text: 'Add up each child\'s minutes a game and divide by the number of children. Each child counts once, however many matches they played. Main keepers (when the squad has one), fill-ins and children who have left are not in it. This is not all the minutes ÷ all the appearances; that gives a slightly different number.',
  },
  {
    figure: 'gap',
    title: 'Fairness: the gap a game.',
    text: 'Each child\'s minutes a game − the squad average, both to the whole minute. "Everyone within N min a game" is the widest of these.',
  },
  {
    figure: 'underOver',
    title: 'Under or over the average this season.',
    text: '(Squad average − their minutes a game) × their matches from step 3, rounded once at the end. The same as: for each game they played, the squad average minus their minutes, added up. 5 min or more under puts them "Next in line for more time".',
  },
  {
    figure: 'matchShare',
    title: 'A match\'s fair share (the match report).',
    text: 'The minutes on the pitch of the children there, ÷ how many of them there were. Main keepers are not in it; fill-ins are. "vs share" is their minutes − the share.',
  },
  {
    figure: 'planShare',
    title: 'The Plan\'s fair share.',
    text: 'The same as step 8, from the planned minutes, over the children available for the match.',
  },
  {
    figure: 'playerMinutes',
    title: 'Settings › Player minutes',
    text: 'adds up every match not left out, including ones not ended and other formats, so its totals can be higher than the Squad tab\'s.',
  },
];

/** The help as plain text, numbered: what the spec section must equal. */
export function aboutFiguresText(): string {
  return ABOUT_FIGURES.map((s, i) => `${i + 1}. **${s.title}** ${s.text}`).join('\n');
}
