/**
 * Saturday. The clock, the pitch, the score, and who comes off next.
 * REQ-01 (#1), #82, #83, #84.
 *
 * **Full-screen, no tabs** (PO ruling, 2026-09-20, #70). The only way off is
 * an explicit Leave, which returns to Home and leaves the match running.
 *
 * **During play, a move is a record** (#83 AC4). Dragging or tap-tapping a
 * player swaps positions or makes a substitution at that moment, through the
 * engine. Every move and every goal, save or conceded goal gets a 10-second
 * Undo (PO rulings 11 and 12): a mis-drop on a touchline costs one tap.
 *
 * **A tap on a player opens what can be recorded for them** (#84, #185):
 * picture buttons for Goal, Tackle, Corner won and Free kick won for anyone on
 * the pitch, plus Save and Conceded for the keeper; and "Move or swap…" so
 * every move is possible without dragging. A goal then asks who set it up.
 *
 * **This period's planned subs are always in view** (#203), above the pitch,
 * and can be changed from here: the plan only, never the record. Each sub's
 * prompt rises 30 s before it is due, green, then amber at 15 s, then red
 * and counting up once late, and the phone buzzes once as it rises (#137,
 * moved by #203 AC4). Each paint only works it out: the band and the buzz
 * are read from the anchors that paint used, and what has already buzzed or
 * been put off with "Not now" is held by the shell.
 *
 * Invariant 1: the score is folded from the events on every paint.
 * Invariant 2: the interval below is a REPAINT trigger and nothing else.
 * Invariant 3: fairness is total pitch time, goal plus outfield (ADR-015,
 * #101). The figures under each name are that time's breakdown, outfield and
 * GK; who comes off is by unbroken stint on the pitch, never by position.
 */

import { useEffect, useReducer, useRef, useState } from 'react';
import {
  AppState,
  Pressable,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  TextInput,
  Vibration,
  View,
} from 'react-native';
import { Text } from './Text';
import { StatusBar } from 'expo-status-bar';

import { MatchEngine, type MatchState } from '../engine/MatchEngine';
import type { Format, MatchEvent, Player, TallyKind, TapEventKind, UUID } from '../types/index';
import {
  currentQuarter,
  deriveClockView,
  formatClock,
  msUntilNextSecond,
  periodNoun,
} from '../app/matchClock';
import { appClockSetting, appNow } from '../app/appClock';
import { pillDetail } from '../app/pitchLayout';
import { PLACEHOLDER_SQUAD_NAME } from '../app/placeholderSquad';
import { foldPlayerMinutes } from '../app/playerMinutes';
import { checkBuzz, setSubFor, type BuzzLog, type PlannedSub } from '../app/subPlan';
import {
  cameOnFor,
  isNotNow,
  moveSubTime,
  notNow,
  offPicks,
  promptAgain,
  promptGroups,
  removeSub,
  subBand,
  subList,
  type NotNowLog,
  type OnPitch,
} from '../app/clockSubs';
import {
  TAP_LABEL,
  UNDO_NOTE,
  UNDO_WINDOW_MS,
  assistCandidates,
  scoreOf,
  tapEventsFor,
  timeStream,
} from '../app/matchEvents';
import { liveMove, liveSheet, reverseOf, type LiveMove } from '../app/teamSheet';
import { opponentLabel } from '../app/fixtures';
import { periodEndChoices, type PeriodEndChoices } from '../app/periodEnd';
import { PitchView } from './PitchView';
import { ActionSheet, SheetButton } from './Sheet';
import { AssistButton, EventButtons, TallyButtons } from './EventButtons';
import { SubPlanList, SubPlanSheet, SubPrompts } from './ClockSubs';
import { colours, screen, TOUCH_TARGET } from './theme';
import { UNDO_TOAST } from './subPromptColours';

/**
 * Two short pulses (#137). Android reads it as wait, buzz, pause, buzz. iOS
 * ignores the timing: each number becomes a pause before another pulse of
 * its own fixed length.
 */
const SUB_DUE_BUZZ = [0, 400, 200, 400];

function buzz() {
  try {
    Vibration.vibrate(SUB_DUE_BUZZ);
  } catch {
    // A phone that cannot buzz still shows the sub on screen.
  }
}

export function ClockScreen({
  engine,
  state,
  format,
  players,
  squadName,
  subPlan,
  buzzOnDue,
  buzzLog,
  notNowLog,
  onChangePlan,
  onLiveMove,
  onRecord,
  onRecordAssist,
  tallies = [],
  onRecordTally,
  onWithdraw,
  onEndQuarter,
  onFinish,
  onLeave,
  onPlanRest,
  onAnalysis,
}: {
  engine: MatchEngine;
  state: MatchState;
  /** The shape this match is played in. */
  format: Format;
  players: Player[];
  squadName: string;
  subPlan: PlannedSub[];
  /** Settings: "Buzz when a sub is due" (#137). */
  buzzOnDue: boolean;
  /**
   * What has buzzed this period. Owned by the shell, so leaving this screen
   * and coming back does not buzz the same sub again.
   */
  buzzLog: { current: BuzzLog };
  /**
   * The subs the coach said "Not now" to this period (#203 C5). Owned by the
   * shell for the same reason, so the prompt does not nag again on return.
   */
  notNowLog: { current: NotNowLog };
  /** A change to this period's planned subs (#203 AC2). The plan only, never the record. */
  onChangePlan: (plan: PlannedSub[]) => void;
  /** A swap or a substitution during play. False if the engine refused it. */
  onLiveMove: (move: LiveMove, isUndo?: boolean) => boolean;
  /** A goal, save, goal conceded, tackle, corner or free kick won. Null if the engine refused it. */
  onRecord: (kind: TapEventKind, playerId: UUID) => MatchEvent | null;
  /** Credit a goal's assist (#185). Null if the engine refused it. */
  onRecordAssist: (goalId: UUID, playerId: UUID) => MatchEvent | null;
  /** The coach's own tally kinds (#198), each its own button; a team one is credited to no child. */
  tallies?: { kind: TallyKind; label: string; team: boolean }[];
  onRecordTally?: (kind: TallyKind, playerId: UUID | null) => MatchEvent | null;
  /** Take an event back, with its note (invariant 5). */
  onWithdraw: (eventId: UUID, note: string) => boolean;
  /**
   * End the running period. With a time, the coach chose when it ended
   * because the clock ran on past planned length (#180).
   */
  onEndQuarter: (atQuarterElapsedMs?: number) => void;
  onFinish: () => void;
  onLeave: () => void;
  /** Re-plan the periods still to come (#88). The clock keeps running. */
  onPlanRest?: () => void;
  /** Match analysis (#105 AC3). The clock keeps running. */
  onAnalysis?: () => void;
}) {
  const [, forceRepaint] = useReducer((n: number) => n + 1, 0);
  // Repaint just after each displayed second changes (#96), not on a free
  // interval a late timer can carry across two seconds. Only a repaint: the
  // value is recomputed from anchors every time (invariant 2).
  const latest = useRef({ engine, state });
  latest.current = { engine, state };
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const { engine: e, state: s } = latest.current;
      const running = s.quarters.find((q) => q.status === 'running');
      const wait = running
        ? // A test match's own ×5 or ×10 (#194) on top of the Test kit's.
          msUntilNextSecond(e.getQuarterElapsedMs(running), appClockSetting().speed * (s.match.test?.clock.speed ?? 1))
        : 1000;
      id = setTimeout(() => {
        forceRepaint();
        schedule();
      }, wait);
    };
    schedule();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') forceRepaint();
    });
    return () => {
      clearTimeout(id);
      sub.remove();
    };
  }, []);

  const [selected, setSelected] = useState<UUID | null>(null);
  const [sheetFor, setSheetFor] = useState<UUID | null>(null);
  /** The goal just recorded, while asking who set it up (#185 AC3). */
  const [assistFor, setAssistFor] = useState<MatchEvent | null>(null);
  const [dragging, setDragging] = useState(false);
  /** Who comes off each prompted sub, when the coach has changed the suggestion. */
  const [offChoice, setOffChoice] = useState<Record<string, UUID>>({});
  /** The row of a shared prompt panel whose choices are open (#203 C2). */
  const [expanded, setExpanded] = useState<UUID | null>(null);
  /** The planned sub whose sheet is open (#203 AC2, C7). */
  const [planSheetFor, setPlanSheetFor] = useState<UUID | null>(null);
  const [undo, setUndo] = useState<{ label: string; until: number; run: () => void } | null>(null);
  const [withdrawing, setWithdrawing] = useState<{ id: UUID; note: string } | null>(null);
  const [notice, setNotice] = useState('');
  /** #180: when the period ended, asked only when End comes past the margin. */
  const [endChoices, setEndChoices] = useState<PeriodEndChoices | null>(null);

  const view = deriveClockView(engine, state);
  const quarter = currentQuarter(state);
  const running = view.isRunning && quarter?.status === 'running';
  const minutes = foldPlayerMinutes(engine, state, players);
  const minutesOf = new Map(minutes.map((m) => [m.playerId, m]));
  const onPitch = minutes.filter((m) => m.onPitchNow);
  const noun = periodNoun(state.match.quarterCount).toLowerCase();
  const nameOf = (id: UUID) => players.find((p) => p.id === id)?.firstName ?? '—';
  const score = scoreOf(state.events);

  const sheet = quarter ? liveSheet(state.appearances, quarter.id) : {};
  const keeperPos = format.positions.find((p) => p.kind === 'goalkeeper')?.id;
  const keeper = keeperPos ? (sheet[keeperPos] ?? null) : null;
  const onIds = new Set(Object.values(sheet).filter((v): v is UUID => v !== null));
  const bench = players.filter((p) => !onIds.has(p.id)).map((p) => p.id);
  const outfieldOn = onPitch.map((m) => m.playerId).filter((id) => id !== keeper);

  // Read from the anchors on this paint, and everything below follows from
  // it: a phone that slept shows the right band on waking (#203 AC5).
  const periodElapsedMs = running ? engine.getQuarterElapsedMs(quarter!) : 0;
  const periodKey = quarter ? `${state.match.id}/${quarter.id}` : '';
  const periodMs = engine.getPlannedQuarterMs(state.match);
  const putOff = (sub: PlannedSub) => isNotNow(notNowLog.current, periodKey, sub);
  const outfieldStints: OnPitch[] = onPitch
    .filter((m) => m.playerId !== keeper)
    .map((m) => ({ playerId: m.playerId, currentStintMs: m.currentStintMs }));
  const picks = offPicks(subPlan, outfieldStints);
  const prompts = running ? promptGroups(subPlan, periodElapsedMs, putOff) : [];
  const list = running
    ? subList({
        plan: subPlan,
        periodElapsedMs,
        prompting: prompts.length > 0,
        nameOf,
        outfieldOn: outfieldStints,
        onPitchIds: onIds,
        madeFor: (id) => (quarter ? cameOnFor(state.appearances, quarter.id, id) : null),
      })
    : null;
  /** Who comes off if Done is pressed now: the coach's choice while still on, else the pick. */
  const chosenOff = (sub: PlannedSub): UUID | null => {
    const choice = offChoice[sub.playerId];
    if (choice && outfieldOn.includes(choice)) return choice;
    return picks.get(sub.playerId)?.offId ?? null;
  };
  const sheetSub = planSheetFor ? (subPlan.find((s) => s.playerId === planSheetFor) ?? null) : null;
  // A sheet left open at the whistle must not reopen on the next period.
  useEffect(() => {
    if (!running) setPlanSheetFor(null);
  }, [running]);
  const changeSheetSub = (change: (plan: PlannedSub[]) => PlannedSub[]) => onChangePlan(change(subPlan));

  /**
   * Done on a prompt (#203 AC6): the substitution as any other, with Undo.
   * An Undo puts the reminder back already put off, so it does not leap
   * straight back up: the line reads "late" and a tap brings it back (C5).
   */
  const makePlannedSub = (sub: PlannedSub, offId: UUID) => {
    const m: LiveMove = { kind: 'sub', out: offId, in: sub.playerId };
    if (!onLiveMove(m)) {
      setNotice('That sub could not be made.');
      return;
    }
    setNotice('');
    const { [sub.playerId]: _gone, ...rest } = offChoice;
    setOffChoice(rest);
    setExpanded(null);
    offerUndo(describe(m), () => {
      if (onLiveMove(reverseOf(m), true)) {
        notNowLog.current = notNow(notNowLog.current, periodKey, [sub]);
      }
    });
  };

  // #137: after every paint, buzz for any sub this paint shows as newly due.
  // Detection only: the elapsed time is the one just read from the anchors,
  // so it follows the Test kit's ×5 and ×10 clock, and nothing is counted.
  useEffect(() => {
    const result = checkBuzz(buzzLog.current, {
      enabled: buzzOnDue,
      foreground: AppState.currentState === 'active',
      running:
        running && quarter
          ? { periodKey: `${state.match.id}/${quarter.id}`, elapsedMs: periodElapsedMs }
          : null,
      plan: subPlan,
    });
    buzzLog.current = result.log;
    if (result.buzz.length > 0) buzz();
  });

  // The Undo toast goes away on its own once its ten seconds are up.
  const undoLive = undo !== null && appNow().getTime() < undo.until;

  const offerUndo = (label: string, run: () => void) =>
    setUndo({ label, until: appNow().getTime() + UNDO_WINDOW_MS, run });

  const describe = (m: LiveMove) =>
    m.kind === 'swap' ? `Swapped ${nameOf(m.a)} and ${nameOf(m.b)}` : `${nameOf(m.in)} on for ${nameOf(m.out)}`;

  const doMove = (m: LiveMove) => {
    if (!onLiveMove(m)) {
      setNotice('That move could not be made.');
      return;
    }
    setNotice('');
    offerUndo(describe(m), () => onLiveMove(reverseOf(m), true));
  };

  const record = (kind: TapEventKind, id: UUID) => {
    setSheetFor(null);
    const event = onRecord(kind, id);
    if (!event) {
      setNotice('That could not be recorded.');
      return;
    }
    const label = kind === 'conceded' ? 'Goal conceded' : `${TAP_LABEL[kind]}: ${nameOf(id)}`;
    offerUndo(label, () => onWithdraw(event.id, UNDO_NOTE));
    if (kind === 'goal') setAssistFor(event);
  };

  const tally = (kind: TallyKind, team: boolean, id: UUID) => {
    setSheetFor(null);
    const event = onRecordTally?.(kind, team ? null : id) ?? null;
    if (!event) {
      setNotice('That could not be recorded.');
      return;
    }
    const label = tallies.find((t) => t.kind === kind)?.label ?? 'Tally';
    offerUndo(team ? `${label} (team)` : `${label}: ${nameOf(id)}`, () => onWithdraw(event.id, UNDO_NOTE));
  };

  /** Withdrawing the goal takes its assist with it (#185 AC5), so Undo stays one tap. */
  const assist = (goal: MatchEvent, id: UUID) => {
    setAssistFor(null);
    if (!onRecordAssist(goal.id, id)) {
      setNotice('That assist could not be recorded.');
      return;
    }
    const scorer = goal.playerId ? nameOf(goal.playerId) : 'someone';
    offerUndo(`Goal: ${scorer}, assist ${nameOf(id)}`, () => onWithdraw(goal.id, UNDO_NOTE));
  };

  const stream = timeStream(state.appearances, state.events, players, new Map(tallies.map((t) => [t.kind, t.label])));

  return (
    <View style={screen.safe}>
      {/* #174: keeps the withdraw note above the keyboard on Android too. */}
      <KeyboardAvoidingView style={screen.flex} behavior="padding">
      <ScrollView contentContainerStyle={screen.scroll} scrollEnabled={!dragging}>
        <View style={local.scoreRow}>
          <Text style={[local.team]} numberOfLines={1}>
            {squadName || PLACEHOLDER_SQUAD_NAME}
          </Text>
          <Text style={local.score}>
            {score.us} – {score.them}
          </Text>
          <Text style={[local.team, local.them]} numberOfLines={1}>
            {opponentLabel(state.match)}
          </Text>
        </View>
        <Text style={screen.period}>{view.quarterLabel}</Text>
        <Text style={local.clock} numberOfLines={1} adjustsFontSizeToFit>
          {formatClock(view.quarterElapsedMs)}
        </Text>

        {view.isMatchOver ? (
          <Text style={screen.caption}>
            Full time — {formatClock(view.matchElapsedMs)} played
          </Text>
        ) : (
          <Text style={[screen.caption, view.isOvertime && screen.overtime]}>
            {view.isOvertime
              ? `${periodNoun(state.match.quarterCount)} over — end it when play stops`
              : `${formatClock(view.quarterRemainingMs)} left in this ${noun}`}
          </Text>
        )}

        {/* #203: the prompt rises 30 s early (AC3); the list is always there (AC1). #82 AC1: the pick is a default; any outfield player can be chosen. */}
        {running && (
          <SubPrompts
            groups={prompts}
            band={(sub) => subBand(sub, periodElapsedMs)}
            elapsedMs={periodElapsedMs}
            outfieldOn={outfieldOn}
            chosenOff={chosenOff}
            expanded={expanded}
            nameOf={nameOf}
            onChoose={(sub, id) => {
              setOffChoice({ ...offChoice, [sub.playerId]: id });
              setExpanded(null);
            }}
            onExpand={setExpanded}
            onDone={makePlannedSub}
            onNotNow={(subs) => {
              notNowLog.current = notNow(notNowLog.current, periodKey, subs);
              forceRepaint();
            }}
          />
        )}
        {list && (
          <SubPlanList
            title={`Subs this ${noun}`}
            list={list}
            nameOf={nameOf}
            onOpen={setPlanSheetFor}
          />
        )}

        {running && (
          <>
            <Text style={screen.hint}>
              {selected
                ? `Now tap where ${nameOf(selected)} goes, or tap ${nameOf(selected)} again to cancel.`
                : 'Tap a player for Goal, Save or Move. Or drag them.'}
            </Text>
            <PitchView
              format={format}
              sheet={sheet}
              bench={bench}
              nameOf={nameOf}
              detailOf={(id) => pillDetail(minutesOf.get(id), id === keeper)}
              selected={selected}
              onSelect={setSelected}
              onTapPlayer={(id) => setSheetFor(id)}
              onDragging={setDragging}
              onMove={(id, target) => {
                const m = liveMove(sheet, id, target);
                if (m) doMove(m);
                else if (target.kind === 'bench')
                  setNotice('To take a player off, drop a bench player onto them.');
              }}
            />
          </>
        )}

        {notice !== '' && <Text style={[screen.hint, screen.overtime]}>{notice}</Text>}

        {(view.isMatchOver || !running) && (
          <View style={screen.list}>
            {(view.isMatchOver ? minutes : onPitch).map((m) => (
              <View key={m.playerId} style={screen.playerRow}>
                <Text style={screen.playerName} numberOfLines={1}>
                  {nameOf(m.playerId)}
                </Text>
                <Text style={screen.rowTime} numberOfLines={1}>
                  {formatClock(m.outfieldMs)}
                  {m.goalkeeperMs > 0 ? ` · GK ${formatClock(m.goalkeeperMs)}` : ''}
                </Text>
              </View>
            ))}
          </View>
        )}

        {view.canEnd && (
          <Pressable
            style={({ pressed }) => [
              screen.button,
              view.isOvertime && screen.buttonUrgent,
              pressed && screen.buttonPressed,
            ]}
            onPress={() => {
              setSelected(null);
              // Read at the tap from the anchors: within the margin, end now
              // as always; past it, ask (#180).
              const choices = quarter ? periodEndChoices(engine, state, quarter) : null;
              if (choices) setEndChoices(choices);
              else onEndQuarter();
            }}
          >
            <Text style={screen.buttonLabel}>End {noun}</Text>
          </Pressable>
        )}
        {view.isMatchOver && (
          <Pressable
            style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]}
            onPress={onFinish}
          >
            <Text style={screen.buttonLabel}>See the minutes</Text>
          </Pressable>
        )}

        {stream.length > 0 && (
          <>
            <Text style={screen.fieldLabel}>Time stream</Text>
            {[...stream].reverse().map((row, i) => (
              <View key={`${row.atMs}-${i}`}>
                <View style={local.streamRow}>
                  <Text style={local.streamTime}>{formatClock(row.atMs)}</Text>
                  <Text style={[local.streamText, row.withdrawn && local.withdrawn]} numberOfLines={2}>
                    {row.text}
                  </Text>
                  {row.eventId && !row.withdrawn && (
                    <Pressable
                      onPress={() => setWithdrawing({ id: row.eventId!, note: '' })}
                      style={local.withdrawHit}
                    >
                      <Text style={local.withdrawLink}>Withdraw</Text>
                    </Pressable>
                  )}
                </View>
                {withdrawing?.id === row.eventId && (
                  <View style={local.withdrawBox}>
                    <TextInput
                      style={screen.input}
                      value={withdrawing.note}
                      onChangeText={(note) => setWithdrawing({ ...withdrawing, note })}
                      placeholder="Why? (needed)"
                      placeholderTextColor={colours.inkFaint}
                      maxLength={120}
                    />
                    <View style={screen.actions}>
                      <Pressable
                        disabled={withdrawing.note.trim() === ''}
                        onPress={() => {
                          if (onWithdraw(withdrawing.id, withdrawing.note)) setWithdrawing(null);
                        }}
                        style={screen.linkHit}
                      >
                        <Text style={[screen.dangerLink, withdrawing.note.trim() === '' && local.faint]}>
                          Withdraw it
                        </Text>
                      </Pressable>
                      <Pressable onPress={() => setWithdrawing(null)} style={screen.linkHit}>
                        <Text style={screen.link}>Keep it</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            ))}
          </>
        )}

        {onPlanRest && !view.isMatchOver && (
          <Pressable onPress={onPlanRest} style={screen.linkHit}>
            <Text style={screen.link}>Plan the rest of the match</Text>
          </Pressable>
        )}
        {onAnalysis && (
          <Pressable onPress={onAnalysis} style={screen.linkHit}>
            <Text style={screen.link}>Playing time chart — the clock keeps running</Text>
          </Pressable>
        )}
        <Pressable onPress={onLeave} style={screen.linkHit}>
          <Text style={screen.link}>
            {view.isMatchOver ? 'Leave — go to Home' : 'Leave — the match keeps running'}
          </Text>
        </Pressable>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* The tap sheet (#84): what can be recorded for this player. */}
      <ActionSheet
        visible={sheetFor !== null}
        title={sheetFor ? `${nameOf(sheetFor)}${sheetFor === keeper ? ' (in goal)' : ''}` : ''}
        onClose={() => setSheetFor(null)}
      >
        {sheetFor && (
          <>
            {onIds.has(sheetFor) && (
              <>
                <EventButtons kinds={tapEventsFor(sheetFor === keeper)} onPress={(kind) => record(kind, sheetFor)} />
                <TallyButtons tallies={tallies} onPress={(kind, team) => tally(kind, team, sheetFor)} />
              </>
            )}
            <SheetButton
              label="Move or swap…"
              onPress={() => {
                setSelected(sheetFor);
                setSheetFor(null);
              }}
            />
          </>
        )}
      </ActionSheet>

      {/* #203 AC2: change one planned sub. The plan only; nothing is recorded. */}
      <SubPlanSheet
        sub={running ? sheetSub : null}
        nameOf={nameOf}
        outfieldOn={outfieldOn}
        suggested={
          sheetSub
            ? (offPicks(setSubFor(subPlan, sheetSub.playerId, null), outfieldStints).get(sheetSub.playerId)
                ?.offId ?? null)
            : null
        }
        canPromptAgain={
          sheetSub !== null && putOff(sheetSub) && subBand(sheetSub, periodElapsedMs) !== null
        }
        onMove={(deltaMs) =>
          sheetSub && changeSheetSub((plan) => moveSubTime(plan, sheetSub.playerId, deltaMs, periodMs))
        }
        onSetFor={(offId) => sheetSub && changeSheetSub((plan) => setSubFor(plan, sheetSub.playerId, offId))}
        onPromptAgain={() => {
          if (sheetSub) notNowLog.current = promptAgain(notNowLog.current, periodKey, sheetSub);
          setPlanSheetFor(null);
        }}
        onRemove={() => {
          if (sheetSub) changeSheetSub((plan) => removeSub(plan, sheetSub.playerId));
          setPlanSheetFor(null);
        }}
        onClose={() => setPlanSheetFor(null)}
      />

      {/* #185: a goal asks who set it up, from the players on the pitch. */}
      <ActionSheet
        visible={assistFor !== null}
        title="Who set it up?"
        onClose={() => setAssistFor(null)}
        closeLabel="No assist"
      >
        {assistFor?.playerId &&
          assistCandidates([...onIds], assistFor.playerId).map((id) => (
            <AssistButton key={id} name={nameOf(id)} onPress={() => assist(assistFor, id)} />
          ))}
      </ActionSheet>

      {/* #180: the forgotten clock. Spec 02's words; "Still playing" changes nothing. */}
      <ActionSheet
        visible={endChoices !== null}
        title={`When did the ${noun} end?`}
        onClose={() => setEndChoices(null)}
        closeLabel="Still playing"
      >
        {endChoices && (
          <>
            <SheetButton
              label={endChoices.planned.label}
              strong
              onPress={() => {
                setEndChoices(null);
                onEndQuarter(endChoices.planned.atMs);
              }}
            />
            <SheetButton
              label={endChoices.now.label}
              onPress={() => {
                setEndChoices(null);
                onEndQuarter();
              }}
            />
          </>
        )}
      </ActionSheet>

      {undoLive && (
        <View style={local.toast}>
          <Text style={local.toastText} numberOfLines={2}>
            {undo!.label}
          </Text>
          <Pressable
            onPress={() => {
              undo!.run();
              setUndo(null);
            }}
            style={local.toastButton}
          >
            <Text style={local.toastButtonText}>Undo</Text>
          </Pressable>
        </View>
      )}
      <StatusBar style="light" />
    </View>
  );
}

const local = StyleSheet.create({
  scoreRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  team: { flex: 1, color: colours.inkMuted, fontSize: 15, fontWeight: '600', includeFontPadding: false },
  them: { textAlign: 'right' },
  score: {
    color: colours.ink,
    fontSize: 34,
    fontWeight: '700',
    includeFontPadding: false,
    flexShrink: 0,
    width: 110,
    textAlign: 'center',
  },
  clock: {
    color: colours.ink,
    fontSize: 48,
    fontWeight: '300',
    letterSpacing: 2,
    width: '100%',
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  streamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOUCH_TARGET,
    borderBottomWidth: 1,
    borderBottomColor: '#164f3c',
  },
  streamTime: { width: 56, flexShrink: 0, color: colours.inkMuted, fontSize: 13, includeFontPadding: false },
  streamText: { flex: 1, color: colours.ink, fontSize: 14, includeFontPadding: false },
  withdrawn: { color: colours.inkFaint, textDecorationLine: 'line-through' },
  withdrawHit: { minHeight: TOUCH_TARGET, justifyContent: 'center', paddingLeft: 10, flexShrink: 0 },
  withdrawLink: { color: colours.inkMuted, fontSize: 13, textDecorationLine: 'underline', includeFontPadding: false },
  withdrawBox: { paddingVertical: 8 },
  faint: { color: colours.inkFaint },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: UNDO_TOAST.bg,
    borderColor: colours.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
  },
  toastText: { flex: 1, color: UNDO_TOAST.text, fontSize: 15, includeFontPadding: false },
  toastButton: {
    backgroundColor: UNDO_TOAST.buttonBg,
    borderRadius: 10,
    minHeight: TOUCH_TARGET,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  toastButtonText: { color: UNDO_TOAST.buttonText, fontSize: 15, fontWeight: '700', includeFontPadding: false },
});
