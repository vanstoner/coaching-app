/**
 * #283: the team talk's due moment, the late Start's question, and a start
 * "from when it was due" in the engine. Made-up names only.
 */

import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import { makePlayer } from './squad';
import { makeFormat } from './shapes';
import { asksFromDue, parseTalkLengths, stepTalk, TALK_DEFAULT, teamTalkOf } from './teamTalk';

const squadId = uuid();
const players = ['Ava', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal', 'Ivy'].map((n) => makePlayer(squadId, n));
const format = makeFormat('2-3-1');

function lineup() {
  const sheet = new Map<ReturnType<typeof uuid>, ReturnType<typeof uuid>>();
  format.positions.forEach((p, i) => sheet.set(p.id, players[i].id));
  return sheet;
}

/** A match whose Q1 ended at 10:20:00, on a clock the test moves. */
function afterQ1(quarterCount = 4) {
  let now = new Date('2026-11-08T10:07:30Z');
  const engine = new MatchEngine({ nowFn: () => now });
  const state = engine.createMatch(squadId, format.id, {
    totalMinutes: 50,
    quarterCount,
    availablePlayerIds: players.map((p) => p.id),
  });
  engine.startQuarter(state, state.quarters[0], lineup(), format);
  now = new Date('2026-11-08T10:20:00Z');
  engine.endQuarter(state, state.quarters[0]);
  return { engine, state, at: (iso: string) => (now = new Date(iso)) };
}

describe('the team talk (#283)', () => {
  it('Q2 is due 3:00 after Q1 ended, from the anchor (C1, C2)', () => {
    const { state } = afterQ1();
    const talk = teamTalkOf(state.quarters, 4, TALK_DEFAULT)!;
    expect(talk.nextIndex).toBe(2);
    expect(talk.halfTime).toBe(false);
    expect(new Date(talk.dueAtMs).toISOString()).toBe('2026-11-08T10:23:00.000Z');
  });

  it('half-time uses its own length; halves have only half-time; none before kick-off or while running (C10)', () => {
    const { engine, state, at } = afterQ1();
    at('2026-11-08T10:23:00Z');
    engine.startQuarter(state, state.quarters[1], lineup(), format);
    expect(teamTalkOf(state.quarters, 4, TALK_DEFAULT)).toBeNull();
    at('2026-11-08T10:35:30Z');
    engine.endQuarter(state, state.quarters[1]);
    const half = teamTalkOf(state.quarters, 4, TALK_DEFAULT)!;
    expect(half).toMatchObject({ nextIndex: 3, halfTime: true, lengthMs: 5 * 60_000 });
    const halves = afterQ1(2);
    expect(teamTalkOf(halves.state.quarters, 2, TALK_DEFAULT)).toMatchObject({ nextIndex: 2, halfTime: true });
    const fresh = new MatchEngine().createMatch(squadId, format.id, { totalMinutes: 50, quarterCount: 4, availablePlayerIds: [] });
    expect(teamTalkOf(fresh.quarters, 4, TALK_DEFAULT)).toBeNull();
  });

  it('the late Start asks only between 1 s and one period after the due moment (C4, C7)', () => {
    const due = Date.parse('2026-11-08T10:23:00Z');
    const period = 12.5 * 60_000;
    expect(asksFromDue(due - 5000, due, period)).toBe(false);
    expect(asksFromDue(due + 999, due, period)).toBe(false);
    expect(asksFromDue(due + 101_000, due, period)).toBe(true);
    expect(asksFromDue(due + period, due, period)).toBe(false);
  });

  it('Yes starts Q2 from 10:23: the clock shows the gap run, the lineup is credited from then (C5)', () => {
    const { engine, state, at } = afterQ1();
    at('2026-11-08T10:24:41Z');
    engine.startQuarter(state, state.quarters[1], lineup(), format, new Date('2026-11-08T10:23:00Z'));
    expect(state.quarters[1].startedAt).toBe('2026-11-08T10:23:00.000Z');
    expect(engine.getQuarterElapsedMs(state.quarters[1])).toBe(101_000);
    const q2 = state.appearances.filter((a) => a.quarterId === state.quarters[1].id);
    expect(q2).toHaveLength(format.onFieldCount);
    expect(q2.every((a) => a.startElapsedMs === 12.5 * 60_000)).toBe(true);
  });

  it('the engine refuses a start before the last period ended, or in the future, writing nothing (C8)', () => {
    const { engine, state, at } = afterQ1();
    at('2026-11-08T10:24:00Z');
    const before = state.appearances.length;
    expect(() => engine.startQuarter(state, state.quarters[1], lineup(), format, new Date('2026-11-08T10:19:00Z'))).toThrow(/before quarter 1 ended/);
    expect(() => engine.startQuarter(state, state.quarters[1], lineup(), format, new Date('2026-11-08T10:25:00Z'))).toThrow(/future/);
    expect(state.quarters[1].status).toBe('pending');
    expect(state.appearances).toHaveLength(before);
  });

  it('a test match counts on its own clock (C14)', () => {
    const { engine } = afterQ1();
    expect(engine.clockNow().toISOString()).toBe('2026-11-08T10:20:00.000Z');
  });

  it('the lengths: 1:00 to 15:00 in 30 s steps, unreadable means the defaults (C12)', () => {
    expect(parseTalkLengths(null)).toEqual(TALK_DEFAULT);
    expect(parseTalkLengths('junk')).toEqual(TALK_DEFAULT);
    expect(parseTalkLengths(JSON.stringify({ betweenMs: 10, halfMs: 99 * 60_000 }))).toEqual({ betweenMs: 60_000, halfMs: 15 * 60_000 });
    expect(stepTalk(180_000, 1)).toBe(210_000);
    expect(stepTalk(60_000, -1)).toBe(60_000);
    expect(stepTalk(15 * 60_000, 1)).toBe(15 * 60_000);
  });

  it('the Lineup counts down, turns Start urgent when due, and asks before a late start (C1, C4–C6, C12)', async () => {
    const { readFileSync } = await import('node:fs');
    const lineup = readFileSync(new URL('../screens/LineupScreen.tsx', import.meta.url), 'utf8');
    expect(lineup).toMatch(/teamTalkOf\(state\.quarters, state\.match\.quarterCount, talk\.lengths\)/);
    expect(lineup).toMatch(/label=\{talkDue \? `\$\{talkLabel\} is due: Start`/);
    expect(lineup).toMatch(/asksFromDue\(engine\.clockNow\(\)\.getTime\(\), breakTalk\.dueAtMs, periodMs\)/);
    expect(lineup).toMatch(/onStart\(sheet, plan, new Date\(breakTalk\.dueAtMs\)\)/);
    const settings = readFileSync(new URL('../screens/SettingsScreen.tsx', import.meta.url), 'utf8');
    expect(settings).toContain("['betweenMs', 'Between quarters']");
    expect(settings).toContain("['halfMs', 'At half-time']");
  });
});

