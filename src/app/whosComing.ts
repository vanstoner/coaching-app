/**
 * Who's coming — #277 A, ADR-024 D1.
 *
 * Pure TypeScript. Who's coming is the match's own per-child `availability`
 * (the same map Here today edits), read before kick-off as three states:
 *
 * - **Coming** = `available`. A new fixture starts with everyone Coming (Rob,
 *   5 Nov: "assume all available"), as before.
 * - **Can't** = `unavailable` (also `absent` and `injured`, which Here today
 *   or a correction may have set: none of them is coming).
 * - **Not heard** = `unconfirmed`, the new status. It lives in the session
 *   only: `ledger.ts` writes it to the record as `absent`, because a child
 *   still unconfirmed at kick-off was unticked on Here today.
 *
 * The weekly changes are planning, never the record (invariant 1).
 */

import type { AvailabilityStatus, Player, UUID } from '../types/index';
import { isActive } from './squad';

export type Coming = 'coming' | 'cant' | 'notHeard';

export function comingOf(status: AvailabilityStatus | undefined): Coming {
  if (status === undefined || status === 'available') return 'coming';
  if (status === 'unconfirmed') return 'notHeard';
  return 'cant';
}

/** The status stored for each state. */
export function statusOf(coming: Coming): AvailabilityStatus {
  return coming === 'coming' ? 'available' : coming === 'cant' ? 'unavailable' : 'unconfirmed';
}

/** A tap moves a child Coming → Can't → Not heard → Coming (A2). */
export function nextComing(coming: Coming): Coming {
  return coming === 'coming' ? 'cant' : coming === 'cant' ? 'notHeard' : 'coming';
}

export interface ComingRow {
  player: Player;
  coming: Coming;
}

/**
 * The active squad, in squad order, each with their state. A child with no
 * entry (added to the squad after the fixture, or a fixture saved before
 * availability was kept) is Coming, as `availabilityForOpening` treats them.
 */
export function comingRows(
  availability: readonly [UUID, AvailabilityStatus][] | undefined,
  players: readonly Player[]
): ComingRow[] {
  const map = new Map(availability ?? []);
  return players.filter(isActive).map((player) => ({ player, coming: comingOf(map.get(player.id)) }));
}

/** "9 coming · 2 can't · 1 not heard": a part with none is left out, except coming. */
export function comingSummary(rows: readonly ComingRow[]): string {
  const count = (c: Coming) => rows.filter((r) => r.coming === c).length;
  const parts = [`${count('coming')} coming`];
  if (count('cant') > 0) parts.push(`${count('cant')} can't`);
  if (count('notHeard') > 0) parts.push(`${count('notHeard')} not heard`);
  return parts.join(' · ');
}

/**
 * The availability with one child set to a state. Every other entry is kept
 * as it is, and the active squad is filled in as Coming first, so the stored
 * list is complete once the coach has touched it.
 */
export function setComing(
  availability: readonly [UUID, AvailabilityStatus][] | undefined,
  players: readonly Player[],
  playerId: UUID,
  coming: Coming
): [UUID, AvailabilityStatus][] {
  const map = new Map(availability ?? []);
  for (const p of players) if (isActive(p) && !map.has(p.id)) map.set(p.id, 'available');
  map.set(playerId, statusOf(coming));
  return [...map.entries()];
}

/** "changed Thu 20:14" (A4), in the phone's local time. */
export function changedLabel(at: number): string {
  const d = new Date(at);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short' });
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `changed ${day} ${hh}:${mm}`;
}
