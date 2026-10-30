import { describe, expect, it } from 'vitest';

import { uuid, type UUID } from '../types/index';
import { matchFairShare } from './fairShare';

const MIN = 60_000;
const kid = (pitch: number, o: { present?: boolean; mainKeeper?: boolean } = {}) => ({
  playerId: uuid() as UUID,
  pitchMs: pitch * MIN,
  present: o.present ?? true,
  mainKeeper: o.mainKeeper ?? false,
});

describe('one fair-share rule for a match (#261 item 1, Rob 1b; #262)', () => {
  it('Ada’s example: 250 pitch minutes, the Main keeper’s 50 in goal, 6 there → 40:00 (AC3)', () => {
    const keeper = kid(50, { mainKeeper: true });
    const r = matchFairShare([keeper, kid(45), kid(40), kid(40), kid(40), kid(35)]);
    expect(r.shareMs).toBe(40 * MIN);
    expect(r.out.get(keeper.playerId)).toBe('main-keeper');
  });

  it('an absent child is out of the share and gets no gap (#262)', () => {
    const away = kid(0, { present: false });
    const r = matchFairShare([kid(40), kid(40), away]);
    expect(r.shareMs).toBe(40 * MIN);
    expect(r.out.get(away.playerId)).toBe('absent');
  });

  it('a Main keeper who is absent does not take another child out', () => {
    const away = kid(0, { present: false, mainKeeper: true });
    const r = matchFairShare([kid(50), kid(30), away]);
    expect(r.shareMs).toBe(40 * MIN);
    expect(r.out.size).toBe(1);
  });

  it('a fill-in is in the share on the day: nothing in this rule leaves them out (Rob, #190)', () => {
    const r = matchFairShare([kid(30), kid(50)]);
    expect(r.shareMs).toBe(40 * MIN);
    expect(r.out.size).toBe(0);
  });

  it('nobody in the share gives no share', () => {
    expect(matchFairShare([]).shareMs).toBeNull();
    expect(matchFairShare([kid(0, { present: false })]).shareMs).toBeNull();
  });
});
