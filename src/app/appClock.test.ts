import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import { makeSevenASideFormat } from './placeholderSquad';
import { makePlayer } from './squad';
import { teamSheetFor } from './lineup';
import { currentQuarter } from './matchClock';
import { foldPlayerMinutes } from './playerMinutes';
import {
  NORMAL_CLOCK,
  parseClockSetting,
  virtualNowMs,
  withSpeed,
  type ClockSetting,
} from './appClock';

const T = 1_800_000_000_000;

describe('the app clock (#95)', () => {
  it('is the device clock at ×1', () => {
    expect(virtualNowMs(NORMAL_CLOCK, T)).toBe(T);
  });

  it('runs N times faster at ×N, with no jump when the speed changes', () => {
    const fast = withSpeed(NORMAL_CLOCK, 10, T);
    expect(virtualNowMs(fast, T)).toBe(T); // continuous at the change
    expect(virtualNowMs(fast, T + 1_000)).toBe(T + 10_000);
  });

  it('never goes backwards: slowing down keeps the time already gained', () => {
    let s: ClockSetting = withSpeed(NORMAL_CLOCK, 10, T);
    const before = virtualNowMs(s, T + 60_000); // 10 minutes of match time gained
    s = withSpeed(s, 1, T + 60_000);
    expect(virtualNowMs(s, T + 60_000)).toBe(before);
    expect(virtualNowMs(s, T + 61_000)).toBe(before + 1_000);
    // A relaunch an hour later reads the stored setting and carries on.
    const relaunched = parseClockSetting(JSON.stringify(s));
    expect(virtualNowMs(relaunched, T + 3_660_000)).toBeGreaterThan(before);
  });

  it('reads anything it does not trust as the normal clock', () => {
    for (const raw of [null, '', 'nope', '{"offsetMs":-5,"speed":10,"sinceRealMs":0}', '{"offsetMs":0,"speed":3,"sinceRealMs":0}']) {
      expect(parseClockSetting(raw)).toEqual(NORMAL_CLOCK);
    }
  });

  it('keeps minutes exact when a whole quarter is played at ×10', () => {
    let real = T;
    const setting = withSpeed(NORMAL_CLOCK, 10, T);
    const engine = new MatchEngine({ nowFn: () => new Date(virtualNowMs(setting, real)) });
    const format = makeSevenASideFormat();
    const squadId = uuid();
    const players = ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal'].map((n) => makePlayer(squadId, n));
    const state = engine.createMatch(squadId, format.id, { totalMinutes: 50, quarterCount: 4 });
    const ids = players.map((p) => p.id);
    const q = currentQuarter(state)!;
    engine.startQuarter(state, q, teamSheetFor(ids.slice(0, 7), ids[0], format), format);
    real += 75_000; // 75 real seconds at ×10 = the 12:30 quarter
    engine.endQuarter(state, q);
    const minutes = foldPlayerMinutes(engine, state, players);
    expect(minutes.reduce((t, m) => t + m.outfieldMs + m.goalkeeperMs, 0)).toBe(7 * 750_000);
  });
});
