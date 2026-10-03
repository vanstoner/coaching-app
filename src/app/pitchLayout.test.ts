import { describe, expect, it } from 'vitest';
import { uuid } from '../types/index';
import type { UUID } from '../types/index';
import { makeFormat } from './shapes';
import { dropTargetAt, slotSpots } from './pitchLayout';

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
