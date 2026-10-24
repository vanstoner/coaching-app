/**
 * #228, PO ruling `both` (Rob, 23 Oct): the award card on the clock at full
 * time, beside End match's prompt. The screen is a source check; the rule it
 * draws from is tested. Made-up first names only.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid, type Player } from '../types/index';
import { DEFAULT_AWARD_TYPES, emptyLedger, giveAward, recordMatches, updateAwardType, type Ledger } from './ledger';
import { endMatch } from './matchClosing';
import { awardCardAtFullTime, awardPromptDue } from './matchAwards';
import { makeFormat } from './shapes';
import { makePlayer } from './squad';
import { sheetFromSelection, toTeamSheet } from './teamSheet';
import { newTestMark, recordable } from './testMatches';

const MIN = 60_000;
const root = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8');
const squadId = uuid();
const players: Player[] = ['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gil'].map((n) => makePlayer(squadId, n));
const ids = players.map((p) => p.id);
const [POTW, ASSIST] = DEFAULT_AWARD_TYPES.map((t) => t.id);
const ok = (r: { ok: true; ledger: Ledger } | { ok: false; reason: string }): Ledger => {
  if (!r.ok) throw new Error(r.reason);
  return r.ledger;
};

function play(test = false) {
  let nowMs = Date.parse('2026-10-24T09:00:00Z');
  const engine = new MatchEngine({ nowFn: () => new Date(nowMs) });
  const format = makeFormat('2-3-1');
  const state = engine.createMatch(squadId, format.id, { totalMinutes: 20, quarterCount: 2 });
  if (test) state.match.test = newTestMark(nowMs);
  const sheet = toTeamSheet(sheetFromSelection(ids, ids[0], format));
  const save = () => recordMatches(emptyLedger(squadId, 'Test FC', new Date(nowMs)), recordable([state]), players, 'Test FC', new Date(nowMs));
  engine.startQuarter(state, state.quarters[0], sheet, format);
  const cardInQ1 = awardCardAtFullTime(save(), state);
  nowMs += 10 * MIN;
  engine.endQuarter(state, state.quarters[0]);
  const cardAtBreak = awardCardAtFullTime(save(), state);
  engine.startQuarter(state, state.quarters[1], sheet, format);
  nowMs += 10 * MIN;
  engine.endQuarter(state, state.quarters[1]);
  return { engine, state, cardInQ1, cardAtBreak, fullTime: save(), now: new Date(nowMs) };
}

describe('the award card on the clock at full time (ruling `both`)', () => {
  it('shows at full time only: not in Q1, not at a break, not once closed', () => {
    const m = play();
    expect(m.cardInQ1).toBe(false);
    expect(m.cardAtBreak).toBe(false);
    expect(awardCardAtFullTime(m.fullTime, m.state)).toBe(true);
    endMatch(m.engine, m.state);
    expect(awardCardAtFullTime(m.fullTime, m.state)).toBe(false);
  });

  it('shows even when every award has a winner (it shows them); End match then closes without asking', () => {
    const m = play();
    let l = ok(giveAward(m.fullTime, m.state.match.id, POTW, ids[1], '', m.now));
    l = ok(giveAward(l, m.state.match.id, ASSIST, ids[2], '', m.now));
    expect(awardCardAtFullTime(l, m.state)).toBe(true);
    expect(awardPromptDue(l, m.state)).toBe(false);
  });

  it('the same rules: no card without a writable record or an active award type', () => {
    const m = play();
    expect(awardCardAtFullTime(null, m.state)).toBe(false);
    let l = ok(updateAwardType(m.fullTime, POTW, { active: false }, m.now));
    l = ok(updateAwardType(l, ASSIST, { active: false }, m.now));
    expect(awardCardAtFullTime(l, m.state)).toBe(false);
  });

  it('never in a test match', () => {
    const m = play(true);
    expect(awardCardAtFullTime(m.fullTime, m.state)).toBe(false);
  });

  it('the clock draws the same AwardCard from that rule, under the strip (source check)', () => {
    const clock = read('src', 'screens', 'ClockScreen.tsx');
    expect(clock).toMatch(/\{awards\?\.atFullTime && !fullTimeAwardsHidden && \(\s*<AwardCard/);
    expect(clock.indexOf('awards?.atFullTime')).toBeGreaterThan(clock.indexOf('<View style={local.strip}'));
    expect(read('App.tsx')).toMatch(/atFullTime: awardCardAtFullTime\(l, match\.state\),/);
  });
});

