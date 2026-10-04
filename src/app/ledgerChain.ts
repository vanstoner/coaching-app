/**
 * The ledger's hash chain — ADR-014 (#100).
 *
 * Pure TypeScript, synchronous, no I/O. The ledger is a list of entries; each
 * holds the records one recording changed, the hash of the entry before it,
 * and its own hash. Everything a screen shows is folded from the entries on
 * read (`ledger.ts`) and never stored (invariant 1).
 *
 * This file knows nothing of matches or players: it canonicalises, hashes,
 * appends, verifies, and folds records to their latest revision by key.
 */

import { sha256 } from './sha256';

/**
 * One record. `type` is the tag (ADR-014 §3): squad, player, match, interval,
 * event, attendance. A type this build does not know is carried and hashed,
 * and ignored by the fold.
 */
export interface LedgerRecord {
  type: string;
  [field: string]: unknown;
}

export interface LedgerEntry {
  seq: number;
  /** The previous entry's hash; null at 0. */
  prev: string | null;
  /** The device's wall clock when written. For people only: order is `seq`. */
  at: string;
  /** `genesis` at 0, `record` after. */
  kind: string;
  records: LedgerRecord[];
  /** sha256(canonical(this entry without `hash`)), lowercase hex. */
  hash: string;
  /** Genesis only: where the chain came from — 'v1', 'new'. */
  from?: string;
  [field: string]: unknown;
}

/**
 * Canonical JSON (ADR-014 §6): keys sorted by code unit, no whitespace,
 * arrays in order, `undefined` omitted, `null` kept, strings escaped as
 * `JSON.stringify` escapes them. A number that is not a safe integer is a bug
 * — every ledger number is ms, minutes or a count — and throws.
 */
export function canonical(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isSafeInteger(value)) {
        throw new Error(`canonical: ${value} is not a safe integer`);
      }
      return String(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((v) => (v === undefined ? 'null' : canonical(v))).join(',')}]`;
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
    }
    default:
      throw new Error(`canonical: cannot encode a ${typeof value}`);
  }
}

/** The hash an entry should carry: of everything in it except `hash`. */
export function hashOf(entry: Omit<LedgerEntry, 'hash'> | LedgerEntry): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { hash, ...rest } = entry as LedgerEntry;
  return sha256(canonical(rest));
}

/** A new entry after `previous` (null for a genesis). */
export function makeEntry(
  previous: LedgerEntry | null,
  kind: string,
  records: LedgerRecord[],
  at: Date,
  extra: Record<string, unknown> = {}
): LedgerEntry {
  const body = {
    ...extra,
    seq: previous ? previous.seq + 1 : 0,
    prev: previous ? previous.hash : null,
    at: at.toISOString(),
    kind,
    records,
  };
  return { ...body, hash: hashOf(body) };
}

/** The key a record's later revisions replace it by; null for an unknown type. */
export function keyOf(record: LedgerRecord): string | null {
  switch (record.type) {
    case 'squad':
      return 'squad';
    case 'player':
    case 'match':
      return `${record.type}:${String(record.id)}`;
    case 'interval':
    case 'event':
      return `${record.type}:${String(record.matchId)}:${String(record.id)}`;
    case 'attendance':
      return `attendance:${String(record.matchId)}:${String(record.playerId)}`;
    default:
      return null;
  }
}

/**
 * Every record's latest revision, by key, in the order each key first
 * appeared. Unknown record types are left out of the fold (they are still in
 * the chain, so they are still written back).
 *
 * Read-only: it is cached against the chain's last entry, and a chain that
 * grows by one entry folds only that entry (a season is ~1,000 entries and
 * this runs on every save). Copy it before changing it.
 */
export function latestRecords(entries: LedgerEntry[]): ReadonlyMap<string, LedgerRecord> {
  const last = entries[entries.length - 1];
  if (!last) return new Map();
  const cached = latestCache.get(last);
  if (cached) return cached;
  const before = entries.length > 1 ? latestCache.get(entries[entries.length - 2]) : undefined;
  const latest = new Map<string, LedgerRecord>(before ?? []);
  for (const entry of before ? [last] : entries) {
    for (const record of entry.records) {
      const key = keyOf(record);
      if (key !== null) latest.set(key, record);
    }
  }
  latestCache.set(last, latest);
  return latest;
}

const latestCache = new WeakMap<LedgerEntry, Map<string, LedgerRecord>>();

/**
 * Whether two records have the same canonical form. Known records are flat,
 * so a field-by-field check settles almost every call without building the
 * canonical strings; anything nested falls back to them.
 */
export function sameRecord(a: LedgerRecord, b: LedgerRecord): boolean {
  const keys = (r: LedgerRecord) => Object.keys(r).filter((k) => r[k] !== undefined);
  const ka = keys(a);
  if (ka.length !== keys(b).length) return false;
  for (const k of ka) {
    const x = a[k];
    const y = b[k];
    if (x === y) continue;
    if (typeof x === 'object' && x !== null && typeof y === 'object' && y !== null) {
      return canonical(a) === canonical(b);
    }
    return false;
  }
  return true;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "3 Oct at 10:42", in the phone's time zone. */
export function whenOf(at: unknown): string {
  const d = typeof at === 'string' ? new Date(at) : new Date(NaN);
  if (Number.isNaN(d.getTime())) return 'an unknown time';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} at ${hh}:${mm}`;
}

export type Verification =
  | { ok: true }
  /** `detail` is a plain-English clause: "the entry recorded on … has been changed since it was written". */
  | { ok: false; detail: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Check a chain (ADR-014 §8): `seq` contiguous from 0, entry 0 a genesis with
 * `prev: null`, each `prev` the hash before it, each hash recomputing. The
 * first failure is reported; nothing is repaired.
 */
export function verifyChain(entries: unknown): Verification {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { ok: false, detail: 'it has no entries, so its start is missing' };
  }
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as unknown;
    const before = i > 0 ? (entries[i - 1] as LedgerEntry) : null;
    const after = before ? `after ${whenOf(before.at)}` : 'at its start';
    if (!isObj(e) || !Array.isArray(e.records) || typeof e.hash !== 'string') {
      return { ok: false, detail: `an entry ${after} is damaged` };
    }
    if (e.seq !== i) {
      if (typeof e.seq === 'number' && e.seq > i) {
        return { ok: false, detail: i === 0 ? 'its start is missing' : `an entry is missing ${after}` };
      }
      return { ok: false, detail: `an entry has been added or moved ${after}` };
    }
    if (i === 0 && (e.kind !== 'genesis' || e.prev !== null)) {
      return { ok: false, detail: 'its start is missing or has been changed' };
    }
    if (before && e.prev !== before.hash) {
      return { ok: false, detail: `an entry is missing ${after}` };
    }
    if (!e.records.every((r) => isObj(r) && typeof r.type === 'string')) {
      return { ok: false, detail: `the entry recorded on ${whenOf(e.at)} is damaged` };
    }
    let recomputed: string;
    try {
      recomputed = hashOf(e as LedgerEntry);
    } catch {
      recomputed = '';
    }
    if (recomputed !== e.hash) {
      return {
        ok: false,
        detail: `the entry recorded on ${whenOf(e.at)} has been changed since it was written`,
      };
    }
  }
  return { ok: true };
}
