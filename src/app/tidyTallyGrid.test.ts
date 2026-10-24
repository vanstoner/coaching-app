/**
 * #228 item 2: one tap grid, every tile the same size, and each coach's tally
 * its own colour and icon by Dee's slot rule (criteria 13–18; Q3 (a) approved
 * as recommended, 23 Oct). Tile sizes cannot be measured in Node, so 13 and 14
 * are source checks on the one component that draws the sheet; 15–17 are
 * tested on the rule itself. Made-up first names only.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { uuid } from '../types/index';
import { addEventType, emptyLedger, parseLedger, serialiseLedger, setEventTypeActive, type Ledger } from './ledger';
import { eventGridRows, tapEventsFor } from './matchEvents';
import { tallyButtons } from './tallies';
import {
  BUILT_IN_ICONS,
  BUILT_IN_TILE,
  TALLY_ICONS,
  TALLY_PALETTE,
  TILE_INK,
  tallyLook,
} from '../screens/tallyLook';

const root = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8');
const NOW = new Date('2026-10-23T12:00:00Z');
const ok = (r: { ok: true; ledger: Ledger } | { ok: false; reason: string }): Ledger => {
  if (!r.ok) throw new Error(r.reason);
  return r.ledger;
};
const NAMES = ['Good pass', 'Header', 'Throw-in', 'Dribble', 'Block', 'Clearance', 'Cross', 'Nutmeg', 'Volley', 'Interception', 'Chip', 'Lob', 'Overlap', 'Turn'];

function withTallies(n: number, team = false): Ledger {
  let l = emptyLedger(uuid(), 'Test FC', NOW);
  for (let i = 0; i < n; i++) l = ok(addEventType(l, NAMES[i], team && i % 2 === 1 ? 'team' : 'child', NOW));
  return l;
}

describe('one grid, every tile the same size (#228 AC13, AC14, source check)', () => {
  const src = read('src', 'screens', 'EventButtons.tsx');
  it('the clock draws the tap sheet from one TapButtons grid', () => {
    const clock = read('src', 'screens', 'ClockScreen.tsx');
    expect(clock.match(/<TapButtons\b/g)?.length).toBe(1);
    expect(clock).not.toMatch(/<EventButtons\b|<TallyButtons\b/);
    expect(src).not.toMatch(/export function (EventButtons|TallyButtons)\b/);
  });
  it('one tile style, 30% wide: no 44% tile and no width chosen per count', () => {
    expect(src).not.toMatch(/44%|tileWide|tileThird|eventGridColumns/);
    expect(src.match(/width: '30%'/g)?.length).toBe(1);
    expect(src).toMatch(/minHeight: TOUCH_TARGET \* 2\.1/);
  });
  it('a label is one line in its tile, so a 20-letter name never grows it', () => {
    expect(src).toMatch(/<Text style=\{local\.label\} numberOfLines=\{1\} ellipsizeMode="tail">/);
    const label = src.slice(src.indexOf('  label: {'), src.indexOf('  assist: {'));
    expect(label).toMatch(/alignSelf: 'stretch'/);
    expect(label).toMatch(/textAlign: 'center'/);
    expect(label).toMatch(/flexShrink: 0/);
    expect(label).not.toMatch(/minWidth/);
  });
  it.each([0, 1, 2, 3, 4, 7])('built-ins and %i coach’s tallies sit at most three to a row, for outfield and keeper', (n) => {
    for (const keeper of [false, true]) {
      const tiles = [...tapEventsFor(keeper), ...tallyButtons(withTallies(n, true).eventTypes)];
      const rows = eventGridRows(tiles);
      expect(rows.flat()).toEqual(tiles);
      for (const row of rows) expect(row.length).toBeLessThanOrEqual(3);
    }
  });
});

describe('each tally its own colour and icon (#228 AC15, AC16, AC18)', () => {
  it('Dee’s palette and icons, all distinct, apart from the built-ins, and readable under the tile ink', () => {
    expect(TALLY_PALETTE).toEqual(['#f5a8c8', '#cfe57a', '#7fd6d6', '#a9b6f6', '#e3cfa0', '#a6dd8f', '#e2a8ef', '#cde9f0']);
    expect(TALLY_ICONS.length).toBe(12);
    expect(new Set(TALLY_PALETTE).size).toBe(8);
    expect(new Set(TALLY_ICONS).size).toBe(12);
    for (const c of TALLY_PALETTE) expect(Object.values(BUILT_IN_TILE)).not.toContain(c);
    for (const i of TALLY_ICONS) expect(BUILT_IN_ICONS).not.toContain(i);
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const c of TALLY_PALETTE) expect((lum(c) + 0.05) / (lum(TILE_INK) + 0.05)).toBeGreaterThanOrEqual(7.5);
  });

  it('the built-ins keep their colours (AC18)', () => {
    expect(BUILT_IN_TILE).toEqual({
      goal: '#ffd166',
      shot_on_target: '#c9b8f0',
      tackle: '#f4a259',
      corner: '#ef8a80',
      free_kick: '#7cc6fe',
      save: '#8be0c3',
      conceded: '#d9d9d9',
    });
  });

  it('colour is slot mod 8 and icon slot mod 12, from the record alone (AC15)', () => {
    const buttons = tallyButtons(withTallies(14).eventTypes);
    buttons.forEach((b, i) => {
      expect(b.slot).toBe(i);
      expect(tallyLook(b.slot)).toEqual({ colour: TALLY_PALETTE[i % 8], icon: TALLY_ICONS[i % 12] });
    });
  });

  it('added one at a time, no colour or icon repeats on the sheet until the set runs out (AC16)', () => {
    for (let n = 1; n <= 8; n++) {
      const looks = tallyButtons(withTallies(n).eventTypes).map((b) => tallyLook(b.slot));
      expect(new Set(looks.map((l) => l.colour)).size).toBe(n);
      expect(new Set(looks.map((l) => l.icon)).size).toBe(n);
    }
    // The ninth reuses slot 1's colour (Pink) but not its icon; the 13th reuses slot 1's icon.
    const looks = tallyButtons(withTallies(13).eventTypes).map((b) => tallyLook(b.slot));
    expect(looks[8].colour).toBe(looks[0].colour);
    expect(looks[8].icon).not.toBe(looks[0].icon);
    expect(new Set(looks.slice(0, 12).map((l) => l.icon)).size).toBe(12);
    expect(looks[12].icon).toBe(looks[0].icon);
  });
});

describe('a tally keeps its look (#228 AC17)', () => {
  const lookOf = (l: Ledger) => new Map(tallyButtons(l.eventTypes).map((b) => [b.label, tallyLook(b.slot)]));

  it('when another is added, and when one is retired and brought back; a retired look is not handed on (Q3 a)', () => {
    let l = withTallies(3);
    const before = lookOf(l);
    l = ok(addEventType(l, 'Nutmeg', 'child', NOW));
    for (const [name, look] of before) expect(lookOf(l).get(name)).toEqual(look);
    const header = l.eventTypes.find((t) => t.label === 'Header')!;
    l = ok(setEventTypeActive(l, header.id, false, NOW));
    expect(lookOf(l).has('Header')).toBe(false);
    l = ok(addEventType(l, 'Volley', 'child', NOW));
    expect(lookOf(l).get('Volley')).toEqual(tallyLook(4));
    expect(lookOf(l).get('Volley')).not.toEqual(before.get('Header'));
    l = ok(setEventTypeActive(l, header.id, true, NOW));
    expect(lookOf(l).get('Header')).toEqual(before.get('Header'));
  });

  it('after a restart or a restore from the file on another phone', () => {
    let l = withTallies(4);
    l = ok(setEventTypeActive(l, l.eventTypes[1].id, false, NOW));
    const back = parseLedger(serialiseLedger(l));
    if (!back.ok) throw new Error(back.reason);
    expect(lookOf(back.ledger)).toEqual(lookOf(l));
  });
});
