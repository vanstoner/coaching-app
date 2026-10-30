/**
 * #263 AC19: the Settings sections — default open set, the stored choice,
 * every summary, the last-backup date — and that none of it touches the
 * record (AC16, #264 C1, C2, E7).
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPEN_SECTIONS,
  SETTINGS_SECTIONS,
  SETTINGS_SECTIONS_KEY,
  LAST_BACKUP_KEY,
  TEST_KIT_SUMMARY,
  awardsSummary,
  backupSummary,
  dangerSummary,
  defaultsSummary,
  minutesSummary,
  parseLastBackup,
  parseOpenSections,
  seasonSummary,
  serialiseLastBackup,
  serialiseOpenSections,
  shortDay,
  talliesSummary,
  teamSummary,
  testMatchesSummary,
  toggleSection,
} from './settingsSections';
import { BUILT_IN_TALLIES } from './tallies';
import { addAwardType, emptyLedger } from './ledger';
import { fingerprint } from './ledgerAnchor';
import { sheetCommit } from './saveState';
import { uuid } from '../types/index';

describe('sections and order (AC1, AC3)', () => {
  it('ten sections, Danger zone last', () => {
    expect(SETTINGS_SECTIONS).toEqual([
      'season',
      'team',
      'defaults',
      'minutes',
      'awards',
      'tallies',
      'backup',
      'tests',
      'testkit',
      'danger',
    ]);
  });

  it('Season and Team open by default', () => {
    expect([...DEFAULT_OPEN_SECTIONS]).toEqual(['season', 'team']);
  });

  it('keys live under coaching-app/', () => {
    expect(SETTINGS_SECTIONS_KEY.startsWith('coaching-app/')).toBe(true);
    expect(LAST_BACKUP_KEY.startsWith('coaching-app/')).toBe(true);
  });
});

describe('the stored choice (AC5, AC6)', () => {
  it('missing falls back to the default', () => {
    expect([...parseOpenSections(null)]).toEqual(['season', 'team']);
    expect([...parseOpenSections(undefined)]).toEqual(['season', 'team']);
  });

  it('unreadable falls back to the default, with no error', () => {
    expect([...parseOpenSections('{not json')]).toEqual(['season', 'team']);
    expect([...parseOpenSections('"hello"')]).toEqual(['season', 'team']);
    expect([...parseOpenSections('{"open":"backup"}')]).toEqual(['season', 'team']);
  });

  it('an unknown id is ignored', () => {
    expect([...parseOpenSections('{"open":["backup","nonsense",3]}')]).toEqual(['backup']);
  });

  it('Danger zone is dropped on the way in and never written', () => {
    expect([...parseOpenSections('{"open":["danger","awards"]}')]).toEqual(['awards']);
    expect(serialiseOpenSections(new Set(['danger', 'team']))).toBe('{"open":["team"]}');
  });

  it('all closed is a choice, kept as such', () => {
    expect([...parseOpenSections(serialiseOpenSections(new Set()))]).toEqual([]);
  });

  it('round-trips in page order', () => {
    const open = new Set(['backup', 'season'] as const);
    expect(serialiseOpenSections(open)).toBe('{"open":["season","backup"]}');
    expect([...parseOpenSections(serialiseOpenSections(open))]).toEqual(['season', 'backup']);
  });

  it('several open at once: opening one never closes another (AC4)', () => {
    const one = toggleSection(new Set(['season', 'team']), 'backup');
    expect([...one].sort()).toEqual(['backup', 'season', 'team']);
    expect([...toggleSection(one, 'team')].sort()).toEqual(['backup', 'season']);
  });
});

describe('summaries (AC9)', () => {
  it('Season', () => {
    expect(seasonSummary({ confirmed: true, name: '2026/27', ageGroup: 'U10', matches: 12 })).toBe(
      '2026/27 · U10 · 12 matches'
    );
    expect(seasonSummary({ confirmed: true, name: '2026/27', ageGroup: 'U10', matches: 1 })).toBe(
      '2026/27 · U10 · 1 match'
    );
    expect(seasonSummary({ confirmed: false, name: '2026/27', ageGroup: null, matches: 3 })).toBe('Not started yet');
  });

  it('Team, singular and plural', () => {
    expect(teamSummary('Unicorns U10', 1)).toBe('Unicorns U10 · 1 team on this phone');
    expect(teamSummary('Unicorns U10', 3)).toBe('Unicorns U10 · 3 teams on this phone');
  });

  it('Match defaults', () => {
    expect(defaultsSummary({ totalMinutes: 50, periodCount: 4, shape: '2-3-1', buzz: true })).toBe(
      '50 min · 4 × 12:30 quarters · 2-3-1 · buzz on'
    );
    expect(defaultsSummary({ totalMinutes: 60, periodCount: 2, shape: null, buzz: false })).toBe(
      '60 min · 2 × 30:00 halves · buzz off'
    );
  });

  it('Player minutes', () => {
    expect(minutesSummary(12, 9)).toBe('12 matches · 9 players · export, import');
    expect(minutesSummary(1, 1)).toBe('1 match · 1 player · export, import');
    expect(minutesSummary(0, 9)).toBe('Nothing played yet');
  });

  it('Awards', () => {
    expect(awardsSummary(['Player of the Week', 'Mr Assister'])).toBe('Player of the Week, Mr Assister');
    expect(awardsSummary([])).toBe('None on offer');
  });

  it('Tallies, from the code’s count', () => {
    const n = BUILT_IN_TALLIES.length;
    expect(talliesSummary(n, 1)).toBe(`${n} built in · 1 of yours`);
    expect(talliesSummary(n, 0)).toBe(`${n} built in`);
  });

  it('Backup', () => {
    const sat = new Date(2026, 9, 24, 10, 0).getTime();
    expect(shortDay(sat)).toBe('Sat 24 Oct');
    expect(backupSummary(sat)).toBe('Last backed up Sat 24 Oct');
    expect(backupSummary(null)).toBe('Not backed up from this phone yet');
  });

  it('Test matches and Test kit', () => {
    expect(testMatchesSummary(2)).toBe('2 on this phone');
    expect(testMatchesSummary(0)).toBe('None on this phone');
    expect(TEST_KIT_SUMMARY).toBe('Test squad, past season, signing timer');
  });

  it('Danger zone, one team, several, none', () => {
    expect(dangerSummary('Unicorns U10', 1)).toBe('Remove Unicorns U10 · Forget everything');
    expect(dangerSummary('Unicorns U10', 3)).toBe('Remove Unicorns U10 · Forget everything (all 3 teams)');
    expect(dangerSummary(null, 1)).toBe('Forget everything');
  });
});

describe('the last backup date (AC10)', () => {
  it('reads back what was written; anything else is no date', () => {
    const t = new Date(2026, 9, 24, 10, 0).getTime();
    expect(parseLastBackup(serialiseLastBackup(t))).toBe(t);
    expect(parseLastBackup(null)).toBeNull();
    expect(parseLastBackup('soon')).toBeNull();
    expect(parseLastBackup('-5')).toBeNull();
  });
});

describe('nothing about the record changes (AC16, #264 C1, C2, E7)', () => {
  it('opening and closing every section and cancelling a sheet leaves the ledger fingerprint as it was', () => {
    const now = new Date('2026-10-24T10:00:00.000Z');
    const made = addAwardType(emptyLedger(uuid(), 'Unicorns U10', now), 'Kindness', now);
    if (!made.ok) throw new Error(made.reason);
    const ledger = made.ledger;
    const before = fingerprint(ledger);
    let open = parseOpenSections(null);
    for (const id of SETTINGS_SECTIONS) open = toggleSection(toggleSection(open, id), id);
    expect(sheetCommit('outside', { name: 'Kind' })).toBeNull();
    expect(sheetCommit('cancel', { name: 'Kind' })).toBeNull();
    expect(sheetCommit('back', { name: 'Kind' })).toBeNull();
    expect(fingerprint(ledger)).toBe(before);
    expect([...open].sort()).toEqual(['season', 'team']);
  });
});
