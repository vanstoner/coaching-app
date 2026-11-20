/**
 * #301: edit a saved fixture before kick-off (criteria on #301, Rob 20 Nov:
 * "approve 300, 301, 302 as 2.5.1"). Made-up names only.
 */
import { describe, expect, it } from 'vitest';
import { uuid } from '../types/index';
import { makePlayer } from './squad';
import { makeFormat, shapeOfFormat } from './shapes';
import { newMatch } from './matchLifecycle';
import { buildTeamSheet } from './teamSheetBuilder';
import { canEditFixture, editFixture, editWarnings, placedIn, type FixtureEdit } from './fixtureEdit';

const squadId = uuid();
const players = ['Ava', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal'].map((n) => makePlayer(squadId, n));
const format = makeFormat('2-3-1');
const NOW = () => new Date('2026-11-20T12:00:00Z');

function fixture(withSheet: boolean) {
  const stored = newMatch({ squadId, format, totalMinutes: 50, periodCount: 4, players }, NOW).stored;
  if (!withSheet) return stored;
  const plan = buildTeamSheet({
    format, totalMinutes: 50, periodCount: 4, coming: players, keepers: players.slice(0, 4).map((p) => p.id),
    subs: 1, fill: 'fair', season: new Map(), existing: undefined,
  }).plan;
  return { ...stored, plan };
}
const draftOf = (s: ReturnType<typeof fixture>, over: Partial<FixtureEdit> = {}): FixtureEdit => ({
  opponent: s.match.opponent ?? '', competition: s.match.competition, kickoffAt: s.match.kickoffAt,
  totalMinutes: s.match.totalMinutes, periodCount: s.match.quarterCount, shape: shapeOfFormat(s.format!)!,
  excludeFromStats: false, pitch: { surface: null, condition: null, referee: '' }, ...over,
});

describe('edit a saved fixture (#301)', () => {
  it('C2: the opposition placeholder gets its name; the id, Who\'s coming and the team sheet stay', () => {
    const s = fixture(true);
    const e = editFixture(s, draftOf(s, { opponent: '  Rovers ', kickoffAt: '2026-11-22T10:20:00.000Z', competition: 'cup' }), format, NOW);
    expect(e.match.opponent).toBe('Rovers');
    expect(e.match.kickoffAt).toBe('2026-11-22T10:20:00.000Z');
    expect(e.match.competition).toBe('cup');
    expect(e.match.id).toBe(s.match.id);
    expect(e.availability).toEqual(s.availability);
    expect(e.plan).toEqual(s.plan);
    expect(e.quarters).toBe(s.quarters);
  });

  it('C2: pitch, referee and "leave out of the figures" change; a cleared one is gone', () => {
    const s = fixture(false);
    const e = editFixture(s, draftOf(s, { excludeFromStats: true, pitch: { surface: 'grass', condition: null, referee: 'Mo' } }), format, NOW);
    expect(e.match.excludeFromStats).toBe(true);
    expect(e.match.surface).toBe('grass');
    expect(e.match.referee).toBe('Mo');
    const back = editFixture(e, draftOf(e, { pitch: { surface: null, condition: null, referee: '' } }), format, NOW);
    expect(back.match.surface).toBeUndefined();
    expect(back.match.referee).toBeUndefined();
  });

  it('C3: a shape change re-places each quarter by area; the same children start, nobody added or dropped', () => {
    const s = fixture(true);
    const e = editFixture(s, draftOf(s, { shape: '1-4-1' }), format, NOW);
    expect(shapeOfFormat(e.format!)).toBe('1-4-1');
    for (let p = 0; p < 4; p++) expect(new Set(placedIn(e.plan, p))).toEqual(new Set(placedIn(s.plan, p)));
    expect(Object.keys(e.plan!.periods[0].slots).sort()).toEqual(e.format!.positions.map((x) => x.id).sort());
    expect(e.plan!.periods[0].subs).toEqual(s.plan!.periods[0].subs);
  });

  it('C3: a length or period change keeps who starts and clears the planned subs; new periods are pending', () => {
    const s = fixture(true);
    const e = editFixture(s, draftOf(s, { totalMinutes: 60, periodCount: 2 }), format, NOW);
    expect(e.match.totalMinutes).toBe(60);
    expect(e.quarters).toHaveLength(2);
    expect(e.quarters.every((q) => q.status === 'pending' && q.matchId === s.match.id)).toBe(true);
    expect(e.plan!.periods).toHaveLength(2);
    expect(placedIn(e.plan, 0)).toEqual(placedIn(s.plan, 0));
    expect(e.plan!.periods.every((p) => p.subs.length === 0)).toBe(true);
  });

  it('C3: the form warns only when a team sheet is made and the change touches it', () => {
    const made = fixture(true);
    const bare = fixture(false);
    expect(editWarnings(bare, { totalMinutes: 60, periodCount: 2, shape: '1-4-1' })).toEqual([]);
    expect(editWarnings(made, { totalMinutes: 50, periodCount: 4, shape: '2-3-1' })).toEqual([]);
    expect(editWarnings(made, { totalMinutes: 50, periodCount: 4, shape: '1-4-1' })).toEqual(['The team sheet will be re-placed: everyone keeps their area']);
    expect(editWarnings(made, { totalMinutes: 60, periodCount: 4, shape: '2-3-1' })).toEqual(['Sub times will be cleared']);
  });

  it('C4: after kick-off there is no edit, and an edit changes nothing', () => {
    const s = fixture(false);
    const started = { ...s, quarters: s.quarters.map((q, i) => (i === 0 ? { ...q, status: 'running' as const } : q)) };
    expect(canEditFixture(s)).toBe(true);
    expect(canEditFixture(started)).toBe(false);
    expect(editFixture(started, draftOf(s, { opponent: 'Rovers' }), format, NOW)).toBe(started);
  });
});

describe('Edit on the card, before kick-off only (#301 C1, C4, C5)', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const app = readFileSync(join(__dirname, '../../App.tsx'), 'utf8');
  const card = readFileSync(join(__dirname, '../screens/FixturesScreen.tsx'), 'utf8');
  it('the card offers Edit only for a fixture the app says can still be edited', () => {
    expect(card).toMatch(/match\.status === 'planned' && onEdit && editable\?\.has\(match\.id\) && \(\s*<RowNav label="Edit"/);
    expect(app).toMatch(/editable=\{new Set\(real\.filter\(\(m\) => canEditFixture\(m\)\)\.map\(\(m\) => m\.match\.id\)\)\}/);
  });
  it('the form opens filled in, titled Edit fixture, and warns before Save', () => {
    expect(app).toMatch(/creates=\{false\}\s*warnings=\{\(d\) => editWarnings\(editing, d\)\}/);
    expect(readFileSync(join(__dirname, '../screens/FixtureFormScreen.tsx'), 'utf8')).toMatch(/creates \? 'New fixture' : 'Edit fixture'/);
  });
});
