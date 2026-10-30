/**
 * "Why the difference: <name>" — #261 item 2, AC10 to AC12.
 *
 * A read-only sheet: Close at the top left, no Save; a tap outside or Android
 * Back closes it. Every line comes from `whyDifference`, folded from the same
 * views the list beside it draws (invariant 1). Neutral text throughout:
 * colour never marks a shortfall (AC7).
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';

import type { UUID } from '../types/index';
import { NOT_IN_SHARE_SHORT } from '../app/fairShare';
import type { SquadViews } from '../app/squadViews';
import { minSec, signedMinSec, whyDifference } from '../app/whyDifference';
import { FormSheet, GroupLabel, RowNav } from './controls';
import { AboutFiguresScreen } from './FiguresHelp';
import { colours } from './theme';

export function WhySheet({
  views,
  playerId,
  onClose,
  onChildPage,
}: {
  views: SquadViews;
  /** Null: closed. */
  playerId: UUID | null;
  onClose: () => void;
  /** The child's own page, which the row used to open: still one tap away. */
  onChildPage?: (playerId: UUID) => void;
}) {
  const [about, setAbout] = useState(false);
  const why = playerId === null ? null : whyDifference(views, playerId);
  return (
    <>
      <FormSheet
        visible={why !== null && !about}
        title={why ? `Why the difference: ${why.name}` : ''}
        onCancel={onClose}
        cancelLabel="Close"
      >
        {why && (
          <>
            <Text style={local.headline} accessibilityRole="summary">
              {why.headline}
            </Text>
            {why.sum !== null && <Text style={local.sum}>{why.sum}</Text>}

            {why.matches.length > 0 && (
              <>
                <GroupLabel>Match by match</GroupLabel>
                <View style={local.head}>
                  <Text style={[local.headText, local.what]}>Match</Text>
                  <Text style={[local.headText, local.fig]}>Played</Text>
                  <Text style={[local.headText, local.fig]}>Share</Text>
                  <Text style={[local.headText, local.fig]}>vs share</Text>
                </View>
                {why.matches.map((m) => {
                  const vs =
                    m.diffMs !== null ? signedMinSec(m.diffMs) : m.notInShare ? NOT_IN_SHARE_SHORT[m.notInShare] : '—';
                  const share = m.shareMs === null ? '—' : minSec(m.shareMs);
                  return (
                    <View
                      key={m.matchId}
                      style={local.row}
                      accessible
                      accessibilityLabel={`${m.label}${m.late ? ', arrived after kick-off' : ''}: played ${minSec(m.minutesMs)}, fair share ${share}, ${vs} against the share`}
                    >
                      <View style={local.what}>
                        <Text style={local.label} numberOfLines={1}>
                          {m.label}
                        </Text>
                        {m.late && <Text style={local.note}>Arrived after kick-off</Text>}
                      </View>
                      <Text style={local.fig}>{minSec(m.minutesMs)}</Text>
                      <Text style={local.fig}>{share}</Text>
                      <Text style={local.fig}>{vs}</Text>
                    </View>
                  );
                })}
                <Text style={local.note}>
                  Each match&apos;s fair share is the match report&apos;s. The season figure is against the squad
                  average, so the two need not add up.
                </Text>
              </>
            )}

            {why.notCounted.length > 0 && (
              <>
                <GroupLabel>Not counted</GroupLabel>
                {why.notCounted.map((n) => (
                  <View key={n.matchId} style={local.row} accessible accessibilityLabel={`${n.label}: ${n.reason}`}>
                    <Text style={[local.label, local.what]} numberOfLines={1}>
                      {n.label}
                    </Text>
                    <Text style={local.reason}>{n.reason}</Text>
                  </View>
                ))}
              </>
            )}

            <View style={local.links}>
              <RowNav first label="How the figures are worked out" onPress={() => setAbout(true)} />
              {onChildPage && playerId !== null && (
                <RowNav label={`${why.name}'s page`} onPress={() => onChildPage(playerId)} />
              )}
            </View>
          </>
        )}
      </FormSheet>
      <AboutFiguresScreen visible={about} onBack={() => setAbout(false)} backLabel={why ? `Why the difference` : 'Back'} />
    </>
  );
}

const local = StyleSheet.create({
  headline: {
    color: colours.ink,
    fontSize: 18,
    fontWeight: '600',
    includeFontPadding: false,
    marginTop: 6,
  },
  sum: {
    color: colours.inkMuted,
    fontSize: 14,
    lineHeight: 20,
    includeFontPadding: false,
    marginTop: 6,
  },
  head: { flexDirection: 'row', alignItems: 'flex-end', paddingBottom: 4 },
  headText: {
    color: colours.inkFaint,
    fontSize: 12,
    includeFontPadding: false,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colours.hair,
  },
  what: { flex: 1, minWidth: 0, paddingRight: 6 },
  label: { color: colours.ink, fontSize: 14, includeFontPadding: false },
  fig: {
    width: 58,
    textAlign: 'right',
    color: colours.ink,
    fontSize: 14,
    includeFontPadding: false,
  },
  note: {
    color: colours.inkMuted,
    fontSize: 12,
    includeFontPadding: false,
    marginTop: 4,
  },
  reason: {
    flexShrink: 0,
    maxWidth: '50%',
    color: colours.inkMuted,
    fontSize: 13,
    includeFontPadding: false,
  },
  links: { marginTop: 14 },
});
