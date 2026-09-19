import { describe, expect, it } from 'vitest';

import { nextSaturday, toDateInput, toIso, toTimeInput } from './kickoff';

describe('toIso', () => {
  it('builds a timestamp from a whole date and time', () => {
    const iso = toIso('26/09/2026', '10:30');
    expect(iso).not.toBeNull();
    const d = new Date(iso!);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8); // September
    expect(d.getDate()).toBe(26);
    expect(d.getHours()).toBe(10);
    expect(d.getMinutes()).toBe(30);
  });

  it('accepts a single-digit day and month', () => {
    expect(toIso('3/9/2026', '9:05')).not.toBeNull();
  });

  it('returns null for a half-typed date, rather than guessing a day', () => {
    // A coach mid-keystroke must not have "03/0" quietly stored as some other
    // date they never chose.
    for (const partial of ['', '0', '03', '03/', '03/0', '03/09', '03/09/20']) {
      expect(toIso(partial, '10:00')).toBeNull();
    }
  });

  it('returns null for a half-typed time', () => {
    for (const partial of ['', '1', '10', '10:', '10:0']) {
      expect(toIso('26/09/2026', partial)).toBeNull();
    }
  });

  it('refuses a date that would roll over into another month', () => {
    // 31 February is not 3 March. Silently accepting it would put a fixture on
    // a day the coach never picked.
    expect(toIso('31/02/2026', '10:00')).toBeNull();
    expect(toIso('31/04/2026', '10:00')).toBeNull();
    expect(toIso('32/01/2026', '10:00')).toBeNull();
  });

  it('accepts 29 February in a leap year and refuses it otherwise', () => {
    expect(toIso('29/02/2028', '10:00')).not.toBeNull();
    expect(toIso('29/02/2027', '10:00')).toBeNull();
  });

  it('refuses an impossible time', () => {
    expect(toIso('26/09/2026', '24:00')).toBeNull();
    expect(toIso('26/09/2026', '10:60')).toBeNull();
  });

  it('ignores surrounding whitespace', () => {
    expect(toIso(' 26/09/2026 ', ' 10:30 ')).not.toBeNull();
  });
});

describe('round trip through the inputs', () => {
  it('formats and re-parses to the same instant', () => {
    const original = new Date(2026, 8, 26, 10, 30, 0, 0);
    const iso = toIso(toDateInput(original), toTimeInput(original));
    expect(iso).not.toBeNull();
    expect(new Date(iso!).getTime()).toBe(original.getTime());
  });

  it('zero-pads, so the field is always the same width', () => {
    const d = new Date(2026, 0, 3, 9, 5, 0, 0);
    expect(toDateInput(d)).toBe('03/01/2026');
    expect(toTimeInput(d)).toBe('09:05');
  });
});

describe('nextSaturday', () => {
  it('finds the coming Saturday from midweek', () => {
    // Tuesday 22 September 2026 -> Saturday 26th.
    const tuesday = new Date(2026, 8, 22);
    const sat = nextSaturday(tuesday);
    expect(sat.getDay()).toBe(6);
    expect(sat.getDate()).toBe(26);
  });

  it('returns today when today is a Saturday', () => {
    // A coach adding a fixture on the morning of the match means TODAY, not
    // a week away.
    const saturday = new Date(2026, 8, 19);
    expect(saturday.getDay()).toBe(6);
    const sat = nextSaturday(saturday);
    expect(sat.getDate()).toBe(19);
  });

  it('rolls into the next month correctly', () => {
    const monday = new Date(2026, 8, 28); // Mon 28 Sep
    const sat = nextSaturday(monday);
    expect(sat.getDay()).toBe(6);
    expect(sat.getMonth()).toBe(9); // October
    expect(sat.getDate()).toBe(3);
  });

  it('never returns a date in the past', () => {
    for (let i = 0; i < 14; i++) {
      const from = new Date(2026, 8, 14 + i);
      expect(nextSaturday(from).getTime()).toBeGreaterThanOrEqual(from.getTime());
    }
  });
});
