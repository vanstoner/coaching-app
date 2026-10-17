/**
 * A played match from the minutes record, with no fixture on this phone —
 * #195 AC1. Read-only: everything is folded from the record on each render
 * (`recordMatchPage`), and nothing here can change it.
 *
 * Full screen with an explicit Back, like the match report. Invariant 3: the
 * figure is total pitch time, goal plus outfield; "in goal" is its breakdown.
 */

import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { competitionLabel, whenLabel } from '../app/fixtures';
import { formatClock } from '../app/matchClock';
import { scoreLabel, type RecordMatchPage } from '../app/recordOnly';
import { colours, screen } from './theme';

export function RecordMatchScreen({ page, now, onBack }: { page: RecordMatchPage; now: Date; onBack: () => void }) {
  const { match } = page;
  const competition = competitionLabel(match.competition);
  return (
    <View style={screen.flex}>
      <ScrollView contentContainerStyle={screen.scroll}>
        <Pressable onPress={onBack} style={screen.linkHit}>
          <Text style={screen.link}>Back</Text>
        </Pressable>
        <Text style={screen.title} numberOfLines={1}>
          {(match.opponent ?? '').trim() || 'Opponent not recorded'}
        </Text>
        <Text style={screen.caption} numberOfLines={1}>
          {whenLabel(match.kickoffAt ? new Date(match.kickoffAt) : null, now)}
          {competition === '' ? '' : ` · ${competition}`}
        </Text>
        <Text style={match.score ? local.score : screen.caption}>{scoreLabel(match.score)}</Text>
        <Text style={local.reconstructed}>
          ◐ Reconstructed: this match is in the minutes record but was not played on this phone, so its
          times may be approximate.
        </Text>
        {match.leftOut !== null && (
          <Text style={screen.hint}>
            Left out of the figures{match.leftOut ? `: "${match.leftOut}"` : ''}
          </Text>
        )}

        <Text style={screen.fieldLabel}>Goals</Text>
        {page.goals.length === 0 && page.conceded === 0 ? (
          <Text style={local.lineFaint}>No goals in the record for this match.</Text>
        ) : (
          <>
            {page.goals.map((g, i) => (
              <Text key={i} style={local.line} numberOfLines={1}>
                {g.name} · {periodName(match.periodCount)} {g.period}
              </Text>
            ))}
            {page.conceded > 0 && (
              <Text style={local.lineFaint} numberOfLines={1}>
                {page.conceded} conceded
              </Text>
            )}
          </>
        )}

        <Text style={screen.fieldLabel}>Minutes on the pitch</Text>
        {page.minutes.map((m) => (
          <View key={m.playerId} style={local.row}>
            <Text style={local.name} numberOfLines={1}>
              {m.name}
            </Text>
            <Text style={local.figure} numberOfLines={1}>
              {formatClock(m.totalMs)}
            </Text>
            <Text style={[local.goal, m.goalMs === 0 && local.faint]} numberOfLines={1}>
              {m.goalMs > 0 ? `GK ${formatClock(m.goalMs)}` : ''}
            </Text>
          </View>
        ))}

        <Pressable onPress={onBack} style={screen.linkHit}>
          <Text style={screen.link}>Back</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const periodName = (count: number) => (count === 2 ? 'half' : 'Q');

const local = StyleSheet.create({
  score: {
    alignSelf: 'stretch',
    textAlign: 'center',
    color: colours.ink,
    fontSize: 34,
    fontWeight: '700',
    includeFontPadding: false,
    marginTop: 4,
  },
  reconstructed: {
    alignSelf: 'stretch',
    textAlign: 'center',
    color: colours.taint,
    fontSize: 13,
    includeFontPadding: false,
    marginTop: 8,
  },
  line: { alignSelf: 'stretch', color: colours.ink, fontSize: 15, includeFontPadding: false, marginTop: 4 },
  lineFaint: { alignSelf: 'stretch', color: colours.inkMuted, fontSize: 14, includeFontPadding: false, marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#164f3c',
  },
  name: { flex: 1, minWidth: 0, color: colours.ink, fontSize: 15, includeFontPadding: false },
  // Fixed widths and no shrink: a time beside a flex sibling loses its tail.
  figure: { width: 64, flexShrink: 0, textAlign: 'right', color: colours.ink, fontSize: 15, includeFontPadding: false },
  goal: { width: 84, flexShrink: 0, textAlign: 'right', color: colours.inkMuted, fontSize: 13, includeFontPadding: false },
  faint: { color: colours.inkFaint },
});
