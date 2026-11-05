/**
 * Play now: which match? — #278 (Rob, 1 Nov: "it just lets you go to a
 * particular upcoming fixture (date order)").
 *
 * The Coming up fixtures, soonest first, each with its date and Who's coming
 * summary (#277 A1). A tap opens that fixture, as its card does. There is no
 * ad-hoc match: with nothing coming up, + Fixture is the Main button.
 */

import { ScrollView, View } from 'react-native';
import { Text } from './Text';
import type { Match, UUID } from '../types/index';
import {
  fixtureList,
  inBucket,
  kickoffLabel,
  opponentLabel,
  type MatchProgress,
  type StartedPeriod,
} from '../app/fixtures';
import { BackLink, MainButton, MainFoot, RowNav, TopBar } from './controls';
import { screen } from './theme';

export const NOTHING_COMING_UP = 'Nothing coming up';

export function WhichMatchScreen({
  matches,
  now,
  progress,
  periods,
  coming,
  onOpen,
  onAdd,
  onBack,
}: {
  matches: Match[];
  now: Date;
  progress: ReadonlyMap<UUID, MatchProgress>;
  periods: ReadonlyMap<UUID, readonly StartedPeriod[]>;
  coming: ReadonlyMap<UUID, string>;
  onOpen: (matchId: UUID) => void;
  onAdd: () => void;
  onBack: () => void;
}) {
  const future = inBucket(fixtureList(matches, now, null, progress), 'future');
  return (
    <View style={screen.flex}>
      <ScrollView contentContainerStyle={screen.scroll}>
        <TopBar back={<BackLink label="Back" onPress={onBack} />} title="Which match?" />
        {future.length === 0 ? (
          <Text style={screen.caption}>{NOTHING_COMING_UP}</Text>
        ) : (
          future.map(({ match }, i) => (
            <RowNav
              key={match.id}
              first={i === 0}
              label={opponentLabel(match)}
              value={kickoffLabel(match, now, periods.get(match.id))}
              detail={coming.get(match.id)}
              onPress={() => onOpen(match.id)}
            />
          ))
        )}
      </ScrollView>
      {future.length === 0 && (
        <MainFoot>
          <MainButton label="+ Fixture" onPress={onAdd} />
        </MainFoot>
      )}
    </View>
  );
}
