/**
 * #228 item 5: the Test kit's Clock speed goes (criteria 7–12; Q4 approved as
 * recommended, 23 Oct). The screens cannot render in Node, so criteria 7–9
 * and 11 are source checks; criterion 10 is tested on the clock itself.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NORMAL_CLOCK,
  parseClockSetting,
  settleAtNormalSpeed,
  virtualNowMs,
  withSpeed,
  type ClockSetting,
} from './appClock';

const root = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8');
const T = 1_800_000_000_000;
const MIN = 60_000;

describe('Settings › Test kit has no clock speed (#228 AC7, source check)', () => {
  const kit = read('src', 'screens', 'TestKitSection.tsx');
  it('no "Clock speed" heading, no ×1/×5/×10 chips, no "At ×10" hint', () => {
    expect(kit).not.toMatch(/>\s*Clock speed\s*</);
    expect(kit).not.toMatch(/CLOCK_SPEEDS|<Chip\b/);
    expect(kit).not.toMatch(/At ×10/);
  });
  it('App.tsx no longer sets the app clock’s speed', () => {
    const app = read('App.tsx');
    expect(app).not.toMatch(/setAppClockSpeed/);
    expect(app).not.toMatch(/<TestKitSection[^>]*speed=/);
  });
});

describe('the rest of the Test kit is unchanged (#228 AC8, source check)', () => {
  it('still offers the test squad, a past season and time signing, only where showTestKit says', () => {
    const kit = read('src', 'screens', 'TestKitSection.tsx');
    for (const label of ['Add test squad and fixtures', 'Add a past season', 'Time signing on this phone']) {
      expect(kit).toContain(label);
    }
    expect(read('App.tsx')).toMatch(/testKitOn \? \(\s*<TestKitSection/);
  });
});

describe('a test match keeps its own ×1/×5/×10 (#228 AC9, source check)', () => {
  it('the hint and the banner still offer the speeds', () => {
    const tm = read('src', 'screens', 'TestMatchesSection.tsx');
    expect(tm).toContain('at ×1, ×5 or ×10');
    expect(tm).toContain('Test match · not recorded');
    expect(tm).toMatch(/CLOCK_SPEEDS\.map/);
  });
});

describe('a beta phone left fast runs at ×1, and never goes backwards (#228 AC10, Q4)', () => {
  it('folds a ×10 clock to ×1 keeping the time already gained', () => {
    const fast: ClockSetting = withSpeed(NORMAL_CLOCK, 10, T);
    const launch = T + 6 * MIN; // an hour of virtual time gained
    const before = virtualNowMs(fast, launch);
    const settled = settleAtNormalSpeed(fast, launch);
    expect(settled.speed).toBe(1);
    expect(virtualNowMs(settled, launch)).toBe(before); // no jump, never backwards
    expect(virtualNowMs(settled, launch + MIN)).toBe(before + MIN); // ×1 from now
    expect(settled.offsetMs).toBe(before - launch);
  });

  it('a ×5 clock too; a ×1 clock is left exactly as it was', () => {
    const five = withSpeed(NORMAL_CLOCK, 5, T);
    expect(settleAtNormalSpeed(five, T + MIN).speed).toBe(1);
    const one = withSpeed(withSpeed(NORMAL_CLOCK, 10, T), 1, T + MIN);
    expect(settleAtNormalSpeed(one, T + 2 * MIN)).toBe(one);
    expect(settleAtNormalSpeed(NORMAL_CLOCK, T)).toBe(NORMAL_CLOCK);
  });

  it('adoptStoredClock puts the settled clock in force and says whether to store it', async () => {
    const { adoptStoredClock, appClockSetting, setAppClock } = await import('./appClock');
    const r = adoptStoredClock(withSpeed(NORMAL_CLOCK, 10, Date.now() - MIN));
    expect(r.changed).toBe(true);
    expect(appClockSetting()).toBe(r.setting);
    expect(r.setting.speed).toBe(1);
    expect(r.setting.offsetMs).toBeGreaterThanOrEqual(9 * MIN);
    expect(adoptStoredClock(r.setting).changed).toBe(false);
    setAppClock(NORMAL_CLOCK);
  });

  it('the settled clock survives the store and a later relaunch unchanged', () => {
    const settled = settleAtNormalSpeed(withSpeed(NORMAL_CLOCK, 10, T), T + MIN);
    const again = parseClockSetting(JSON.stringify(settled));
    expect(again).toEqual(settled);
    expect(settleAtNormalSpeed(again, T + 99 * MIN)).toBe(again);
  });

  it('App.tsx settles the stored clock at launch, before anything reads the time (source check)', () => {
    const app = read('App.tsx');
    const at = app.indexOf('adoptStoredClock(parseClockSetting(');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(app.indexOf('await installDeviceSigner()'));
  });
});

describe('the docs follow (#228 AC11, AC12)', () => {
  it('README no longer promises the Test kit a faster clock', () => {
    expect(read('README.md')).not.toMatch(/faster clock/);
  });
  it('the spec row and architecture lines describe the clock as it is', () => {
    const spec = read('docs', 'feature-specs.md');
    const row = spec.split('\n').find((l) => l.startsWith('| Test kit |'))!;
    expect(row).not.toMatch(/Clock speed ×1\/×5\/×10/);
    const arch = read('docs', 'system-architecture.md');
    expect(arch).not.toMatch(/sped up by the Test kit/);
    expect(arch).not.toMatch(/Beta clock offset and speed/);
  });
  // Replaced in 2.2.0 (#249): whats_new.txt now holds only the version's own
  // notes, because Google Play takes at most 500 characters and a version bump
  // must fit (#232 Part 1, play_api.py notes-check --require). The 10x claim
  // lives on in the store description.
  it('the store listing still says test matches run at up to ten times speed', () => {
    expect(read('store', 'app-store', 'en-GB', 'description.txt')).toContain('at up to ten times speed');
    expect(read('store', 'app-store', 'en-GB', 'whats_new.txt')).not.toMatch(/\b(5|8)x\b/);
  });
});
