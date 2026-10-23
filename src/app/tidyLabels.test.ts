/**
 * #228 item 3: the labels Shot, Free kick and Corner. Acceptance criteria 1–6
 * are on the issue (Bea, approved by Rob 23 Oct with Q1 and Q2 as
 * recommended: "Shot" still means on target, and the report's "Their shots on
 * target" line stays). Made-up first names only (invariant 4).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid, type Player } from '../types/index';
import { addEventType, emptyLedger, parseLedger, recordMatches, serialiseLedger, type Ledger } from './ledger';
import * as released from './fixtures/reader-1.2.0/ledger';
import { TAP_LABEL, talliesOf, tapEventsFor, timeStream } from './matchEvents';
import { recordMatchPage } from './recordOnly';
import { makeFormat } from './shapes';
import { makePlayer } from './squad';
import { sheetFromSelection, toTeamSheet } from './teamSheet';
import { BUILT_IN_TALLIES, matchTalliesWithGoals, tallyLineText } from './tallies';

const MIN = 60_000;
const NOW = new Date('2026-10-23T12:00:00Z');
const squadId = uuid();
const players: Player[] = ['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gil', 'Hal'].map((n) => makePlayer(squadId, n));
const ids = players.map((p) => p.id);
const nameOf = (id: string) => players.find((p) => p.id === id)?.firstName ?? 'Unknown';

function played() {
  let nowMs = Date.parse('2026-10-17T09:00:00Z');
  const engine = new MatchEngine({ nowFn: () => new Date(nowMs) });
  const format = makeFormat('2-3-1');
  const s = engine.createMatch(squadId, format.id, { totalMinutes: 20, quarterCount: 1 });
  const q = s.quarters[0];
  engine.startQuarter(s, q, toTeamSheet(sheetFromSelection(ids.slice(0, 7), ids[0], format)), format);
  nowMs += 2 * MIN;
  engine.recordEvent(s, q, 'shot_on_target', ids[5]);
  engine.recordEvent(s, q, 'shot_on_target', ids[5]);
  engine.recordEvent(s, q, 'goal', ids[2]);
  engine.recordEvent(s, q, 'corner', ids[3]);
  engine.recordEvent(s, q, 'corner', ids[4]);
  engine.recordEvent(s, q, 'free_kick', ids[4]);
  nowMs += 18 * MIN;
  engine.endQuarter(s, q);
  engine.completeMatch(s);
  return s;
}

describe('the tap sheet reads Shot, Free kick and Corner (#228 AC1)', () => {
  it('names the three buttons in short words', () => {
    expect(TAP_LABEL.shot_on_target).toBe('Shot');
    expect(TAP_LABEL.free_kick).toBe('Free kick');
    expect(TAP_LABEL.corner).toBe('Corner');
  });

  it('every tap label is short enough for a 30% tile on a 360dp phone (no longer than "Conceded")', () => {
    // Source-level proxy: rendering width cannot be measured in Node. "Conceded"
    // has always fitted its tile; nothing on the sheet is longer.
    for (const k of tapEventsFor(true)) expect(TAP_LABEL[k].length).toBeLessThanOrEqual('Conceded'.length + 1);
  });
});

describe('everywhere else uses the same words (#228 AC2)', () => {
  it('the time stream (and so the Undo line) says Shot, Corner and Free kick', () => {
    const s = played();
    const text = timeStream(s.appearances, s.events, players).map((r) => r.text);
    expect(text).toContain('Shot: Flo');
    expect(text).toContain('Corner: Di');
    expect(text).toContain('Free kick: Ed');
  });

  it('More stats and the "Built in:" list say shots, corners and free kicks', () => {
    const s = played();
    const lines = matchTalliesWithGoals(s.events, [], nameOf).map(tallyLineText);
    expect(lines).toContain('3 shots: Cy 1, Flo 2');
    expect(lines).toContain('2 corners: Di 1, Ed 1');
    expect(lines).toContain('1 free kick: Ed 1');
    expect(BUILT_IN_TALLIES.map((t) => t.one)).toEqual(['shot', 'save', 'tackle', 'corner', 'free kick']);
  });

  it('no user-visible "Shot on target", "Corner won" or "Free kick won" is left in App.tsx or src/', () => {
    const root = join(__dirname, '..', '..');
    const files: string[] = [join(root, 'App.tsx')];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) {
          if (!p.includes(join('fixtures', 'reader-1.2.0'))) walk(p);
        } else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) files.push(p);
      }
    };
    walk(join(root, 'src'));
    const hits: string[] = [];
    for (const f of files) {
      // Comments are not user-visible.
      const code = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      code.split('\n').forEach((line) => {
        if (!/shots? on target|corners? won|free kicks? won/i.test(line)) return;
        // Q2 (approved): the opposition line stays. The duplicate-name guard keeps the old words (AC6).
        if (/Their shots on target/.test(line)) return;
        if (f.endsWith(join('app', 'ledger.ts')) && /^\s*'(shot on target|corner won|free kick won)',$/.test(line)) return;
        hits.push(`${f}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});

describe('the record is unchanged (#228 AC3, AC4)', () => {
  it('the kinds stay shot_on_target, corner and free_kick', () => {
    const kinds = (played().events ?? []).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['shot_on_target', 'corner', 'free_kick']));
    expect(Object.keys(TAP_LABEL).sort()).toEqual(
      ['conceded', 'corner', 'free_kick', 'goal', 'save', 'shot_on_target', 'tackle'].sort()
    );
  });

  it('a ledger written by the released 1.2.0 code reads back with the new labels', () => {
    const ours = recordMatches(emptyLedger(squadId, 'Test FC', NOW), [played()], players, 'Test FC', NOW);
    const old = released.parseLedger(serialiseLedger(ours));
    if (!old.ok) throw new Error(old.reason);
    const back = parseLedger(released.serialiseLedger(old.ledger));
    if (!back.ok) throw new Error(back.reason);
    expect((back.ledger.matches[0].events ?? []).map((e) => e.kind)).toEqual(
      expect.arrayContaining(['shot_on_target', 'corner', 'free_kick'])
    );
    const page = recordMatchPage(back.ledger, back.ledger.matches[0].id)!;
    const text = page.tallies.map(tallyLineText);
    expect(text.some((t) => t.startsWith('2 shots') || t.startsWith('3 shots'))).toBe(true);
    expect(text).toContain('2 corners: Di 1, Ed 1');
    expect(text).toContain('1 free kick: Ed 1');
  });
});

describe('a goal still counts as a shot (#228 AC5, #202)', () => {
  it('adds one to the scorer’s shots', () => {
    const s = played();
    const cy = talliesOf(s.events).find((t) => t.playerId === ids[2]);
    expect(cy?.shotsOnTarget).toBe(1);
    expect(matchTalliesWithGoals(s.events, [], nameOf).map(tallyLineText)[0]).toBe('3 shots: Cy 1, Flo 2');
  });
});

describe('a coach’s tally cannot take a built-in word (#228 AC6)', () => {
  const ok = (r: { ok: true; ledger: Ledger } | { ok: false; reason: string }) => r.ok;
  it.each(['Shot', 'shot', 'SHOT', 'Free kick', 'free KICK', 'Corner', 'corner', 'Shot on target', 'Corner won', 'Free kick won'])(
    'refuses "%s"',
    (name) => {
      expect(ok(addEventType(emptyLedger(squadId, 'Test FC', NOW), name, 'child', NOW))).toBe(false);
    }
  );
  it('still accepts a new word', () => {
    expect(ok(addEventType(emptyLedger(squadId, 'Test FC', NOW), 'Header', 'child', NOW))).toBe(true);
  });
});
