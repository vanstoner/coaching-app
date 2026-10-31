/**
 * The Test kit — Heart FC Beta Coach and development builds (#95 "approve 1",
 * #134 "approve 14").
 *
 * A fast clock (appClock.ts) and one-tap test data, so a whole match can be
 * played through the real screens in minutes before a beta is approved. Only
 * ever in Heart FC Beta Coach — a pull-request build, or the demo (#146) — which has
 * its own app id and its own storage (#79), so test data and fast-clock
 * matches cannot reach the real squad. Synthetic first names only.
 */

import type { Format, Player, UUID } from '../types/index';
import type { Distribution } from './distribution';
import { makePlayer } from './squad';
import { kickoffIso, nextSaturday } from './kickoff';
import { newMatch } from './matchLifecycle';
import type { SavedMatch } from './persistence';
import { addSwap, emptyPlan, periodLengthMs, setSlot, updateSwap } from './matchPlan';

/**
 * True for a pull-request build of Heart FC Beta Coach. CI bakes the build label
 * into the bundle, and only a pull-request build labels itself "(pr N)". A
 * build of main never does — including the demo (#146), a Heart FC Beta Coach built
 * from main, which `showTestKit` tells apart by its distribution instead.
 */
export function isBetaBuild(buildLabel: string): boolean {
  return /\(pr \d+\)$/.test(buildLabel.trim());
}

/**
 * Whether to show the Test kit (#134, PO ruling "approve 14"; #146): in a CI
 * pull-request beta, as before; in the demo (#146), which installs as Coaching
 * Beta but is built from main, so it carries no "(pr N)" and is known by the
 * distribution CI writes (`distribution.ts`); and in a development build
 * (`__DEV__`) — `expo start`, `expo run:ios`, `expo run:android`,
 * `npm run ios:beta` — so a local copy can add sample data. A release build of
 * Heart FC Coach never shows it. The caller passes `__DEV__` and the
 * distribution; this module reads no platform global, so it stays testable in
 * Node. Every Test-kit gate goes through this one call.
 */
export function showTestKit(buildLabel: string, isDev: boolean, distribution: Distribution): boolean {
  return isDev || isBetaBuild(buildLabel) || distribution === 'demo';
}

/**
 * Made-up first names, so nothing in a beta looks like the real squad. The
 * first ten are the 2.1.0 list, unchanged, so existing test data still reads
 * as the made-up team; four more let it field 11 with a bench (#249 K47).
 */
export const TEST_NAMES = ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kai', 'Lia', 'Mo', 'Ned'];

/**
 * The made-up names a team of `onFieldCount` takes: the first ten, as before,
 * or enough to field the team with a bench of three (#249 K48), so a 5- or
 * 7-a-side kit (and every store shot seeded from one) is unchanged.
 */
export function testNamesFor(onFieldCount: number): string[] {
  return TEST_NAMES.slice(0, Math.max(10, onFieldCount + 3));
}
export const TEST_OPPONENTS = ['Test Rovers', 'Sample Town'];

export interface TestData {
  players: Player[];
  matches: SavedMatch[];
  /** What was added, for the message on screen. */
  summary: string;
}

/**
 * Add the test squad and two fixtures. Additive and repeatable: a name
 * already in the squad is not added twice, and nothing existing is changed.
 *
 * - "Test Rovers", kicking off in 30 minutes, planned: everyone placed for
 *   every period and one sub due halfway through each, so sub reminders fire.
 * - "Sample Town", next Saturday at 10:00, unplanned.
 */
export function addTestData(
  players: Player[],
  matches: SavedMatch[],
  squadId: UUID,
  format: Format,
  totalMinutes: number,
  periodCount: number,
  now: Date
): TestData {
  const names = testNamesFor(format.onFieldCount);
  const have = new Set(players.filter((p) => p.active).map((p) => p.firstName));
  const added = names.filter((n) => !have.has(n)).map((n) => makePlayer(squadId, n));
  const squad = [...players, ...added];
  const testPlayers = squad.filter((p) => p.active && TEST_NAMES.includes(p.firstName));

  // The same builder as the fixture form and Play now (#99 AC1).
  const fixture = (opponent: string, kickoffAt: string) =>
    newMatch(
      { squadId, format, totalMinutes, periodCount, players: squad, opponent, kickoffAt },
      () => now
    ).stored;

  const soon = fixture(TEST_OPPONENTS[0], new Date(now.getTime() + 30 * 60_000).toISOString());
  const positions = [...format.positions].sort((a, b) => a.sortOrder - b.sortOrder);
  const periodMs = periodLengthMs(totalMinutes, periodCount);
  let plan = emptyPlan(periodCount);
  for (let period = 0; period < periodCount; period++) {
    // Rotate who starts, so the projection has something to balance.
    const shift = period * 2;
    positions.forEach((pos, i) => {
      const who = testPlayers[(i + shift) % testPlayers.length];
      plan = setSlot(plan, period, pos.id, who?.id ?? null);
    });
    const onPitch = new Set(positions.map((_, i) => testPlayers[(i + shift) % testPlayers.length]?.id));
    const bench = testPlayers.find((p) => !onPitch.has(p.id));
    const off = testPlayers[(positions.length - 1 + shift) % testPlayers.length];
    if (bench && off) {
      plan = addSwap(plan, period, periodMs);
      plan = updateSwap(plan, period, 0, { onId: bench.id, offId: off.id });
    }
  }
  const later = fixture(TEST_OPPONENTS[1], kickoffIso(nextSaturday(new Date(now.getTime() + 86_400_000)), '10:00'));

  return {
    players: squad,
    matches: [...matches, { ...soon, plan }, later],
    summary: `Added ${added.length} test player${added.length === 1 ? '' : 's'} and 2 fixtures.`,
  };
}

/** Where the beta's clock setting is kept (beta storage only). */
export const TEST_CLOCK_KEY = 'coaching-app/test-clock/v1';
