import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { uuid } from '../types/index';
import { makeSevenASideFormat } from './placeholderSquad';
import { makePlayer } from './squad';
import { projectPlan } from './matchPlan';
import { TEST_NAMES, addTestData, isBetaBuild, showTestKit } from './testKit';

const root = resolve(__dirname, '../..');

/** The label CI bakes into the bundle, from the script CI runs. */
function ciLabel(event: string, pr = ''): string {
  const out = execFileSync('bash', ['.github/scripts/build-label.sh'], {
    cwd: root,
    env: { ...process.env, GITHUB_EVENT_NAME: event, GITHUB_REF_TYPE: 'branch', GITHUB_RUN_NUMBER: '95', PR_NUMBER: pr },
  }).toString();
  return /BUILD_LABEL=(.*)/.exec(out)![1];
}

describe('the Test kit shows in betas and development builds (#134)', () => {
  it('AC1: shows in a development build, whatever the label', () => {
    expect(showTestKit('2026.10.05 · local dev', true)).toBe(true);
    expect(showTestKit(ciLabel('push'), true)).toBe(true);
  });

  it('AC2: a release build with a non-PR label never shows it', () => {
    expect(showTestKit(ciLabel('push'), false)).toBe(false);
    expect(showTestKit('v2026.10.04-build.81', false)).toBe(false);
    expect(showTestKit('2026.10.05 · local dev', false)).toBe(false);
  });

  it('AC4: a CI pull-request beta (a release build) still shows it', () => {
    expect(showTestKit(ciLabel('pull_request', '97'), false)).toBe(true);
  });
});

describe('the Test kit is beta only (#95 AC1)', () => {
  it('shows in a pull-request build (Coaching Beta), from the label CI really writes', () => {
    expect(isBetaBuild(ciLabel('pull_request', '97'))).toBe(true);
  });

  it('never shows in a build of main (Coaching App), or a local run', () => {
    expect(isBetaBuild(ciLabel('push'))).toBe(false);
    expect(isBetaBuild('v2026.10.04-build.81')).toBe(false);
    expect(isBetaBuild('2026.09.19 · local dev')).toBe(false);
  });
});

describe('test data (#95 AC4)', () => {
  const format = makeSevenASideFormat();
  const squadId = uuid();
  const now = new Date('2026-10-04T09:00:00Z');

  it('adds a synthetic squad and two fixtures, the first planned with a sub each period', () => {
    const data = addTestData([], [], squadId, format, 50, 4, now);
    expect(data.players.map((p) => p.firstName)).toEqual(TEST_NAMES);
    expect(data.matches).toHaveLength(2);
    const [soon, later] = data.matches;
    expect(Date.parse(soon.match.kickoffAt!)).toBe(now.getTime() + 30 * 60_000);
    expect(Date.parse(later.match.kickoffAt!)).toBeGreaterThan(now.getTime() + 86_400_000);
    expect(soon.plan!.periods.every((p) => p.subs.length === 1)).toBe(true);
    // A plan the app itself finds nothing wrong with.
    const projection = projectPlan(soon.plan!, format, 50, 4, data.players);
    expect(projection.problems).toEqual([]);
    expect(later.plan).toBeUndefined();
  });

  it('is additive: nobody is added twice and nothing existing is changed', () => {
    const mine = makePlayer(squadId, 'Ben');
    const once = addTestData([mine], [], squadId, format, 50, 4, now);
    expect(once.players.filter((p) => p.firstName === 'Ben')).toEqual([mine]);
    const twice = addTestData(once.players, once.matches, squadId, format, 50, 4, now);
    expect(twice.players).toHaveLength(TEST_NAMES.length);
    expect(twice.matches).toHaveLength(4);
    expect(twice.summary).toBe('Added 0 test players and 2 fixtures.');
  });
});
