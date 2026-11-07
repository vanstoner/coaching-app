/**
 * Who's coming — #277 A2–A4 (Dee's prototype, 1 Nov).
 *
 * One row per child in the active squad. A tap moves them Coming → Can't →
 * Not heard → Coming and saves at once, with ✓ Saved on the top bar (#264).
 * The list can be reopened all week; the line under the title says when it
 * last changed. It is planning, never the record (invariant 1): on match
 * day Here today starts from it and the coach confirms it there.
 */

import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import type { AvailabilityStatus, Player, UUID } from '../types/index';
import { displayName } from '../app/squad';
import { changedLabel, comingRows, comingSummary, nextComing, setComing, type Coming } from '../app/whosComing';
import { BackLink, MainButton, MainFoot, SavedTick, TopBar, useSavedTick } from './controls';
import { rows } from './controls/Rows';
import { colours, screen } from './theme';

const WORD: Record<Coming, string> = { coming: 'Coming', cant: "Can't", notHeard: 'Not heard' };

export function WhosComingScreen({
  title,
  players,
  availability,
  changedAt,
  onChange,
  onBack,
  onNext,
}: {
  /** "Heart FC v Rovers". */
  title: string;
  players: Player[];
  availability: [UUID, AvailabilityStatus][] | undefined;
  /** When the list last changed, or null if never. */
  changedAt: number | null;
  onChange: (next: [UUID, AvailabilityStatus][]) => void;
  onBack: () => void;
  /** The next step, the team sheet (Rob, 6 Nov). */
  onNext: () => void;
}) {
  const tick = useSavedTick();
  const list = comingRows(availability, players);
  return (
    <View style={screen.flex}>
      <ScrollView contentContainerStyle={screen.scroll}>
        <TopBar
          back={<BackLink label="Done" accessibilityLabel="Done" onPress={onBack} />}
          title="Who's coming"
          right={<SavedTick visible={tick.visible} />}
        />
        <Text style={screen.caption} numberOfLines={1}>
          {title}
        </Text>
        <Text style={local.summary}>{comingSummary(list)}</Text>
        <Text style={screen.hint}>
          Tap a name to change it. Change it as often as you like before kick-off
          {changedAt === null ? '.' : `: ${changedLabel(changedAt)}.`}
        </Text>
        {list.map(({ player, coming }, i) => (
          <Pressable
            key={player.id}
            accessibilityRole="button"
            accessibilityLabel={`${displayName(player)}, ${WORD[coming]}. Tap to change.`}
            onPress={() => {
              onChange(setComing(availability, players, player.id, nextComing(coming)));
              tick.mark();
            }}
            style={({ pressed }) => [rows.row, i === 0 && rows.first, pressed && rows.pressed]}
          >
            <View style={rows.labelCol}>
              <Text style={[rows.label, coming !== 'coming' && local.away]} numberOfLines={1}>
                {displayName(player)}
              </Text>
            </View>
            <Text style={[local.state, coming === 'cant' && local.cant, coming === 'notHeard' && local.notHeard]}>
              {WORD[coming]}
            </Text>
          </Pressable>
        ))}
        <Text style={screen.hint}>On match day, Here today starts from this list.</Text>
      </ScrollView>
      <MainFoot>
        <MainButton label="Next: team sheet" onPress={onNext} />
      </MainFoot>
    </View>
  );
}

const local = StyleSheet.create({
  summary: { color: colours.ink, fontSize: 16, includeFontPadding: false, marginTop: 6 },
  away: { color: colours.inkMuted },
  // Neutral colours only: none of these is a warning (#261 AC7).
  state: { color: colours.saved, fontSize: 15, fontWeight: '600', includeFontPadding: false, flexShrink: 0 },
  cant: { color: colours.inkMuted },
  notHeard: { color: colours.inkFaint },
});
