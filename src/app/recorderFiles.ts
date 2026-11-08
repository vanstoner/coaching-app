/**
 * #281 (Rob, 7 Nov: "Import a match from another recorder's app"; ADR-025,
 * Proposed): the recorder pack the coach sends, and the recorded match the
 * recorder sends back. Pure TypeScript.
 *
 * D1: each file is a small wrapper around an ordinary minutes file (ledger
 * v2), read with parseLedger's checks. D2: the pack is a fresh chain holding
 * only what recording needs: the team's name, its active children (first
 * names only), the fixture, the settings, the coach's tallies, the season and
 * its power play rule, and a `pack` record naming the fixture. D5: the
 * import appends the match's records to the coach's record, unchanged with
 * their ids, plus one `received` record carrying the recorder's original
 * entries as evidence; it is refused, writing nothing, unless every rule holds.
 */

import type { AvailabilityStatus, Format, UUID } from '../types/index';
import {
  appendRecords,
  carryRecords,
  emptyLedger,
  importLedger,
  isWritable,
  parseLedger,
  serialiseLedger,
  type Ledger,
} from './ledger';
import { keyOf, latestRecords, type LedgerEntry, type LedgerRecord } from './ledgerChain';
import { isPlanShaped, type SavedMatch } from './persistence';
import { restoreFromRecord, type Restored } from './recordRestore';

export const PACK_KIND = 'coaching-app/recorder-pack';
export const MATCH_KIND = 'coaching-app/recorded-match';
const FILE_VERSION = 1;

export interface RecorderPack {
  kind: typeof PACK_KIND;
  version: number;
  minReaderVersion: number;
  writtenAt: string;
  fixtureId: UUID;
  /** The pack's chain, as a minutes file's JSON. */
  record: unknown;
  /** The fixture's plan as the session stores it, or null. */
  plan: unknown;
  /** Coming, Can't or Not heard per child, as the session stores it. */
  availability: [UUID, string][];
}

export interface RecordedMatchFile {
  kind: typeof MATCH_KIND;
  version: number;
  minReaderVersion: number;
  writtenAt: string;
  fixtureId: UUID;
  record: unknown;
}

/** D2: the pack's chain: a fresh genesis and only what recording needs, from the coach's record. */
export function packLedger(coach: Ledger, fixtureId: UUID, now: Date): Ledger {
  const active = new Set(coach.players.filter((p) => p.active).map((p) => p.id));
  const fixture = coach.fixtures.find((f) => f.id === fixtureId);
  const season = fixture?.season ?? null;
  let pack = emptyLedger(coach.squad.id, coach.squad.name, now);
  pack = carryRecords(pack, coach, (key) => {
    const [type, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    if (key === 'settings') return true;
    if (type === 'player') return active.has(id as UUID);
    if (type === 'fixture') return id === fixtureId;
    if (type === 'event-type') return true;
    if (type === 'season' || type === 'power-play-rule') return season !== null && id === season;
    return false;
  });
  return appendRecords(pack, [{ type: 'pack', fixtureId }], now);
}

export function makeRecorderPack(coach: Ledger, fixtureId: UUID, plan: unknown, availability: [UUID, string][], now: Date): RecorderPack {
  return {
    kind: PACK_KIND,
    version: FILE_VERSION,
    minReaderVersion: 1,
    writtenAt: now.toISOString(),
    fixtureId,
    record: JSON.parse(serialiseLedger(packLedger(coach, fixtureId, now), false)),
    plan: plan ?? null,
    availability,
  };
}

/** D4: the borrowed team's whole record, as the match file. */
export function makeRecordedMatch(borrowed: Ledger, fixtureId: UUID, now: Date): RecordedMatchFile {
  return {
    kind: MATCH_KIND,
    version: FILE_VERSION,
    minReaderVersion: 1,
    writtenAt: now.toISOString(),
    fixtureId,
    record: JSON.parse(serialiseLedger(borrowed, false)),
  };
}

export type RecorderFile =
  | { kind: 'pack'; file: RecorderPack; ledger: Ledger }
  | { kind: 'match'; file: RecordedMatchFile; ledger: Ledger }
  | { kind: 'minutes' }
  | { kind: 'refused'; reason: string };

/** D1: one picker routes by `kind`; a bare minutes file goes to Import minutes file as today. */
export function readRecorderFile(text: string): RecorderFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { kind: 'refused', reason: 'This file could not be read.' };
  }
  if (typeof raw !== 'object' || raw === null) return { kind: 'refused', reason: 'This file could not be read.' };
  const o = raw as Record<string, unknown>;
  if (o.kind !== PACK_KIND && o.kind !== MATCH_KIND) return { kind: 'minutes' };
  if (typeof o.minReaderVersion !== 'number' || o.minReaderVersion > FILE_VERSION) {
    return { kind: 'refused', reason: 'This file was made by a newer version of the app. Update the app, then open it again.' };
  }
  if (typeof o.fixtureId !== 'string') return { kind: 'refused', reason: 'This file names no fixture.' };
  const parsed = parseLedger(JSON.stringify(o.record));
  if (!parsed.ok) return { kind: 'refused', reason: parsed.reason };
  return o.kind === PACK_KIND
    ? { kind: 'pack', file: o as unknown as RecorderPack, ledger: parsed.ledger }
    : { kind: 'match', file: o as unknown as RecordedMatchFile, ledger: parsed.ledger };
}

/** Whether a record belongs to the match's play (D5's copied types). */
const PLAY_TYPES = new Set(['match', 'structure', 'interval', 'event', 'attendance', 'exclusion']);
function playOf(r: LedgerRecord, matchId: UUID): boolean {
  if (!PLAY_TYPES.has(String(r.type))) return false;
  return r.type === 'match' ? r.id === matchId : r.matchId === matchId;
}

export const ALREADY_IN_RECORD = 'This match is already in your record. Nothing has been added or changed.';
export const RECORDED_HERE_TOO =
  'Your phone recorded this match too. Only one recording of a match can be kept, and yours is already in your record. Nothing has been added or changed.';

/**
 * D5: append the match file's match to the coach's record, or say why not.
 * `holdingLive` is true when this phone holds that match live.
 */
export function importRecordedMatch(
  coach: Ledger,
  file: RecordedMatchFile,
  recorded: Ledger,
  holdingLive: boolean,
  now: Date
): { ok: true; ledger: Ledger; matchId: UUID } | { ok: false; reason: string } {
  if (!isWritable(coach)) return { ok: false, reason: 'Player minutes cannot be written on this phone.' };
  const matchId = file.fixtureId;
  const theirs = recorded.matches.find((m) => m.id === matchId);
  if (!theirs || theirs.status !== 'completed') return { ok: false, reason: 'The match in this file has not been finished. Ask the recorder to end it, then send it again.' };
  const fixture = coach.fixtures.find((f) => f.id === matchId);
  if (!fixture) return { ok: false, reason: "This match is not one of this team's fixtures. Open the team it was shared from." };
  if (fixture.state === 'cancelled') return { ok: false, reason: 'That fixture is cancelled.' };
  const ours = coach.matches.find((m) => m.id === matchId);
  const alreadyImported = latestRecords(coach.entries).has(`received:${matchId}`);
  if (alreadyImported) return { ok: false, reason: ALREADY_IN_RECORD };
  if (holdingLive || (ours && (ours.intervals.length > 0 || (ours.events?.length ?? 0) > 0 || (ours.attendance?.length ?? 0) > 0))) {
    return { ok: false, reason: RECORDED_HERE_TOO };
  }
  const known = new Set(coach.players.map((p) => p.id));
  const copied = [...latestRecords(recorded.entries).values()].filter((r) => playOf(r, matchId));
  const stranger = copied.find((r) => typeof r.playerId === 'string' && !known.has(r.playerId as UUID));
  if (stranger) return { ok: false, reason: 'This file has a child who is not in your squad. Nothing has been added.' };
  const originals: LedgerEntry[] = recorded.entries.filter((e) => e.records.some((r) => playOf(r, matchId)));
  const device = originals.map((e) => (e as unknown as { device?: string }).device).find((d) => typeof d === 'string') ?? null;
  const received: LedgerRecord = { type: 'received', matchId, device, entries: originals as unknown as LedgerRecord[] };
  // D5: the recorder's key, if the coach's chain does not publish it yet, so D6 can check what it signed.
  const isKey = (r: LedgerRecord) => r.type === 'device' && r.id === device;
  const published = coach.entries.some((e) => e.records.some(isKey));
  const key = device && !published ? recorded.entries.flatMap((e) => e.records).find(isKey) : undefined;
  return { ok: true, ledger: appendRecords(coach, [...(key ? [key] : []), ...copied, received], now), matchId };
}

/** D6: a match carried in from another phone, from its `received` record. */
export function recordedElsewhere(ledger: Ledger, matchId: UUID): boolean {
  return latestRecords(ledger.entries).has(`received:${matchId}`);
}

/**
 * D3: the fixture a borrowed team was lent for, from the pack record its
 * chain holds; null for a team of one's own. A fact about where the record
 * came from, never a setting.
 */
export function borrowedFor(ledger: Ledger | null | undefined): UUID | null {
  if (!ledger) return null;
  const r = latestRecords(ledger.entries).get('pack');
  return r && typeof r.fixtureId === 'string' ? (r.fixtureId as UUID) : null;
}

const STATUSES = new Set<AvailabilityStatus>(['available', 'absent', 'injured', 'unavailable', 'unconfirmed']);

/**
 * D3: a pack opened on the recorder's phone. Its chain is adopted onto the
 * new team's empty record as Import minutes file adopts one, the team is
 * rebuilt from it (children, settings, the one fixture), and the fixture
 * gets the coach's plan and Who's coming. Nothing else is invented.
 */
export function openPack(
  base: Ledger,
  pack: RecorderPack,
  chain: Ledger,
  defaults: Format,
  now: Date
): { ok: true; ledger: Ledger; restored: Restored; matches: SavedMatch[] } | { ok: false; reason: string } {
  if (borrowedFor(chain) !== pack.fixtureId) return { ok: false, reason: 'This pack does not match its fixture. Ask the coach to share it again.' };
  const report = importLedger(base, chain, undefined, now);
  if (!report.ok) return { ok: false, reason: report.reason };
  const restored = restoreFromRecord(report.ledger, base.squad.id, defaults, now);
  const known = new Set(restored.players.map((p) => p.id));
  const availability = (Array.isArray(pack.availability) ? pack.availability : []).filter(
    (a): a is [UUID, AvailabilityStatus] =>
      Array.isArray(a) && known.has(a[0] as UUID) && STATUSES.has(a[1] as AvailabilityStatus)
  );
  const plan = isPlanShaped(pack.plan) ? pack.plan : undefined;
  const matches = restored.fixtures.map((m) =>
    m.match.id !== pack.fixtureId
      ? m
      : {
          ...m,
          ...(plan ? { plan } : {}),
          // Who's coming as the coach left it; a child the pack does not mention keeps the rebuilt default.
          availability: m.availability.map(([id, status]): [UUID, AvailabilityStatus] => availability.find((a) => a[0] === id) ?? [id, status]),
        }
  );
  if (!matches.some((m) => m.match.id === pack.fixtureId)) {
    return { ok: false, reason: 'The fixture in this pack could not be opened on this phone. Update the app, then try again.' };
  }
  return { ok: true, ledger: report.ledger, restored, matches };
}

/** D4: Send to the coach appears once the borrowed fixture's match is finished. */
export function borrowedMatchFinished(ledger: Ledger | null, fixtureId: UUID): boolean {
  return ledger?.matches.some((m) => m.id === fixtureId && m.status === 'completed') ?? false;
}

/** D3: the same children, by id and name; a borrowed team may change who is here, never who exists. */
export function sameChildren(
  a: readonly { id: UUID; firstName: string; displaySuffix?: string | null }[],
  b: readonly { id: UUID; firstName: string; displaySuffix?: string | null }[]
): boolean {
  const key = (p: { id: UUID; firstName: string; displaySuffix?: string | null }) => `${p.id}|${p.firstName}|${p.displaySuffix ?? ''}`;
  const x = new Set(a.map(key));
  return a.length === b.length && b.every((p) => x.has(key(p)));
}

export { keyOf };
