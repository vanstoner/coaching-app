/**
 * How far a played match can be trusted — #199 (PO `approve readiness`,
 * 18 Oct: AC1–6; the derived rule replaces #189 AC2), ADR-021 D4.
 *
 * Three states, **derived from the record on every read, never stored**
 * (invariant 1; ADR-021 rejected a stored flag):
 *
 * - **pristine**: every interval, event and attendance record of the match
 *   was written in an entry signed (and checking) by the one install that
 *   wrote the first of them, each within the match's window, with no
 *   `origin: reconstructed`, no corrected interval, and nothing added after
 *   its last period was recorded. A signed match imported onto another phone
 *   stays pristine: the signatures travel with it.
 * - **live, unsigned**: the same, but written before signing existed.
 * - **reconstructed**: anything else, e.g. this season's back-filled
 *   matches, written weeks after kick-off.
 *
 * **The window** is from 2 hours before kick-off to 3 hours after its
 * planned end. Seconds do not matter here; a match typed in from paper days
 * later is what this tells apart (proportionality ruling). Kick-off is the
 * fixture's time, else when the record took the kick-off attendance.
 *
 * Signatures are checked once per entry and remembered, so drawing a screen
 * does not re-check the whole chain.
 */

import type { UUID } from '../types/index';
import type { Ledger, LedgerEntry, LedgerMatch } from './ledger';
import { signatureStatuses, type SignatureStatus } from './entrySigning';

export type Provenance = 'pristine' | 'live-unsigned' | 'reconstructed';

export interface ProvenanceInfo {
  state: Provenance;
  /** Why, in words a coach reads on the match page ("How was this recorded?"). */
  why: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const WINDOW_BEFORE_MS = 2 * HOUR;
export const WINDOW_AFTER_MS = 3 * HOUR;

// --- signatures, checked once per entry --------------------------------------

const checked = new WeakMap<LedgerEntry, SignatureStatus>();

/** Each entry's signature status, remembered per entry (a key, once published, never changes). */
export function statusesOf(entries: readonly LedgerEntry[]): SignatureStatus[] {
  if (entries.every((e) => checked.has(e))) return entries.map((e) => checked.get(e) as SignatureStatus);
  const all = signatureStatuses(entries);
  entries.forEach((e, i) => checked.set(e, all[i]));
  return all;
}

// --- the rule ------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayOf = (t: number) => {
  const d = new Date(t);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

/** "3 weeks", "4 days", "5 hours". */
function lateness(ms: number): string {
  if (ms >= 14 * DAY) return `${Math.round(ms / (7 * DAY))} weeks`;
  if (ms >= 2 * DAY) return `${Math.round(ms / DAY)} days`;
  const h = Math.max(1, Math.round(ms / HOUR));
  return `${h} ${h === 1 ? 'hour' : 'hours'}`;
}

interface Written {
  seq: number;
  at: number;
  status: SignatureStatus;
  device: string | null;
  type: string;
}

/** Every interval, event and attendance record of each match, with the entry it was written in. */
function writtenRecords(ledger: Ledger): Map<string, Written[]> {
  const statuses = statusesOf(ledger.entries);
  const out = new Map<string, Written[]>();
  ledger.entries.forEach((e, i) => {
    for (const r of e.records) {
      if (r.type !== 'interval' && r.type !== 'event' && r.type !== 'attendance') continue;
      const id = String(r.matchId);
      const list = out.get(id) ?? [];
      list.push({
        seq: e.seq,
        at: Date.parse(e.at),
        status: statuses[i],
        device: typeof e.device === 'string' ? e.device : null,
        type: r.type,
      });
      out.set(id, list);
    }
  });
  return out;
}

/** The `origin` a coach recorded for a match (ADR-021 D2), if any. Not set by this build (#199 ruling). */
function originOf(ledger: Ledger, matchId: UUID): string | null {
  let how: string | null = null;
  for (const e of ledger.entries) {
    for (const r of e.records) if (r.type === 'origin' && r.matchId === matchId && typeof r.how === 'string') how = r.how;
  }
  return how;
}

function judge(ledger: Ledger, m: LedgerMatch, written: Written[]): ProvenanceInfo {
  const reasons: string[] = [];
  if (originOf(ledger, m.id) === 'reconstructed') reasons.push('marked as reconstructed');
  if (m.intervals.some((i) => i.corrected)) reasons.push('a playing time was corrected');
  if (written.length === 0) reasons.push('no playing time in the record');

  const firstAttendance = written.find((w) => w.type === 'attendance');
  const kickoff = m.kickoffAt ? Date.parse(m.kickoffAt) : (firstAttendance?.at ?? NaN);
  if (!Number.isFinite(kickoff)) {
    if (written.length > 0) reasons.push('no kick-off time to check it against');
  } else {
    const from = kickoff - WINDOW_BEFORE_MS;
    const to = kickoff + m.totalMinutes * 60_000 + WINDOW_AFTER_MS;
    const late = written.filter((w) => w.at > to);
    const early = written.filter((w) => w.at < from);
    if (late.length > 0) {
      const last = Math.max(...late.map((w) => w.at));
      reasons.push(`written ${dayOf(last)}, ${lateness(last - kickoff)} after kick-off`);
    }
    if (early.length > 0) reasons.push('written before its kick-off time');
  }

  // Added after the match ended: after the entry holding its last interval.
  const lastInterval = Math.max(-1, ...written.filter((w) => w.type === 'interval').map((w) => w.seq));
  if (m.status === 'completed' && lastInterval >= 0 && written.some((w) => w.type !== 'interval' && w.seq > lastInterval)) {
    reasons.push('an event or attendance was added after the match');
  }

  const signed = written.filter((w) => w.status !== 'unsigned');
  const first = [...written].sort((a, b) => a.seq - b.seq)[0];
  if (signed.some((w) => w.status !== 'valid')) reasons.push('a signature does not check');
  else if (first && first.status === 'valid' && signed.some((w) => w.device !== first.device)) {
    reasons.push('written by more than one phone');
  } else if (first && first.status === 'valid' && signed.length !== written.length) {
    reasons.push('partly unsigned');
  }

  if (reasons.length > 0) {
    const text = reasons.join('; ');
    return { state: 'reconstructed', why: `${text[0].toUpperCase()}${text.slice(1)}. Its times may be approximate.` };
  }
  if (signed.length === written.length) {
    return { state: 'pristine', why: 'Recorded live on the clock and signed by the phone that played it. Nothing changed afterwards.' };
  }
  return {
    state: 'live-unsigned',
    why: 'Recorded live on the clock, before the app signed what it records. Nothing changed afterwards.',
  };
}

const cache = new WeakMap<LedgerEntry, Map<UUID, ProvenanceInfo>>();

/** Every match's provenance, folded from the chain; remembered per chain head. */
export function provenances(ledger: Ledger | null): Map<UUID, ProvenanceInfo> {
  if (!ledger || ledger.entries.length === 0) return new Map();
  const head = ledger.entries[ledger.entries.length - 1];
  const hit = cache.get(head);
  if (hit && ledger.matches.every((m) => hit.has(m.id))) return hit;
  const written = writtenRecords(ledger);
  const out = new Map(ledger.matches.map((m) => [m.id, judge(ledger, m, written.get(m.id) ?? [])]));
  cache.set(head, out);
  return out;
}

export function provenanceOf(ledger: Ledger | null, matchId: UUID): ProvenanceInfo | null {
  return provenances(ledger).get(matchId) ?? null;
}

/**
 * The view toggle "Include reconstructed matches" (#199 AC4): off leaves
 * them out of every figure, recomputed, with nothing written. The record is
 * untouched; this is a view of it.
 */
export function withoutReconstructed(ledger: Ledger): Ledger {
  const p = provenances(ledger);
  const keep = ledger.matches.filter((m) => p.get(m.id)?.state !== 'reconstructed');
  return keep.length === ledger.matches.length ? ledger : { ...ledger, matches: keep };
}

/** The tag on a card: "◐ reconstructed", "◐ live, unsigned", or none for pristine (#199 AC2). */
export function provenanceTag(state: Provenance | undefined): string | null {
  if (state === 'reconstructed') return '◐ reconstructed';
  if (state === 'live-unsigned') return '◐ live, unsigned';
  return null;
}
