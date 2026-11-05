/**
 * #277 A1 and #278: source guards, because Node cannot draw a screen. They
 * check the wiring a coach meets: Who's coming on every fixture to come, and
 * Play now going to Which match? with no ad-hoc match.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (f: string) => readFileSync(join(__dirname, f), 'utf-8');
const app = readFileSync(join(__dirname, '../../App.tsx'), 'utf-8');

describe("Who's coming on each fixture to come (#277 A1)", () => {
  it('the card shows the row, with its summary, before the plan row', () => {
    const card = src('FixturesScreen.tsx');
    const coming = card.indexOf('<RowNav label="Who\'s coming" value={coming.get(match.id)}');
    const plan = card.indexOf("label={planned ? 'Edit the plan' : 'Plan this match'}");
    expect(coming).toBeGreaterThan(-1);
    expect(coming).toBeLessThan(plan);
  });

  it('Home and Which match? read the summary from the match’s own availability', () => {
    expect(app.match(/comingSummary\(comingRows\(m\.availability, squad\)\)/g)?.length).toBe(2);
  });

  it('each tap saves at once with ✓ Saved (A2)', () => {
    const screen = src('WhosComingScreen.tsx');
    expect(screen).toMatch(/onChange\(setComing\([^)]*nextComing\(coming\)\)\);\s*tick\.mark\(\);/);
  });

  it('a state changes colour only, never weight (the last-glyph trap)', () => {
    const screen = src('WhosComingScreen.tsx');
    expect(screen).not.toMatch(/cant: \{[^}]*fontWeight/);
    expect(screen).not.toMatch(/notHeard: \{[^}]*fontWeight/);
    expect(screen).not.toContain('colours.warn');
  });
});

describe('Play now picks a fixture (#278)', () => {
  it('lists Coming up only, and offers + Fixture when there is none (AC1, AC3)', () => {
    const which = src('WhichMatchScreen.tsx');
    expect(which).toContain("inBucket(fixtureList(matches, now, null, progress), 'future')");
    expect(which).toContain('<MainButton label="+ Fixture" onPress={onAdd} />');
  });

  it('a tap opens the fixture as its card does (AC2)', () => {
    expect(app).toMatch(/<WhichMatchScreen[\s\S]*?onOpen=\{openFixture\}/);
  });

  it('is hidden while a match is under way, as before (AC4)', () => {
    expect(app).toContain('onPlayNow={liveReal && matchIsUnderway(liveReal.state.quarters) ? null : playNow}');
  });
});
