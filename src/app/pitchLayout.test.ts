import { describe, expect, it } from 'vitest';
import { uuid } from '../types/index';
import type { UUID } from '../types/index';
import { makeFormat } from './shapes';
import { PILL_WIDTH_FRACTION, dropTargetAt, pillDetail, slotSpots } from './pitchLayout';

describe('the pitch layout (#83 AC1)', () => {
  it('draws 2-3-1 attacking upwards, left on the left', () => {
    const spots = slotSpots(makeFormat('2-3-1'));
    const at = (label: string) => spots.find((s) => s.label === label)!;
    expect(at('GK').y).toBeGreaterThan(at('LB').y);
    expect(at('LB').y).toBeGreaterThan(at('CM').y);
    expect(at('CM').y).toBeGreaterThan(at('ST').y);
    expect(at('LB').x).toBeLessThan(at('RB').x);
    expect(at('LW').x).toBeLessThan(at('CM').x);
    expect(at('CM').x).toBeLessThan(at('RW').x);
    expect(at('ST').x).toBeCloseTo(0.5);
  });

  it('draws 2-2-2 with two forwards side by side', () => {
    const spots = slotSpots(makeFormat('2-2-2'));
    const fwd = spots.filter((s) => s.unit === 'ATT');
    expect(fwd).toHaveLength(2);
    expect(fwd[0].y).toBe(fwd[1].y);
  });

  it('puts every position somewhere distinct', () => {
    const spots = slotSpots(makeFormat('2-3-1'));
    const keys = new Set(spots.map((s) => `${s.x.toFixed(3)},${s.y}`));
    expect(keys.size).toBe(7);
  });
});

describe('what a drop lands on', () => {
  const format = makeFormat('2-3-1');
  const spots = slotSpots(format);
  const pitch = { x: 0, y: 0, width: 300, height: 360 };
  const gk = spots.find((s) => s.label === 'GK')!;
  const benchRect = { x: 0, y: 380, width: 300, height: 60 };
  const benchPlayer = uuid() as UUID;
  const pills = [{ playerId: benchPlayer, rect: { x: 10, y: 390, width: 90, height: 44 } }];

  it('lands on the nearest position, even a little short of it', () => {
    const t = dropTargetAt(gk.x * 300 + 20, gk.y * 360 - 10, pitch, spots, pills, benchRect);
    expect(t).toEqual({ kind: 'slot', positionId: gk.positionId });
  });

  it('lands on a bench player before the bench itself', () => {
    expect(dropTargetAt(40, 400, pitch, spots, pills, benchRect)).toEqual({ kind: 'player', playerId: benchPlayer });
    expect(dropTargetAt(250, 400, pitch, spots, pills, benchRect)).toEqual({ kind: 'bench' });
  });

  it('lands on nothing outside the pitch and the bench', () => {
    expect(dropTargetAt(150, 470, pitch, spots, pills, benchRect)).toBeNull();
  });
});

describe('pills do not touch (#89 AC3)', () => {
  it('leaves a gap between neighbours in every row, for both shapes', () => {
    for (const shape of ['2-3-1', '2-2-2'] as const) {
      const spots = slotSpots(makeFormat(shape));
      const rows = new Map<number, number[]>();
      for (const s of spots) rows.set(s.y, [...(rows.get(s.y) ?? []), s.x]);
      for (const xs of rows.values()) {
        const sorted = [...xs].sort((a, b) => a - b);
        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i] - sorted[i - 1]).toBeGreaterThan(PILL_WIDTH_FRACTION + 0.03);
        }
      }
    }
  });
});

describe('the time under a pill (match day 4)', () => {
  const m = { outfieldMs: 0, goalkeeperMs: 12 * 60_000 + 30_000 };
  it('shows the keeper their time in goal, not 00:00 outfield', () => {
    expect(pillDetail(m, true)).toBe('GK 12:30');
  });
  it('shows everyone else their outfield time', () => {
    expect(pillDetail({ outfieldMs: 5 * 60_000, goalkeeperMs: 60_000 }, false)).toBe('05:00');
    expect(pillDetail(undefined, false)).toBe('00:00');
    expect(pillDetail(undefined, true)).toBe('GK 00:00');
  });
});
