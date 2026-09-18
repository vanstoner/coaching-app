import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import {
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { MatchEngine } from './src/engine/MatchEngine';
import type { MatchState } from './src/engine/MatchEngine';
import { uuid } from './src/types/index';
import type { Format, Player, UUID } from './src/types/index';
import {
  deriveClockView,
  formatClock,
  currentQuarter,
  periodNoun,
  periodNounPlural,
  TOTAL_MINUTES_CHOICES,
  PERIOD_COUNT_CHOICES,
} from './src/app/matchClock';
import {
  makeSevenASideFormat,
  PLACEHOLDER_SQUAD_NAME,
  DEFAULT_TOTAL_MINUTES,
  DEFAULT_QUARTER_COUNT,
} from './src/app/placeholderSquad';
import {
  validateName,
  makePlayer,
  displayName,
  duplicatedNames,
  squadReadiness,
  buildTeamSheet,
  MAX_NAME_LENGTH,
} from './src/app/squad';

/**
 * The setup flow, then the clock.
 *
 *   match shape (REQ-10, #10)  ->  squad (REQ-09, #9)  ->  clock (REQ-01, #1)
 *
 * Invariant 2 in practice. The interval in ClockScreen is a REPAINT trigger and
 * nothing else — every figure is recomputed by `deriveClockView` from the
 * engine's wall-clock anchors on each render, so dropping every tick still
 * leaves the clock correct the moment it repaints. That is what Android does to
 * a backgrounded app.
 *
 * Invariant 4 is enforced in src/app/squad.ts, at the point a name is typed.
 * Names entered here stay in memory on this device: nothing persists yet, and
 * ADR-011 means nothing leaves the phone when it does.
 *
 * `SafeAreaView` matters: React Native 0.86 activities are edge-to-edge, so
 * without it content slides under the status and navigation bars.
 *
 * Not built yet: substitutions (REQ-04, #4), minutes per player (REQ-03, #3),
 * persistence, and choosing who plays where (REQ-02, #2).
 */

type Step = 'match' | 'squad' | 'playing';

interface Match {
  engine: MatchEngine;
  state: MatchState;
  format: Format;
  players: Player[];
  teamSheet: Map<UUID, UUID>;
}

export default function App() {
  const [step, setStep] = useState<Step>('match');
  const [squadName, setSquadName] = useState(PLACEHOLDER_SQUAD_NAME);
  const [totalMinutes, setTotalMinutes] = useState(DEFAULT_TOTAL_MINUTES);
  const [periodCount, setPeriodCount] = useState(DEFAULT_QUARTER_COUNT);
  const [players, setPlayers] = useState<Player[]>([]);
  const [match, setMatch] = useState<Match | null>(null);

  const squadId = useMemo(() => uuid(), []);
  const format = useMemo(() => makeSevenASideFormat(), []);

  const kickOff = useCallback(() => {
    const engine = new MatchEngine();
    const state = engine.createMatch(squadId, format.id, {
      totalMinutes,
      quarterCount: periodCount,
    });
    setMatch({
      engine,
      state,
      format,
      players,
      teamSheet: buildTeamSheet(players, format.positions),
    });
    setStep('playing');
  }, [squadId, format, totalMinutes, periodCount, players]);

  if (step === 'match') {
    return (
      <MatchSetupScreen
        squadName={squadName}
        onSquadName={setSquadName}
        totalMinutes={totalMinutes}
        periodCount={periodCount}
        onTotalMinutes={setTotalMinutes}
        onPeriodCount={setPeriodCount}
        onNext={() => setStep('squad')}
      />
    );
  }

  if (step === 'squad' || match === null) {
    return (
      <SquadScreen
        squadId={squadId}
        players={players}
        onPlayers={setPlayers}
        onFieldCount={format.onFieldCount}
        onBack={() => setStep('match')}
        onKickOff={kickOff}
      />
    );
  }

  return (
    <ClockScreen
      match={match}
      squadName={squadName}
      onChangeSetup={() => setStep('match')}
    />
  );
}

// ---------------------------------------------------------------------------
// Step 1 — the shape of the match
// ---------------------------------------------------------------------------

function MatchSetupScreen({
  squadName,
  onSquadName,
  totalMinutes,
  periodCount,
  onTotalMinutes,
  onPeriodCount,
  onNext,
}: {
  squadName: string;
  onSquadName: (s: string) => void;
  totalMinutes: number;
  periodCount: number;
  onTotalMinutes: (n: number) => void;
  onPeriodCount: (n: number) => void;
  onNext: () => void;
}) {
  // Shown so the coach sees the consequence of the choice before committing,
  // rather than discovering the period length after kick-off.
  const periodMs = (totalMinutes * 60_000) / periodCount;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.caption}>Set up the match</Text>

        <Text style={styles.fieldLabel}>Team name</Text>
        <TextInput
          style={[styles.input, styles.nameInput]}
          value={squadName}
          onChangeText={onSquadName}
          placeholder="Your team"
          placeholderTextColor="#6e9787"
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={28}
          returnKeyType="done"
        />

        <Text style={styles.fieldLabel}>Match length</Text>
        <View style={styles.choiceRow}>
          {TOTAL_MINUTES_CHOICES.map((m) => (
            <Choice
              key={m}
              label={`${m}`}
              selected={m === totalMinutes}
              onPress={() => onTotalMinutes(m)}
            />
          ))}
        </View>
        <Text style={styles.hint}>minutes</Text>

        <Text style={styles.fieldLabel}>Played in</Text>
        <View style={styles.choiceRow}>
          {PERIOD_COUNT_CHOICES.map((p) => (
            <Choice
              key={p}
              label={periodNounPlural(p)}
              selected={p === periodCount}
              onPress={() => onPeriodCount(p)}
              wide
            />
          ))}
        </View>

        <Text style={styles.summary}>
          {periodCount} × {formatClock(periodMs)}{' '}
          {periodNounPlural(periodCount).toLowerCase()}
        </Text>

        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={onNext}
        >
          <Text style={styles.buttonLabel}>Next: the squad</Text>
        </Pressable>
      </View>
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — who is playing
// ---------------------------------------------------------------------------

function SquadScreen({
  squadId,
  players,
  onPlayers,
  onFieldCount,
  onBack,
  onKickOff,
}: {
  squadId: UUID;
  players: Player[];
  onPlayers: (p: Player[]) => void;
  onFieldCount: number;
  onBack: () => void;
  onKickOff: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const readiness = squadReadiness(players, onFieldCount);
  const dupes = duplicatedNames(players);

  const add = useCallback(() => {
    const check = validateName(draft);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    onPlayers([...players, makePlayer(squadId, check.cleaned)]);
    setDraft('');
    setError('');
  }, [draft, players, onPlayers, squadId]);

  const remove = useCallback(
    (id: UUID) => onPlayers(players.filter((p) => p.id !== id)),
    [players, onPlayers]
  );

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.squadInner}>
          <Text style={styles.squad}>Who is playing?</Text>
          <Text style={styles.hint}>
            First names only. Nothing leaves this phone.
          </Text>

          <View style={styles.addRow}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={(t) => {
                setDraft(t);
                if (error) setError('');
              }}
              placeholder="First name"
              placeholderTextColor="#6e9787"
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={MAX_NAME_LENGTH + 8}
              returnKeyType="done"
              onSubmitEditing={add}
            />
            <Pressable
              style={({ pressed }) => [styles.addButton, pressed && styles.buttonPressed]}
              onPress={add}
            >
              <Text style={styles.buttonLabel}>Add</Text>
            </Pressable>
          </View>

          {error !== '' && <Text style={styles.error}>{error}</Text>}

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {players.map((p, i) => (
              <View key={p.id} style={styles.playerRow}>
                <Text style={styles.playerIndex}>
                  {i < onFieldCount ? `${i + 1}` : 'sub'}
                </Text>
                <Text style={styles.playerName}>{displayName(p)}</Text>
                <Pressable onPress={() => remove(p.id)} style={styles.removeHit}>
                  <Text style={styles.remove}>Remove</Text>
                </Pressable>
              </View>
            ))}
            {players.length === 0 && (
              <Text style={styles.caption}>No players yet.</Text>
            )}
          </ScrollView>

          {dupes.length > 0 && (
            <Text style={styles.hint}>
              Two players called {dupes.join(', ')} — you can tell them apart on
              the teamsheet later.
            </Text>
          )}

          <Text style={[styles.caption, !readiness.ready && styles.overtime]}>
            {readiness.message}
          </Text>

          <View style={styles.actions}>
            <Pressable onPress={onBack} style={styles.linkHit}>
              <Text style={styles.link}>Back</Text>
            </Pressable>
            <Pressable
              disabled={!readiness.ready}
              style={({ pressed }) => [
                styles.button,
                !readiness.ready && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}
              onPress={onKickOff}
            >
              <Text style={styles.buttonLabel}>Start match</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — the clock
// ---------------------------------------------------------------------------

function ClockScreen({
  match,
  squadName,
  onChangeSetup,
}: {
  match: Match;
  squadName: string;
  onChangeSetup: () => void;
}) {
  const [, forceRepaint] = useReducer((n: number) => n + 1, 0);
  const { engine, state, format, teamSheet } = match;

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

  const view = deriveClockView(engine, state);

  // Changing the match shape mid-game would silently rewrite what has already
  // been played, so the way back is offered only before the first whistle.
  const notStartedYet = state.quarters.every((q) => q.status === 'pending');

  const onStart = useCallback(() => {
    const quarter = currentQuarter(state);
    if (!quarter) return;
    engine.startQuarter(state, quarter, teamSheet, format);
    forceRepaint();
  }, [engine, state, teamSheet, format]);

  const onEnd = useCallback(() => {
    const quarter = currentQuarter(state);
    if (!quarter) return;
    engine.endQuarter(state, quarter);
    forceRepaint();
  }, [engine, state]);

  const noun = periodNoun(state.match.quarterCount).toLowerCase();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.squad} numberOfLines={1}>
          {squadName.trim() === '' ? PLACEHOLDER_SQUAD_NAME : squadName}
        </Text>
        <Text style={styles.quarter}>{view.quarterLabel}</Text>

        <Text style={styles.clock} numberOfLines={1} adjustsFontSizeToFit>
          {formatClock(view.quarterElapsedMs)}
        </Text>

        {view.isMatchOver ? (
          <Text style={styles.caption}>
            Match elapsed {formatClock(view.matchElapsedMs)}
          </Text>
        ) : (
          <Text style={[styles.caption, view.isOvertime && styles.overtime]}>
            {view.isOvertime
              ? `${periodNoun(state.match.quarterCount)} over — end it when play stops`
              : `${formatClock(view.quarterRemainingMs)} left in this ${noun}`}
          </Text>
        )}

        <Text style={styles.caption}>
          Match total {formatClock(view.matchElapsedMs)} of{' '}
          {state.match.totalMinutes}:00
        </Text>

        <View style={styles.actions}>
          {view.canStart && (
            <Pressable
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              onPress={onStart}
            >
              <Text style={styles.buttonLabel}>Start {noun}</Text>
            </Pressable>
          )}
          {view.canEnd && (
            <Pressable
              style={({ pressed }) => [
                styles.button,
                view.isOvertime && styles.buttonUrgent,
                pressed && styles.buttonPressed,
              ]}
              onPress={onEnd}
            >
              <Text style={styles.buttonLabel}>End {noun}</Text>
            </Pressable>
          )}
        </View>

        {notStartedYet && (
          <Pressable onPress={onChangeSetup} style={styles.linkHit}>
            <Text style={styles.link}>Change match setup</Text>
          </Pressable>
        )}

        <Text style={styles.footnote}>
          {match.players.length} in the squad. Substitutions and fairness are not
          built yet.
        </Text>
      </View>
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------

function Choice({
  label,
  selected,
  onPress,
  wide,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  wide?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        wide && styles.choiceWide,
        selected && styles.choiceSelected,
        pressed && styles.buttonPressed,
      ]}
    >
      <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b3d2e' },
  flex: { flex: 1 },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  squadInner: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  squad: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '600',
    alignSelf: 'stretch',
    textAlign: 'center',
    includeFontPadding: false,
  },
  quarter: {
    color: '#cfe3da',
    fontSize: 16,
    marginTop: 4,
    marginBottom: 4,
    alignSelf: 'stretch',
    textAlign: 'center',
    includeFontPadding: false,
  },
  // No `fontVariant: ['tabular-nums']`. On a real phone that clipped the last
  // glyph and the first release read "00:0" instead of "00:00".
  clock: {
    color: '#ffffff',
    fontSize: 80,
    fontWeight: '300',
    letterSpacing: 2,
    width: '100%',
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  caption: {
    color: '#cfe3da',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 8,
    alignSelf: 'stretch',
    includeFontPadding: false,
  },
  overtime: { color: '#ffd166', fontWeight: '600' },
  error: { color: '#ffb4a2', fontSize: 14, marginTop: 8 },
  fieldLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 24,
    marginBottom: 8,
  },
  choiceRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap' },
  // Fixed width, not minWidth: the box no longer depends on Android's
  // measurement of its own text, which is what clipped "90" to "9".
  choice: {
    width: 76,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2f6b55',
    margin: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceWide: { width: 124 },
  choiceSelected: { backgroundColor: '#12855a', borderColor: '#12855a' },
  // fontWeight is the SAME in both states. Changing it on selection forces a
  // re-measure that Android applies late, so an unselected label rendered at
  // the selected width and lost its last character until it was tapped.
  // Selection is shown by colour and fill, never by metrics.
  choiceLabel: {
    color: '#cfe3da',
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    includeFontPadding: false,
    alignSelf: 'stretch',
  },
  choiceLabelSelected: { color: '#ffffff' },
  hint: {
    color: '#8fb3a5',
    fontSize: 12,
    marginTop: 4,
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  summary: {
    color: '#ffffff',
    fontSize: 17,
    marginTop: 24,
    marginBottom: 20,
    alignSelf: 'stretch',
    textAlign: 'center',
    includeFontPadding: false,
  },
  addRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  input: {
    flex: 1,
    backgroundColor: '#0f4d3a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2f6b55',
    color: '#ffffff',
    fontSize: 17,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginRight: 8,
  },
  addButton: {
    backgroundColor: '#12855a',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
  nameInput: {
    alignSelf: 'stretch',
    marginRight: 0,
    textAlign: 'center',
  },
  list: { flex: 1, marginTop: 12 },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#164f3c',
  },
  playerIndex: {
    color: '#8fb3a5',
    fontSize: 12,
    width: 34,
  },
  playerName: { color: '#ffffff', fontSize: 18, flex: 1 },
  removeHit: { padding: 6 },
  remove: { color: '#8fb3a5', fontSize: 13, textDecorationLine: 'underline' },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  button: {
    backgroundColor: '#12855a',
    paddingVertical: 15,
    paddingHorizontal: 28,
    borderRadius: 10,
  },
  buttonDisabled: { backgroundColor: '#2f6b55', opacity: 0.6 },
  buttonUrgent: { backgroundColor: '#c47f1a' },
  buttonPressed: { opacity: 0.7 },
  buttonLabel: { color: '#ffffff', fontSize: 18, fontWeight: '600' },
  linkHit: { marginTop: 4, padding: 10, marginRight: 8 },
  link: { color: '#8fb3a5', fontSize: 14, textDecorationLine: 'underline' },
  footnote: {
    color: '#8fb3a5',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 20,
  },
});
