/**
 * The squad — REQ-09 (#9).
 *
 * First names by default, a longer name only after a warning, checked in `src/app/squad.ts` at entry (invariant 4, #54).
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
 * small bar against the squad average. A Main keeper is not in the squad
 * average, and their row says so. Tapping a
 * name opens the child's page, where their figures and their position
 * preferences live.
 *
 * The list sorts by minutes a game, most first (#222, overriding #208 AC7 for
 * this list only). Name and "a game" headings re-sort it as the analytics
 * tables do, remembered on this phone; children with no matches keep squad
 * order below the rest, and the Main keeper is last (`sortSquadList`). The
 * lineup, bench and plan keep squad order.
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

import { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text } from './Text';

import type { Player, UUID } from '../types/index';
import { fairnessHistory, isCountedInFairness, type Ledger } from '../app/ledger';
import {
  MAX_NAME_LENGTH,
  activePlayers,
  displayName,
  duplicatedNames,
  makePlayer,
  preferenceSummary,
  removePlayer,
  restorePlayer,
  sameNameAs,
  splitName,
  squadReadiness,
  validateName,
} from '../app/squad';
import { wholeMinutes } from '../app/analysis';
import { FILL_IN_NOTE, MAIN_KEEPER_NOTE } from '../app/childSeason';
import { childPositionLine } from '../app/matchRecord';
import { provenances, withoutReconstructed } from '../app/provenance';
import { VIEW_TITLE, squadViews, type SquadView } from '../app/squadViews';
import { AverageBar, chartColours } from './Charts';
import { ChildScreen } from './ChildScreen';
import { MoreThanFirstName } from './NameWarning';
import { FairnessView, PositionsView, SaturdayView, SeasonGridView, SquadTiles } from './SquadViews';
import { InfoTap } from './FiguresHelp';
import { MADE_UP_GUARD, emptySquadSentence, TRY_MADE_UP_TEAM } from '../app/gettingStarted';
import { EmptyState } from './GettingStarted';
import { NAME, sortSquadList } from '../app/tableSort';
import { SortHeading, useTableSort } from './TableSort';
import { Action, BackLink, Icon, MainButton, SegmentedRow, TopBar, UndoToast } from './controls';
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
  fairness,
  onFieldCount,
  /** Offered only on the way to a match; the tab has tabs instead. */
  onStartMatch,
  /** Offered only on the way to a match. Leaves without kicking off. */
  onLeave,
  onTryMadeUp = null,
  focusName = false,
  firstTime = null,
  onClearMadeUp = null,
  seasonName = null,
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
  /** #190: mark a child not counted in fairness, or counted again; a reason when refused. */
  fairness: { set: (playerId: UUID, counted: boolean, note: string) => string | null };
  onFieldCount: number;
  onStartMatch: (() => void) | null;
  onLeave: (() => void) | null;
  /** #243 AC1: the current season's name, which every figure here covers. */
  seasonName?: string | null;
  /** #218 Q5: load the made-up team. Passed only while the squad is empty. */
  onTryMadeUp?: (() => void) | null;
  /** #218: arrived to add the squad, so the name box is ready. */
  focusName?: boolean;
  /** #218 Q3: the squad views' next thing to do, before the first match. */
  firstTime?: { label: string; onPress: () => void } | null;
  /**
   * The made-up guard (approve made-up guard): passed while the made-up team
   * is loaded. The first name added is then asked about first; "Clear it and
   * start" hands it here, "Keep exploring" adds it to the made-up team.
   */
  onClearMadeUp?: ((firstName: string) => void) | null;
}) {
  const players = activePlayers(everyone);
  const retired = everyone.filter((p) => !players.includes(p));
  const [draft, setDraft] = useState('');
  // #219: the name box keeps the keyboard between names, so a squad goes in
  // one after another without tapping back into it.
  // #264 V25: Remove changes what the coach can't see, so it offers Undo (Bring back).
  const [toast, setToast] = useState<{ message: string; undo: () => void } | null>(null);
  const clearToast = useCallback(() => setToast(null), []);
  const latest = useRef(everyone);
  latest.current = everyone;
  const nameInput = useRef<TextInput>(null);
  /** The views and child pages open (#121, #143); empty shows the list. */
  const [pages, setPages] = useState<Page[]>([]);
  const [error, setError] = useState('');
  /** The name waiting on the made-up guard's answer; screen state only. */
  const [asking, setAsking] = useState<string | null>(null);
  /**
   * #54: a name waiting on the coach. `more`: more than one word, which is
   * only saved once the coach picks a button. `same`: another child is
   * already shown by this name, so an initial is offered first.
   */
  const [naming, setNaming] = useState<
    { kind: 'more'; cleaned: string } | { kind: 'same'; name: string; other: string } | null
  >(null);
  /** "Keep exploring" was chosen: not asked again while this screen is open. */
  const [keptExploring, setKeptExploring] = useState(false);
  const onTab = onStartMatch === null && onLeave === null;

  const readiness = squadReadiness(players, onFieldCount);
  const dupes = duplicatedNames(players);
  // #199 AC4: a view choice, never saved and never written to the record.
  const [includeReconstructed, setIncludeReconstructed] = useState(true);
  const anyReconstructed = ledger ? [...provenances(ledger).values()].some((p) => p.state === 'reconstructed') : false;
  const shown = ledger && !includeReconstructed ? withoutReconstructed(ledger) : ledger;
  // Every figure on this screen and the views, folded from the ledger on each draw (invariant 1).
  const views = squadViews(shown, everyone, { kickoffs });
  const season = views.season;
  const seasonOf = (id: UUID) => season.children.find((c) => c.playerId === id);
  const open = (page: Page) => setPages((stack) => [...stack, page]);
  // #222: minutes a game most first by default; Name or "a game" re-sorts it.
  const listSort = useTableSort('squadList');
  const listed = sortSquadList(
    players.map((p) => {
      const s = seasonOf(p.id);
      return { player: p, name: displayName(p), averageMs: s?.averageMs ?? null, mainKeeper: s?.mainKeeper === true };
    }),
    listSort.sort
  ).map((r) => r.player);
  const back = () => setPages((stack) => stack.slice(0, -1));

  /** The name is settled: add the child (through the made-up guard if it applies). */
  const commit = useCallback(
    (name: string) => {
      setNaming(null);
      if (onClearMadeUp && !keptExploring) {
        setAsking(name);
        setError('');
        return;
      }
      const { firstName, displaySuffix } = splitName(name);
      onPlayers([...everyone, makePlayer(squadId, firstName, displaySuffix)]);
      setDraft('');
      setError('');
      nameInput.current?.focus();
    },
    [everyone, onPlayers, squadId, onClearMadeUp, keptExploring]
  );

  /** #54 AC4: a second child shown by the same name is offered an initial first. */
  const settle = useCallback(
    (name: string) => {
      const other = sameNameAs(everyone, name);
      if (other) setNaming({ kind: 'same', name, other: displayName(other) });
      else commit(name);
    },
    [everyone, commit]
  );

  // #54 AC3: Add and the keyboard's Enter both come here, so a name of more
  // than one word is never saved without the coach's choice.
  const add = useCallback(() => {
    const check = validateName(draft);
    if (check.reason === 'more-than-one-word') {
      setError('');
      setNaming({ kind: 'more', cleaned: check.cleaned });
      return;
    }
    if (!check.ok) {
      setError(check.message);
      return;
    }
    settle(check.cleaned);
  }, [draft, settle]);

  const changeIt = () => {
    setNaming(null);
    nameInput.current?.focus();
  };

  const keepExploring = () => {
    if (asking === null) return;
    const { firstName, displaySuffix } = splitName(asking);
    onPlayers([...everyone, makePlayer(squadId, firstName, displaySuffix)]);
    setKeptExploring(true);
    setAsking(null);
    setDraft('');
    nameInput.current?.focus();
  };
  const clearAndStart = () => {
    if (asking === null || !onClearMadeUp) return;
    onClearMadeUp(asking);
    setAsking(null);
    setDraft('');
  };

  const top = pages[pages.length - 1];
  if (top?.kind === 'view') {
    const ViewScreen = VIEWS[top.view];
    return (
      <ViewScreen views={views} onChild={(id) => open({ kind: 'child', id })} onBack={back} firstTime={firstTime} />
    );
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
        roleLine={childPositionLine(shown, child.id)}
        fairness={{
          counted: isCountedInFairness(ledger, child.id),
          history: ledger ? fairnessHistory(ledger, child.id) : [],
          set: (counted, note) => fairness.set(child.id, counted, note),
        }}
        backLabel={under?.kind === 'view' ? `Back to ${VIEW_TITLE[under.view]}` : 'Back to Squad'}
        onBack={back}
      />
    );
  }

  return (
    <View style={screen.flex}>
      <KeyboardAvoidingView
        style={screen.flex}
        // #174: Android draws edge to edge, so the window no longer resizes for
        // the keyboard; pad on both platforms.
        behavior="padding"
      >
        <View style={screen.pane}>
          {/* #264 V31: on the way to a match, the way out is top left. */}
          {onLeave && <TopBar back={<BackLink label="Home" accessibilityLabel="Leave — go to Home" onPress={onLeave} />} />}
          <Text style={screen.title}>Squad</Text>
          {seasonName !== null && <Text style={screen.caption}>{seasonName}</Text>}
          <Text style={screen.hint}>First names are best. Nothing leaves this phone.</Text>

          {/* Dragging the list puts the keyboard away: the name field keeps focus on
              Return (#219), and since #264 the heading is outside this list (run 41038444305). */}
          <ScrollView style={screen.list} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            {/* #143 AC1: the squad views, each answering before it is tapped. */}
            {onTab && anyReconstructed && (
              <SegmentedRow
                label="Include reconstructed matches"
                stacked
                options={[
                  { value: true, label: 'On' },
                  { value: false, label: 'Off' },
                ]}
                value={includeReconstructed}
                onChange={(v) => v !== null && setIncludeReconstructed(v)}
              />
            )}
            {onTab && <SquadTiles views={views} onOpen={(view) => open({ kind: 'view', view })} />}

            <View style={[local.addRow, onTab && local.addRowUnderTiles]}>
              <TextInput
                ref={nameInput}
                autoFocus={focusName}
                style={[screen.input, local.nameInput]}
                value={draft}
                onChangeText={(t) => {
                  setDraft(t);
                  if (error) setError('');
                  // A changed name is checked afresh when added.
                  if (naming) setNaming(null);
                }}
                placeholder="First name"
                placeholderTextColor={colours.inkFaint}
                autoCapitalize="words"
                autoCorrect={false}
                maxLength={MAX_NAME_LENGTH + 8}
                // "next", and submitting keeps focus: Done would close the
                // keyboard after every name (#219).
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={add}
              />
              {/* #264: an Action; the label "Add" is kept (the store selector ADD_NAME). */}
              <Action label="Add" onPress={add} />
            </View>

            {error !== '' && <Text style={screen.error}>{error}</Text>}

            {naming?.kind === 'more' && <MoreThanFirstName cleaned={naming.cleaned} onUse={settle} onChange={changeIt} />}
            {naming?.kind === 'same' && (
              <View style={local.guard}>
                <Text style={local.guardText}>
                  You already have {naming.other}. Add an initial so you can tell them apart.
                </Text>
                <Action
                  label="Add an initial"
                  onPress={() => {
                    setDraft(`${naming.name} `);
                    changeIt();
                  }}
                />
                <Action label={`Add as “${naming.name}” anyway`} onPress={() => commit(naming.name)} />
              </View>
            )}
            {asking !== null && (
              <View style={local.guard}>
                <Text style={local.guardText}>{MADE_UP_GUARD.question}</Text>
                <Action label={MADE_UP_GUARD.clear} onPress={clearAndStart} />
                <Action label={MADE_UP_GUARD.keep} onPress={keepExploring} />
              </View>
            )}

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
                    <InfoTap figure="perGame" />
                  </View>
                  {season.squadAverageMs !== null && (
                    <View style={local.keyItem}>
                      <View style={local.keyTick} />
                      <Text style={local.keyText}>Squad average, {wholeMinutes(season.squadAverageMs)}</Text>
                    </View>
                  )}
                </View>
              ))}
            {/* ADR-015 §6a (#223): how many matches the figures leave out for their format, and why. */}
            {players.length > 0 && season.formatNote !== null && (
              <Text style={screen.hint}>{season.formatNote}.</Text>
            )}
            {players.length > 1 && (
              <View style={local.headings}>
                <SortHeading label="Name" column={NAME} align="left" style={local.headingName} {...listSort} />
                <SortHeading label="a game" column="perGame" {...listSort} />
                <View style={local.headingSpacer} />
              </View>
            )}
            {listed.map((p) => {
              const s = seasonOf(p.id);
              const summary = preferenceSummary(p);
              const figures = s?.summary ?? 'No matches yet';
              return (
                <View key={p.id} style={screen.playerRow}>
                  {/* #121: tap a name for their page. */}
                  <Pressable
                    onPress={() => open({ kind: 'child', id: p.id })}
                    style={({ pressed }) => [local.nameRow, pressed && screen.buttonPressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`${displayName(p)}, ${figures}${s?.fillIn ? `, ${FILL_IN_NOTE}` : s?.mainKeeper ? `, ${MAIN_KEEPER_NOTE}` : ''}`}
                  >
                    <View style={local.nameHit}>
                    <Text style={screen.playerName} numberOfLines={1}>
                      {displayName(p)}
                    </Text>
                    {/* Two lines (#223 QA N2): the R5 line "Played 1 five-a-side
                        match, not in fairness" lost its tail on a narrow phone. */}
                    <Text style={local.figures} numberOfLines={2}>
                      {figures}
                    </Text>
                    {s && s.averageMs !== null && (
                      <AverageBar
                        value={s.averageMs}
                        line={s.mainKeeper || s.fillIn ? null : season.squadAverageMs}
                        scale={season.scaleMs}
                      />
                    )}
                    {s?.fillIn ? (
                      <Text style={local.prefSummary} numberOfLines={1}>
                        {FILL_IN_NOTE}
                      </Text>
                    ) : (
                      s?.mainKeeper &&
                      s.averageMs !== null && (
                        <Text style={local.prefSummary} numberOfLines={1}>
                          {MAIN_KEEPER_NOTE}
                        </Text>
                      )
                    )}
                    {summary !== '' && (
                      <Text style={local.prefSummary} numberOfLines={1}>
                        {summary}
                      </Text>
                    )}
                    </View>
                    {/* #264: a Row ›: it opens the child's page. */}
                    <Icon name="chevron-right" size={22} color={colours.back} style={local.chevron} />
                  </Pressable>
                  <View style={local.removeHit}>
                    <Action
                      label="Remove"
                      accessibilityLabel={`Remove ${displayName(p)}`}
                      onPress={() => {
                        onPlayers(removePlayer(everyone, p.id, played));
                        setToast({
                          message: `${displayName(p)} removed`,
                          undo: () => onPlayers(restorePlayer(latest.current, p.id)),
                        });
                      }}
                    />
                  </View>
                </View>
              );
            })}
            {players.length === 0 &&
              (everyone.length === 0 ? (
                // #218 Q3: nothing has happened yet: say how, and offer the made-up team (Q5).
                <EmptyState
                  text={emptySquadSentence(onFieldCount)}
                  action={onTryMadeUp ? { label: TRY_MADE_UP_TEAM, onPress: onTryMadeUp } : null}
                />
              ) : (
                <Text style={screen.caption}>No players yet.</Text>
              ))}

            {retired.length > 0 && (
              <>
                <Text style={screen.fieldLabel}>Removed, still in past matches</Text>
                {retired.map((p) => (
                  <View key={p.id} style={screen.playerRow}>
                    <Text style={[screen.playerName, local.retired]}>{displayName(p)}</Text>
                    <View style={local.removeHit}>
                      <Action label="Bring back" onPress={() => onPlayers(restorePlayer(everyone, p.id))} />
                    </View>
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

          {onStartMatch && <MainButton label="Pick the lineup" disabled={!readiness.ready} onPress={onStartMatch} />}
        </View>
      </KeyboardAvoidingView>
      <UndoToast message={toast?.message ?? null} onUndo={toast?.undo} onDone={clearToast} />
    </View>
  );
}

const local = StyleSheet.create({
  addRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  addRowUnderTiles: { marginTop: 10 },
  nameInput: { flex: 1, alignSelf: 'auto', marginRight: 8 },
  nameRow: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: TOUCH_TARGET },
  nameHit: { flex: 1, minHeight: TOUCH_TARGET, justifyContent: 'center', paddingVertical: 8, paddingRight: 8 },
  chevron: { width: 24, flexShrink: 0 },
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
  guard: {
    alignSelf: 'stretch',
    backgroundColor: colours.pitchRaised,
    borderColor: colours.warn,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  guardText: { alignSelf: 'stretch', color: colours.ink, fontSize: 16, includeFontPadding: false },
  // #222: the headings sit over the list, "a game" left of the Remove column.
  headings: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', marginTop: 6 },
  headingName: { flex: 1 },
  headingSpacer: { width: TOUCH_TARGET + 24, flexShrink: 0 },
});
