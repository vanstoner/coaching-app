/**
 * The one clock the app reads time from — #95.
 *
 * Real time plus an offset. In Heart FC Coach the offset is always zero and
 * this is the device clock. In Heart FC Beta Coach the Test kit can run it ×5 or
 * ×10, so a 50-minute match can be played through the real screens in five
 * minutes.
 *
 * Invariant 2 holds at any speed. Nothing is counted: the time is computed
 * from the device clock every time it is read, and the engine's anchors
 * are readings of THIS clock, so every elapsed figure stays exact. The clock
 * never goes backwards: the offset only grows (speed is never below 1), and
 * a speed change folds the time gained so far into the offset.
 *
 * This file is the only place in the app that reads the device clock for
 * match time; a test fails if a screen or App.tsx reads it directly, because
 * two clocks disagreeing is how the Undo window and the sub reminders would
 * drift apart in fast mode.
 */

export const CLOCK_SPEEDS = [1, 5, 10] as const;
export type ClockSpeed = (typeof CLOCK_SPEEDS)[number];

export interface ClockSetting {
  /** Time gained over the device clock before `sinceRealMs`. Never negative. */
  offsetMs: number;
  speed: ClockSpeed;
  /** The device time the current speed took effect. */
  sinceRealMs: number;
}

export const NORMAL_CLOCK: ClockSetting = { offsetMs: 0, speed: 1, sinceRealMs: 0 };

/** The app's time at device time `realMs`. */
export function virtualNowMs(setting: ClockSetting, realMs: number): number {
  const running = Math.max(0, realMs - setting.sinceRealMs) * (setting.speed - 1);
  return realMs + setting.offsetMs + running;
}

/** The same clock from `realMs` on, at a new speed. Continuous: no jump at the change. */
export function withSpeed(setting: ClockSetting, speed: ClockSpeed, realMs: number): ClockSetting {
  return { offsetMs: virtualNowMs(setting, realMs) - realMs, speed, sinceRealMs: realMs };
}

/** A stored setting, or the normal clock for anything that is not one. */
export function parseClockSetting(raw: string | null): ClockSetting {
  try {
    const v = JSON.parse(raw ?? 'null');
    if (
      v &&
      Number.isFinite(v.offsetMs) &&
      v.offsetMs >= 0 &&
      Number.isFinite(v.sinceRealMs) &&
      (CLOCK_SPEEDS as readonly number[]).includes(v.speed)
    ) {
      return { offsetMs: v.offsetMs, speed: v.speed, sinceRealMs: v.sinceRealMs };
    }
  } catch {
    // fall through
  }
  return NORMAL_CLOCK;
}

// --- the app's instance ------------------------------------------------------

let current: ClockSetting = NORMAL_CLOCK;

/** Now, by the app's clock. Use this, never `new Date()` or `Date.now()`, for match time. */
export function appNow(): Date {
  return new Date(virtualNowMs(current, Date.now()));
}

export function appClockSetting(): ClockSetting {
  return current;
}

export function setAppClock(setting: ClockSetting): void {
  current = setting;
}

/** Change the speed from now. Returns the new setting, for the caller to store. */
export function setAppClockSpeed(speed: ClockSpeed): ClockSetting {
  current = withSpeed(current, speed, Date.now());
  return current;
}
