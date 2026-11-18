/**
 * #282: the highlights for parents and the full log for coaches, from the
 * record. Made-up names only.
 */

import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { UUID } from '../types/index';
import { makePlayer, displayName } from './squad';
import { makeFormat } from './shapes';
import { emptyLedger, recordMatches } from './ledger';
import { giveAwards } from './matchAwards';
import { highlightsText, matchLogText } from './highlights';

const squadId = uuid();
const players = ['Ava', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal', 'Ivy'].map((n) => makePlayer(squadId, n));
const format = makeFormat('2-3-1');
const nameOf = (id: UUID) => displayName(players.find((p) => p.id === id)!);

function playedLedger() {
  let now = new Date('2026-11-08T10:00:00Z');
  const engine = new MatchEngine({ nowFn: () => now });
  const state = engine.createMatch(squadId, format.id, { totalMinutes: 50, quarterCount: 4, availablePlayerIds: players.map((p) => p.id) });
  state.match.opponent = 'Rovers';
  state.match.kickoffAt = '2026-11-08T10:00:00Z';
  const sheet = new Map<UUID, UUID>();
  format.positions.forEach((p, i) => sheet.set(p.id, players[i].id));
  const q1 = state.quarters[0];
  engine.startQuarter(state, q1, sheet, format);
  const striker = players[format.positions.findIndex((p) => p.kind !== 'goalkeeper')].id;
  const keeper = players[format.positions.findIndex((p) => p.kind === 'goalkeeper')].id;
  const helper = players[format.positions.findIndex((p, i) => p.kind !== 'goalkeeper' && players[i].id !== striker)].id;
  now = new Date('2026-11-08T10:03:15Z');
  const goal = engine.recordEvent(state, q1, 'goal', striker);
  engine.recordAssist(state, goal.id, helper);
  engine.recordEvent(state, q1, 'tackle', helper);
  now = new Date('2026-11-08T10:06:15Z');
  engine.substitute(state, q1, helper, players[7].id);
  engine.recordEvent(state, q1, 'conceded', keeper);
  engine.recordTheirPowerPlay(state, q1);
  now = new Date('2026-11-08T10:12:30Z');
  engine.endQuarter(state, q1);
  let ledger = recordMatches(emptyLedger(squadId, 'Test FC', now), [{ ...state, format }], players, 'Test FC', now);
  const r = giveAwards(ledger, state.match.id, [{ typeId: ledger.awardTypes[0].id, playerIds: [striker, keeper], note: "" }], now);
  if (r.ok) ledger = r.ledger;
  return { ledger, id: state.match.id, striker, helper, keeper };
}

describe('match highlights (#282)', () => {
  it('score, goals by period with the assist, awards, their power play and team totals; never minutes', () => {
    const { ledger, id, striker, helper } = playedLedger();
    const text = highlightsText({ ledger, matchId: id, teamName: 'Test FC', nameOf, provenance: null })!;
    expect(text.split('\n')[0]).toBe('Test FC 1–1 Rovers');
    expect(text).toContain(`Q1 (1–1): ${nameOf(striker)}, assist ${nameOf(helper)}; Rovers scored`);
    expect(text).toContain('(joint)');
    expect(text).toContain('Rovers used a power play');
    expect(text).toContain('AS A TEAM\n1 tackle');
    // Children named only for goals, assists and awards: the tackle is a team total.
    expect(text).not.toMatch(new RegExp(`tackle[^\\n]*${nameOf(helper)}`));
    expect(text).not.toMatch(/minute|fair share|in goal/i);
  });

  it('says so in small text for a reconstructed or imported match', () => {
    const { ledger, id } = playedLedger();
    expect(highlightsText({ ledger, matchId: id, teamName: 'Test FC', nameOf, provenance: 'Recorded on another phone' })).toMatch(/\(Recorded on another phone\)$/);
  });
});

describe('the full match log for coaches (#282, Rob "Log as recommended")', () => {
  it('every tap with who and time, every sub, their power play, in time order; no minutes totals', () => {
    const { ledger, id, striker, helper } = playedLedger();
    const log = matchLogText({ ledger, matchId: id, teamName: 'Test FC', nameOf, provenance: null })!;
    const lines = log.split('\n');
    const at = (s: string) => lines.findIndex((l) => l.includes(s));
    expect(log).toContain(`Q1 3:15  Goal: ${nameOf(striker)} (assist ${nameOf(helper)})`);
    expect(log).toContain(`Q1 3:15  Tackle: ${nameOf(helper)}`);
    expect(log).toContain(`Q1 6:15  Sub: ${nameOf(players[7].id)} on for ${nameOf(helper)}`);
    expect(log).toContain('Rovers used a power play');
    expect(at('Goal:')).toBeLessThan(at('Sub:'));
    expect(log).not.toMatch(/fair share|minutes/i);
  });
});
