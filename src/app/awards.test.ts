/**
 * Customisable awards — #197 (PO `approve readiness`, 18 Oct: joint winners
 * allowed, one shown by default). Made-up first names only (invariant 4).
 */

import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid, type Player, type UUID } from '../types/index';
import {
  DEFAULT_AWARD_TYPES,
  addAwardType,
  afterMatchDay,
  changeAward,
  childAwards,
  emptyLedger,
  foldLedger,
  giveAward,
  parseLedger,
  recordMatches,
  serialiseLedger,
  updateAwardType,
  type Ledger,
} from './ledger';
import * as released from './fixtures/reader-1.2.0/ledger';
import { recordMatchPage } from './recordOnly';
import { makeFormat } from './shapes';
import { makePlayer } from './squad';
import { squadViews } from './squadViews';
import { sheetFromSelection, toTeamSheet } from './teamSheet';

const MIN = 60_000;
const DAY = new Date('2026-10-03T11:00:00Z');
const NEXT_WEEK = new Date('2026-10-10T11:00:00Z');
const squadId = uuid();
const players: Player[] = ['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gil', 'Hal'].map((n) => makePlayer(squadId, n));
const ids = players.map((p) => p.id);
const POTW = DEFAULT_AWARD_TYPES[0].id;
const ASSIST = DEFAULT_AWARD_TYPES[1].id;

function season(): { ledger: Ledger; matchId: UUID } {
  let nowMs = Date.parse('2026-10-03T09:00:00Z');
  const engine = new MatchEngine({ nowFn: () => new Date(nowMs) });
  const format = makeFormat('2-3-1');
  const s = engine.createMatch(squadId, format.id, { totalMinutes: 20, quarterCount: 1 });
  s.match.kickoffAt = '2026-10-03T09:00:00Z';
  engine.startQuarter(s, s.quarters[0], toTeamSheet(sheetFromSelection(ids.slice(0, 7), ids[0], format)), format);
  nowMs += 20 * MIN;
  engine.endQuarter(s, s.quarters[0]);
  engine.completeMatch(s);
  return { ledger: recordMatches(emptyLedger(squadId, 'Test FC', DAY), [s], players, 'Test FC', DAY), matchId: s.match.id };
}

const ok = (r: { ok: true; ledger: Ledger } | { ok: false; reason: string }): Ledger => {
  if (!r.ok) throw new Error(r.reason);
  return r.ledger;
};

describe('award types (#197 AC1)', () => {
  it('Player of the Week and Mr Assister are there by default', () => {
    expect(season().ledger.awardTypes.map((t) => t.name)).toEqual(['Player of the Week', 'Mr Assister']);
  });

  it('can be added and renamed; names are checked', () => {
    let { ledger } = season();
    expect(addAwardType(ledger, '  ', DAY).ok).toBe(false);
    expect(addAwardType(ledger, 'player of the week', DAY).ok).toBe(false);
    ledger = ok(addAwardType(ledger, 'Best Tackle', DAY));
    expect(ledger.awardTypes.map((t) => t.name)).toEqual(['Player of the Week', 'Mr Assister', 'Best Tackle']);
    ledger = ok(updateAwardType(ledger, ASSIST, { name: 'Top Assister' }, DAY));
    expect(ledger.awardTypes[1]).toMatchObject({ id: ASSIST, name: 'Top Assister', active: true });
  });

  it('retiring one stops it being offered and keeps every past award on its match', () => {
    const { ledger: base, matchId } = season();
    let ledger = ok(giveAward(base, matchId, POTW, ids[2], '', DAY));
    ledger = ok(updateAwardType(ledger, POTW, { active: false }, NEXT_WEEK));
    const page = recordMatchPage(ledger, matchId);
    expect(page?.awards.map((a) => [a.award, a.name])).toEqual([['Player of the Week', 'Cy']]);
    expect(page?.awardTypes.map((t) => t.id)).toEqual([ASSIST]);
    expect(giveAward(ledger, matchId, POTW, ids[3], '', NEXT_WEEK).ok).toBe(false);
    ledger = ok(updateAwardType(ledger, POTW, { active: true }, NEXT_WEEK));
    expect(ledger.awardTypes[0].active).toBe(true);
  });
});

describe('awards on a played match (#197 AC2)', () => {
  it('given with an optional note; joint winners are allowed', () => {
    const { ledger: base, matchId } = season();
    let ledger = ok(giveAward(base, matchId, POTW, ids[2], '', DAY));
    ledger = ok(giveAward(ledger, matchId, POTW, ids[3], 'Shared this week', DAY));
    ledger = ok(giveAward(ledger, matchId, ASSIST, ids[4], '', DAY));
    expect(giveAward(ledger, matchId, POTW, ids[3], '', DAY).ok).toBe(false);
    expect(recordMatchPage(ledger, matchId)?.awards.map((a) => [a.award, a.name, a.note])).toEqual([
      ['Player of the Week', 'Cy', null],
      ['Player of the Week', 'Di', 'Shared this week'],
      ['Mr Assister', 'Ed', null],
    ]);
  });

  it('a change is a new record and the earlier one stays in the chain; after the day it needs a note', () => {
    const { ledger: base, matchId } = season();
    const given = ok(giveAward(base, matchId, POTW, ids[2], '', DAY));
    expect(afterMatchDay(given, matchId, DAY)).toBe(false);
    const sameDay = ok(changeAward(given, matchId, POTW, ids[2], ids[5], '', DAY));
    expect(recordMatchPage(sameDay, matchId)?.awards.map((a) => a.name)).toEqual(['Flo']);
    expect(afterMatchDay(given, matchId, NEXT_WEEK)).toBe(true);
    expect(changeAward(given, matchId, POTW, ids[2], ids[5], ' ', NEXT_WEEK)).toEqual({
      ok: false,
      reason: 'A change after the day of the match needs a note saying why.',
    });
    const later = ok(changeAward(given, matchId, POTW, ids[2], null, 'Entered against the wrong child', NEXT_WEEK));
    expect(recordMatchPage(later, matchId)?.awards).toEqual([]);
    expect(later.entries.slice(0, given.entries.length)).toEqual(given.entries);
    const awardRecords = later.entries.flatMap((e) => e.records).filter((r) => r.type === 'award');
    expect(awardRecords.map((r) => r.given)).toEqual([true, false]);
  });
});

describe('awards and the rest of the record (#197 AC3–AC6)', () => {
  it('a child’s awards for the season fold from the record (AC3)', () => {
    const { ledger: base, matchId } = season();
    const ledger = ok(giveAward(ok(giveAward(base, matchId, POTW, ids[2], '', DAY)), matchId, ASSIST, ids[2], '', DAY));
    expect(childAwards(ledger, ids[2]).map((a) => a.award)).toEqual(['Player of the Week', 'Mr Assister']);
    expect(childAwards(ledger, ids[3])).toEqual([]);
  });

  it('never feed fairness or minutes (AC5)', () => {
    const { ledger: base, matchId } = season();
    const ledger = ok(giveAward(base, matchId, POTW, ids[2], '', DAY));
    expect(foldLedger(ledger)).toEqual(foldLedger(base));
    const a = squadViews(base, players);
    const b = squadViews(ledger, players);
    expect(b.season).toEqual(a.season);
    expect(b.owed).toEqual(a.owed);
  });

  it('the released 1.2.0 build reads the new records and carries them (AC6)', () => {
    const { ledger: base, matchId } = season();
    let ledger = ok(addAwardType(base, 'Best Tackle', DAY));
    ledger = ok(giveAward(ledger, matchId, POTW, ids[2], '', DAY));
    const old = released.parseLedger(serialiseLedger(ledger));
    if (!old.ok) throw new Error(old.reason);
    expect(released.foldLedger(old.ledger)).toEqual(foldLedger(ledger));
    const back = parseLedger(released.serialiseLedger(old.ledger));
    if (!back.ok) throw new Error(back.reason);
    expect(back.ledger.awardTypes.map((t) => t.name)).toContain('Best Tackle');
    expect(recordMatchPage(back.ledger, matchId)?.awards.map((a) => a.name)).toEqual(['Cy']);
  });
});
