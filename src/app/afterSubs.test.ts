/** #304: the pitch after a quarter's subs (criteria on #304, approved by Rob 20 Nov). Made-up ids. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { UUID } from '../types/index';
import { afterSlots, afterSubsAt, afterSubsSummary, movesOf, subbedSlots, swapsTo } from './afterSubs';

const id = (s: string) => s as UUID;
const [gk, cb, lm, cm, rm, st] = ['gk', 'cb', 'lm', 'cm', 'rm', 'st'].map(id);
const [ava, ben, cal, dan, eve, fin, gus, hal] = ['ava', 'ben', 'cal', 'dan', 'eve', 'fin', 'gus', 'hal'].map(id);
const start = { [gk]: ava, [cb]: ben, [lm]: cal, [cm]: dan, [rm]: eve, [st]: fin };
const period = { slots: start, subs: [{ offId: cal, onId: gus, atMs: 375_000 }, { offId: eve, onId: hal, atMs: 375_000 }] };

describe('after the subs (#304)', () => {
  it('C1: as subbed, each child coming on takes the place of the one going off', () => {
    expect(subbedSlots(period)).toEqual({ ...start, [lm]: gus, [rm]: hal });
    expect(afterSubsAt(period)).toBe(375_000);
    expect(afterSubsAt({ subs: [] })).toBeNull();
  });

  it('C2: untouched reads "As subbed"; a rearrangement counts its moves', () => {
    expect(afterSubsSummary(period)).toBe('As subbed');
    const after = { ...subbedSlots(period), [cm]: gus, [lm]: dan };
    expect(movesOf({ ...period, after })).toEqual([
      { playerId: dan, from: cm, to: lm },
      { playerId: gus, from: lm, to: cm },
    ]);
    expect(afterSubsSummary({ ...period, after })).toBe('Rearranged · 2 moves');
  });

  it('C3: a sub changed afterwards keeps who is still on, and the newcomer takes the free place', () => {
    const after = { ...subbedSlots(period), [cm]: gus, [lm]: dan };
    const changed = { ...period, subs: [{ offId: cal, onId: gus, atMs: 375_000 }, { offId: eve, onId: id('ivy'), atMs: 375_000 }], after };
    const out = afterSlots(changed);
    expect(new Set(Object.values(out))).toEqual(new Set(Object.values(subbedSlots(changed))));
    expect(out[cm]).toBe(gus);
    expect(out[lm]).toBe(dan);
  });

  it('C4: the swaps that turn the pitch as it is into the plan, only between children on it', () => {
    const now = subbedSlots(period);
    const target = { ...now, [cm]: gus, [lm]: dan, [st]: hal, [rm]: fin };
    const swaps = swapsTo(now, target);
    let pitch = { ...now };
    for (const [a, b] of swaps) {
      const pa = (Object.keys(pitch) as UUID[]).find((p) => pitch[p] === a)!;
      const pb = (Object.keys(pitch) as UUID[]).find((p) => pitch[p] === b)!;
      pitch = { ...pitch, [pa]: b, [pb]: a };
    }
    expect(pitch).toEqual(target);
    // A planned child who is not on is left alone.
    expect(swapsTo(now, { ...now, [cm]: id('nobody') })).toEqual([]);
  });
});

describe('the screens carry it (#304)', () => {
  const read = (p: string) => readFileSync(join(__dirname, p), 'utf8');

  it('C1, C2: the Team sheet offers "After the subs" only with a sub, and Reset', () => {
    const sheet = read('../screens/TeamSheetScreen.tsx');
    expect(sheet).toMatch(/After the subs/);
    expect(sheet).toMatch(/afterSubsSummary\(/);
    expect(sheet).toMatch(/Reset to as subbed/);
  });

  it('C4: the clock asks once the subs at that time are done, and records swaps', () => {
    const clock = read('../screens/ClockScreen.tsx');
    expect(clock).toMatch(/swapsTo\(/);
    expect(clock).toMatch(/onLiveMove\(\{ kind: 'swap'/);
    const card = read('../screens/ClockSubs.tsx');
    expect(card).toMatch(/Now move to the planned positions/);
    expect(card).toMatch(/Move them/);
    expect(card).toMatch(/Not now/);
  });

  it('C4: the app gives the clock the running quarter\'s planned positions', () => {
    const app = read('../../App.tsx');
    expect(app).toMatch(/afterSubs=\{/);
    expect(app).toMatch(/target: afterSlots\(planned\), atMs: at/);
  });

  it('C6: the shared plan draws the after pitch', () => {
    expect(read('../screens/PlanImageView.tsx')).toMatch(/miniPitch\(period\.after\.slots/);
  });
});
