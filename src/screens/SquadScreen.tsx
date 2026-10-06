/**
 * The squad — REQ-09 (#9).
 *
 * First names only, enforced in `src/app/squad.ts` at entry (invariant 4).
 * Nothing leaves the phone (ADR-011).
 *
 * ---------------------------------------------------------------------------
 * One screen, two errands
 * ---------------------------------------------------------------------------
 *
 * As the **Squad tab** it is housekeeping: add a player, remove a player,
 * leave by tapping another tab. A short squad is a normal state there, so
 * nothing blocks.
 *
 * On the way to a **match** it is step one of a kick-off: the tabs are gone,
 * it offers the lineup, and it offers Leave. A screen whose only exit commits
 * the coach to starting a game is a trap — the lineup screen was one.
 *
 * ---------------------------------------------------------------------------
 * Each child's season (#121)
 * ---------------------------------------------------------------------------
 *
 * Each row answers "is anyone behind?": minutes a game, played X of Y, and a
 * small bar against the squad average. The list keeps its order (PO ruling).
 * A Main keeper is not in the squad average, and their row says so. Tapping a
 * name opens the child's page, where their figures and their position
 * preferences live.
 *
 * ---------------------------------------------------------------------------
 * The squad views (#143)
 * ---------------------------------------------------------------------------
 *
 * On the tab, four tiles sit above the list, each showing its answer: Season
 * grid, Fairness, Going into Saturday, Positions tried (`SquadViews.tsx`).
 * A view, and a child opened from one, stack here like the child's page
 * always has: Back returns to where the coach came from. The list itself is
 * unchanged. On the way to a match there are no tiles: that errand is a
 * kick-off.
 */

import { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Text } from './Text';

import type { Player, UUID } from '../types/index';
import type { Ledger } from '../app/ledger';
import {
  MAX_NAME_LENGTH,
  activePlayers,
  displayName,
  duplicatedNames,
  makePlayer,
  preferenceSummary,
  removePlayer,
  restorePlayer,
  squadReadiness,
  validateName,
} from '../app/squad';
import { wholeMinutes } from '../app/analysis';
import { MAIN_KEEPER_NOTE } from '../app/childSeason';
import { VIEW_TITLE, squadViews, type SquadView } from '../app/squadViews';
import { AverageBar, chartColours } from './Charts';
import { ChildScreen } from './ChildScreen';
import { FairnessView, PositionsView, SaturdayView, SeasonGridView, SquadTiles } from './SquadViews';
import { colours, screen, TOUCH_TARGET } from './theme';

/** Where the coach is inside Squad: a view, or a child's page. The list is the empty stack. */
type Page = { kind: 'view'; view: SquadView } | { kind: 'child'; id: UUID };

const VIEWS = {
  grid: SeasonGridView,
  fairness: FairnessView,
  saturday: SaturdayView,
  positions: PositionsView,
} as const;

export function SquadScreen({
  squadId,
  players: everyone,
  played,
  ledger,
  kickoffs,
  onPlayers,
  onFieldCount,
  /** Offered only on the way to a match; the tab has tabs instead. */
  onStartMatch,
  /** Offered only on the way to a match. Leaves without kicking off. */
  onLeave,
}: {
  squadId: UUID;
  /** Everyone ever in the squad, retired players included (#77). */
  players: Player[];
  /** Players with recorded time: removing one retires rather than deletes. */
  played: ReadonlySet<UUID>;
  /** Each child's season figures (#121), folded on every draw. */
  ledger: Ledger | null;
  /** Kick-off of each match without a `kickoffAt`, for ruling E (`kickoffTimes`). */
  kickoffs: ReadonlyMap<UUID, string>;
  onPlayers: (p: Player[]) => void;
  onFieldCount: number;
  onStartMatch: (() => void) | null;
  onLeave: (() => void) | null;
}) {
  const players = activePlayers(everyone);
  const retired = everyone.filter((p) => !players.includes(p));
  const [draft, setDraft] = useState('');
  /** The views and child pages open (#121, #143); empty shows the list. */
  const [pages, setPages] = useState<Page[]>([]);
  const [error, setError] = useState('');
  const onTab = onStartMatch === null && onLeave === null;

  const readiness = squadReadiness(players, onFieldCount);
  const dupes = duplicatedNames(players);
  // Every figure on this screen and the views, folded from the ledger on each draw (invariant 1).
  const views = squadViews(ledger, everyone, { kickoffs });
  const season = views.season;
  const seasonOf = (id: UUID) => season.children.find((c) => c.playerId === id);
  const open = (page: Page) => setPages((stack) => [...stack, page]);
  const back = () => setPages((stack) => stack.slice(0, -1));

  const add = useCallback(() => {
    const check = validateName(draft);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    onPlayers([...everyone, makePlayer(squadId, check.cleaned)]);
    setDraft('');
    setError('');
  }, [draft, everyone, onPlayers, squadId]);

  const top = pages[pages.length - 1];
  if (top?.kind === 'view') {
    const ViewScreen = VIEWS[top.view];
    return <ViewScreen views={views} onChild={(id) => open({ kind: 'child', id })} onBack={back} />;
  }
  const child = top?.kind === 'child' ? players.find((p) => p.id === top.id) : undefined;
  if (child) {
    const under = pages[pages.length - 2];
    return (
      <ChildScreen
        player={child}
        views={views}
        everyone={everyone}
        onPlayers={onPlayers}
        backLabel={under?.kind === 'view' ? `Back to ${VIEW_TITLE[under.view]}` : 'Back to Squad'}
        onBack={back}
      />
    );
  }

  return (
    <View style={screen.flex}>
      <KeyboardAvoidingView
        style={screen.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={screen.pane}>
          <Text style={screen.title}>Squad</Text>
          <Text style={screen.hint}>First names only. Nothing leaves this phone.</Text>

          <ScrollView style={screen.list} keyboardShouldPersistTaps="handled">
            {/* #143 AC1: the squad views, each answering before it is tapped. */}
            {onTab && <SquadTiles views={views} onOpen={(view) => open({ kind: 'view', view })} />}

            <View style={[local.addRow, onTab && local.addRowUnderTiles]}>
              <TextInput
                style={[screen.input, local.nameInput]}
                value={draft}
                onChangeText={(t) => {
                  setDraft(t);
                  if (error) setError('');
                }}
                placeholder="First name"
                placeholderTextColor={colours.inkFaint}
                autoCapitalize="words"
                autoCorrect={false}
                maxLength={MAX_NAME_LENGTH + 8}
                returnKeyType="done"
                onSubmitEditing={add}
              />
              <Pressable
                style={({ pressed }) => [local.addButton, pressed && screen.buttonPressed]}
                onPress={add}
              >
                <Text style={screen.buttonLabel}>Add</Text>
              </Pressable>
            </View>

            {error !== '' && <Text style={screen.error}>{error}</Text>}

            {players.length > 0 &&
              (season.countedMatches === 0 ? (
                <Text style={screen.hint}>
                  Each child&apos;s minutes a game appear here after the first match is closed.
                </Text>
              ) : (
                <View style={local.key}>
                  <View style={local.keyItem}>
                    <View style={local.keyFill} />
                    <Text style={local.keyText}>Minutes a game, out of {wholeMinutes(season.scaleMs)}</Text>
                  </View>
                  {season.squadAverageMs !== null && (
                    <View style={local.keyItem}>
                      <View style={local.keyTick} />
                      <Text style={local.keyText}>Squad average, {wholeMinutes(season.squadAverageMs)}</Text>
                    </View>
                  )}
                </View>
              ))}
            {players.map((p) => {
              const s = seasonOf(p.id);
              const summary = preferenceSummary(p);
              const figures = s?.summary ?? 'No matches yet';
              return (
                <View key={p.id} style={screen.playerRow}>
                  {/* #121: tap a name for their page. */}
                  <Pressable
                    onPress={() => open({ kind: 'child', id: p.id })}
                    style={local.nameHit}
                    accessibilityRole="button"
                    accessibilityLabel={`${displayName(p)}, ${figures}${s?.mainKeeper ? `, ${MAIN_KEEPER_NOTE}` : ''}`}
                  >
                    <Text style={screen.playerName} numberOfLines={1}>
                      {displayName(p)}
                    </Text>
                    <Text style={local.figures} numberOfLines={1}>
                      {figures}
                    </Text>
                    {s && s.averageMs !== null && (
                      <AverageBar
                        value={s.averageMs}
                        line={s.mainKeeper ? null : season.squadAverageMs}
                        scale={season.scaleMs}
                      />
                    )}
                    {s?.mainKeeper && s.averageMs !== null && (
                      <Text style={local.prefSummary} numberOfLines={1}>
                        {MAIN_KEEPER_NOTE}
                      </Text>
                    )}
                    {summary !== '' && (
                      <Text style={local.prefSummary} numberOfLines={1}>
                        {summary}
                      </Text>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() => onPlayers(removePlayer(everyone, p.id, played))}
                    style={local.removeHit}
                  >
                    <Text style={local.remove}>Remove</Text>
                  </Pressable>
                </View>
              );
            })}
            {players.length === 0 && <Text style={screen.caption}>No players yet.</Text>}

            {retired.length > 0 && (
              <>
                <Text style={screen.fieldLabel}>Removed, still in past matches</Text>
                {retired.map((p) => (
                  <View key={p.id} style={screen.playerRow}>
                    <Text style={[screen.playerName, local.retired]}>{displayName(p)}</Text>
                    <Pressable
                      onPress={() => onPlayers(restorePlayer(everyone, p.id))}
                      style={local.removeHit}
                    >
                      <Text style={local.remove}>Bring back</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            )}
          </ScrollView>

          {dupes.length > 0 && (
            <Text style={screen.hint}>Two players called {dupes.join(', ')}.</Text>
          )}
          <Text style={[screen.caption, !readiness.ready && screen.overtime]}>
            {readiness.message}
          </Text>

          {onStartMatch && (
            <Pressable
              disabled={!readiness.ready}
              style={({ pressed }) => [
                screen.button,
                !readiness.ready && screen.buttonDisabled,
                pressed && screen.buttonPressed,
              ]}
              onPress={onStartMatch}
            >
              <Text style={screen.buttonLabel}>Pick the lineup</Text>
            </Pressable>
          )}
          {onLeave && (
            <Pressable onPress={onLeave} style={screen.linkHit}>
              <Text style={screen.link}>Leave — go to Home</Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const local = StyleSheet.create({
  addRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  addRowUnderTiles: { marginTop: 10 },
  nameInput: { flex: 1, alignSelf: 'auto', marginRight: 8 },
  addButton: {
    backgroundColor: colours.accent,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: TOUCH_TARGET,
    minWidth: 72,
    paddingHorizontal: 18,
  },
  nameHit: { flex: 1, minHeight: TOUCH_TARGET, justifyContent: 'center', paddingVertical: 8, paddingRight: 8 },
  figures: { color: colours.inkMuted, fontSize: 14, marginTop: 3, includeFontPadding: false },
  prefSummary: { color: colours.inkFaint, fontSize: 12, marginTop: 4, includeFontPadding: false },
  key: { flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'stretch', marginTop: 10, marginBottom: 2 },
  keyItem: { flexDirection: 'row', alignItems: 'center', marginRight: 14, marginBottom: 4 },
  keyFill: { width: 18, height: 8, borderRadius: 2, backgroundColor: chartColours.outfield, marginRight: 6 },
  keyTick: { width: 2, height: 14, backgroundColor: colours.ink, marginRight: 6 },
  keyText: { color: colours.inkMuted, fontSize: 13, includeFontPadding: false, flexShrink: 0 },
  // 44dp even though the word is small: a mis-hit here deletes a child from
  // the squad, and the row it sits in is 44 high anyway.
  removeHit: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET + 24,
  },
  // Colour only: a weight change re-measures and clips (theme.ts).
  retired: { color: colours.inkFaint },
  remove: {
    color: colours.inkMuted,
    fontSize: 13,
    includeFontPadding: false,
    textDecorationLine: 'underline',
  },
});
