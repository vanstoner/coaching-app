/**
 * The lineup. This is the substitution reminder — REQ-02 (#2), REQ-05 (#5).
 *
 * Between quarters, not mid-play: this squad rotates at the boundaries, so the
 * app stops here and says who is owed minutes, sorted so the top of the list
 * is who should come on. The coach can take the suggestion or ignore it; the
 * override is what happens.
 *
 * ---------------------------------------------------------------------------
 * A list of named positions — PO ruling, 2026-09-20 (#70)
 * ---------------------------------------------------------------------------
 *
 * > *"actually I like setting up as a pitch... Can live with lists and names
 * > of positions for the time being."*
 *
 * A pitch is the target and it is #2/#10, not this slice. What this shows is
 * the team sheet as named slots — the same `teamSheetFor` the engine is handed,
 * read out loud — so the shape the match is being played in is visible without
 * kicking off to find out.
 *
 * Invariant 3 is untouched: which outfield slot a player takes is not a
 * fairness input. Fairness is total pitch time, goal plus outfield (ADR-015,
 * #101); the minutes shown are its outfield and in-goal breakdown.
 *
 * ---------------------------------------------------------------------------
 * The plan, explicit positions, and who comes off — #72
 * ---------------------------------------------------------------------------
 *
 * When the fixture has a plan for this period the screen starts from it
 * (AC7): its players in their positions, its subs with their times and who
 * each replaces. The coach can change any of it, and what they start with is
 * what the engine records — the plan is never the record (AC8).
 *
 * Any named position can be given to any player (AC9), and a planned sub can
 * name who comes off (AC10). With neither, the old behaviour stands: players
 * fill the outfield back to front, and the sub replaces whoever has been on
 * longest.
 *
 * **There is a way out that does not commit.** This screen used to have one
 * exit and it was "Start quarter", so a coach who arrived with the wrong squad
 * was stuck until they started a period they did not mean to start.
 *
 * ---------------------------------------------------------------------------
 * One control vocabulary — #264 (Rob's design, 29 Oct)
 * ---------------------------------------------------------------------------
 *
 * One line per child. Goalkeeper and Here today are each a row › opening a
 * list with a tick. A bench child is a row ›: tapping it opens "*name* comes
 * on" with the time on the compact stepper (the first + is the period's
 * midpoint, as `nudgeSubTime` always did) and, separately, who comes off,
 * whoever is on longest first. Cancel changes nothing; Save puts the plan in
 * light text by the name. Use plan and Use suggestion offer Undo. The way
 * out is top left; Start is the one Main button.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useEdgeScroll } from './useEdgeScroll';
import { Text } from './Text';
import { StatusBar } from 'expo-status-bar';

import { MatchEngine, type MatchState } from '../engine/MatchEngine';
import type { Format, Player, UUID } from '../types/index';
import { currentQuarter, formatClock, periodNoun } from '../app/matchClock';
import { pillDetail } from '../app/pitchLayout';
import { PLACEHOLDER_SQUAD_NAME } from '../app/placeholderSquad';
import { displayName } from '../app/squad';
import { foldPlayerMinutes, type PlayerMinutes } from '../app/playerMinutes';
import { suggestLineup } from '../app/lineup';
import { lineupFromPlan, periodHasContent, type PlannedPeriod } from '../app/matchPlan';
import { NO_SUB_PLANNED, planSubs, type PlannedSub } from '../app/subPlan';
import {
  LINEUP_SUB_STEP_MS,
  draftFor,
  plannedSubText,
  saveSubDraft,
  stepLineupSub,
  subTimeValue,
  subsPlannedSummary,
  type SubDraft,
} from '../app/plannedSubSheet';
import {
  editSheet,
  keeperOf,
  makeKeeper,
  playersOn,
  removeFromSheet,
  sheetFromSelection,
  sheetIsComplete,
  type Sheet,
} from '../app/teamSheet';
import { bandCaption, scoreBand, showsScoreBand } from '../app/scoreBand';
import { opponentLabel } from '../app/fixtures';
import { ScoreBand } from './ScoreBand';
import { PitchView } from './PitchView';
import { isTestMatch } from '../app/testMatches';
import { TeamTalkPanel, talkClock, talkMmss, useTalkTick } from './TeamTalkPanel';
import { asksFromDue, teamTalkOf, type TalkLengths } from '../app/teamTalk';
import { AwardCard, giveLabel, picksCount, picksList, type Picks } from './AwardCard';
import { awardsLine, type AwardPick, type AwardRow } from '../app/matchAwards';
import { PositionNameSheet, type PositionNaming } from './PositionNameSheet';
import { hasRenamedPositions } from '../app/positionNames';
import { shapeOfFormat } from '../app/shapes';
import {
  Action,
  ActionRow,
  BackLink,
  CheckLine,
  FormSheet,
  ListSheet,
  MainButton,
  MultiListSheet,
  RowNav,
  Section,
  SheetNote,
  Stepper,
  TopBar,
  UndoToast,
} from './controls';
import { colours, screen, TOUCH_TARGET } from './theme';

export function LineupScreen({
  pitch = null,
  engine,
  state,
  format,
  players,
  squadName,
  planned,
  onStart,
  onLeave,
  onPlanRest,
  planGaps = [],
  attendance,
  names,
  talk,
  awards = null,
  onPicksCount,
}: {
  engine: MatchEngine;
  state: MatchState;
  /** The shape THIS match is played in, not the squad default. */
  format: Format;
  players: Player[];
  squadName: string;
  /** This period of the fixture's plan, if one was made (#72). */
  planned?: PlannedPeriod;
  /** `startedAt`: #283's "from when it was due"; omitted, the period starts now. */
  onStart: (sheet: Sheet, plan: PlannedSub[], startedAt?: Date) => void;
  /** #283: the team talk's lengths and whether this phone buzzes. */
  talk?: { lengths: TalkLengths; buzz: boolean };
  /** Back to Home. Does not kick off and does not end anything. */
  onLeave: () => void;
  /** Re-plan the periods still to come (#88). The clock keeps running. */
  onPlanRest?: () => void;
  /** #277 D20: who is in the plan but not here today, and where. Never re-planned for the coach. */
  planGaps?: string[];
  /** Rename this match's positions (#166): before kick-off and between periods. */
  names?: PositionNaming;
  /**
   * Who is here today (#102 AC1). Given between periods, never while one
   * runs; `players` above is already only those not marked absent, so an
   * absent player can't be picked.
   */
  attendance?: {
    /**
     * After kick-off: only the absent are listed, and a tap marks them
     * arrived — a late-arrival correction (ruling F). Nobody is marked
     * absent here once the match has kicked off.
     */
    arrivalsOnly?: boolean;
    squad: Player[];
    isAbsent: (id: UUID) => boolean;
    onToggle: (id: UUID, absent: boolean) => void;
  };
  /** #254 AC12, AC20: the "Pitch and referee" row for this match. */
  pitch?: ReactNode;
  /**
   * #266 C13 (Rob, Q1): the award card at a break, on the Lineup. Null where
   * awards are not offered (`awardsOffered`). Each act: the reason when refused, else null.
   */
  awards?: {
    rows: AwardRow[];
    childrenInMatch: { playerId: UUID; name: string }[];
    onGiveAll: (picks: AwardPick[]) => string | null;
    onTakeBack: (typeId: UUID, playerId: UUID, note: string) => string | null;
  } | null;
  /** #266 C11: how many names are picked and not given, so leaving can say so. */
  onPicksCount?: (n: number) => void;
}) {
  const quarter = currentQuarter(state);
  // #283: the break this match is in, worked out from the last period's end on
  // every paint, on this match's own clock (a test match's included).
  const breakTalk = talk ? teamTalkOf(state.quarters, state.match.quarterCount, talk.lengths) : null;
  useTalkTick(breakTalk !== null);
  const nowMs = engine.clockNow().getTime();
  const [lateAsk, setLateAsk] = useState(false);
  // #266: names picked at the break, not yet given. Screen state only (C11).
  const atBreak = state.quarters.some((q) => q.status === 'ended');
  const [awardsOpen, setAwardsOpen] = useState(false);
  const [awardPicks, setAwardPicks] = useState<Picks>({});
  const [giveError, setGiveError] = useState('');
  const [askPicks, setAskPicks] = useState<(() => void) | null>(null);
  const picked = picksCount(awardPicks);
  useEffect(() => onPicksCount?.(picked), [picked, onPicksCount]);
  const giveAll = (then?: () => void) => {
    if (!awards || picked === 0) return;
    const refused = awards.onGiveAll(picksList(awardPicks));
    if (refused) {
      // C7: the reason shows on the card, the picks stay; open it so it is seen.
      setGiveError(refused);
      setAwardsOpen(true);
    } else {
      setAwardPicks({});
      setGiveError('');
      then?.();
    }
  };
  const minutes = useMemo(
    () => foldPlayerMinutes(engine, state, players),
    [engine, state, players]
  );
  const suggestion = useMemo(
    () => suggestLineup(players, minutes, format),
    [players, minutes, format]
  );

  // How long this period will run, which is what a sub time is an offset into.
  const periodMs = engine.getPlannedQuarterMs(state.match);
  const hasPlan = periodHasContent(planned);

  /** Where the screen starts: the plan if there is one, else the suggestion. */
  const prefersOf = (id: UUID) => players.find((p) => p.id === id)?.prefers ?? null;
  const fromSuggestion = () => ({
    // #86: preferred units first, then back to front.
    sheet: sheetFromSelection(suggestion.onPitch, suggestion.goalkeeper, format, prefersOf),
    subs: planSubs(suggestion.bench, periodMs),
  });
  const fromPlan = () => (planned ? lineupFromPlan(planned, format, players) : fromSuggestion());
  const initial = () => (hasPlan ? fromPlan() : fromSuggestion());

  const [start] = useState(initial);
  const [sheet, setSheet] = useState<Sheet>(start.sheet);
  const [plan, setPlan] = useState<PlannedSub[]>(start.subs);
  const suggestedFor = useRef(quarter?.id);

  /** The pitch's first tap, waiting for where that player goes (#83). */
  const [pitchPick, setPitchPick] = useState<UUID | null>(null);
  const [dragging, setDragging] = useState(false);

  // #276: drag near the scrolling area's edge to scroll it; the pitch fits with the bench.
  const edge = useEdgeScroll(dragging);
  /** The position whose name is being changed (#166). */
  const [renaming, setRenaming] = useState<UUID | null>(null);
  /** Kept so `apply` reads as before; the old inline pickers are now sheets. */
  const [, setPicking] = useState<null>(null);
  /** #264: the open sheets, each a draft until its Save. */
  const [keeperSheet, setKeeperSheet] = useState(false);
  const [hereSheet, setHereSheet] = useState(false);
  const [subSheet, setSubSheet] = useState<{ playerId: UUID; draft: SubDraft } | null>(null);
  const [benchOpen, setBenchOpen] = useState(true);
  const [toast, setToast] = useState<{ message: string; undo: () => void } | null>(null);
  const clearToast = useCallback(() => setToast(null), []);

  const apply = (next: { sheet: Sheet; subs: PlannedSub[] }) => {
    setSheet(next.sheet);
    setPlan(next.subs);
    setPicking(null);
  };

  // A new period means starting again: from its plan, or a fresh suggestion.
  useEffect(() => {
    if (suggestedFor.current !== quarter?.id) {
      suggestedFor.current = quarter?.id;
      apply(initial());
    }
    // `initial` reads only the values listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quarter?.id, suggestion, periodMs, planned]);

  // Memoised: the bench-follow effect below depends on it, and a fresh array
  // every render would re-run that effect every render.
  const onPitch = useMemo(() => playersOn(sheet), [sheet]);
  const goalkeeper = keeperOf(sheet, format);

  // The bench changes as the coach taps names, so the plan follows it: a new
  // bench player gets the default time, and one brought on loses their entry.
  useEffect(() => {
    const bench = players.map((p) => p.id).filter((id) => !onPitch.includes(id));
    setPlan((current) => {
      const kept = current.filter((entry) => bench.includes(entry.playerId));
      const added = bench.filter((id) => !current.some((e) => e.playerId === id));
      return [...kept, ...planSubs(added, periodMs)];
    });
  }, [onPitch, players, periodMs]);

  const byId = useMemo(() => {
    const m = new Map<UUID, PlayerMinutes>();
    for (const row of minutes) m.set(row.playerId, row);
    return m;
  }, [minutes]);

  const selected = new Set(onPitch);
  const complete = sheetIsComplete(sheet, format);
  const noun = periodNoun(state.match.quarterCount);
  const talkLabel = breakTalk ? `${noun === 'Quarter' ? 'Q' : noun === 'Half' ? 'H' : noun + ' '}${breakTalk.nextIndex}` : '';
  const talkDue = breakTalk !== null && nowMs >= breakTalk.dueAtMs;
  const shape = shapeOfFormat(format);
  const positions = [...format.positions].sort((a, b) => a.sortOrder - b.sortOrder);
  const nameOf = new Map(players.map((p) => [p.id, displayName(p)]));

  /** Outfield players on now: who a sub can replace. */
  const outfieldOn = positions
    .filter((p) => p.kind !== 'goalkeeper')
    .map((p) => sheet[p.id] ?? null)
    .filter((id): id is UUID => id !== null);

  // Players owed the most time first — the answer to "who comes on". On total
  // pitch time, goal plus outfield (#101, ADR-015).
  const ordered = useMemo(
    () =>
      [...players].sort(
        (a, b) => (byId.get(a.id)?.totalMs ?? 0) - (byId.get(b.id)?.totalMs ?? 0)
      ),
    [players, byId]
  );

  const timeOf = (id: UUID) => plan.find((e) => e.playerId === id)?.atMs ?? 0;
  const forOf = (id: UUID) => plan.find((e) => e.playerId === id)?.forPlayerId ?? null;

  const benchIds = players.map((p) => p.id).filter((id) => !selected.has(id));
  const subsPlanned = plan.filter((e) => benchIds.includes(e.playerId) && e.atMs !== NO_SUB_PLANNED).length;

  /** Use plan / Use suggestion replace the lineup, so each offers Undo (#264 V25). */
  const replaceWith = (next: { sheet: Sheet; subs: PlannedSub[] } | { sheet: Sheet }, words: string) => {
    const before = { sheet, subs: plan };
    if ('subs' in next) apply(next);
    else {
      setPicking(null);
      setSheet(next.sheet);
    }
    setToast({ message: words, undo: () => apply(before) });
  };

  const subName = subSheet ? (nameOf.get(subSheet.playerId) ?? '') : '';
  const absent = attendance ? attendance.squad.filter((p) => attendance.isAbsent(p.id)) : [];

  return (
    <View style={screen.safe}>
      <View style={screen.pane}>
        {/* #264 V31: the way out, top left. Between periods too: the match stays exactly as it is. */}
        <TopBar
          back={<BackLink label="Home" onPress={onLeave} />}
          right={
            <Text style={[local.count, !complete && screen.overtime]} numberOfLines={1}>
              {onPitch.length} of {format.onFieldCount}
            </Text>
          }
        />
        <Text style={screen.title} numberOfLines={1}>
          {squadName || PLACEHOLDER_SQUAD_NAME}
        </Text>
        <Text style={screen.period}>
          {noun} {quarter?.index ?? 1} of {state.match.quarterCount}
          {shape ? ` · ${shape}` : ''}
        </Text>
        <ScrollView style={screen.list} {...edge.scrollProps}>
          {/* #83: the shape drawn as a pitch. Drag a player, or tap one and
              then where they go. Before kick-off this edits the sheet only. */}
          <Text style={screen.fieldLabel}>On the pitch</Text>
          {hasPlan && <Text style={local.fromPlan}>From your plan. Change anything.</Text>}
          {planGaps.map((line) => (
            <Text key={line} style={screen.hint}>
              {line}
            </Text>
          ))}
          <Text style={screen.hint}>
            {pitchPick
              ? `Now tap where ${nameOf.get(pitchPick) ?? ''} goes, or tap them again to cancel.`
              : 'Drag a player into place, or tap one and then where they go.'}
          </Text>
          {/* #252 (Rob: "including between quarters"): the score on the pitch set up for the next period; none before kick-off. */}
          {showsScoreBand(state.quarters) && (
            <ScoreBand
              {...scoreBand(state.events, squadName || PLACEHOLDER_SQUAD_NAME, opponentLabel(state.match))}
              caption={bandCaption(state.quarters, state.match.quarterCount)}
              onPitch
            />
          )}
          {breakTalk && talk && (
            <TeamTalkPanel talk={breakTalk} nowMs={nowMs} label={talkLabel} buzz={talk.buzz} clockTimes={!isTestMatch(state.match)} />
          )}
          <PitchView
            format={format}
            sheet={sheet}
            bench={benchIds}
            nameOf={(id) => nameOf.get(id) ?? ''}
            detailOf={(id) => pillDetail(byId.get(id), id === goalkeeper)}
            selected={pitchPick}
            onSelect={setPitchPick}
            onDragging={setDragging}
            onMove={(id, target) => setSheet(editSheet(sheet, id, target))}
            onRenamePosition={names ? setRenaming : undefined}
            {...edge.pitchProps}
          />
          {names && (
            <Text style={screen.hint}>Tap a gold position name to rename it for this match.</Text>
          )}
          {names && hasRenamedPositions(format) && (
            <Action label="Reset position names" onPress={names.onReset} align="center" />
          )}

          {/* #264: Goalkeeper is one row opening a list with a tick, not a GK square per child. */}
          <RowNav
            first
            label="Goalkeeper"
            value={goalkeeper ? (nameOf.get(goalkeeper) ?? '') : 'Not chosen'}
            onPress={() => setKeeperSheet(true)}
          />

          {/* #264 V20 to V23: each bench child opens "name comes on": the time, then who for. */}
          <Section
            title="Bench"
            summary={subsPlannedSummary(subsPlanned)}
            open={benchOpen}
            onToggle={() => setBenchOpen((o) => !o)}
          >
            {benchIds.length === 0 && <Text style={screen.hint}>Nobody on the subs bench.</Text>}
            {ordered
              .filter((p) => !selected.has(p.id))
              .map((p) => {
                const m = byId.get(p.id);
                const forId = forOf(p.id);
                const text = plannedSubText(timeOf(p.id), forId === null ? null : (nameOf.get(forId) ?? null));
                return (
                  <RowNav
                    key={p.id}
                    label={displayName(p)}
                    detail={text}
                    value={`${formatClock(m?.totalMs ?? 0)} played`}
                    onPress={() => setSubSheet({ playerId: p.id, draft: draftFor(plan, p.id) })}
                  />
                );
              })}
          </Section>

          {attendance && !attendance.arrivalsOnly && (
            <>
              <RowNav
                label="Here today"
                value={`${attendance.squad.length - absent.length} of ${attendance.squad.length}`}
                onPress={() => setHereSheet(true)}
              />
              <Text style={screen.hint}>
                Everyone is here unless you say so. An absent player can&apos;t be picked. After kick-off this can
                only be changed as a correction.
              </Text>
            </>
          )}
          {attendance && attendance.arrivalsOnly && absent.length > 0 && (
            <>
              <RowNav label="Arrived late?" value={`${absent.length} absent`} onPress={() => setHereSheet(true)} />
              <Text style={screen.hint}>
                Mark them here. They can then be picked, and the record notes they arrived after kick-off.
              </Text>
            </>
          )}

          {/* #276: Pitch and referee sits below the pitch, so a small phone shows the whole pitch. */}
          {pitch}

          <ActionRow>
            {hasPlan && <Action label="Use plan" onPress={() => replaceWith(fromPlan(), 'Lineup set from the plan')} />}
            <Action
              label="Use suggestion"
              onPress={() => replaceWith({ sheet: fromSuggestion().sheet }, 'Lineup set from the suggestion')}
            />
          </ActionRow>
          {onPlanRest && <RowNav label="Plan the rest of the match" onPress={onPlanRest} />}

          {/* #266 C13 (Rob, Q1): at a break the award card sits here, its Give a quiet full-width button,
              because Start stays the Main button. Closed with picks waiting, it says so. */}
          {awards && atBreak && (
            <Section
              title={!awardsOpen && picked > 0 ? `${picked} picked, not given yet` : awardsLine(awards.rows)}
              open={awardsOpen}
              onToggle={() => setAwardsOpen((v) => !v)}
            >
              <AwardCard
                rows={awards.rows}
                childrenInMatch={awards.childrenInMatch}
                picks={awardPicks}
                onPicks={setAwardPicks}
                error={giveError}
                onTakeBack={awards.onTakeBack}
                footer={<Action label={giveLabel(picked)} onPress={() => giveAll()} align="center" />}
              />
            </Section>
          )}
        </ScrollView>

        <Text style={[screen.caption, !complete && screen.overtime]}>
          {onPitch.length} of {format.onFieldCount} picked
          {goalkeeper === null ? ' · no goalkeeper chosen' : ''}
        </Text>
        <MainButton
          label={talkDue ? `${talkLabel} is due: Start` : `Start ${noun.toLowerCase()}`}
          urgent={talkDue && complete}
          disabled={!complete}
          onPress={() => {
            // #283 C4, C7: a late Start asks whether to start from when it was due.
            const start = () => {
              if (breakTalk && asksFromDue(engine.clockNow().getTime(), breakTalk.dueAtMs, periodMs)) setLateAsk(true);
              else onStart(sheet, plan);
            };
            // #266 C10, #283 C17: names picked and not given are asked about first; the late Start follows.
            if (picked > 0) setAskPicks(() => start);
            else start();
          }}
        />
      </View>

      {/* #266 C10: picks waiting when Start is tapped. Either answer carries on to Start. */}
      <FormSheet visible={askPicks !== null} title={`Give the ${picked} picked?`} onCancel={() => setAskPicks(null)}>
        <SheetNote>
          {(awards?.rows ?? [])
            .filter((r) => (awardPicks[r.typeId]?.playerIds.length ?? 0) > 0)
            .map((r) => `${r.name}: ${awardPicks[r.typeId]!.playerIds.map((id) => awards?.childrenInMatch.find((c) => c.playerId === id)?.name ?? '—').join(' and ')}`)
            .join(' · ')}
        </SheetNote>
        <Action
          label={`Give ${picked}`}
          onPress={() => {
            const then = askPicks;
            setAskPicks(null);
            giveAll(() => then?.());
          }}
        />
        <Action
          label="Don't give"
          onPress={() => {
            const then = askPicks;
            setAskPicks(null);
            setAwardPicks({});
            then?.();
          }}
        />
      </FormSheet>

      {/* #283 C4–C6: "from when it was due" uses a wall-clock anchor in the past (Ada's note). */}
      <FormSheet visible={lateAsk && breakTalk !== null} title={`Start ${talkLabel} from when it was due?`} onCancel={() => setLateAsk(false)}>
        {breakTalk && (
          <>
            <Text style={screen.hint}>
              {`It was due ${isTestMatch(state.match) ? '' : `at ${talkClock(breakTalk.dueAtMs)}, `}${talkMmss(nowMs - breakTalk.dueAtMs)} ago. The children on the pitch get that time, and the clock shows it already run.`}
            </Text>
            <Text style={screen.hint}>Any change made during the gap can't be timed. Make it as a sub once the clock runs.</Text>
            <MainButton
              label={isTestMatch(state.match) ? 'Yes, from when it was due' : `Yes, from ${talkClock(breakTalk.dueAtMs)}`}
              onPress={() => {
                setLateAsk(false);
                onStart(sheet, plan, new Date(breakTalk.dueAtMs));
              }}
            />
            <Action
              label="Start now"
              onPress={() => {
                setLateAsk(false);
                onStart(sheet, plan);
              }}
            />
          </>
        )}
      </FormSheet>

      <ListSheet
        visible={keeperSheet}
        title="Goalkeeper"
        items={onPitch.map((id) => ({ value: id, label: nameOf.get(id) ?? '' }))}
        value={goalkeeper}
        onPick={(id) => {
          setSheet(makeKeeper(sheet, format, id));
          setKeeperSheet(false);
        }}
        onCancel={() => setKeeperSheet(false)}
        footer={<SheetNote>Only children on the pitch can go in goal.</SheetNote>}
      />

      <FormSheet
        visible={subSheet !== null}
        title={`${subName} comes on`}
        onCancel={() => setSubSheet(null)}
        onSave={() => {
          if (subSheet) setPlan((c) => saveSubDraft(c, subSheet.playerId, subSheet.draft));
          setSubSheet(null);
        }}
      >
        {subSheet && (
          <>
            <View style={local.atRow}>
              <Text style={local.atLabel}>At</Text>
              <Text
                style={[local.atValue, subSheet.draft.atMs === NO_SUB_PLANNED && local.atOff]}
                numberOfLines={1}
              >
                {subTimeValue(subSheet.draft.atMs)}
              </Text>
              <Stepper
                minusLabel="30 seconds earlier"
                plusLabel="30 seconds later"
                minusDisabled={subSheet.draft.atMs === NO_SUB_PLANNED}
                onMinus={() =>
                  setSubSheet({
                    ...subSheet,
                    draft: {
                      ...subSheet.draft,
                      atMs: stepLineupSub(subSheet.draft.atMs, -LINEUP_SUB_STEP_MS, periodMs),
                    },
                  })
                }
                onPlus={() =>
                  setSubSheet({
                    ...subSheet,
                    draft: {
                      ...subSheet.draft,
                      atMs: stepLineupSub(subSheet.draft.atMs, LINEUP_SUB_STEP_MS, periodMs),
                    },
                  })
                }
              />
            </View>
            <SheetNote>
              The first + is halfway through the {noun.toLowerCase()}; − from the earliest time is No sub.
            </SheetNote>
            <Text style={screen.fieldLabel}>For</Text>
            <CheckLine
              label="Whoever is on longest"
              checked={subSheet.draft.forPlayerId === null}
              onPress={() => setSubSheet({ ...subSheet, draft: { ...subSheet.draft, forPlayerId: null } })}
            />
            {outfieldOn.map((id) => (
              <CheckLine
                key={id}
                label={nameOf.get(id) ?? ''}
                checked={subSheet.draft.forPlayerId === id}
                onPress={() => setSubSheet({ ...subSheet, draft: { ...subSheet.draft, forPlayerId: id } })}
              />
            ))}
          </>
        )}
      </FormSheet>

      {attendance && (
        <MultiListSheet
          visible={hereSheet}
          title={attendance.arrivalsOnly ? 'Arrived late?' : 'Here today'}
          items={(attendance.arrivalsOnly ? absent : attendance.squad).map((p) => ({ value: p.id, label: displayName(p) }))}
          chosen={new Set(attendance.arrivalsOnly ? [] : attendance.squad.filter((p) => !attendance.isAbsent(p.id)).map((p) => p.id))}
          onCancel={() => setHereSheet(false)}
          onSave={(here) => {
            setHereSheet(false);
            if (attendance.arrivalsOnly) {
              // Ticked: arrived. A late arrival is a correction; nobody is marked absent here.
              for (const p of absent) if (here.has(p.id)) attendance.onToggle(p.id, false);
              return;
            }
            for (const p of attendance.squad) {
              const wasAbsent = attendance.isAbsent(p.id);
              const nowAbsent = !here.has(p.id);
              if (wasAbsent === nowAbsent) continue;
              // Off the sheet first, so an absent player is never left picked.
              if (nowAbsent) setSheet((s) => removeFromSheet(s, p.id));
              attendance.onToggle(p.id, nowAbsent);
            }
          }}
        />
      )}

      {names && (
        <PositionNameSheet
          format={format}
          positionId={renaming}
          offerKeep={names.offerKeep}
          onSave={names.onRename}
          onClose={() => setRenaming(null)}
        />
      )}
      <UndoToast message={toast?.message ?? null} onUndo={toast?.undo} onDone={clearToast} />
      <StatusBar style="light" />
    </View>
  );
}

const local = StyleSheet.create({
  fromPlan: {
    alignSelf: 'stretch',
    color: colours.warn,
    fontSize: 13,
    includeFontPadding: false,
    marginBottom: 4,
  },
  // A fixed width, never sized to its own text: "7 of 7" and "10 of 7" share it.
  count: {
    width: 72,
    textAlign: 'right',
    color: colours.back,
    fontSize: 15,
    includeFontPadding: false,
    flexShrink: 0,
  },
  atRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOUCH_TARGET,
    borderBottomWidth: 1,
    borderBottomColor: colours.hair,
  },
  atLabel: { flex: 1, color: colours.ink, fontSize: 16, includeFontPadding: false },
  // A FIXED width, not minWidth. "No sub" is wider than "6:15", and a box
  // that sizes itself to its own text is what clipped the last glyph off
  // the clock and the choice boxes.
  atValue: {
    width: 68,
    flexShrink: 0,
    textAlign: 'right',
    paddingRight: 8,
    color: colours.ink,
    fontSize: 16,
    includeFontPadding: false,
  },
  // Same metrics as atValue — only the colour changes.
  atOff: { color: colours.back },
});
