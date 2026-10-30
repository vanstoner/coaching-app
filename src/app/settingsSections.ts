/**
 * Settings in collapsible sections — #263 (Dee's prototype, Bea's AC1 to
 * AC21, approved by Rob 29 Oct). Pure: which sections there are, which start
 * open, how the open set is remembered, every closed heading's one-line
 * summary, and the last-backup date.
 *
 * Which sections are open is a **view choice on this phone** (AC5), kept like
 * the table sorts under one key, never in the record. Danger zone is never
 * stored and always starts closed (AC6). Every summary is worked out on each
 * draw from what the screen already has; nothing derived is stored (AC16,
 * invariant 1).
 */

import { describeDefaults } from './settings';

/** The ten sections, in their order (AC1). */
export const SETTINGS_SECTIONS = [
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
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number];

/** AC3: Season and Team open, everything else closed. */
export const DEFAULT_OPEN_SECTIONS: readonly SettingsSectionId[] = ['season', 'team'];

/** AC5: one key under `coaching-app/`, beside `table-sort/v1`. Never in the record. */
export const SETTINGS_SECTIONS_KEY = 'coaching-app/settings-sections/v1';

const isSection = (x: unknown): x is SettingsSectionId =>
  typeof x === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(x);

/**
 * The open set as stored, read back. Missing or unreadable: the default
 * (AC3). An unknown id is ignored, and Danger zone is dropped (AC6).
 */
export function parseOpenSections(raw: string | null | undefined): Set<SettingsSectionId> {
  if (raw === null || raw === undefined) return new Set(DEFAULT_OPEN_SECTIONS);
  try {
    const parsed: unknown = JSON.parse(raw);
    const list = (parsed as { open?: unknown })?.open;
    if (!Array.isArray(list)) return new Set(DEFAULT_OPEN_SECTIONS);
    return new Set(list.filter(isSection).filter((id) => id !== 'danger'));
  } catch {
    return new Set(DEFAULT_OPEN_SECTIONS);
  }
}

/** What is written: the open set in page order, never Danger zone (AC6). */
export function serialiseOpenSections(open: ReadonlySet<SettingsSectionId>): string {
  return JSON.stringify({ open: SETTINGS_SECTIONS.filter((id) => id !== 'danger' && open.has(id)) });
}

/** Open or close one section; several can be open at once (AC4). */
export function toggleSection(open: ReadonlySet<SettingsSectionId>, id: SettingsSectionId): Set<SettingsSectionId> {
  const next = new Set(open);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

// ---------------------------------------------------------------------------
// Summaries (AC9)
// ---------------------------------------------------------------------------

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function seasonSummary(s: {
  confirmed: boolean;
  name: string;
  ageGroup: string | null;
  matches: number;
}): string {
  if (!s.confirmed) return 'Not started yet';
  return [s.name, s.ageGroup, plural(s.matches, 'match', 'matches')].filter(Boolean).join(' · ');
}

export function teamSummary(name: string, teamsOnPhone: number): string {
  return `${name} · ${plural(teamsOnPhone, 'team', 'teams')} on this phone`;
}

export function defaultsSummary(d: {
  totalMinutes: number;
  periodCount: number;
  /** The shape's code, e.g. "2-3-1"; null for a custom shape. */
  shape: string | null;
  buzz: boolean;
}): string {
  return [
    `${d.totalMinutes} min`,
    describeDefaults(d.totalMinutes, d.periodCount),
    d.shape,
    `buzz ${d.buzz ? 'on' : 'off'}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function minutesSummary(matches: number, players: number): string {
  if (matches <= 0) return 'Nothing played yet';
  return `${plural(matches, 'match', 'matches')} · ${plural(players, 'player', 'players')} · export, import`;
}

/** The awards on offer, in their order (retired ones are not on offer). */
export function awardsSummary(onOffer: readonly string[]): string {
  return onOffer.length === 0 ? 'None on offer' : onOffer.join(', ');
}

/** "5 built in · 1 of yours"; the second part is dropped at 0. */
export function talliesSummary(builtIn: number, yoursOffered: number): string {
  return yoursOffered > 0 ? `${builtIn} built in · ${yoursOffered} of yours` : `${builtIn} built in`;
}

export function testMatchesSummary(count: number): string {
  return count <= 0 ? 'None on this phone' : `${count} on this phone`;
}

export const TEST_KIT_SUMMARY = 'Test squad, past season, signing timer';

/** Matches the button: "Forget everything (all 3 teams)" with more than one team. */
export function dangerSummary(teamName: string | null, forgetCount: number): string {
  const forget = forgetCount > 1 ? `Forget everything (all ${forgetCount} teams)` : 'Forget everything';
  return teamName === null ? forget : `Remove ${teamName} · ${forget}`;
}

// ---------------------------------------------------------------------------
// The last backup (AC10; Rob, Q1: keep "Last backed up")
// ---------------------------------------------------------------------------

/**
 * When Back up this app last made its file and handed it to the share sheet
 * without an error, on this phone. A view note: never in the record, never
 * in a backup file, never restored from one. Forget everything removes it.
 */
export const LAST_BACKUP_KEY = 'coaching-app/last-backup/v1';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sat 24 Oct", in the phone's own time zone. */
export function shortDay(ms: number): string {
  const d = new Date(ms);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** The stored note read back: a time in ms, or null when missing or unreadable. */
export function parseLastBackup(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function serialiseLastBackup(ms: number): string {
  return String(Math.round(ms));
}

export function backupSummary(lastBackupMs: number | null): string {
  return lastBackupMs === null ? 'Not backed up from this phone yet' : `Last backed up ${shortDay(lastBackupMs)}`;
}
