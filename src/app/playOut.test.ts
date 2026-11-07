/**
 * Play out a match as planned — #280. Made-up names only (invariant 4).
 */

import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { UUID } from '../types/index';
import { makePlayer } from './squad';
import { makeFormat } from './shapes';
import { periodLengthMs, projectPlan } from './matchPlan';
import { buildTeamSheet, rotateKeepers } from './teamSheetBuilder';
import { emptyLedger } from './ledger';
import { provenances } from './provenance';
import { squadViews } from './squadViews';
import type { SavedMatch } from './persistence';
import { playOutAsPlanned, playOutRefusal, recordPlayedOut } from './playOut';

const squadId = uuid();
const players = ['Ava', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal', 'Ivy', 'Jo'].map((n) => makePlayer(squadId, n));
const format = makeFormat('2-3-1');
const kickoff = new Date('2026-11-07T10:00:00Z');

function fixture(coming: UUID[]) {
  const engine = new MatchEngine({ nowFn: () => kickoff });
  const state = engine.createMatch(squadId, format.id, { totalMinutes: 50, quarterCount: 4, availablePlayerIds: players.map((p) => p.id) });
  state.match.kickoffAt = kickoff.toISOString();
  for (const p of players) if (!coming.includes(p.id)) state.playerAvailability.set(p.id, 'unconfirmed');
  const stored: SavedMatch = {
    match: state.match,
    quarters: state.quarters,
    appearances: [],
    benchStints: [],
    availability: [...state.playerAvailability.entries()],
    format,
  };
  const here = players.filter((p) => coming.includes(p.id));
  const plan = buildTeamSheet({
    format,
    totalMinutes: 50,
    periodCount: 4,
    coming: here,
    keepers: rotateKeepers(here, 4, periodLengthMs(50, 4), new Map()),
    subs: 1,
    fill: 'fair',
    season: new Map(),
  }).plan;
  return { stored, plan, here };
}

describe('Play out as planned (#280)', () => {
  it('writes the plan to the record as it would be played: the same minutes, the match closed', () => {
    const { stored, plan, here } = fixture(players.slice(0, 9).map((p) => p.id));
    expect(playOutRefusal(stored, plan, format, players)).toBeNull();
    const out = playOutAsPlanned({ stored, format, plan, players, start: kickoff });
    expect(out.played.match.status).toBe('completed');
    expect(out.played.quarters.every((q) => q.status === 'ended')).toBe(true);
    const ledger = recordPlayedOut(emptyLedger(squadId, 'Test FC', kickoff), out, format, players, 'Test FC', kickoff);
    const recorded = squadViews(ledger, players).matches[0].minutes;
    for (const row of projectPlan(plan, format, 50, 4, here).rows) expect(recorded.get(row.playerId)?.pitchMs).toBe(row.pitchMs);
  });

  it('Who’s coming is the attendance: Not heard is recorded absent, never "unconfirmed"', () => {
    const { stored, plan } = fixture(players.slice(0, 9).map((p) => p.id));
    const out = playOutAsPlanned({ stored, format, plan, players, start: kickoff });
    const ledger = recordPlayedOut(emptyLedger(squadId, 'Test FC', kickoff), out, format, players, 'Test FC', kickoff);
    const jo = ledger.matches[0].attendance!.find((a) => a.playerId === players[9].id)!;
    expect(jo.status).toBe('absent');
  });

  it('is marked reconstructed, with a note, and no goal is written', () => {
    const { stored, plan } = fixture(players.slice(0, 9).map((p) => p.id));
    const out = playOutAsPlanned({ stored, format, plan, players, start: kickoff });
    expect(out.played.events).toEqual([]);
    const ledger = recordPlayedOut(emptyLedger(squadId, 'Test FC', kickoff), out, format, players, 'Test FC', kickoff);
    expect(provenances(ledger).get(out.played.match.id)?.state).toBe('reconstructed');
    const origin = ledger.entries.flatMap((e) => e.records).find((r) => r.type === 'origin');
    expect(origin).toMatchObject({ how: 'reconstructed', source: 'plan' });
  });

  it('refuses a plan with an empty place, or someone not marked Coming', () => {
    const { stored, plan } = fixture(players.slice(0, 9).map((p) => p.id));
    const gap = { periods: plan.periods.map((p, i) => (i === 1 ? { ...p, slots: { ...p.slots, [format.positions[1].id]: null } } : p)) };
    expect(playOutRefusal(stored, gap, format, players)).toMatch(/empty place in period 2/);
    const onList = Object.values(plan.periods[0].slots)[1]!;
    const away = { ...stored, availability: stored.availability.map(([id, s]) => [id, id === onList ? 'unavailable' : s] as [UUID, typeof s]) };
    expect(playOutRefusal(away, plan, format, players)).toMatch(/not marked Coming/);
  });

  it('refuses a match that has kicked off', () => {
    const { stored, plan } = fixture(players.slice(0, 9).map((p) => p.id));
    const started = { ...stored, quarters: stored.quarters.map((q, i) => (i === 0 ? { ...q, status: 'ended' as const } : q)) };
    expect(playOutRefusal(started, plan, format, players)).toMatch(/already kicked off/);
  });
});
