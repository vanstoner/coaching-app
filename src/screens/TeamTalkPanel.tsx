/**
 * #283: the team talk panel on the Lineup between periods (Dee's prototype,
 * Rob 7 Nov). It counts down to the next period, then shows how long it is
 * overdue. What it paints is worked out from the anchor each time; the
 * interval only asks for a repaint (invariant 2). It never starts the clock.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, Vibration, View } from 'react-native';
import { Text } from './Text';
import type { TeamTalk } from '../app/teamTalk';
import { colours } from './theme';

const TALK_BUZZ = [0, 300, 120, 300];
/** One buzz per break, kept across remounts (a break is its previous period's end). */
const buzzed = new Set<number>();

const mmss = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const clock = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Repaints every half second while a break is on. */
export function useTalkTick(on: boolean): void {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => set((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [on]);
}

export function TeamTalkPanel({
  talk,
  nowMs,
  label,
  buzz,
  clockTimes = true,
}: {
  talk: TeamTalk;
  nowMs: number;
  label: string;
  buzz: boolean;
  /** Rob, 7 Nov: a test match's sped-up clock reads as a wrong time of day, so it shows durations only. */
  clockTimes?: boolean;
}) {
  const left = talk.dueAtMs - nowMs;
  const due = left <= 0;
  const late = -left;
  // C11: at most once per break, only while the app is open; on return during
  // the same break it buzzes once if it was missed.
  useEffect(() => {
    if (due && buzz && !buzzed.has(talk.endedAtMs)) {
      buzzed.add(talk.endedAtMs);
      Vibration.vibrate(TALK_BUZZ);
    }
  }, [due, buzz, talk.endedAtMs]);
  const pct = Math.min(100, Math.max(0, (100 * (nowMs - talk.endedAtMs)) / talk.lengthMs));
  return (
    <View style={[local.panel, due && local.due]} accessibilityLiveRegion="polite">
      <Text style={local.kicker}>{due ? `${label} is due` : 'Team talk'}</Text>
      <Text style={[local.count, due && local.countDue]}>{due ? (late < 1000 ? '0:00' : `+${mmss(late)}`) : mmss(left)}</Text>
      {!due && (
        <View style={local.track}>
          <View style={[local.fill, { width: `${pct}%` }]} />
        </View>
      )}
      <Text style={local.hint}>
        {due
          ? late < 5000
            ? 'Buzz'
            : clockTimes
              ? `Due at ${clock(talk.dueAtMs)}, ${mmss(late)} ago`
              : `Due ${mmss(late)} ago`
          : clockTimes
            ? `${label} due at ${clock(talk.dueAtMs)}`
            : `${label} due in ${mmss(left)}`}
      </Text>
    </View>
  );
}

export { clock as talkClock, mmss as talkMmss };

const local = StyleSheet.create({
  panel: {
    alignSelf: 'stretch',
    alignItems: 'center',
    backgroundColor: colours.pitchRaised,
    borderWidth: 2,
    borderColor: colours.line,
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginVertical: 4,
  },
  due: { borderColor: colours.urgent, backgroundColor: '#2b2a12' },
  kicker: { color: colours.inkMuted, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', includeFontPadding: false },
  count: {
    alignSelf: 'stretch',
    textAlign: 'center',
    color: colours.ink,
    fontSize: 36,
    fontWeight: '300',
    letterSpacing: 2,
    includeFontPadding: false,
    flexShrink: 0,
    fontVariant: ['tabular-nums'],
  },
  countDue: { color: colours.warn },
  track: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: colours.pitch, marginTop: 8, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colours.edge },
  hint: { color: colours.inkMuted, fontSize: 14, marginTop: 4, includeFontPadding: false },
});
