/**
 * #176: what the recovery screen says and offers, as pure data, and the beta
 * Test kit's switch that makes the next screen fail so QA can see it on a
 * phone (criterion 11). No React here; RecoveryBoundary draws it.
 */

export type RecoveryWhere = 'team' | 'test' | 'shell';

export interface RecoveryCopy {
  title: string;
  lines: string[];
  /** The Main button's label: what Back does too (#175). */
  main: string;
  /** Export minutes file is offered only when a record is loaded (never shown disabled). */
  offerExport: boolean;
}

export const RECOVERY_TITLE = 'Something went wrong';

export function recoveryCopy(where: RecoveryWhere, hasRecord: boolean): RecoveryCopy {
  if (where === 'shell') {
    return {
      title: RECOVERY_TITLE,
      lines: ['Your teams, minutes and matches are safe on this phone.'],
      main: 'Try again',
      offerExport: false,
    };
  }
  return {
    title: RECOVERY_TITLE,
    lines: [
      'Your minutes and matches are safe on this phone. Nothing has been changed or deleted.',
      'A match you were holding is still there: Home offers Resume as before.',
    ],
    main: where === 'test' ? 'Go to Settings' : 'Go to Home',
    offerExport: hasRecord,
  };
}

let armed = false;

/** Test kit (beta builds only): the next screen drawn throws once. */
export function armRecoveryTest(): void {
  armed = true;
}

/** True once after `armRecoveryTest`, then false again. */
export function takeRecoveryTest(): boolean {
  const was = armed;
  armed = false;
  return was;
}
