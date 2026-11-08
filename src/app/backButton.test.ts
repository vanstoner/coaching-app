/**
 * #175: Android Back on every step (Rob, "Approve 1-8": Squad and Settings go
 * to Home; Back on Home leaves the app).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { backFrom, type Step } from './tabs';

const ALL: Step[] = ['loading', 'resume', 'fixtures', 'fixtureForm', 'plan', 'summary', 'analysis', 'settings', 'squad', 'lineup', 'playing', 'record', 'seasonStart', 'seasonPast', 'coming', 'teamSheet'];

describe('Android Back (#175)', () => {
  it('has an answer for every step (C9)', () => {
    for (const step of ALL) expect(['leave-app', 'home', 'screen', 'own']).toContain(backFrom(step));
  });

  it('Home leaves the app; the tabs go Home; forms that ask listen themselves (C1, C3, C7)', () => {
    expect(backFrom('fixtures')).toBe('leave-app');
    expect(backFrom('squad')).toBe('home');
    expect(backFrom('settings')).toBe('home');
    expect(backFrom('fixtureForm')).toBe('own');
    expect(backFrom('seasonStart')).toBe('own');
  });

  it('every other screen does its own way out: the Plan, Team sheet, Who\'s coming, the clock, the Lineup, the report (C1, C2, C4)', () => {
    for (const step of ['plan', 'teamSheet', 'coming', 'playing', 'lineup', 'summary', 'analysis', 'record', 'seasonPast', 'resume'] as Step[]) {
      expect(backFrom(step)).toBe('screen');
    }
  });

  it('one listener in App, which only calls a screen\'s own exit or goes Home (C2, C6, C8)', () => {
    const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
    expect(app.match(/BackHandler\.addEventListener\('hardwareBackPress'/g)).toHaveLength(1);
    // #266 C11: leaving the Lineup or the clock says if picks were dropped, then leaves as before.
    expect(app).toContain('onLeave={exit(leaveWithPicks)}');
    expect(app).toContain('onBack={exit(() => setStep(planReturn))}');
    const handler = app.slice(app.indexOf("BackHandler.addEventListener('hardwareBackPress'"), app.indexOf("BackHandler.addEventListener('hardwareBackPress'") + 500);
    expect(handler).not.toMatch(/endQuarter|completeMatch|persist\(|commitLedger/);
  });
});
