/**
 * #228 item 6: awards from Q1 and before the match is closed (Bea's criteria
 * 19–31; Q5 and Q6 approved as recommended, and Dee's placements, 23 Oct).
 * The rules are tested on the record and `matchAwards.ts`; where only the
 * screens can show it, a source check says so. Made-up first names only.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MatchEngine, type MatchState } from '../engine/MatchEngine';
import { uuid, type Player } from '../types/index';
import {
  DEFAULT_AWARD_TYPES,
  changeAward,
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
import { endMatch } from './matchClosing';
import { awardPromptDue, awardRows, awardsLine, awardsOffered, childrenInMatch } from './matchAwards';
import { recordMatchPage } from './recordOnly';
import { makeFormat } from './shapes';
import { makePlayer } from './squad';
import { sheetFromSelection, toTeamSheet } from './teamSheet';
import { newTestMark, recordable } from './testMatches';

const MIN = 60_000;
const squadId = uuid();
const players: Player[] = ['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gil', 'Hal'].map((n) => makePlayer(squadId, n));
const ids = players.map((p) => p.id);
const POTW = DEFAULT_AWARD_TYPES[0].id;
const ASSIST = DEFAULT_AWARD_TYPES[1].id;
const nameOf = (id: string) => players.find((p) => p.id === id)?.firstName ?? 'Unknown';

const ok = (r: { ok: true; ledger: Ledger } | { ok: false; reason: string }): Ledger => {
  if (!r.ok) throw new Error(r.reason);
  return r.ledger;
};

/** A real two-half match, driven through the engine one step at a time. */
function matchDay() {
  let nowMs = Date.parse('2026-10-24T09:00:00Z');
  const now = () => new Date(nowMs);
  const engine = new MatchEngine({ nowFn: now });
  const format = makeFormat('2-3-1');
  const state = engine.createMatch(squadId, format.id, { totalMinutes: 20, quarterCount: 2 });
  const sheet = toTeamSheet(sheetFromSelection(ids.slice(0, 7), ids[0], format));
  let ledger = emptyLedger(squadId, 'Test FC', now());
  /** What the app's persist() does: the live match into the record. */
  const save = () => {
    ledger = recordMatches(ledger, recordable([state]), players, 'Test FC', now());
    return ledger;
  };
  return {
    engine,
    state,
    now,
    save,
    get ledger() {
      return ledger;
    },
    set ledger(l: Ledger) {
      ledger = l;
    },
    kickOff: () => engine.startQuarter(state, state.quarters[0], sheet, format),
    advance: (ms: number) => (nowMs += ms),
    endFirst: () => engine.endQuarter(state, state.quarters[0]),
    startSecond: () => engine.startQuarter(state, state.quarters[1], sheet, format),
    endSecond: () => engine.endQuarter(state, state.quarters[1]),
  };
}

function toFullTime() {
  const d = matchDay();
  d.kickOff();
  d.save();
  d.advance(10 * MIN);
  d.endFirst();
  d.startSecond();
  d.advance(10 * MIN);
  d.endSecond();
  d.save();
  return d;
}

const awardRecords = (l: Ledger) => l.entries.flatMap((e) => e.records).filter((r) => r.type === 'award').length;

describe('offered from kick-off until closed, breaks included (#228 AC23)', () => {
  it('not before kick-off; in Q1; at the break; at full time; not once closed', () => {
    const d = matchDay();
    expect(awardsOffered(d.save(), d.state)).toBe(false);
    d.kickOff();
    expect(awardsOffered(d.save(), d.state)).toBe(true);
    d.advance(10 * MIN);
    d.endFirst();
    expect(awardsOffered(d.save(), d.state)).toBe(true);
    d.startSecond();
    d.advance(10 * MIN);
    d.endSecond();
    expect(awardsOffered(d.save(), d.state)).toBe(true);
    endMatch(d.engine, d.state);
    expect(awardsOffered(d.save(), d.state)).toBe(false);
  });

  it('not without a record to write, nor with every award type retired', () => {
    const d = matchDay();
    d.kickOff();
    expect(awardsOffered(null, d.state)).toBe(false);
    let l = ok(updateAwardType(d.save(), POTW, { active: false }, d.now()));
    l = ok(updateAwardType(l, ASSIST, { active: false }, d.now()));
    expect(awardsOffered(l, d.state)).toBe(false);
  });

  it('the break line counts the active awards given (Dee)', () => {
    const d = matchDay();
    d.kickOff();
    const l = ok(giveAward(d.save(), d.state.match.id, POTW, ids[3], '', d.now()));
    expect(awardsLine(awardRows(l, d.state.match.id, nameOf))).toBe('Awards: 1 of 2 given');
  });
});

describe('an award in Q1 is in the record at once (#228 AC24)', () => {
  it('lands in Q1, survives later saves and a relaunch, and shows on the record page and in the prompt', () => {
    const d = matchDay();
    d.kickOff();
    d.advance(3 * MIN);
    d.save();
    d.ledger = ok(giveAward(d.ledger, d.state.match.id, POTW, ids[3], 'Ran all day', d.now()));
    d.advance(7 * MIN);
    d.endFirst();
    d.save();
    const back = parseLedger(serialiseLedger(d.ledger));
    if (!back.ok) throw new Error(back.reason);
    const rows = awardRows(back.ledger, d.state.match.id, nameOf);
    expect(rows.find((r) => r.typeId === POTW)?.winners).toEqual([{ playerId: ids[3], name: 'Di', note: 'Ran all day' }]);
    // The match's page in the record lists closed matches: play on and close it.
    d.startSecond();
    d.advance(10 * MIN);
    d.endSecond();
    endMatch(d.engine, d.state);
    const page = recordMatchPage(d.save(), d.state.match.id);
    expect(page?.awards.map((a) => [a.award, a.name])).toEqual([['Player of the Week', 'Di']]);
  });

  it('the children offered are those who took part', () => {
    const d = matchDay();
    d.kickOff();
    expect(childrenInMatch(players, d.state.appearances).map((c) => c.name)).toEqual(['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gil']);
  });
});

describe('End match asks first (#228 AC19, AC22; Q5)', () => {
  it('not while periods remain; at full time while an award has no winner', () => {
    const d = matchDay();
    d.kickOff();
    expect(awardPromptDue(d.save(), d.state)).toBe(false);
    const f = toFullTime();
    expect(awardPromptDue(f.ledger, f.state)).toBe(true);
  });

  it('not once every active award has a winner, so a coach who decided in Q1 is not asked again', () => {
    const f = toFullTime();
    let l = ok(giveAward(f.ledger, f.state.match.id, POTW, ids[1], '', f.now()));
    expect(awardPromptDue(l, f.state)).toBe(true);
    l = ok(giveAward(l, f.state.match.id, ASSIST, ids[2], '', f.now()));
    expect(awardPromptDue(l, f.state)).toBe(false);
  });

  it('a retired type does not hold the prompt open', () => {
    const f = toFullTime();
    let l = ok(giveAward(f.ledger, f.state.match.id, POTW, ids[1], '', f.now()));
    l = ok(updateAwardType(l, ASSIST, { active: false }, f.now()));
    expect(awardPromptDue(l, f.state)).toBe(false);
  });

  it('leaving without giving or skipping leaves the match open, and it asks again (AC22)', () => {
    const f = toFullTime();
    expect(awardPromptDue(f.ledger, f.state)).toBe(true);
    // Nothing happened: the match is still not closed, and End match asks again.
    expect(f.state.match.status).not.toBe('completed');
    expect(awardPromptDue(f.save(), f.state)).toBe(true);
  });

  it('the report asks only when due, and both End match and Give them later close it (source check)', () => {
    const src = readFileSync(join(__dirname, '..', 'screens', 'MatchSummaryScreen.tsx'), 'utf8');
    expect(src).toMatch(/onPress=\{\(\) => \(awards\?\.due \? setAskingAwards\(true\) : onEndMatch\(\)\)\}/);
    const card = src.slice(src.indexOf('<AwardCard'), src.indexOf('</>\n            }'));
    expect(card.match(/onPress=\{onEndMatch\}/g)?.length).toBe(2);
    expect(card).toContain('Give them later');
  });
});

describe('skip writes nothing (#228 AC21)', () => {
  it('closing without awards closes exactly as End match and adds no award record', () => {
    const f = toFullTime();
    const before = awardRecords(f.ledger);
    expect(endMatch(f.engine, f.state)).toBe(true);
    const after = f.save();
    expect(awardRecords(after)).toBe(before);
    expect(after.matches.find((m) => m.id === f.state.match.id)?.awards).toBeUndefined();
    expect(f.state.match.status).toBe('completed');
  });
});

describe('the existing rules hold (#228 AC25, AC26, AC28, AC29)', () => {
  it('joint winners, no same child twice, retired not offered, a change keeps the earlier record', () => {
    const d = matchDay();
    d.kickOff();
    const id = d.state.match.id;
    let l = ok(giveAward(d.save(), id, POTW, ids[1], '', d.now()));
    l = ok(giveAward(l, id, POTW, ids[2], '', d.now()));
    expect(awardRows(l, id, nameOf)[0].winners.map((w) => w.name)).toEqual(['Bo', 'Cy']);
    expect(giveAward(l, id, POTW, ids[1], '', d.now()).ok).toBe(false);
    const n = awardRecords(l);
    l = ok(changeAward(l, id, POTW, ids[2], null, '', d.now()));
    expect(awardRecords(l)).toBe(n + 1);
    expect(awardRows(l, id, nameOf)[0].winners.map((w) => w.name)).toEqual(['Bo']);
    l = ok(updateAwardType(l, ASSIST, { active: false }, d.now()));
    expect(awardRows(l, id, nameOf).map((r) => r.typeId)).toEqual([POTW]);
    expect(giveAward(l, id, ASSIST, ids[4], '', d.now()).ok).toBe(false);
  });

  it('once closed, the record page can still give an award (AC26)', () => {
    const f = toFullTime();
    endMatch(f.engine, f.state);
    expect(giveAward(f.save(), f.state.match.id, POTW, ids[5], '', f.now()).ok).toBe(true);
  });

  it('awards never feed minutes or fairness (AC28)', () => {
    const f = toFullTime();
    const l = ok(giveAward(f.ledger, f.state.match.id, POTW, ids[5], '', f.now()));
    expect(foldLedger(l)).toEqual(foldLedger(f.ledger));
  });

  it('no new record type: the released reader carries an award given mid-match (AC29)', () => {
    const d = matchDay();
    d.kickOff();
    const l = ok(giveAward(d.save(), d.state.match.id, POTW, ids[3], '', d.now()));
    // The award is the existing #197 record, field for field.
    const written = l.entries.flatMap((e) => e.records).filter((r) => r.type === 'award');
    expect(written).toEqual([
      { type: 'award', matchId: d.state.match.id, awardTypeId: POTW, playerId: ids[3], given: true, note: null },
    ]);
    const old = released.parseLedger(serialiseLedger(l));
    if (!old.ok) throw new Error(old.reason);
    const again = parseLedger(released.serialiseLedger(old.ledger));
    if (!again.ok) throw new Error(again.reason);
    expect(again.ledger.matches.find((m) => m.id === d.state.match.id)?.awards?.map((a) => a.playerId)).toEqual([ids[3]]);
  });
});

describe('a test match has no awards (#228 AC27, Q6)', () => {
  function testMatch(): { state: MatchState; ledger: Ledger; engine: MatchEngine } {
    const d = matchDay();
    d.state.match.test = newTestMark(Date.parse('2026-10-24T09:00:00Z'));
    d.kickOff();
    d.advance(10 * MIN);
    d.endFirst();
    d.startSecond();
    d.advance(10 * MIN);
    d.endSecond();
    return { state: d.state, ledger: d.save(), engine: d.engine };
  }

  it('offers no control, no prompt, and its End match closes it as today', () => {
    const t = testMatch();
    expect(awardsOffered(t.ledger, t.state)).toBe(false);
    expect(awardPromptDue(t.ledger, t.state)).toBe(false);
    expect(endMatch(t.engine, t.state)).toBe(true);
  });

  it('never has an award record: it is not in the record to give one to', () => {
    const t = testMatch();
    expect(t.ledger.matches.some((m) => m.id === t.state.match.id)).toBe(false);
    expect(giveAward(t.ledger, t.state.match.id, POTW, ids[1], '', new Date()).ok).toBe(false);
    expect(awardRecords(t.ledger)).toBe(0);
  });

  it('the screens draw awards only from what awardsOffered allows (source check)', () => {
    const app = readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8');
    expect(app).toMatch(/if \(!match \|\| !l \|\| !awardsOffered\(l, match\.state\)\) return null;/);
    const clock = readFileSync(join(__dirname, '..', 'screens', 'ClockScreen.tsx'), 'utf8');
    // #264 V2: the › is an icon (`more`), not text.
    expect(clock).toMatch(/\{awards && \(\s*<SheetButton\s*label=\{`Give \$\{nameOf\(sheetFor\)\} an award`\}\s*more/);
    expect(clock).toMatch(/\{awards && !running && !view\.isMatchOver && \(/);
  });
});

describe('Settings says where awards are given (#228 AC31, source check)', () => {
  it('the hint names the match, End match and the record', () => {
    const src = readFileSync(join(__dirname, '..', 'screens', 'AwardsSection.tsx'), 'utf8');
    expect(src).toMatch(/Given during a match \(tap a player, or at a break\), when you End match/);
    const spec = readFileSync(join(__dirname, '..', '..', 'docs', 'feature-specs.md'), 'utf8');
    expect(spec.split('\n').find((l) => l.startsWith('| Give / change an award |'))).toMatch(/End match asks first/);
  });
});
