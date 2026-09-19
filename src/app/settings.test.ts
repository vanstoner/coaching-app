import { describe, expect, it } from 'vitest';

import {
  MAX_TEAM_NAME_LENGTH,
  describeDefaults,
  normaliseTeamName,
  periodMsFor,
  teamNameIsClean,
} from './settings';

describe('normaliseTeamName', () => {
  it('keeps a normal name untouched', () => {
    expect(normaliseTeamName('Sunday Rovers', 'Example FC')).toBe('Sunday Rovers');
  });

  it('falls back rather than storing a blank name', () => {
    // A coach who clears the field has not asked for a nameless app.
    for (const blank of ['', '   ', '\n\t ']) {
      expect(normaliseTeamName(blank, 'Example FC')).toBe('Example FC');
    }
  });

  it('collapses runs of whitespace', () => {
    expect(normaliseTeamName('Sunday    Rovers', 'Example FC')).toBe('Sunday Rovers');
  });

  it('trims the ends', () => {
    expect(normaliseTeamName('  Sunday Rovers  ', 'Example FC')).toBe('Sunday Rovers');
  });

  it('truncates to what the input allows, so the model cannot exceed the UI', () => {
    const long = 'A'.repeat(MAX_TEAM_NAME_LENGTH + 20);
    expect(normaliseTeamName(long, 'Example FC')).toHaveLength(MAX_TEAM_NAME_LENGTH);
  });
});

describe('teamNameIsClean', () => {
  it('is true for a name that would be stored exactly as typed', () => {
    expect(teamNameIsClean('Sunday Rovers')).toBe(true);
  });

  it('is false when normalising would change it', () => {
    expect(teamNameIsClean(' Sunday Rovers')).toBe(false);
    expect(teamNameIsClean('Sunday  Rovers')).toBe(false);
    expect(teamNameIsClean('A'.repeat(MAX_TEAM_NAME_LENGTH + 1))).toBe(false);
  });
});

describe('describeDefaults', () => {
  it("describes the PO's own example: a 50-minute match in quarters", () => {
    expect(describeDefaults(50, 4)).toBe('4 × 12:30 quarters');
  });

  it('describes halves, and says Halves rather than Halfs', () => {
    expect(describeDefaults(75, 2)).toBe('2 × 37:30 halves');
  });

  it('covers every combination the setup screen offers', () => {
    for (const minutes of [50, 60, 75, 90]) {
      for (const periods of [2, 4]) {
        const text = describeDefaults(minutes, periods);
        expect(text).toMatch(/^\d × \d{2}:\d{2} (halves|quarters)$/);
      }
    }
  });

  it('does not render nonsense for impossible input', () => {
    expect(describeDefaults(50, 0)).toBe('—');
    expect(describeDefaults(Number.NaN, 4)).toBe('—');
    expect(describeDefaults(50, Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('periodMsFor', () => {
  it('gives 12:30 for a 50-minute match in quarters', () => {
    expect(periodMsFor(50, 4)).toBe(750_000);
  });

  it('agrees with what describeDefaults renders', () => {
    // The sub plan anchors to this number and the coach reads that string.
    // If they ever disagree, the reminder fires at a time nobody was shown.
    expect(describeDefaults(50, 4)).toContain('12:30');
    expect(periodMsFor(50, 4)).toBe(12 * 60_000 + 30_000);
  });

  it('returns zero rather than Infinity for impossible input', () => {
    expect(periodMsFor(50, 0)).toBe(0);
    expect(periodMsFor(Number.NaN, 4)).toBe(0);
  });
});
