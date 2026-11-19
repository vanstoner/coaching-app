/**
 * The Lineup's draft for the coming period — #293 criterion 5 (Bea, approved
 * by Rob 19 Nov: "approve criteria 293 (a)").
 *
 * What the coach sets on the Lineup (positions, sub times, who comes off) is
 * screen state until Start. Before this, leaving the Lineup (Home, Plan the
 * rest of the match, Android ending the app) threw it away and the screen
 * came back from the team sheet. Now it is kept on the stored match, keyed
 * by the period it is for, and the Lineup starts from it on return.
 *
 * Intent, never a record, like the period's subs (#139) and the plan (#72
 * AC8): no minute, event or record is written from it, so invariant 1 is
 * untouched. It is dropped when that period starts (it becomes the period's
 * reminders) or when the plan is edited (criterion 4: the plan wins), and a
 * draft for any other period is never shown.
 *
 * Kept on this phone under its own key (`LINEUP_DRAFT_KEY`), one draft at a
 * time, naming its match: a live match is not always in the stored fixture
 * list (Play now, a test match), and an older build simply never reads it.
 */

import type { Format, UUID } from '../types/index';
import type { Sheet } from './teamSheet';
import type { PlannedSub, SavedSub } from './subPlan';

export interface LineupDraft {
  /** The period this draft is for. It is only ever restored into that period. */
  quarterId: UUID;
  /** Position id → child, or null for an empty place. */
  sheet: Sheet;
  subs: SavedSub[];
}

/** What to keep of the Lineup as it stands: the intention, without `done`. */
export function draftToSave(quarterId: UUID, sheet: Sheet, plan: PlannedSub[]): LineupDraft {
  return {
    quarterId,
    sheet: { ...sheet },
    subs: plan.map(({ playerId, atMs, forPlayerId }) => ({ playerId, atMs, forPlayerId })),
  };
}

/** True when two drafts hold the same intention, so an unchanged Lineup writes nothing. */
export function sameDraft(a: LineupDraft | null | undefined, b: LineupDraft | null | undefined): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The Lineup's starting point from a kept draft, or null to start as before
 * (the plan, else the suggestion). Null when there is no draft, it is for
 * another period, or it names a position this match's shape does not have.
 * A child who can no longer be picked (marked absent since) is left out:
 * their place is empty and their sub is dropped, never invented.
 */
export function restoreLineupDraft(
  draft: LineupDraft | null | undefined,
  quarterId: UUID | undefined,
  format: Pick<Format, 'positions'>,
  pickable: readonly UUID[]
): { sheet: Sheet; subs: PlannedSub[] } | null {
  if (!draft || !quarterId || draft.quarterId !== quarterId) return null;
  const positions = new Set(format.positions.map((p) => p.id));
  if (Object.keys(draft.sheet).some((id) => !positions.has(id as UUID))) return null;
  const known = new Set(pickable);
  const sheet: Sheet = {};
  const placed = new Set<UUID>();
  for (const p of format.positions) {
    const who = draft.sheet[p.id] ?? null;
    if (who !== null && known.has(who) && !placed.has(who)) {
      sheet[p.id] = who;
      placed.add(who);
    } else {
      sheet[p.id] = null;
    }
  }
  const subs: PlannedSub[] = draft.subs
    .filter((s) => known.has(s.playerId) && !placed.has(s.playerId))
    .map((s) => ({
      playerId: s.playerId,
      atMs: s.atMs,
      forPlayerId: s.forPlayerId !== null && placed.has(s.forPlayerId) ? s.forPlayerId : null,
      done: false,
    }));
  return { sheet, subs };
}

/** A stored draft is read only when well formed; anything else is as if none was kept. */
export function isLineupDraftShaped(value: unknown): value is LineupDraft {
  if (typeof value !== 'object' || value === null) return false;
  const { quarterId, sheet, subs } = value as Record<string, unknown>;
  if (typeof quarterId !== 'string' || typeof sheet !== 'object' || sheet === null || !Array.isArray(subs)) return false;
  if (!Object.values(sheet as Record<string, unknown>).every((v) => v === null || typeof v === 'string')) return false;
  return subs.every((s: unknown) => {
    if (typeof s !== 'object' || s === null) return false;
    const { playerId, atMs, forPlayerId } = s as Record<string, unknown>;
    return typeof playerId === 'string' && Number.isFinite(atMs) && (forPlayerId === null || typeof forPlayerId === 'string');
  });
}

/** This phone's one kept draft (#293). */
export const LINEUP_DRAFT_KEY = 'coaching-app/lineup-draft/v1';

export interface KeptLineupDraft {
  matchId: UUID;
  draft: LineupDraft;
}

/** The stored value, or null when absent or malformed (as if nothing was kept). */
export function parseKeptLineupDraft(raw: string | null | undefined): KeptLineupDraft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    return typeof v?.matchId === 'string' && isLineupDraftShaped(v.draft)
      ? { matchId: v.matchId as UUID, draft: v.draft }
      : null;
  } catch {
    return null;
  }
}
