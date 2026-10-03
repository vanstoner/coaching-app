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
 * **A tap on a player opens what can be recorded for them** (#84): Goal for
 * anyone on the pitch; Goal, Save and Conceded for the keeper; and "Move or
 * swap…" so every move is possible without dragging.
 *
 * Invariant 1: the score is folded from the events on every paint.
 * Invariant 2: the interval below is a REPAINT trigger and nothing else.
 * Invariant 3: the figure under each name is OUTFIELD minutes.
 */

import { useEffect, useReducer, useState } from 'react';
import {
  AppState,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { MatchEngine, type MatchState } from '../engine/MatchEngine';
import type { Format, MatchEvent, Player, UUID } from '../types/index';
import { currentQuarter, deriveClockView, formatClock, periodNoun } from '../app/matchClock';
import { PLACEHOLDER_SQUAD_NAME } from '../app/placeholderSquad';
import { foldPlayerMinutes } from '../app/playerMinutes';
import { dueSubs, msUntilNextSub, whoComesOff, type PlannedSub } from '../app/subPlan';
import { UNDO_NOTE, UNDO_WINDOW_MS, scoreOf, timeStream } from '../app/matchEvents';
import { liveMove, liveSheet, reverseOf, type LiveMove } from '../app/teamSheet';
import { opponentLabel } from '../app/fixtures';
import { PitchView } from './PitchView';
import { colours, screen, TOUCH_TARGET } from './theme';

type RecordKind = 'goal' | 'save' | 'conceded';

export function ClockScreen({
  engine,
  state,
  format,
  players,
  squadName,
  subPlan,
  onMakeSub,
  onLiveMove,
  onRecord,
  onWithdraw,
  onEndQuarter,
  onFinish,
  onLeave,
  onPlanRest,
}: {
  engine: MatchEngine;
  state: MatchState;
  /** The shape this match is played in. */
  format: Format;
  players: Player[];
  squadName: string;
  subPlan: PlannedSub[];
  onMakeSub: (outPlayerId: UUID, inPlayerId: UUID) => void;
  /** A swap or a substitution during play. False if the engine refused it. */
  onLiveMove: (move: LiveMove, isUndo?: boolean) => boolean;
  /** A goal, save or goal conceded. Null if the engine refused it. */
  onRecord: (kind: RecordKind, playerId: UUID) => MatchEvent | null;
  /** Take an event back, with its note (invariant 5). */
  onWithdraw: (eventId: UUID, note: string) => boolean;
  onEndQuarter: () => void;
  onFinish: () => void;
  onLeave: () => void;
  /** Re-plan the periods still to come (#88). The clock keeps running. */
  onPlanRest?: () => void;
}) {
  const [, forceRepaint] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const id = setInterval(forceRepaint, 500);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') forceRepaint();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);

  const [selected, setSelected] = useState<UUID | null>(null);
  const [sheetFor, setSheetFor] = useState<UUID | null>(null);
  const [dragging, setDragging] = useState(false);
  /** Who comes off each due sub, when the coach has changed the suggestion. */
  const [offChoice, setOffChoice] = useState<Record<string, UUID>>({});
  const [undo, setUndo] = useState<{ label: string; until: number; run: () => void } | null>(null);
  const [withdrawing, setWithdrawing] = useState<{ id: UUID; note: string } | null>(null);
  const [notice, setNotice] = useState('');

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

  const periodElapsedMs = running ? engine.getQuarterElapsedMs(quarter!) : 0;
  const due = running ? dueSubs(subPlan, periodElapsedMs) : [];
  const untilNext = running ? msUntilNextSub(subPlan, periodElapsedMs) : null;

  // The Undo toast goes away on its own once its ten seconds are up.
  const undoLive = undo !== null && Date.now() < undo.until;

  const offerUndo = (label: string, run: () => void) =>
    setUndo({ label, until: Date.now() + UNDO_WINDOW_MS, run });

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

  const record = (kind: RecordKind, id: UUID) => {
    setSheetFor(null);
    const event = onRecord(kind, id);
    if (!event) {
      setNotice('That could not be recorded.');
      return;
    }
    const label =
      kind === 'goal' ? `Goal: ${nameOf(id)}` : kind === 'save' ? `Save: ${nameOf(id)}` : 'Goal conceded';
    offerUndo(label, () => onWithdraw(event.id, UNDO_NOTE));
  };

  const stream = timeStream(state.appearances, state.events, players);

  return (
    <SafeAreaView style={screen.safe}>
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

        {/* #82 AC1: the suggestion is the default; any outfield player can be chosen. */}
        {due.map((sub) => {
          const suggested = whoComesOff(sub, onPitch);
          const chosen = offChoice[sub.playerId] ?? suggested;
          return (
            <View key={sub.playerId} style={local.subDue}>
              <Text style={local.subDueText}>Bring on {nameOf(sub.playerId)} for:</Text>
              <View style={local.choiceRow}>
                {outfieldOn.map((id) => (
                  <Pressable
                    key={id}
                    onPress={() => setOffChoice({ ...offChoice, [sub.playerId]: id })}
                    style={[local.choice, chosen === id && local.choiceOn]}
                  >
                    <Text style={[local.choiceText, chosen === id && local.choiceTextOn]} numberOfLines={1}>
                      {nameOf(id)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {chosen && (
                <Pressable
                  onPress={() => {
                    onMakeSub(chosen, sub.playerId);
                    const { [sub.playerId]: _gone, ...rest } = offChoice;
                    setOffChoice(rest);
                  }}
                  style={({ pressed }) => [local.subDueButton, pressed && screen.buttonPressed]}
                >
                  <Text style={local.subDueButtonLabel}>Done</Text>
                </Pressable>
              )}
            </View>
          );
        })}
        {due.length === 0 && untilNext !== null && (
          <Text style={screen.hint}>Next substitution in {formatClock(untilNext)}</Text>
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
              detailOf={(id) => formatClock(minutesOf.get(id)?.outfieldMs ?? 0)}
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
              onEndQuarter();
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
        <Pressable onPress={onLeave} style={screen.linkHit}>
          <Text style={screen.link}>
            {view.isMatchOver ? 'Leave — go to Home' : 'Leave — the match keeps running'}
          </Text>
        </Pressable>
      </ScrollView>

      {/* The tap sheet (#84): what can be recorded for this player. */}
      <Modal
        visible={sheetFor !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSheetFor(null)}
      >
        <Pressable style={local.scrim} onPress={() => setSheetFor(null)}>
          <Pressable style={local.sheet} onPress={() => {}}>
            {sheetFor && (
              <>
                <Text style={local.sheetTitle} numberOfLines={1}>
                  {nameOf(sheetFor)}
                  {sheetFor === keeper ? ' (in goal)' : ''}
                </Text>
                {onIds.has(sheetFor) && (
                  <SheetButton label="Goal" strong onPress={() => record('goal', sheetFor)} />
                )}
                {sheetFor === keeper && (
                  <>
                    <SheetButton label="Save" strong onPress={() => record('save', sheetFor)} />
                    <SheetButton label="Conceded" against onPress={() => record('conceded', sheetFor)} />
                  </>
                )}
                <SheetButton
                  label="Move or swap…"
                  onPress={() => {
                    setSelected(sheetFor);
                    setSheetFor(null);
                  }}
                />
                <Pressable onPress={() => setSheetFor(null)} style={screen.linkHit}>
                  <Text style={screen.link}>Cancel</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

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
    </SafeAreaView>
  );
}

function SheetButton({
  label,
  onPress,
  strong,
  against,
}: {
  label: string;
  onPress: () => void;
  strong?: boolean;
  against?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        local.sheetButton,
        strong && local.sheetButtonStrong,
        against && local.sheetButtonAgainst,
        pressed && screen.buttonPressed,
      ]}
    >
      <Text style={[local.sheetButtonText, against && local.againstText]}>{label}</Text>
    </Pressable>
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
  subDue: {
    backgroundColor: colours.urgent,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 10,
    alignSelf: 'stretch',
  },
  subDueText: { color: colours.ink, fontSize: 16, fontWeight: '700', includeFontPadding: false },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  choice: {
    width: 96,
    minHeight: TOUCH_TARGET,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colours.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
    marginBottom: 6,
  },
  choiceOn: { backgroundColor: colours.ink },
  choiceText: { color: colours.ink, fontSize: 14, fontWeight: '600', includeFontPadding: false, alignSelf: 'stretch', textAlign: 'center' },
  choiceTextOn: { color: '#8a5600' },
  subDueButton: {
    backgroundColor: colours.ink,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: TOUCH_TARGET,
    marginTop: 4,
  },
  subDueButtonLabel: { color: '#8a5600', fontSize: 15, fontWeight: '700', includeFontPadding: false },
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
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colours.pitchRaised,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 28,
  },
  sheetTitle: { color: colours.ink, fontSize: 22, fontWeight: '700', marginBottom: 8, includeFontPadding: false },
  sheetButton: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colours.line,
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sheetButtonStrong: { backgroundColor: colours.accent, borderColor: colours.accent },
  sheetButtonAgainst: { borderColor: colours.danger },
  sheetButtonText: { color: colours.ink, fontSize: 17, fontWeight: '600', includeFontPadding: false },
  againstText: { color: colours.danger },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1d2a25',
    borderColor: colours.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
  },
  toastText: { flex: 1, color: colours.ink, fontSize: 15, includeFontPadding: false },
  toastButton: {
    backgroundColor: colours.warn,
    borderRadius: 10,
    minHeight: TOUCH_TARGET,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  toastButtonText: { color: '#3a2a00', fontSize: 15, fontWeight: '700', includeFontPadding: false },
});
