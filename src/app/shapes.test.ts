import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SHAPE,
  SHAPES,
  SHAPE_CODES,
  readShapeCode,
  formatForShape,
  makeFormat,
  shapeLabel,
  shapeOfFormat,
  shapeSpec,
} from './shapes';
import { makeSevenASideFormat } from './placeholderSquad';
import type { PositionUnit } from '../types/index';

const unitsOf = (shape: (typeof SHAPES)[number]) => shape.slots.map((s) => s.unit);

const count = (units: PositionUnit[], unit: PositionUnit) => units.filter((u) => u === unit).length;

describe('the shapes the PO named', () => {
  // Replaces "offers 2-3-1 and 2-2-2, both seven a side": #223 (approved
  // 18 Oct) adds two 5-a-side shapes beside them.
  it('offers 2-3-1 and 2-2-2 seven a side, and 1-2-1 and 2-2 five a side (#223 AC1)', () => {
    expect(SHAPES.map((s) => s.code)).toEqual(['2-3-1', '2-2-2', '1-2-1', '2-2']);
    const size = Object.fromEntries(SHAPES.map((s) => [s.code, s.slots.length]));
    expect(size).toEqual({ '2-3-1': 7, '2-2-2': 7, '1-2-1': 5, '2-2': 5 });
  });

  it('fields five children in every 5-a-side shape, one of them in goal (#223 AC6)', () => {
    for (const code of ['1-2-1', '2-2'] as const) {
      const format = makeFormat(code);
      expect(format.onFieldCount).toBe(5);
      expect(format.positions).toHaveLength(5);
      expect(format.name).toBe('5-a-side');
      expect(format.positions.filter((p) => p.kind === 'goalkeeper')).toHaveLength(1);
    }
    expect(makeFormat('2-3-1').name).toBe('7-a-side');
    expect(makeFormat('2-2-2').name).toBe('7-a-side');
  });

  it('builds 1-2-1 + GK as GK, D, LM, RM, F: 1 defence, 2 midfield, 1 attack', () => {
    const spec = shapeSpec('1-2-1');
    expect(spec.slots.map((s) => s.label)).toEqual(['GK', 'D', 'LM', 'RM', 'F']);
    const units = unitsOf(spec);
    expect([count(units, 'GK'), count(units, 'DEF'), count(units, 'MID'), count(units, 'ATT')]).toEqual([1, 1, 2, 1]);
    expect(shapeLabel('1-2-1')).toBe('1-2-1 + GK');
    expect(spec.description).toBe('5-a-side · 1 defence · 2 midfield · 1 attack');
  });

  it('builds 2-2 + GK as GK, LB, RB, LF, RF: 2 defence, 2 attack', () => {
    const spec = shapeSpec('2-2');
    expect(spec.slots.map((s) => s.label)).toEqual(['GK', 'LB', 'RB', 'LF', 'RF']);
    const units = unitsOf(spec);
    expect([count(units, 'GK'), count(units, 'DEF'), count(units, 'MID'), count(units, 'ATT')]).toEqual([1, 2, 0, 2]);
    expect(shapeLabel('2-2')).toBe('2-2 + GK');
    expect(spec.description).toBe('5-a-side · 2 defence · 2 attack');
  });

  it('says which format each 7-a-side shape is, on the chip a coach taps', () => {
    expect(shapeSpec('2-3-1').description).toBe('7-a-side · 2 defence · 3 midfield · 1 attack');
    expect(shapeSpec('2-2-2').description).toBe('7-a-side · 2 defence · 2 midfield · 2 attack');
  });

  it('counts 2 defence, 3 midfield, 1 attack plus a keeper for 2-3-1', () => {
    const units = unitsOf(shapeSpec('2-3-1'));
    expect(units.filter((u) => u === 'GK')).toHaveLength(1);
    expect(units.filter((u) => u === 'DEF')).toHaveLength(2);
    expect(units.filter((u) => u === 'MID')).toHaveLength(3);
    expect(units.filter((u) => u === 'ATT')).toHaveLength(1);
  });

  it('counts 2 defence, 2 midfield, 2 attack plus a keeper for 2-2-2', () => {
    const units = unitsOf(shapeSpec('2-2-2'));
    expect(units.filter((u) => u === 'GK')).toHaveLength(1);
    expect(units.filter((u) => u === 'DEF')).toHaveLength(2);
    expect(units.filter((u) => u === 'MID')).toHaveLength(2);
    expect(units.filter((u) => u === 'ATT')).toHaveLength(2);
  });

  it('names a shape with its keeper, because the coach counts ten outfield slots', () => {
    expect(shapeLabel('2-3-1')).toBe('2-3-1 + GK');
    expect(shapeLabel('2-2-2')).toBe('2-2-2 + GK');
  });

  it('gives every slot a unit from the four fixed primitives', () => {
    const allowed: PositionUnit[] = ['GK', 'DEF', 'MID', 'ATT'];
    for (const shape of SHAPES) {
      for (const slot of shape.slots) expect(allowed).toContain(slot.unit);
    }
  });
});

describe('makeFormat', () => {
  it('builds exactly one goalkeeping position — the engine rejects two', () => {
    for (const shape of SHAPES) {
      const format = makeFormat(shape.code);
      expect(format.positions.filter((p) => p.kind === 'goalkeeper')).toHaveLength(1);
      expect(format.onFieldCount).toBe(format.positions.length);
    }
  });

  it('takes the unit from the shape rather than inferring it from the label', () => {
    // A renamed label must never be able to change what a slot measures.
    const format = makeFormat('2-2-2');
    const byLabel = new Map(format.positions.map((p) => [p.label, p.unit]));
    expect(byLabel.get('LF')).toBe<PositionUnit>('ATT');
    expect(byLabel.get('RF')).toBe<PositionUnit>('ATT');
    expect(byLabel.get('LM')).toBe<PositionUnit>('MID');
  });

  it('orders positions back to front, so a team sheet reads like a pitch', () => {
    const format = makeFormat('2-3-1');
    expect(format.positions.map((p) => p.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(format.positions[0].label).toBe('GK');
    expect(format.positions[6].label).toBe('ST');
  });

  it('gives each format its own ids, so two matches never share a position', () => {
    const a = makeFormat('2-3-1');
    const b = makeFormat('2-3-1');
    expect(a.id).not.toBe(b.id);
    expect(a.positions.map((p) => p.id)).not.toEqual(b.positions.map((p) => p.id));
  });
});

describe('shapeOfFormat', () => {
  it('reads the shape the released app has been playing all along', () => {
    // The 7-a-side format in every existing save IS 2-3-1 — LW and RW are
    // midfield in the catalogue. A coach upgrading must not be told their
    // shape is unrecognised.
    expect(shapeOfFormat(makeSevenASideFormat())).toBe('2-3-1');
  });

  it('round-trips every shape it can build', () => {
    for (const shape of SHAPES) {
      expect(shapeOfFormat(makeFormat(shape.code))).toBe(shape.code);
    }
  });

  it('reads the shape by unit, so renaming every position changes nothing', () => {
    const format = makeFormat('2-2-2');
    const renamed = {
      ...format,
      positions: format.positions.map((p) => ({ ...p, label: 'goes wherever' })),
    };
    expect(shapeOfFormat(renamed)).toBe('2-2-2');
  });

  it('answers null for a format with units still unknown, rather than guessing', () => {
    // A v1 save whose outfield units could not be recovered. Null makes the
    // caller decide; a guess would put a child's minutes in a bucket nobody
    // could see was invented.
    const format = makeFormat('2-3-1');
    const unknown = {
      ...format,
      positions: format.positions.map((p) =>
        p.kind === 'outfield' ? { ...p, unit: null } : p
      ),
    };
    expect(shapeOfFormat(unknown)).toBeNull();
  });

  it('recognises both 5-a-side shapes, renamed or not (#223 AC6)', () => {
    for (const code of ['1-2-1', '2-2'] as const) {
      const format = makeFormat(code);
      expect(shapeOfFormat(format)).toBe(code);
      const renamed = { ...format, positions: format.positions.map((p) => ({ ...p, label: 'goes wherever' })) };
      expect(shapeOfFormat(renamed)).toBe(code);
    }
  });

  it('never reads a 5-a-side shape as a 7-a-side one, or the reverse', () => {
    const five = makeFormat('1-2-1');
    expect(shapeOfFormat({ ...five, onFieldCount: 7 })).toBeNull();
    const seven = makeFormat('2-3-1');
    expect(shapeOfFormat({ ...seven, onFieldCount: 5 })).toBeNull();
  });

  it('answers null when the slot count does not match any shape', () => {
    const format = makeFormat('2-3-1');
    expect(shapeOfFormat({ ...format, onFieldCount: 9 })).toBeNull();
    expect(
      shapeOfFormat({ ...format, positions: format.positions.slice(0, 5) })
    ).toBeNull();
  });
});

describe('formatForShape', () => {
  it('keeps the default format when it is already that shape, renames included', () => {
    // The point: a coach who called a slot "sweeper" keeps "sweeper" when they
    // start a match in the shape they already play.
    const base = makeFormat('2-3-1');
    const renamed = {
      ...base,
      positions: base.positions.map((p) => (p.label === 'LB' ? { ...p, label: 'Sweeper' } : p)),
    };
    const chosen = formatForShape('2-3-1', renamed);
    expect(chosen).toBe(renamed);
    expect(chosen.positions.some((p) => p.label === 'Sweeper')).toBe(true);
  });

  it('builds a new format when the shape genuinely differs', () => {
    const base = makeFormat('2-3-1');
    const chosen = formatForShape('2-2-2', base);
    expect(chosen.id).not.toBe(base.id);
    expect(shapeOfFormat(chosen)).toBe('2-2-2');
  });

  it('builds from the shape when there is no default to keep', () => {
    expect(shapeOfFormat(formatForShape('2-2-2', null))).toBe('2-2-2');
  });

  it('builds from the shape when the default is unreadable', () => {
    const base = makeFormat('2-3-1');
    const unknown = {
      ...base,
      positions: base.positions.map((p) => ({ ...p, unit: null })),
    };
    expect(shapeOfFormat(formatForShape('2-3-1', unknown))).toBe('2-3-1');
  });
});

describe('reading a shape back from a record', () => {
  it('knows every shape this build offers, and nothing else', () => {
    expect(SHAPE_CODES).toEqual(['2-3-1', '2-2-2', '1-2-1', '2-2']);
    for (const code of SHAPE_CODES) expect(readShapeCode(code)).toBe(code);
    for (const raw of ['3-3', '', null, undefined, 7, '1-2-1 + GK']) expect(readShapeCode(raw)).toBeNull();
  });

  it('moves between 5- and 7-a-side as a genuine change of shape', () => {
    const seven = makeFormat('2-3-1');
    const five = formatForShape('2-2', seven);
    expect(five.onFieldCount).toBe(5);
    expect(formatForShape('2-2', five)).toBe(five);
    expect(formatForShape('2-3-1', five).onFieldCount).toBe(7);
  });
});

describe('the default', () => {
  it('is the shape the released app already plays', () => {
    expect(DEFAULT_SHAPE).toBe('2-3-1');
    expect(shapeOfFormat(makeFormat(DEFAULT_SHAPE))).toBe(DEFAULT_SHAPE);
  });
});
