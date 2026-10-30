/**
 * Saving, as a coach sees it — #264 V28 to V32 (Bea's criteria, approved by
 * Rob 29 Oct). Pure: the controls in `src/screens/controls/` draw from here.
 *
 * Two patterns, chosen by place:
 *
 * - **A Setting** saves on the tap, as it always has, and then shows
 *   "✓ Saved" on the heading of the section that holds it for two seconds.
 *   Another change restarts the two seconds.
 * - **A Form** (something new, or anything carrying a note) says "Nothing to
 *   save yet" until the first change, then "Not saved yet", and writes once,
 *   on Save. Leaving a changed form asks first.
 *
 * Everything here is view state (#264 C2): a dirty flag, a draft and a tick
 * live in a component, never in the record, and nothing derived is stored
 * (invariant 1).
 */

/** How long ✓ Saved shows after a setting saves (V28). */
export const SAVED_TICK_MS = 2_000;

/**
 * Whether ✓ Saved shows now, given when the last save completed. The time
 * comes from the wall clock on every repaint, never from counting ticks
 * (invariant 2's habit, though nothing here is authoritative).
 */
export function savedTickVisible(savedAt: number | null, now: number): boolean {
  return savedAt !== null && now >= savedAt && now - savedAt < SAVED_TICK_MS;
}

/** How long until the tick should go, for the one timer that repaints it. */
export function savedTickRemainingMs(savedAt: number | null, now: number): number {
  if (!savedTickVisible(savedAt, now)) return 0;
  return SAVED_TICK_MS - (now - (savedAt as number));
}

// ---------------------------------------------------------------------------
// A form (V29, V30)
// ---------------------------------------------------------------------------

export type FormPhase = 'pristine' | 'dirty' | 'saved';

export type FormAction = { type: 'change' } | { type: 'save' } | { type: 'reset' };

/**
 * pristine → dirty on the first change; dirty → saved on Save; a change after
 * a save makes it dirty again. Reset puts it back to pristine (a form opened
 * afresh).
 */
export function formReducer(phase: FormPhase, action: FormAction): FormPhase {
  switch (action.type) {
    case 'change':
      return 'dirty';
    case 'save':
      return phase === 'dirty' ? 'saved' : phase;
    case 'reset':
      return 'pristine';
  }
}

/** The status line above a form's Save (V29). */
export function formStatusText(phase: FormPhase): string {
  return phase === 'dirty' ? 'Not saved yet' : phase === 'saved' ? 'Saved' : 'Nothing to save yet';
}

/** Save is offered once something changed and the required fields are valid (V29). */
export function canSaveForm(phase: FormPhase, valid: boolean): boolean {
  return phase === 'dirty' && valid;
}

/** Leaving a changed form asks first; an unchanged one leaves at once (V30). */
export function leaveNeedsAsking(phase: FormPhase): boolean {
  return phase === 'dirty';
}

/** "Leave without saving this fixture?" (V30). */
export function leaveQuestion(thing: string): string {
  return `Leave without saving this ${thing}?`;
}

// ---------------------------------------------------------------------------
// A sheet (V32; the Pitch and referee fix, C3)
// ---------------------------------------------------------------------------

/** Every way a sheet can close. */
export type SheetClose = 'save' | 'cancel' | 'outside' | 'back';

/**
 * What a sheet writes when it closes: its draft on Save, and nothing on any
 * other way out. A tap outside, Cancel or Android Back never commits (V32,
 * `Sheet.tsx`'s own contract), which the Pitch and referee sheet broke (C3).
 */
export function sheetCommit<T>(how: SheetClose, draft: T): T | null {
  return how === 'save' ? draft : null;
}
