/**
 * #254: pitch surface, condition and referee. Surface and condition go in the
 * record (absent when unset); the referee stays on this phone and in the
 * coach's own backup, never in the minutes record (Q2). Made-up names only.
 */

import { describe, expect, it } from 'vitest';

import { uuid } from '../types/index';
import { emptyLedger, recordMatches, serialiseLedger } from './ledger';
import { fixtureRecord, setupFrom, toFixture } from './ledgerSetup';
import { newMatch } from './matchLifecycle';
import { createMemoryStore, loadSession, toSavedSession } from './persistence';
import { makeSevenASideFormat } from './placeholderSquad';
import {
  cleanReferee,
  conditionOf,
  pitchAndRefereeLine,
  pitchTags,
  REFEREE_MAX_LENGTH,
  surfaceOf,
} from './pitch';
import { makePlayer } from './squad';
import { makePhoneBackup, readAnyBackup, restorePhoneBackup } from './storage/phoneBackup';

const NOW = new Date('2026-10-29T12:00:00Z');
const squadId = uuid();
const kids = ['Ada', 'Bo'].map((n) => makePlayer(squadId, n));
const format = makeSevenASideFormat();
const REF = 'Sam Refwood';

function fixture(extra: { surface?: '3g' | '4g' | 'grass'; condition?: 'excellent' | 'good' | 'poor'; referee?: string }) {
  return newMatch(
    { squadId, format, players: kids, totalMinutes: 50, periodCount: 4, kickoffAt: '2026-11-01T10:00:00Z', ...extra },
    () => NOW
  ).stored;
}

const setup = (matches: ReturnType<typeof fixture>[]) =>
  setupFrom({
    players: kids,
    matches: matches.map((m) => ({ match: m.match, format })),
    live: null,
    format,
    totalMinutes: 50,
    periodCount: 4,
    buzzWhenSubDue: true,
  });

describe('pitch surface and condition (#254 AC1–AC4)', () => {
  it('are Rob’s values in his order, each shown only when set', () => {
    expect(pitchTags('3g', 'good')).toEqual(['3G', 'Good pitch']);
    expect(pitchTags('grass', null)).toEqual(['Grass']);
    expect(pitchTags(undefined, 'poor')).toEqual(['Poor pitch']);
    expect(pitchTags(undefined, undefined)).toEqual([]);
  });

  it('a value from a later build shows as nothing (AC4)', () => {
    expect(surfaceOf('indoor')).toBeNull();
    expect(conditionOf('waterlogged')).toBeNull();
    expect(pitchTags('indoor', 'waterlogged')).toEqual([]);
  });

  it('go on the fixture record when set, and are absent (not null) when not (AC2)', () => {
    const set = fixtureRecord({ match: fixture({ surface: '4g', condition: 'excellent' }).match, format });
    expect(set).toMatchObject({ surface: '4g', condition: 'excellent' });
    const unset = fixtureRecord({ match: fixture({}).match, format });
    expect('surface' in unset).toBe(false);
    expect('condition' in unset).toBe(false);
  });

  it('read back from the record, a later build’s value carried as is', () => {
    expect(toFixture({ type: 'fixture', id: uuid(), surface: '3g', condition: 'poor' })).toMatchObject({
      surface: '3g',
      condition: 'poor',
    });
    expect(toFixture({ type: 'fixture', id: uuid(), surface: 'indoor' })?.surface).toBe('indoor');
  });
});

describe('the referee stays on this phone (#254 AC5–AC8, Q2)', () => {
  it('is trimmed, at most 30 characters, blank is none (AC5)', () => {
    expect(cleanReferee('  Sam   Refwood ')).toBe('Sam Refwood');
    expect(cleanReferee('   ')).toBeNull();
    expect(cleanReferee(null)).toBeNull();
    expect(cleanReferee('x'.repeat(40))).toHaveLength(REFEREE_MAX_LENGTH);
  });

  it('is on the phone’s match, never in the fixture record or the minutes record (AC6)', () => {
    const m = fixture({ surface: '3g', referee: REF });
    expect(m.match.referee).toBe(REF);
    expect(JSON.stringify(fixtureRecord({ match: m.match, format }))).not.toContain(REF);
    const ledger = recordMatches(emptyLedger(squadId, 'Mock FC', NOW), [], kids, 'Mock FC', NOW, setup([m]));
    const text = serialiseLedger(ledger);
    expect(text).toContain('"surface": "3g"');
    expect(text).not.toContain(REF);
  });

  it('the coach’s own backup carries it, and a restore brings it back (AC7)', async () => {
    const m = fixture({ referee: REF });
    const session = toSavedSession({
      squadName: 'Mock FC',
      squadId,
      players: kids,
      format,
      totalMinutes: 50,
      periodCount: 4,
      buzzWhenSubDue: true,
      plan: {},
      matches: [m],
      state: null,
      now: NOW,
    });
    const ledger = recordMatches(emptyLedger(squadId, 'Mock FC', NOW), [], kids, 'Mock FC', NOW, setup([m]));
    const file = makePhoneBackup(session, ledger, { app: 'Heart FC Coach', build: 'test' }, NOW);
    expect(file).toContain(REF);
    const back = readAnyBackup(file);
    if (!back.ok) throw new Error(back.reason);
    const phone = createMemoryStore();
    const outcome = await restorePhoneBackup(phone, back.teams[0].backup, NOW);
    if (!outcome.ok) throw new Error(outcome.reason);
    expect((await loadSession(phone))?.matches[0].match.referee).toBe(REF);
  });

  it('the "Pitch and referee" line names what is set, nothing when none (AC12, AC20)', () => {
    expect(pitchAndRefereeLine('3g', 'good', 'Sam')).toBe('3G · Good pitch · Referee: Sam');
    expect(pitchAndRefereeLine(undefined, 'poor', null)).toBe('Poor pitch');
    expect(pitchAndRefereeLine(undefined, undefined, undefined)).toBeNull();
  });
});

describe('the referee is never shared (#254 AC8)', () => {
  it('nothing that builds a shared picture, the minutes file or a card label reads it', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
    for (const f of ['app/planImage.ts', 'screens/PlanImageView.tsx', 'app/ledgerFile.ts', 'app/ledgerSetup.ts', 'screens/FixturesScreen.tsx']) {
      expect(read(f), f).not.toMatch(/referee/i);
    }
  });
});
