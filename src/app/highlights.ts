/**
 * #282 (Rob, 7 Nov: "share some highlights from the match … the timeline is
 * part of that … Nothing to do with the minutes"): the match highlights for
 * parents, and the full match log for coaches ("Log as recommended").
 *
 * Pure TypeScript, worked out from the record each time (invariant 1).
 * Highlights name children only for goals, assists and awards, and give the
 * other taps as team totals, so children are never compared. Neither text
 * carries minutes, time in goal or fair share.
 */

import type { UUID } from '../types/index';
import { awardRows } from './matchAwards';
import { standingEvents } from './matchRecord';
import type { Ledger, LedgerEvent, LedgerMatch } from './ledger';

export interface HighlightsInput {
  ledger: Ledger;
  matchId: UUID;
  teamName: string;
  nameOf: (id: UUID) => string;
  /** "Recorded on another phone", "Reconstructed after the match", or null (C: small text). */
  provenance: string | null;
}

const TALLY_LABEL: Record<string, [string, string]> = {
  shot_on_target: ['shot', 'shots'],
  save: ['save', 'saves'],
  tackle: ['tackle', 'tackles'],
  corner: ['corner', 'corners'],
  free_kick: ['free kick', 'free kicks'],
};

const periodLabel = (count: number, p: number) => (count === 2 ? `H${p}` : count === 4 ? `Q${p}` : `P${p}`);
const mmss = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

function dateLine(m: LedgerMatch): string {
  if (!m.kickoffAt) return '';
  const d = new Date(m.kickoffAt);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Where each period starts in match-elapsed ms, from the record's intervals. */
function periodStarts(m: LedgerMatch): Map<number, number> {
  const starts = new Map<number, number>();
  for (const i of m.intervals) {
    const was = starts.get(i.period);
    if (was === undefined || i.startMs < was) starts.set(i.period, i.startMs);
  }
  return starts;
}

function opponent(m: LedgerMatch): string {
  return (m.opponent ?? '').trim() || 'Opponent';
}

function teamTallies(events: LedgerEvent[], ledger: Ledger): string[] {
  const out: string[] = [];
  for (const [kind, [one, many]] of Object.entries(TALLY_LABEL)) {
    const n = events.filter((e) => e.kind === kind).length;
    if (n > 0) out.push(`${n} ${n === 1 ? one : many}`);
  }
  for (const t of ledger.eventTypes.filter((x) => x.active)) {
    const n = events.filter((e) => e.kind === `tally:${t.id}`).length;
    if (n > 0) out.push(`${n} ${t.label.toLowerCase()}`);
  }
  return out;
}

/** The parents' highlights as one text (Dee's prototype, Rob 7 Nov). Null if the match is not in the record. */
export function highlightsText(input: HighlightsInput): string | null {
  const { ledger, matchId, teamName, nameOf, provenance } = input;
  const m = ledger.matches.find((x) => x.id === matchId);
  if (!m) return null;
  const events = standingEvents(m.events);
  const goals = events.filter((e) => e.kind === 'goal');
  const against = events.filter((e) => e.kind === 'conceded');
  const assistOf = new Map(events.filter((e) => e.kind === 'assist' && e.refersTo).map((e) => [e.refersTo as UUID, e.playerId]));
  const lines: string[] = [`${teamName} ${goals.length}–${against.length} ${opponent(m)}`];
  const when = [dateLine(m), m.structure?.shape ? `${m.structure.onField ?? ''}-a-side` : ''].filter(Boolean).join(' · ');
  if (when) lines.push(when);

  const timed = [...goals, ...against].filter((e) => e.timeKnown !== false);
  const untimed = goals.filter((e) => e.timeKnown === false);
  if (timed.length + untimed.length > 0) {
    lines.push('', 'GOALS');
    const periods = [...new Set(timed.map((e) => e.period))].sort((a, b) => a - b);
    for (const p of periods) {
      const here = timed.filter((e) => e.period === p).sort((a, b) => a.atMs - b.atMs);
      const ours = here.filter((e) => e.kind === 'goal');
      const theirs = here.filter((e) => e.kind === 'conceded');
      const parts = ours.map((g) => {
        const a = g.id ? assistOf.get(g.id) : null;
        return `${g.playerId ? nameOf(g.playerId) : 'Scorer not recorded'}${a ? `, assist ${nameOf(a)}` : ''}`;
      });
      if (theirs.length > 0) parts.push(theirs.length === 1 ? `${opponent(m)} scored` : `${opponent(m)} scored ${theirs.length}`);
      lines.push(`${periodLabel(m.periodCount, p)} (${ours.length}–${theirs.length}): ${parts.join('; ')}`);
    }
    if (untimed.length > 0) lines.push(`Added after the match: ${untimed.map((g) => (g.playerId ? nameOf(g.playerId) : 'Scorer not recorded')).join(', ')}`);
  }

  const awards = awardRows(ledger, matchId, nameOf).filter((r) => r.winners.length > 0);
  if (awards.length > 0) {
    lines.push('', 'AWARDS');
    for (const r of awards) {
      lines.push(`${r.name}: ${r.winners.map((w) => w.name).join(' and ')}${r.winners.length > 1 ? ' (joint)' : ''}`);
    }
  }
  if (events.some((e) => e.kind === 'opp_power_play')) lines.push('', `${opponent(m)} used a power play`);

  const team = teamTallies(events, ledger);
  if (team.length > 0) lines.push('', 'AS A TEAM', team.join(' · '));
  if (provenance) lines.push('', `(${provenance})`);
  return lines.join('\n');
}

/**
 * The full match log for coaches ("Log as recommended", Rob 7 Nov): every
 * standing tap with who, period and time; every sub; their power play; the
 * awards; goals added afterwards in their own group. No minutes totals.
 */
export function matchLogText(input: HighlightsInput): string | null {
  const { ledger, matchId, teamName, nameOf, provenance } = input;
  const m = ledger.matches.find((x) => x.id === matchId);
  if (!m) return null;
  const events = standingEvents(m.events);
  const starts = periodStarts(m);
  const at = (p: number, ms: number) => `${periodLabel(m.periodCount, p)} ${mmss(ms - (starts.get(p) ?? 0))}`;
  const goals = events.filter((e) => e.kind === 'goal').length;
  const against = events.filter((e) => e.kind === 'conceded').length;
  const rows: { p: number; ms: number; text: string }[] = [];
  const assistOf = new Map(events.filter((e) => e.kind === 'assist' && e.refersTo).map((e) => [e.refersTo as UUID, e.playerId]));
  const label = (k: string) => {
    if (k === 'goal') return 'Goal';
    if (k === 'conceded') return `${opponent(m)} goal`;
    if (k === 'opp_power_play') return `${opponent(m)} used a power play`;
    if (TALLY_LABEL[k]) return TALLY_LABEL[k][0][0].toUpperCase() + TALLY_LABEL[k][0].slice(1);
    const t = ledger.eventTypes.find((x) => k === `tally:${x.id}`);
    return t ? t.label : k;
  };
  for (const e of events) {
    if (e.kind === 'assist' || e.timeKnown === false) continue;
    const who = e.playerId ? `: ${nameOf(e.playerId)}` : '';
    const assist = e.kind === 'goal' && assistOf.get(e.id) ? ` (assist ${nameOf(assistOf.get(e.id) as UUID)})` : '';
    rows.push({ p: e.period, ms: e.atMs, text: `${label(e.kind)}${who}${assist}` });
  }
  // Subs: within a period, a child coming on as another goes off at the same moment.
  for (const p of [...starts.keys()]) {
    const start = starts.get(p) as number;
    const inP = m.intervals.filter((i) => i.period === p);
    const ons = inP.filter((i) => i.startMs > start);
    for (const on of ons) {
      const off = inP.find((i) => i.endMs === on.startMs && i.playerId !== on.playerId && !ons.some((o) => o !== on && o.playerId === i.playerId && o.startMs === on.startMs));
      rows.push({ p, ms: on.startMs, text: off ? `Sub: ${nameOf(on.playerId)} on for ${nameOf(off.playerId)}` : `On: ${nameOf(on.playerId)}` });
    }
  }
  rows.sort((a, b) => a.p - b.p || a.ms - b.ms);
  const lines = [`${teamName} ${goals}–${against} ${opponent(m)} · match log (for coaches)`];
  const d = dateLine(m);
  if (d) lines.push(d);
  lines.push('');
  for (const r of rows) lines.push(`${at(r.p, r.ms)}  ${r.text}`);
  const untimed = events.filter((e) => e.timeKnown === false && (e.kind === 'goal' || e.kind === 'conceded'));
  if (untimed.length > 0) {
    lines.push('', 'Added after the match:');
    for (const e of untimed) lines.push(`${label(e.kind)}${e.playerId ? `: ${nameOf(e.playerId)}` : ''}`);
  }
  const awards = awardRows(ledger, matchId, nameOf).filter((r) => r.winners.length > 0);
  if (awards.length > 0) {
    lines.push('', 'Awards:');
    for (const r of awards) lines.push(`${r.name}: ${r.winners.map((w) => w.name).join(' and ')}`);
  }
  if (provenance) lines.push('', `(${provenance})`);
  return lines.join('\n');
}
