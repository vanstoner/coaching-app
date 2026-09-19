import { describe, expect, it } from 'vitest';

import {
  POSITION_CATALOGUE,
  UNITS,
  findRoles,
  inferUnit,
  roleByCode,
  unitName,
  unitOfRole,
} from './positions';
import { kindOfUnit, type PositionUnit } from '../types/index';

describe('the catalogue', () => {
  it('covers all four units, back to front', () => {
    expect(POSITION_CATALOGUE.map((u) => u.unit)).toEqual(['GK', 'DEF', 'MID', 'ATT']);
    expect(UNITS).toEqual(['GK', 'DEF', 'MID', 'ATT']);
  });

  it('has no duplicate role codes across units', () => {
    // A code appearing under two units would make unitOfRole answer by
    // accident of ordering, and quietly file minutes in the wrong bucket.
    const codes = POSITION_CATALOGUE.flatMap((u) => u.roles.map((r) => r.code));
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('names every unit for the screen', () => {
    expect(unitName('GK')).toBe('Goalkeeping');
    expect(unitName('DEF')).toBe('Defence');
    expect(unitName('MID')).toBe('Midfield');
    expect(unitName('ATT')).toBe('Attack');
  });
});

describe('kindOfUnit — invariant 3, expressed once', () => {
  it('counts only goalkeeping as goalkeeping', () => {
    expect(kindOfUnit('GK')).toBe('goalkeeper');
    for (const unit of ['DEF', 'MID', 'ATT'] as PositionUnit[]) {
      expect(kindOfUnit(unit)).toBe('outfield');
    }
  });

  it('means outfield is exactly DEF + MID + ATT', () => {
    // Fairness is total outfield time. Widening the enum must not quietly
    // change what counts toward it.
    const outfield = UNITS.filter((u) => kindOfUnit(u) === 'outfield');
    expect(outfield).toEqual(['DEF', 'MID', 'ATT']);
  });
});

describe('unitOfRole', () => {
  it('reads a catalogue code', () => {
    expect(unitOfRole('CB')).toBe('DEF');
    expect(unitOfRole('CAM')).toBe('MID');
    expect(unitOfRole('ST')).toBe('ATT');
    expect(unitOfRole('GK')).toBe('GK');
  });

  it('reads a default name', () => {
    expect(unitOfRole('Centre Back')).toBe('DEF');
    expect(unitOfRole('Striker')).toBe('ATT');
  });

  it('reads a grassroots term, which is why they are in the model', () => {
    expect(unitOfRole('Goalie')).toBe('GK');
    expect(unitOfRole('Number 1')).toBe('GK');
    expect(unitOfRole('Number 10')).toBe('MID');
    expect(unitOfRole('LW')).toBe('MID');
    expect(unitOfRole('Target Man')).toBe('ATT');
  });

  it('does not care about case or surrounding space', () => {
    expect(unitOfRole('  keeper  ')).toBe('GK');
    expect(unitOfRole('cAm')).toBe('MID');
  });

  it('matches EXACTLY, never as a substring', () => {
    // 'Back' is a term for Centre Back; 'Wing Back' is a different role in the
    // same unit. Substring matching would make a coach's own label decide the
    // unit by accident, and this is the kind of quiet mis-filing that only
    // shows up in a season summary a year later.
    expect(unitOfRole('Backs')).toBeNull();
    expect(unitOfRole('Left')).toBeNull();
  });

  it('is null for anything the catalogue does not list', () => {
    expect(unitOfRole('Wherever he fancies')).toBeNull();
    expect(unitOfRole('')).toBeNull();
    expect(unitOfRole('   ')).toBeNull();
  });
});

describe('inferUnit — what a v1 position becomes', () => {
  it('knows a goalkeeping position is GK whatever it was called', () => {
    expect(inferUnit('goalkeeper', 'GK')).toBe('GK');
    expect(inferUnit('goalkeeper', 'Between the sticks')).toBe('GK');
  });

  it('recovers an outfield unit from a label the catalogue knows', () => {
    expect(inferUnit('outfield', 'LB')).toBe('DEF');
    expect(inferUnit('outfield', 'CM')).toBe('MID');
  });

  it('returns null rather than guessing at an unrecognised outfield label', () => {
    // The property worth defending. A fabricated unit is indistinguishable
    // from a measured one once it is written into a child's history.
    expect(inferUnit('outfield', 'P3')).toBeNull();
    expect(inferUnit('outfield', 'Wherever he fancies')).toBeNull();
  });
});

describe('roleByCode and findRoles', () => {
  it('finds a role by its code', () => {
    expect(roleByCode('CDM')?.defaultName).toBe('Defensive Midfield');
    expect(roleByCode('cdm')?.defaultName).toBe('Defensive Midfield');
    expect(roleByCode('ZZ')).toBeUndefined();
  });

  it('searches forgivingly, because searching is not deciding', () => {
    // findRoles IS substring-based, deliberately: a coach typing "mid" should
    // see the midfield roles. It never decides what a position IS.
    const hits = findRoles('mid').map((r) => r.code);
    expect(hits).toContain('CM');
    expect(hits).toContain('CAM');
    expect(findRoles('goalie').map((r) => r.code)).toEqual(['GK']);
    expect(findRoles('')).toEqual([]);
  });
});
