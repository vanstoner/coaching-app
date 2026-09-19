/**
 * Typing a kick-off date and time — #62.
 *
 * Pure TypeScript, deliberately separate from the screen that uses it. Logic
 * living inside a component that imports `react-native` cannot be tested in
 * Node, and this project's 300 tests run with no device precisely because that
 * line is held.
 *
 * NOT a native date picker: that is a dependency, and the proportionality
 * ruling says prefer the least machinery that satisfies the criterion. Two
 * plain fields plus a "next Saturday" shortcut fit a squad that plays one
 * match a week, nearly always on a Saturday morning.
 */

/** `DD/MM/YYYY`, zero-padded so the field never changes width. */
export function toDateInput(d: Date): string {
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** `HH:MM`, zero-padded. */
export function toTimeInput(d: Date): string {
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * An ISO timestamp from what was typed, or null when it is not yet a whole
 * date and time.
 *
 * Returning null for a half-typed date is the point: a coach mid-keystroke
 * must not have `03/0` quietly stored as some other day. And a date that
 * would roll over — 31 February becoming 3 March — is refused rather than
 * accepted, because a fixture landing on a day nobody picked is worse than
 * a field that will not accept it.
 */
export function toIso(date: string, time: string): string | null {
  const dm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date.trim());
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!dm || !tm) return null;

  const [, dd, mm, yyyy] = dm;
  const [, hh, min] = tm;
  if (Number(hh) > 23 || Number(min) > 59) return null;

  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getDate() !== Number(dd) || d.getMonth() !== Number(mm) - 1) return null;
  return d.toISOString();
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
