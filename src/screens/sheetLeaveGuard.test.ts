/**
 * #264 V29, V30 (QA on PR #260, D5, D6): every form or note sheet tells
 * FormSheet whether its draft changed, so it says "Not saved yet" and asks
 * before a changed draft is thrown away; full-screen forms ask on Android
 * Back. A source guard: it reads the files, it draws nothing.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (f: string) => readFileSync(join(__dirname, f), 'utf-8');

/** Each `<FormSheet ...>` opening tag in a file. */
function formSheets(file: string): string[] {
  return src(file).match(/<FormSheet\b[\s\S]*?\n\s*>/g) ?? [];
}

describe('form and note sheets pass dirty (D5)', () => {
  it.each([
    ['ChildScreen.tsx', 2], // Rename; fill-in
    ['MatchSummaryScreen.tsx', 2], // Correct attendance; the note sheet (Count, Leave out, Void)
    ['RecordMatchScreen.tsx', 1], // every Record correction
    ['Seasons.tsx', 1], // Count it / Leave it out
    ['AwardsSection.tsx', 1], // add or rename an award
    ['AwardCard.tsx', 1],
    ['PitchFields.tsx', 1],
    ['PositionNameSheet.tsx', 1],
    ['TalliesSection.tsx', 1],
  ])('%s: %i sheet(s), each with dirty', (file, count) => {
    const sheets = formSheets(file);
    expect(sheets).toHaveLength(count);
    for (const tag of sheets) expect(tag).toMatch(/\bdirty=\{/);
  });

  it('FormSheet asks through LeaveAsk on Cancel, a tap outside and Back', () => {
    const sheets = src('controls/Sheets.tsx');
    expect(sheets).toMatch(/onRequestClose=\{leave\}/);
    expect(sheets.match(/onPress=\{leave\}/g)).toHaveLength(2);
    expect(sheets).toMatch(/<LeaveAsk\s+visible=\{visible && asking\}/);
  });
});

describe('Android Back asks on a changed full-screen form (D6)', () => {
  it.each(['Seasons.tsx', 'Teams.tsx'])('%s', (file) => {
    expect(src(file)).toMatch(/useBackLeaves\(leave\)/);
  });
});

describe('a correction’s Save waits for its note (#264 C4; QA on #260, D14)', () => {
  it('RecordMatchScreen disables Save until a needed note has text', () => {
    const record = src('RecordMatchScreen.tsx');
    expect(formSheets('RecordMatchScreen.tsx')[0]).toMatch(/saveDisabled=\{saveDisabled\}/);
    expect(record).toMatch(
      /\(panel\.kind === 'add' \|\| panel\.kind === 'withdraw' \|\| panel\.kind === 'structure'\) && panel\.note\.trim\(\) === ''/
    );
  });
});
