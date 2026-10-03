/**
 * Picking a kick-off date and time — #62, #80.
 *
 * Pure TypeScript, deliberately separate from the screen that uses it. Logic
 * living inside a component that imports `react-native` cannot be tested in
 * Node, and this project's 300 tests run with no device precisely because that
 * line is held.
 *
 * NOT a native date picker: that is a dependency, and the proportionality
 * ruling says prefer the least machinery that satisfies the criterion.
 *
 * The typed DD/MM/YYYY fields this file used to parse are gone (#80): the
 * PO found typing a date at all the pain, so the screen now picks from chips
 * and nothing here needs to refuse half-typed input any more.
 */

/** `HH:MM`, zero-padded. */
export function toTimeInput(d: Date): string {
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The next Saturday, or today if today is one.
 *
 * Today matters: a coach adding a fixture on the morning of the match means
 * this morning, not a week away.
 */
export function nextSaturday(from: Date): Date {
  const d = new Date(from.getTime());
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return d;
}

// ---------------------------------------------------------------------------
// Pick, don't type — #80 (PO ruling 2026-10-03: option A)
// ---------------------------------------------------------------------------
//
// > *"entering fixture date pain, needs a picker or restricted dropdowns"*
//
// Chips, no dependency. The answer is nearly always one of the next few
// Saturdays, which is one tap; "Other date" reaches any day as a month then a
// day, still without a keyboard.

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Midnight local time on the same day. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The next `count` Saturdays, nearest first; today counts if it is one (AC1). */
export function upcomingSaturdays(from: Date, count = 8): Date[] {
  const first = startOfDay(nextSaturday(from));
  return Array.from(
    { length: count },
    (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + 7 * i)
  );
}

/** Kick-off times 08:00 to 14:00 in 15-minute steps (AC2). */
export const KICKOFF_TIMES: readonly string[] = Array.from({ length: 25 }, (_, i) => {
  const minutes = 8 * 60 + 15 * i;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

/** "Sat 10 Oct". */
export function dayLabel(d: Date): string {
  return `${DAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
}

/** "Oct 2026". */
export function monthLabel(year: number, month: number): string {
  return `${MONTH[month]} ${year}`;
}

/** The next `count` months as [year, month], starting with this one. */
export function upcomingMonths(from: Date, count = 6): [number, number][] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(from.getFullYear(), from.getMonth() + i, 1);
    return [d.getFullYear(), d.getMonth()] as [number, number];
  });
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** True when two dates fall on the same calendar day. */
export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/** A kick-off ISO timestamp from a picked day and an `HH:MM` time. */
export function kickoffIso(day: Date, time: string): string {
  const [h, m] = time.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0).toISOString();
}
