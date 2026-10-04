/**
 * The outfield-share target — #101 AC2, ADR-015 §3.
 *
 * Pure TypeScript.
 *
 * > *"Right now we have a dedicated keeper who still wants in general outfield
 * > play e.g 25%"* — PO, 2026-10-04 (#98 ruling 3)
 *
 * A coach setting on the player: a whole percentage of their pitch time they
 * would like spent outfield. The figure shown against it is outfield ÷ pitch
 * time over the season's counted (completed) matches. It reads "on track" at
 * or above the target, "below" under it, and nothing before any pitch time.
 *
 * **Never a fairness input** (invariant 3). Nothing in lineup, plan, clock or
 * summary reads it. It is never per position: outfield is one bucket.
 */

import type { Player, UUID } from '../types/index';
import { foldLedger, type Ledger } from './ledger';

export type TargetStatus = 'on-track' | 'below';

export interface OutfieldShare {
  /** Outfield ÷ pitch time as a whole percentage, or null with no pitch time. */
  sharePct: number | null;
  /** The player's target, or null when they have none. */
  targetPct: number | null;
  /** Null when there is no target or no pitch time yet. */
  status: TargetStatus | null;
}

/** The choices the squad screen offers. Tapping the chosen one clears it. */
export const OUTFIELD_TARGET_CHOICES = [25, 50, 75] as const;

/** A stored target, or null if it is absent or not a whole 1–100. */
export function targetOf(player: Pick<Player, 'outfieldTargetPct'> | undefined): number | null {
  const t = player?.outfieldTargetPct;
  return typeof t === 'number' && Number.isInteger(t) && t >= 1 && t <= 100 ? t : null;
}

/** Set, or with null clear, a player's outfield-share target. */
export function setOutfieldTarget(
  players: Player[],
  playerId: UUID,
  outfieldTargetPct: number | null
): Player[] {
  const value =
    outfieldTargetPct !== null &&
    Number.isInteger(outfieldTargetPct) &&
    outfieldTargetPct >= 1 &&
    outfieldTargetPct <= 100
      ? outfieldTargetPct
      : null;
  return players.map((p) => (p.id === playerId ? { ...p, outfieldTargetPct: value } : p));
}

/** How a player's outfield share reads against their target. */
export function outfieldShare(
  outfieldMs: number,
  goalkeeperMs: number,
  targetPct: number | null
): OutfieldShare {
  const pitchMs = outfieldMs + goalkeeperMs;
  if (pitchMs <= 0) return { sharePct: null, targetPct, status: null };
  const exact = (outfieldMs / pitchMs) * 100;
  const sharePct = Math.round(exact);
  // Compared on the exact share, so 24.6% is below a 25% target even though
  // it rounds to 25 on screen.
  const status = targetPct === null ? null : exact >= targetPct ? 'on-track' : 'below';
  return { sharePct, targetPct, status };
}

/**
 * Each player's outfield share over the season's COUNTED matches: those with
 * status `completed` (ADR-015 §6). Computed from the ledger on every call,
 * never stored (invariant 1).
 */
export function seasonOutfieldShares(
  ledger: Ledger,
  players: Pick<Player, 'id' | 'outfieldTargetPct'>[]
): Map<UUID, OutfieldShare> {
  const counted = { ...ledger, matches: ledger.matches.filter((m) => m.status === 'completed') };
  const totals = new Map(foldLedger(counted).map((t) => [t.playerId, t]));
  const targets = new Map(players.map((p) => [p.id, targetOf(p)]));
  const out = new Map<UUID, OutfieldShare>();
  for (const id of new Set([...totals.keys(), ...targets.keys()])) {
    const t = totals.get(id);
    out.set(id, outfieldShare(t?.outfieldMs ?? 0, t?.goalkeeperMs ?? 0, targets.get(id) ?? null));
  }
  return out;
}

/** "Outfield 22% · target 25% · below", or '' with no target. */
export function shareLabel(share: OutfieldShare | undefined): string {
  if (!share || share.targetPct === null) return '';
  const target = `target ${share.targetPct}%`;
  if (share.sharePct === null) return `Outfield ${target}`;
  const status = share.status === 'on-track' ? 'on track' : 'below';
  return `Outfield ${share.sharePct}% · ${target} · ${status}`;
}
