import { describe, expect, it } from 'vitest';

import {
  KICKOFF_TIMES,
  dayLabel,
  daysInMonth,
  kickoffIso,
  nextSaturday,
  sameDay,
  upcomingMonths,
  upcomingSaturdays,
} from './kickoff';

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

describe('pick, do not type — #80', () => {
  // Thursday 1 October 2026.
  const THU = new Date(2026, 9, 1, 19, 30);

  it('AC1: offers the next 8 Saturdays, nearest first', () => {
    const sats = upcomingSaturdays(THU);
    expect(sats).toHaveLength(8);
    expect(sats.every((d) => d.getDay() === 6)).toBe(true);
    expect(dayLabel(sats[0])).toBe('Sat 3 Oct');
    expect(dayLabel(sats[7])).toBe('Sat 21 Nov');
  });

  it('AC1: on a Saturday, today is the first choice', () => {
    expect(sameDay(upcomingSaturdays(new Date(2026, 9, 3, 8, 0))[0], new Date(2026, 9, 3))).toBe(true);
  });

  it('crosses a month and a clock change without drifting off Saturday', () => {
    // Late October: the clocks go back on the 25th in the UK.
    const sats = upcomingSaturdays(new Date(2026, 9, 20), 3);
    expect(sats.map(dayLabel)).toEqual(['Sat 24 Oct', 'Sat 31 Oct', 'Sat 7 Nov']);
  });

  it('AC2: times from 08:00 to 14:00 in 15-minute steps', () => {
    expect(KICKOFF_TIMES[0]).toBe('08:00');
    expect(KICKOFF_TIMES[1]).toBe('08:15');
    expect(KICKOFF_TIMES[KICKOFF_TIMES.length - 1]).toBe('14:00');
    expect(KICKOFF_TIMES).toHaveLength(25);
  });

  it('AC3: any other date — months ahead, and the right number of days', () => {
    expect(upcomingMonths(new Date(2026, 10, 15), 3)).toEqual([
      [2026, 10],
      [2026, 11],
      [2027, 0],
    ]);
    expect(daysInMonth(2028, 1)).toBe(29);
    expect(daysInMonth(2026, 1)).toBe(28);
  });

  it('builds the kick-off from a day and a time, in local time', () => {
    const d = new Date(kickoffIso(new Date(2026, 9, 10), '10:30'));
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([10, 10, 30]);
  });
});
