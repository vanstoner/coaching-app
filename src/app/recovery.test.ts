/**
 * #176: the recovery screen's words and offers, and the Test kit's switch.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { armRecoveryTest, recoveryCopy, takeRecoveryTest } from './recovery';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('Something went wrong (#176)', () => {
  it('in a team: the safe-data lines, Go to Home, and Export only with a record (C2, C5)', () => {
    const c = recoveryCopy('team', true);
    expect(c.title).toBe('Something went wrong');
    expect(c.lines).toEqual([
      'Your minutes and matches are safe on this phone. Nothing has been changed or deleted.',
      'A match you were holding is still there: Home offers Resume as before.',
    ]);
    expect(c.main).toBe('Go to Home');
    expect(c.offerExport).toBe(true);
    expect(recoveryCopy('team', false).offerExport).toBe(false);
  });

  it('a test match goes to Settings (C8); the shell offers Try again and no Export (C9)', () => {
    expect(recoveryCopy('test', true).main).toBe('Go to Settings');
    const shell = recoveryCopy('shell', true);
    expect(shell.main).toBe('Try again');
    expect(shell.offerExport).toBe(false);
    expect(shell.lines).toEqual(['Your teams, minutes and matches are safe on this phone.']);
  });

  it('the Test kit makes the next screen fail once, then never again (C11)', () => {
    expect(takeRecoveryTest()).toBe(false);
    armRecoveryTest();
    expect(takeRecoveryTest()).toBe(true);
    expect(takeRecoveryTest()).toBe(false);
  });

  it('the boundary shows no error text and writes nothing; it wraps every team screen and the shell (C3, C6, C9)', () => {
    const boundary = read('../screens/RecoveryBoundary.tsx');
    expect(boundary).toContain('static getDerivedStateFromError(): { failed: boolean }');
    expect(boundary).not.toMatch(/componentDidCatch|error\.message|\.stack|setItem|persist|fetch\(/);
    const app = read('../../App.tsx');
    expect(app).toMatch(/<RecoveryBoundary\s+key=\{effectiveStep\}\s+where=\{heldTest \? 'test' : 'team'\}/);
    expect(app).toMatch(/<RecoveryProbe \/>\s*\{body\}/);
    expect(app).toMatch(/<RecoveryBoundary key=\{shellTry\} where="shell"/);
    expect(read('../screens/TestKitSection.tsx')).toContain('label="Make the next screen fail" onPress={armRecoveryTest}');
  });
});
