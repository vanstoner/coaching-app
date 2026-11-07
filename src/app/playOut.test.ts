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
import { addUnknownTimeEvent, emptyLedger, giveAward } from './ledger';
import type { Ledger } from './ledger';
import { recordMatchPage } from './recordOnly';
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

  it('takes the score and the awards afterwards, on its page in the record (Rob, 7 Nov)', () => {
    const { stored, plan } = fixture(players.slice(0, 9).map((p) => p.id));
    const out = playOutAsPlanned({ stored, format, plan, players, start: kickoff });
    let ledger: Ledger = recordPlayedOut(emptyLedger(squadId, 'Test FC', kickoff), out, format, players, 'Test FC', kickoff);
    const id = out.played.match.id;
    const step = (r: { ok: true; ledger: Ledger } | { ok: false; reason: string }) => {
      if (!r.ok) throw new Error(r.reason);
      ledger = r.ledger;
    };
    for (const scorer of [players[0], players[1], players[2]]) step(addUnknownTimeEvent(ledger, id, 'goal', scorer.id, 'Match report', kickoff));
    for (let i = 0; i < 4; i++) step(addUnknownTimeEvent(ledger, id, 'conceded', null, 'Match report', kickoff));
    expect(ledger.awardTypes.length).toBeGreaterThan(0);
    step(giveAward(ledger, id, ledger.awardTypes[0].id, players[3].id, 'Match report', kickoff));
    const page = recordMatchPage(ledger, id)!;
    expect(page.goals).toHaveLength(3);
    expect(page.conceded).toBe(4);
    expect(page.result).toBe('L');
    expect(page.awards.map((a) => a.playerId)).toEqual([players[3].id]);
    expect(provenances(ledger).get(id)?.state).toBe('reconstructed');
  });

  it('refuses a sub left out of date by a move by hand, rather than stopping part way (QA on #279, D1)', () => {
    const { stored, plan } = fixture(players.map((p) => p.id));
    const p0 = plan.periods[0];
    const sub = p0.subs[0];
    // The child coming on is put in a position by hand, over someone who was not coming off.
    const [pos] = (Object.entries(p0.slots) as [UUID, UUID][]).find(([, id]) => id !== sub.offId)!;
    const stale = { periods: plan.periods.map((p, i) => (i === 0 ? { ...p, slots: { ...p.slots, [pos]: sub.onId } } : p)) };
    expect(playOutRefusal(stored, stale, format, players)).toMatch(/A sub in period 1 no longer fits/);
    expect(() => playOutAsPlanned({ stored, format, plan: stale, players, start: kickoff })).toThrow();
  });
});

describe('the Home card says why a match cannot be played out, and nothing is written without a record (QA on #279, D2, D3)', () => {
  it('App offers the reason, refuses a blocked record first, and survives the engine refusing', async () => {
    const { readFileSync } = await import('node:fs');
    const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
    const fn = app.slice(app.indexOf('const playOutFixture'), app.indexOf('const playOutFixture') + 3000);
    expect(fn.indexOf('ledgerBlockedRef.current')).toBeLessThan(fn.indexOf('playOutAsPlanned('));
    expect(fn).toMatch(/try \{\s*out = playOutAsPlanned/);
    const card = readFileSync(new URL('../screens/FixturesScreen.tsx', import.meta.url), 'utf8');
    expect(card).toMatch(/Play out as planned: \$\{playable\.get\(match\.id\)\}/);
  });
});
