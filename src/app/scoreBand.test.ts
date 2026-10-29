/**
 * #252: the score band folds the match's events on every paint (AC10, AC11),
 * shows nothing before kick-off (Rob's ruling) and reads once for a screen
 * reader (AC12). Made-up names only.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { uuid, type MatchEvent, type MatchEventKind, type UUID } from '../types/index';
import { scoreOf } from './matchEvents';
import { scoreBand, showsScoreBand } from './scoreBand';

const matchId = uuid();
const quarterId = uuid();
const ev = (kind: MatchEventKind, refersTo: UUID | null = null): MatchEvent => ({
  id: uuid(),
  matchId,
  quarterId,
  kind,
  playerId: null,
  atElapsedMs: 0,
  recordedAt: '2026-11-01T10:00:00Z',
  refersTo,
  note: kind === 'withdrawn' ? 'Tapped by mistake' : null,
});

describe('the score band (#252)', () => {
  it('follows a goal, a conceded goal and a withdrawn goal, always equal to scoreOf (AC10, AC11)', () => {
    const goal = ev('goal');
    const steps: MatchEvent[][] = [[], [goal], [goal, ev('conceded')], [goal, ev('conceded'), ev('withdrawn', goal.id)]];
    const texts = steps.map((events) => {
      const b = scoreBand(events, 'Mock FC', 'Rovers');
      const s = scoreOf(events);
      expect([b.us, b.them]).toEqual([s.us, s.them]);
      return b.text;
    });
    expect(texts).toEqual(['0–0', '1–0', '1–1', '0–1']);
  });

  it('has one label, our name and score first (AC12)', () => {
    expect(scoreBand([ev('goal'), ev('goal'), ev('conceded')], 'Mock FC', 'Rovers').label).toBe('Mock FC 2, Rovers 1');
  });

  it('shows nothing before kick-off, then from the first period on (Rob)', () => {
    expect(showsScoreBand([])).toBe(false);
    expect(showsScoreBand([{ status: 'pending' }, { status: 'pending' }])).toBe(false);
    expect(showsScoreBand([{ status: 'running' }, { status: 'pending' }])).toBe(true);
    expect(showsScoreBand([{ status: 'ended' }, { status: 'pending' }])).toBe(true);
    expect(showsScoreBand([{ status: 'ended' }, { status: 'ended' }])).toBe(true);
  });

  it('the screens draw the band, the strip no longer shows the score, and nothing new is stored (AC4, AC10)', () => {
    const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
    const clock = read('screens/ClockScreen.tsx');
    expect(clock).not.toMatch(/stripScore/);
    expect(clock.match(/<ScoreBand /g)?.length).toBe(2);
    expect(read('screens/LineupScreen.tsx')).toMatch(/<ScoreBand/);
    expect(read('types/index.ts')).not.toMatch(/\bscore\s*[?:]/);
  });
});
