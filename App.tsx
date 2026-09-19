import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { currentBuildLabel } from './src/app/buildLabel';
import { canDeleteFixture, openDestination } from './src/app/fixtures';
import { FixturesScreen } from './src/screens/FixturesScreen';
import { FixtureFormScreen, type FixtureDraft } from './src/screens/FixtureFormScreen';
import { MatchSummaryScreen } from './src/screens/MatchSummaryScreen';
import {
  describeDefaults,
  normaliseTeamName,
  MAX_TEAM_NAME_LENGTH,
} from './src/app/settings';
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
  MAX_NAME_LENGTH,
} from './src/app/squad';
import { foldPlayerMinutes, type PlayerMinutes } from './src/app/playerMinutes';
import { suggestLineup, teamSheetFor, lineupIsComplete } from './src/app/lineup';
import {
  planSubs,
  nudgeSubTime,
  NO_SUB_PLANNED,
  markDone,
  dueSubs,
  msUntilNextSub,
  whoComesOff,
  type PlannedSub,
} from './src/app/subPlan';
import {
  loadSession,
  saveSession,
  clearSession,
  toMatchState,
  hasMatchUnderway,
  type SavedSession,
  type SavedMatch,
} from './src/app/persistence';
import { createDeviceStore } from './src/app/storage';

/**
 * A Saturday, in five screens.
 *
 *   resume? -> match shape -> squad -> LINEUP -> clock -> LINEUP -> clock ...
 *
 * The lineup screen is the substitution reminder. This squad rotates **between
 * quarters**, not mid-play, so the app does not interrupt the game with an
 * alarm — it stops at each boundary and shows who is owed minutes, sorted so
 * the top of the list is who should come on. The coach can take the suggestion
 * or ignore it; the override is what happens.
 *
 * Invariant 2: the interval in ClockScreen is a REPAINT trigger and nothing
 * else. Every figure is recomputed from the engine's wall-clock anchors, so a
 * throttled or dead app is still right the moment it repaints.
 *
 * Invariant 3: the fairness column is OUTFIELD minutes. Goalkeeping is shown
 * separately and never counts toward it.
 *
 * Invariant 4: first names only, enforced in src/app/squad.ts at entry.
 * ADR-011: everything stays on this device.
 */

type Step =
  | 'loading'
  | 'resume'
  | 'fixtures'
  | 'fixtureForm'
  | 'summary'
  | 'match'
  | 'settings'
  | 'squad'
  | 'lineup'
  | 'playing';

interface Match {
  engine: MatchEngine;
  state: MatchState;
}

export default function App() {
  const store = useMemo(() => createDeviceStore(), []);

  const [step, setStep] = useState<Step>('loading');
  const [squadName, setSquadName] = useState(PLACEHOLDER_SQUAD_NAME);
  const [totalMinutes, setTotalMinutes] = useState(DEFAULT_TOTAL_MINUTES);
  const [periodCount, setPeriodCount] = useState(DEFAULT_QUARTER_COUNT);
  const [players, setPlayers] = useState<Player[]>([]);
  const [format, setFormat] = useState<Format>(() => makeSevenASideFormat());
  const [squadId, setSquadId] = useState<UUID>(() => uuid());
  const [match, setMatch] = useState<Match | null>(null);
  const [pending, setPending] = useState<SavedSession | null>(null);
  const [subPlan, setSubPlan] = useState<PlannedSub[]>([]);
  // Where the squad editor goes when it is done. The same screen serves the
  // pre-match flow and settings, and it must not dump a coach who came from
  // settings into a lineup they did not ask for.
  const [squadReturn, setSquadReturn] = useState<'match' | 'settings'>('match');
  /**
   * Every match on disk: planned fixtures, played history, and the one being
   * played. Held in state because `saveSession` writes the WHOLE document —
   * anything not passed is not written, so a save that forgot this would
   * silently delete the season it was meant to be keeping.
   */
  const [matches, setMatches] = useState<SavedMatch[]>([]);

  // --- load once at launch --------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadSession(store);
      if (cancelled) return;
      if (!saved) {
        setStep('fixtures');
        return;
      }
      setSquadName(saved.squadName || PLACEHOLDER_SQUAD_NAME);
      setTotalMinutes(saved.totalMinutes);
      setPeriodCount(saved.periodCount);
      setPlayers(saved.players);
      setFormat(saved.format);
      setSquadId(saved.squadId);
      setMatches(saved.matches);

      if (hasMatchUnderway(saved)) {
        setPending(saved);
        setStep('resume');
      } else {
        // The front door (#62): "when I enter the app I should immediately see
        // a list of Future, Current, Past Fixtures if they exist."
        setStep('fixtures');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store]);

  // --- save on every change that matters ------------------------------------
  //
  // Fire and forget. `saveSession` swallows storage failure by design: a phone
  // with a full disk loses the save, never the match.

  const persist = useCallback(
    (overrides: Partial<Parameters<typeof saveSession>[1]> = {}) => {
      void saveSession(store, {
        squadName,
        squadId,
        players,
        format,
        totalMinutes,
        periodCount,
        plan: {},
        matches,
        state: match?.state ?? null,
        ...overrides,
      });
    },
    [store, squadName, squadId, players, format, totalMinutes, periodCount, match, matches]
  );

  useEffect(() => {
    if (step === 'loading' || step === 'resume') return;
    persist();
  }, [step, persist]);

  // --- actions --------------------------------------------------------------

  /**
   * Save a planned fixture. A fixture IS a Match with status 'planned', so
   * this goes through the engine rather than building a parallel record.
   */
  const saveFixture = useCallback(
    (draft: FixtureDraft) => {
      const engine = new MatchEngine();
      const state = engine.createMatch(squadId, format.id, {
        totalMinutes: draft.totalMinutes,
        quarterCount: draft.periodCount,
        availablePlayerIds: players.map((p) => p.id),
        opponent: draft.opponent.trim() === '' ? null : draft.opponent.trim(),
        competition: draft.competition,
        kickoffAt: draft.kickoffAt,
      });
      const stored: SavedMatch = {
        match: state.match,
        quarters: state.quarters,
        appearances: [],
        benchStints: [],
        availability: [],
      };
      const next = [...matches, stored];
      setMatches(next);
      // Persist immediately with the new list: the effect that saves on step
      // change would otherwise run before this state update lands, and the
      // fixture would exist on screen and not on disk.
      //
      // `state` is the LIVE match, not null. Passing null here wrote
      // currentMatchId as null and dropped the in-progress match's latest
      // anchors — so adding a fixture at half time would have lost the match
      // being played, and the coach would have relaunched into a fixture list
      // instead of their game.
      persist({ matches: next, state: match?.state ?? null });
      setStep('fixtures');
    },
    [squadId, format, matches, persist, match, players]
  );

  /**
   * Remove a fixture.
   *
   * Only a match that has never been played: deleting a played one would
   * destroy the record its minutes came from, and invariant 5 says
   * corrections are never destructive. A typo in an opponent's name, on the
   * other hand, was permanent until this existed.
   */
  const deleteFixture = useCallback(
    (matchId: UUID) => {
      const stored = matches.find((m) => m.match.id === matchId);
      if (!stored) return;
      if (!canDeleteFixture(stored.quarters, stored.match.status)) return;
      const next = matches.filter((m) => m.match.id !== matchId);
      setMatches(next);
      persist({ matches: next, state: match?.state ?? null });
    },
    [matches, persist, match]
  );

  /** Open a fixture: play it if it is today's, otherwise look at it. */
  const openFixture = useCallback(
    (matchId: UUID) => {
      const stored = matches.find((m) => m.match.id === matchId);
      if (!stored) return;
      const engine = new MatchEngine();

      const availability = new Map(stored.availability);
      const notStarted = stored.quarters.every((q) => q.status === 'pending');
      if (availability.size === 0 && notStarted) {
        // A fixture planned before availability was recorded (#64) would
        // otherwise play with an empty map and write no bench stints at all.
        //
        // Only for a match NOT YET STARTED. Back-filling one that has been
        // played would invent a bench for children who may not have been
        // there, and a fabricated figure is indistinguishable from a measured
        // one once it is stored.
        for (const player of players) availability.set(player.id, 'available');
      }

      setMatch({
        engine,
        state: {
          match: stored.match,
          quarters: stored.quarters,
          appearances: stored.appearances,
          benchStints: stored.benchStints,
          playerAvailability: availability,
        },
      });
      setSubPlan([]);

      // The rule lives in fixtures.ts and is tested there: two defects lived
      // in this decision at once and no gate could have caught either.
      const to = openDestination(
        stored.quarters,
        stored.match.status,
        squadReadiness(players, format.onFieldCount).ready
      );
      if (to === 'squad') setSquadReturn('match');
      setStep(to);
    },
    [matches, players, format]
  );

  const beginMatch = useCallback(() => {
    const engine = new MatchEngine();
    const state = engine.createMatch(squadId, format.id, {
      totalMinutes,
      quarterCount: periodCount,
      // #64: without this the bench ledger is never written at all.
      availablePlayerIds: players.map((p) => p.id),
    });
    setMatch({ engine, state });
    setStep('lineup');
  }, [squadId, format, totalMinutes, periodCount, players]);

  const resume = useCallback(() => {
    if (!pending) return;
    const engine = new MatchEngine();
    const state = toMatchState(pending);
    if (!state) {
      // The saved match could not be rebuilt. The fixtures list is somewhere
      // a coach can act from; the setup screen is no longer a front door.
      setStep('fixtures');
      return;
    }
    setMatch({ engine, state });
    // A quarter still running goes straight to the clock; between quarters the
    // coach is owed the lineup screen, which is the whole point of the app.
    setStep(state.quarters.some((q) => q.status === 'running') ? 'playing' : 'lineup');
    setPending(null);
  }, [pending]);

  /**
   * Start another match, KEEPING the squad, the team name and the defaults.
   *
   * This used to wipe all of it, so "New match" at full time threw away ten
   * names the coach had just typed. A squad is a standing thing that barely
   * changes week to week; a match is the thing that ends.
   */
  const newMatch = useCallback(() => {
    setMatch(null);
    setPending(null);
    setSubPlan([]);
    setStep('fixtures');
  }, []);

  /**
   * Forget everything, including the squad. Deliberately separate from
   * `newMatch` and deliberately harder to reach — it is how a coach hands the
   * phone on, not how they start next Saturday.
   */
  const forgetEverything = useCallback(() => {
    void clearSession(store);
    setMatch(null);
    setPending(null);
    setSubPlan([]);
    setPlayers([]);
    setSquadId(uuid());
    setFormat(makeSevenASideFormat());
    setSquadName(PLACEHOLDER_SQUAD_NAME);
    setStep('fixtures');
  }, [store]);

  const startQuarter = useCallback(
    (onPitch: UUID[], goalkeeper: UUID | null, plan: PlannedSub[]) => {
      if (!match) return;
      const quarter = currentQuarter(match.state);
      if (!quarter) return;
      match.engine.startQuarter(
        match.state,
        quarter,
        teamSheetFor(onPitch, goalkeeper, format),
        format
      );
      setSubPlan(plan);
      setStep('playing');
      persist();
    },
    [match, format, persist]
  );

  /**
   * Make a planned substitution. The engine does the swap, so the minutes move
   * with the players — a reminder that only nudged the coach would leave the
   * app recording time for a child who had walked off.
   */
  const makeSub = useCallback(
    (outPlayerId: UUID, inPlayerId: UUID) => {
      if (!match) return;
      const quarter = currentQuarter(match.state);
      if (!quarter) return;
      try {
        match.engine.substitute(match.state, quarter, outPlayerId, inPlayerId);
      } catch {
        // The engine refuses swaps that would corrupt the record. Marking the
        // plan done anyway would hide that from the coach, so leave it due.
        return;
      }
      setSubPlan((plan) => markDone(plan, inPlayerId));
      persist();
    },
    [match, persist]
  );

  const endQuarter = useCallback(() => {
    if (!match) return;
    const quarter = currentQuarter(match.state);
    if (!quarter) return;
    match.engine.endQuarter(match.state, quarter);
    setSubPlan([]);
    persist();
    // Straight to the lineup for the next period — this IS the reminder.
    setStep(currentQuarter(match.state) ? 'lineup' : 'playing');
  }, [match, persist]);

  // --- routing --------------------------------------------------------------

  if (step === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.inner}>
          <ActivityIndicator color="#ffffff" />
        </View>
        <StatusBar style="light" />
      </SafeAreaView>
    );
  }

  if (step === 'resume' && pending) {
    return <ResumeScreen saved={pending} onResume={resume} onFresh={newMatch} />;
  }

  if (step === 'match') {
    return (
      <MatchSetupScreen
        squadName={squadName}
        onSquadName={setSquadName}
        totalMinutes={totalMinutes}
        periodCount={periodCount}
        onTotalMinutes={setTotalMinutes}
        onPeriodCount={setPeriodCount}
        onNext={() => {
          setSquadReturn('match');
          setStep('squad');
        }}
        onSettings={() => setStep('settings')}
      />
    );
  }

  if (step === 'fixtures') {
    return (
      <FixturesScreen
        squadName={squadName}
        matches={matches.map((m) => m.match)}
        currentMatchId={match?.state.match.id ?? null}
        now={new Date()}
        onOpen={openFixture}
        onDelete={deleteFixture}
        onAdd={() => setStep('fixtureForm')}
        onSettings={() => setStep('settings')}
        buildLabel={currentBuildLabel()}
      />
    );
  }

  if (step === 'fixtureForm') {
    return (
      <FixtureFormScreen
        initial={{
          opponent: '',
          competition: null,
          kickoffAt: null,
          totalMinutes,
          periodCount,
        }}
        onSave={saveFixture}
        onCancel={() => setStep('fixtures')}
      />
    );
  }

  if (step === 'summary' && match) {
    return (
      <MatchSummaryScreen
        engine={match.engine}
        state={match.state}
        players={players}
        now={new Date()}
        onBack={() => {
          setMatch(null);
          setStep('fixtures');
        }}
      />
    );
  }

  if (step === 'settings') {
    return (
      <SettingsScreen
        squadName={squadName}
        onSquadName={setSquadName}
        totalMinutes={totalMinutes}
        periodCount={periodCount}
        onTotalMinutes={setTotalMinutes}
        onPeriodCount={setPeriodCount}
        players={players}
        onEditSquad={() => {
          setSquadReturn('settings');
          setStep('squad');
        }}
        onForget={forgetEverything}
        onDone={() => setStep('fixtures')}
      />
    );
  }

  if (step === 'squad') {
    const fromSettings = squadReturn === 'settings';
    return (
      <SquadScreen
        squadId={squadId}
        players={players}
        onPlayers={setPlayers}
        onFieldCount={format.onFieldCount}
        onBack={() => setStep(fromSettings ? 'settings' : 'match')}
        onNext={() => {
          if (fromSettings) {
            // Came from settings: the squad is the errand, not a prelude to a
            // match. Going on to a lineup here would start a match the coach
            // never asked to start.
            setStep('settings');
            return;
          }
          beginMatch();
        }}
        nextLabel={fromSettings ? 'Done' : 'Pick the lineup'}
        // Settings is for tidying a squad between matches, so a short squad is
        // a normal state there rather than something to block on.
        requireReady={!fromSettings}
      />
    );
  }

  if (!match) {
    // Should not happen; recover rather than render nothing.
    return (
      <MatchSetupScreen
        squadName={squadName}
        onSquadName={setSquadName}
        totalMinutes={totalMinutes}
        periodCount={periodCount}
        onTotalMinutes={setTotalMinutes}
        onPeriodCount={setPeriodCount}
        onNext={() => {
          setSquadReturn('match');
          setStep('squad');
        }}
        onSettings={() => setStep('settings')}
      />
    );
  }

  if (step === 'lineup') {
    return (
      <LineupScreen
        match={match}
        players={players}
        format={format}
        squadName={squadName}
        onStart={startQuarter}
        // Only before the first whistle. Once a period has been played the
        // squad screen is not a place to return to, and offering it would
        // suggest the match can be unwound.
        onBack={
          match.state.quarters.every((q) => q.status === 'pending')
            ? () => {
                setSquadReturn('match');
                setStep('squad');
              }
            : null
        }
      />
    );
  }

  return (
    <ClockScreen
      match={match}
      players={players}
      squadName={squadName}
      subPlan={subPlan}
      onMakeSub={makeSub}
      onEndQuarter={endQuarter}
      onStartOver={newMatch}
    />
  );
}

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

function ResumeScreen({
  saved,
  onResume,
  onFresh,
}: {
  saved: SavedSession;
  onResume: () => void;
  onFresh: () => void;
}) {
  // Computed here and now from the saved anchors, never read from the file.
  const engine = useMemo(() => new MatchEngine(), []);
  const state = useMemo(() => toMatchState(saved), [saved]);
  const elapsed = state ? engine.getMatchElapsedMs(state) : 0;
  const played = state ? state.quarters.filter((q) => q.status === 'ended').length : 0;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.squad} numberOfLines={1}>
          {saved.squadName || PLACEHOLDER_SQUAD_NAME}
        </Text>
        <Text style={styles.caption}>There is a match in progress.</Text>
        <Text style={styles.clock} numberOfLines={1} adjustsFontSizeToFit>
          {formatClock(elapsed)}
        </Text>
        <Text style={styles.caption}>
          {played} of {saved.periodCount}{' '}
          {periodNounPlural(saved.periodCount).toLowerCase()} played
        </Text>
        <Text style={styles.hint}>
          Time is worked out from the clock, so nothing was lost while the app
          was closed.
        </Text>

        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={onResume}
          >
            <Text style={styles.buttonLabel}>Resume</Text>
          </Pressable>
        </View>
        <Pressable onPress={onFresh} style={styles.linkHit}>
          <Text style={styles.link}>Start a new match instead</Text>
        </Pressable>
      </View>
      <BuildLabel />
      <StatusBar style="light" />
    </SafeAreaView>
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
  onSettings,
}: {
  squadName: string;
  onSquadName: (s: string) => void;
  totalMinutes: number;
  periodCount: number;
  onTotalMinutes: (n: number) => void;
  onPeriodCount: (n: number) => void;
  onNext: () => void;
  onSettings: () => void;
}) {
  const periodMs = (totalMinutes * 60_000) / periodCount;
  return (
    <SafeAreaView style={styles.container}>
      {/*
        SCROLLS. It did not, and the screen is centred with `justifyContent`,
        so on a shorter phone everything below the fold was simply
        unreachable — which is how build 42 shipped a Settings link and a
        build label that the coach could not see or scroll to. The APK had the
        features; the screen had no way to reach them.

        The emulator smoke gate did not catch it because it asserts that two
        strings are PRESENT, not that the whole screen is reachable. That is
        the third distinct thing that gate has been blind to.
      */}
      <ScrollView
        contentContainerStyle={styles.scrollInner}
        keyboardShouldPersistTaps="handled"
      >
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
        <Pressable onPress={onSettings} style={styles.linkHit}>
          <Text style={styles.link}>Settings</Text>
        </Pressable>
      </ScrollView>
      <BuildLabel />
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — who is in the squad
// ---------------------------------------------------------------------------

function SquadScreen({
  squadId,
  players,
  onPlayers,
  onFieldCount,
  onBack,
  onNext,
  nextLabel = 'Pick the lineup',
  requireReady = true,
}: {
  squadId: UUID;
  players: Player[];
  onPlayers: (p: Player[]) => void;
  onFieldCount: number;
  onBack: () => void;
  onNext: () => void;
  /** What the forward button says. The screen serves two errands. */
  nextLabel?: string;
  /**
   * Whether a full squad is required to go forward. True in the pre-match
   * flow; false from settings, where tidying a squad between matches is the
   * normal reason to be here.
   */
  requireReady?: boolean;
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

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.squadInner}>
          <Text style={styles.squad}>The squad</Text>
          <Text style={styles.hint}>First names only. Nothing leaves this phone.</Text>

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
            {players.map((p) => (
              <View key={p.id} style={styles.playerRow}>
                <Text style={styles.playerName}>{displayName(p)}</Text>
                <Pressable
                  onPress={() => onPlayers(players.filter((x) => x.id !== p.id))}
                  style={styles.removeHit}
                >
                  <Text style={styles.remove}>Remove</Text>
                </Pressable>
              </View>
            ))}
            {players.length === 0 && <Text style={styles.caption}>No players yet.</Text>}
          </ScrollView>

          {dupes.length > 0 && (
            <Text style={styles.hint}>Two players called {dupes.join(', ')}.</Text>
          )}
          <Text style={[styles.caption, !readiness.ready && styles.overtime]}>
            {readiness.message}
          </Text>

          <View style={styles.actions}>
            <Pressable onPress={onBack} style={styles.linkHit}>
              <Text style={styles.link}>Back</Text>
            </Pressable>
            <Pressable
              disabled={requireReady && !readiness.ready}
              style={({ pressed }) => [
                styles.button,
                requireReady && !readiness.ready && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}
              onPress={onNext}
            >
              <Text style={styles.buttonLabel}>{nextLabel}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — the lineup. This is the substitution reminder.
// ---------------------------------------------------------------------------

function LineupScreen({
  match,
  players,
  format,
  squadName,
  onStart,
  onBack,
}: {
  match: Match;
  players: Player[];
  format: Format;
  squadName: string;
  onStart: (onPitch: UUID[], goalkeeper: UUID | null, plan: PlannedSub[]) => void;
  /**
   * A way out. Before this there was none: the lineup screen had one exit and
   * it was "Start quarter", so a coach who reached it with the wrong squad —
   * or simply wanted to look at something else — was stuck until they started
   * a period they did not mean to start.
   *
   * Null between periods, where there is genuinely nowhere to go back TO: the
   * match is underway and the previous screen is a quarter that has ended.
   */
  onBack: (() => void) | null;
}) {
  const { engine, state } = match;
  const quarter = currentQuarter(state);
  const minutes = useMemo(
    () => foldPlayerMinutes(engine, state, players),
    [engine, state, players]
  );
  const suggestion = useMemo(
    () => suggestLineup(players, minutes, format),
    [players, minutes, format]
  );

  const [onPitch, setOnPitch] = useState<UUID[]>(suggestion.onPitch);
  const [goalkeeper, setGoalkeeper] = useState<UUID | null>(suggestion.goalkeeper);
  const suggestedFor = useRef(quarter?.id);

  // How long this period will run, which is what a sub time is an offset into.
  const periodMs = engine.getPlannedQuarterMs(state.match);
  const [plan, setPlan] = useState<PlannedSub[]>(() =>
    planSubs(suggestion.bench, periodMs)
  );

  // A new period means a new suggestion.
  useEffect(() => {
    if (suggestedFor.current !== quarter?.id) {
      suggestedFor.current = quarter?.id;
      setOnPitch(suggestion.onPitch);
      setGoalkeeper(suggestion.goalkeeper);
      setPlan(planSubs(suggestion.bench, periodMs));
    }
  }, [quarter?.id, suggestion, periodMs]);

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
  const complete = lineupIsComplete(onPitch, format);
  const noun = periodNoun(state.match.quarterCount);

  const toggle = (id: UUID) => {
    if (selected.has(id)) {
      setOnPitch(onPitch.filter((x) => x !== id));
      if (goalkeeper === id) setGoalkeeper(null);
    } else if (onPitch.length < format.onFieldCount) {
      setOnPitch([...onPitch, id]);
    }
  };

  // Players owed the most time first — the answer to "who comes on".
  const ordered = useMemo(
    () =>
      [...players].sort(
        (a, b) => (byId.get(a.id)?.outfieldMs ?? 0) - (byId.get(b.id)?.outfieldMs ?? 0)
      ),
    [players, byId]
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.squadInner}>
        <Text style={styles.squad} numberOfLines={1}>
          {squadName || PLACEHOLDER_SQUAD_NAME}
        </Text>
        <Text style={styles.quarter}>
          {noun} {quarter?.index ?? 1} of {state.match.quarterCount} — who is on?
        </Text>
        <Text style={styles.hint}>{suggestion.rationale}</Text>
        <Text style={styles.hint}>
          Tap a name to pick them. The time beside a substitute is when you
          will be reminded to bring them on.
        </Text>

        <ScrollView style={styles.list}>
          {ordered.map((p) => {
            const m = byId.get(p.id);
            const on = selected.has(p.id);
            const isKeeper = goalkeeper === p.id;
            return (
              <Pressable
                key={p.id}
                onPress={() => toggle(p.id)}
                style={({ pressed }) => [
                  styles.pickRow,
                  on && styles.pickRowOn,
                  pressed && styles.buttonPressed,
                ]}
              >
                <View style={styles.pickMain}>
                  <Text style={styles.playerName}>{displayName(p)}</Text>
                  <Text style={styles.pickMinutes}>
                    {formatClock(m?.outfieldMs ?? 0)} outfield
                    {(m?.goalkeeperMs ?? 0) > 0
                      ? ` · ${formatClock(m!.goalkeeperMs)} in goal`
                      : ''}
                  </Text>
                </View>
                {on ? (
                  <Pressable
                    onPress={() => setGoalkeeper(isKeeper ? null : p.id)}
                    style={[styles.gkChip, isKeeper && styles.gkChipOn]}
                  >
                    <Text style={[styles.gkLabel, isKeeper && styles.gkLabelOn]}>GK</Text>
                  </Pressable>
                ) : (
                  // A bench player carries the time they come on. The PO asked
                  // for exactly this: "set that time for a sub next to their
                  // name and that's the anchor for a reminder".
                  <View style={styles.subTimeRow}>
                    <Pressable
                      onPress={() => setPlan((c) => nudgeSubTime(c, p.id, -30_000, periodMs))}
                      style={styles.stepHit}
                    >
                      <Text style={styles.step}>−</Text>
                    </Pressable>
                    <Text
                      style={[
                        styles.subTime,
                        (plan.find((e) => e.playerId === p.id)?.atMs ?? 0) ===
                          NO_SUB_PLANNED && styles.subTimeOff,
                      ]}
                      numberOfLines={1}
                    >
                      {(plan.find((e) => e.playerId === p.id)?.atMs ?? 0) === NO_SUB_PLANNED
                        ? 'No sub'
                        : formatClock(plan.find((e) => e.playerId === p.id)?.atMs ?? 0)}
                    </Text>
                    <Pressable
                      onPress={() => setPlan((c) => nudgeSubTime(c, p.id, 30_000, periodMs))}
                      style={styles.stepHit}
                    >
                      <Text style={styles.step}>+</Text>
                    </Pressable>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={[styles.caption, !complete && styles.overtime]}>
          {onPitch.length} of {format.onFieldCount} picked
          {goalkeeper === null ? ' · no goalkeeper chosen' : ''}
        </Text>

        <View style={styles.actions}>
          {onBack && (
            <Pressable onPress={onBack} style={styles.linkHit}>
              <Text style={styles.link}>Back</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => {
              setOnPitch(suggestion.onPitch);
              setGoalkeeper(suggestion.goalkeeper);
            }}
            style={styles.linkHit}
          >
            <Text style={styles.link}>Use suggestion</Text>
          </Pressable>
          <Pressable
            disabled={!complete}
            style={({ pressed }) => [
              styles.button,
              !complete && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => onStart(onPitch, goalkeeper, plan)}
          >
            <Text style={styles.buttonLabel}>Start {noun.toLowerCase()}</Text>
          </Pressable>
        </View>
      </View>
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — the clock, and who is on
// ---------------------------------------------------------------------------

function ClockScreen({
  match,
  players,
  squadName,
  subPlan,
  onMakeSub,
  onEndQuarter,
  onStartOver,
}: {
  match: Match;
  players: Player[];
  squadName: string;
  subPlan: PlannedSub[];
  onMakeSub: (outPlayerId: UUID, inPlayerId: UUID) => void;
  onEndQuarter: () => void;
  onStartOver: () => void;
}) {
  const [, forceRepaint] = useReducer((n: number) => n + 1, 0);
  const { engine, state } = match;

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
  const minutes = foldPlayerMinutes(engine, state, players);
  const onPitch = minutes.filter((m) => m.onPitchNow);
  const noun = periodNoun(state.match.quarterCount).toLowerCase();
  const nameOf = (id: UUID) => players.find((p) => p.id === id)?.firstName ?? '—';

  // The reminder. `quarterElapsedMs` is capped at the planned length, so the
  // raw period elapsed is used here — a sub due at 6:15 must still show when
  // the coach is three minutes over.
  const periodElapsedMs = view.isRunning
    ? engine.getQuarterElapsedMs(currentQuarter(state)!)
    : 0;
  const due = view.isRunning ? dueSubs(subPlan, periodElapsedMs) : [];
  const untilNext = view.isRunning ? msUntilNextSub(subPlan, periodElapsedMs) : null;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.squadInner}>
        <Text style={styles.squad} numberOfLines={1}>
          {squadName || PLACEHOLDER_SQUAD_NAME}
        </Text>
        <Text style={styles.quarter}>{view.quarterLabel}</Text>

        <Text style={styles.clock} numberOfLines={1} adjustsFontSizeToFit>
          {formatClock(view.quarterElapsedMs)}
        </Text>

        {view.isMatchOver ? (
          <Text style={styles.caption}>
            Full time — {formatClock(view.matchElapsedMs)} played
          </Text>
        ) : (
          <Text style={[styles.caption, view.isOvertime && styles.overtime]}>
            {view.isOvertime
              ? `${periodNoun(state.match.quarterCount)} over — end it when play stops`
              : `${formatClock(view.quarterRemainingMs)} left in this ${noun}`}
          </Text>
        )}

        <Text style={styles.hint}>
          Match total {formatClock(view.matchElapsedMs)} of {state.match.totalMinutes}:00
        </Text>

        {due.map((sub) => {
          const off = whoComesOff(sub, onPitch);
          return (
            <View key={sub.playerId} style={styles.subDue}>
              <Text style={styles.subDueText} numberOfLines={2}>
                Bring on {nameOf(sub.playerId)}
                {off ? ` for ${nameOf(off)}` : ''}
              </Text>
              {off && (
                <Pressable
                  onPress={() => onMakeSub(off, sub.playerId)}
                  style={({ pressed }) => [styles.subDueButton, pressed && styles.buttonPressed]}
                >
                  <Text style={styles.subDueButtonLabel}>Done</Text>
                </Pressable>
              )}
            </View>
          );
        })}

        {due.length === 0 && untilNext !== null && (
          <Text style={styles.hint}>Next substitution in {formatClock(untilNext)}</Text>
        )}

        <ScrollView style={styles.list}>
          {(view.isMatchOver ? minutes : onPitch).map((m) => (
            <View key={m.playerId} style={styles.playerRow}>
              <Text style={styles.playerName}>{nameOf(m.playerId)}</Text>
              <Text style={styles.rowMinutes} numberOfLines={1}>
                {formatClock(m.outfieldMs)}
                {m.goalkeeperMs > 0 ? ` · GK ${formatClock(m.goalkeeperMs)}` : ''}
              </Text>
            </View>
          ))}
        </ScrollView>

        <View style={styles.actions}>
          {view.canEnd && (
            <Pressable
              style={({ pressed }) => [
                styles.button,
                view.isOvertime && styles.buttonUrgent,
                pressed && styles.buttonPressed,
              ]}
              onPress={onEndQuarter}
            >
              <Text style={styles.buttonLabel}>End {noun}</Text>
            </Pressable>
          )}
          {view.isMatchOver && (
            <Pressable onPress={onStartOver} style={styles.linkHit}>
              <Text style={styles.link}>New match</Text>
            </Pressable>
          )}
        </View>
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

// ---------------------------------------------------------------------------
// Settings — the things a coach sets once, not every Saturday
// ---------------------------------------------------------------------------

/**
 * Reachable without starting a match, which is the point. Before this, the
 * only door to the team name, the defaults and the squad was the pre-match
 * flow, so a coach who just wanted to add a player had to begin setting up a
 * game they were not about to play.
 *
 * The same state backs this screen and the setup screen, so the two cannot
 * disagree. That duplication is deliberate for now — the setup screen works,
 * is tested and is on the phone — and collapsing them belongs with the
 * structural design work, not with a change made on a match day.
 *
 * Nothing new is stored. `SavedSession` already carried all of it, so there is
 * no schema bump and every existing save still loads unchanged.
 */
function SettingsScreen({
  squadName,
  onSquadName,
  totalMinutes,
  periodCount,
  onTotalMinutes,
  onPeriodCount,
  players,
  onEditSquad,
  onForget,
  onDone,
}: {
  squadName: string;
  onSquadName: (s: string) => void;
  totalMinutes: number;
  periodCount: number;
  onTotalMinutes: (n: number) => void;
  onPeriodCount: (n: number) => void;
  players: Player[];
  onEditSquad: () => void;
  onForget: () => void;
  onDone: () => void;
}) {
  // Confirm before wiping, because the coach whose squad this deletes is the
  // one who typed all ten names in. Two taps, in-screen, no dialog module.
  const [confirmForget, setConfirmForget] = useState(false);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.settingsInner}>
          <Text style={styles.squad}>Settings</Text>
          <Text style={styles.hint}>
            Kept between matches. Nothing leaves this phone.
          </Text>

          <Text style={styles.fieldLabel}>Team name</Text>
          <TextInput
            style={[styles.input, styles.nameInput]}
            value={squadName}
            onChangeText={onSquadName}
            // Cleaned when the coach leaves the field rather than as they
            // type, so a space mid-word is not eaten under their thumb.
            onBlur={() =>
              onSquadName(normaliseTeamName(squadName, PLACEHOLDER_SQUAD_NAME))
            }
            placeholder="Your team"
            placeholderTextColor="#6e9787"
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={MAX_TEAM_NAME_LENGTH}
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
            {PERIOD_COUNT_CHOICES.map((pc) => (
              <Choice
                key={pc}
                label={periodNounPlural(pc)}
                selected={pc === periodCount}
                onPress={() => onPeriodCount(pc)}
                wide
              />
            ))}
          </View>

          {/* The arithmetic a coach should see before Saturday, not at kick-off. */}
          <Text style={styles.summary}>{describeDefaults(totalMinutes, periodCount)}</Text>

          <Text style={styles.fieldLabel}>Squad</Text>
          <Text style={styles.caption}>
            {players.length === 0
              ? 'Nobody yet'
              : `${players.length} ${players.length === 1 ? 'player' : 'players'}`}
          </Text>
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={onEditSquad}
          >
            <Text style={styles.buttonLabel}>Edit the squad</Text>
          </Pressable>

          <Pressable onPress={onDone} style={styles.linkHit}>
            <Text style={styles.link}>Done</Text>
          </Pressable>

          {confirmForget ? (
            <>
              <Text style={[styles.hint, styles.overtime]}>
                This deletes the squad, the team name and any saved match.
              </Text>
              <Pressable onPress={onForget} style={styles.linkHit}>
                <Text style={styles.dangerLink}>Yes, forget everything</Text>
              </Pressable>
              <Pressable onPress={() => setConfirmForget(false)} style={styles.linkHit}>
                <Text style={styles.link}>Keep it</Text>
              </Pressable>
            </>
          ) : (
            <Pressable onPress={() => setConfirmForget(true)} style={styles.linkHit}>
              <Text style={styles.dangerLink}>Forget everything</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <BuildLabel />
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Which build am I looking at? — #52
// ---------------------------------------------------------------------------

/**
 * A CI build shows its release tag verbatim, so the string on the phone can be
 * pasted into the releases page and find the exact artifact. A local run says
 * `local dev` in words and cannot be mistaken for one.
 *
 * Deliberately quiet: this is diagnostic information, not something a coach
 * reads at the touchline.
 *
 * `alignSelf: 'stretch'` and `includeFontPadding: false` are not decoration.
 * Text sized to its own measurement loses its last glyph on Android, which has
 * now happened three times on this app, and a build label missing its final
 * character is worse than no build label at all.
 */
function BuildLabel() {
  return (
    <Text style={styles.buildLabel} numberOfLines={1}>
      {currentBuildLabel()}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b3d2e' },
  buildLabel: {
    alignSelf: 'stretch',
    textAlign: 'center',
    includeFontPadding: false,
    color: '#4e7a67',
    fontSize: 11,
    paddingBottom: 6,
    paddingHorizontal: 12,
  },
  flex: { flex: 1 },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  // flexGrow with justifyContent: 'center' keeps a short screen centred and
  // lets a tall one scroll, rather than centring content off the top.
  scrollInner: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  squadInner: { flex: 1, paddingHorizontal: 18, paddingVertical: 14 },
  settingsInner: { paddingHorizontal: 18, paddingVertical: 14, paddingBottom: 28 },
  dangerLink: {
    alignSelf: 'stretch',
    textAlign: 'center',
    includeFontPadding: false,
    color: '#ffb4a2',
    fontSize: 15,
  },
  squad: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '600',
    alignSelf: 'stretch',
    textAlign: 'center',
    includeFontPadding: false,
  },
  quarter: {
    color: '#cfe3da',
    fontSize: 16,
    marginTop: 4,
    alignSelf: 'stretch',
    textAlign: 'center',
    includeFontPadding: false,
  },
  // No `fontVariant: ['tabular-nums']`. On a real phone it clipped the last
  // glyph and the first release read "00:0".
  clock: {
    color: '#ffffff',
    fontSize: 68,
    fontWeight: '300',
    letterSpacing: 2,
    width: '100%',
    textAlign: 'center',
    paddingHorizontal: 8,
    marginTop: 4,
  },
  caption: {
    color: '#cfe3da',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 6,
    alignSelf: 'stretch',
    includeFontPadding: false,
  },
  overtime: { color: '#ffd166', fontWeight: '600' },
  error: { color: '#ffb4a2', fontSize: 14, marginTop: 8 },
  fieldLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 22,
    marginBottom: 8,
  },
  choiceRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap' },
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
  // fontWeight is the SAME in both states: changing it forces an Android
  // re-measure applied late, which clipped the last character until tapped.
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
    marginTop: 22,
    marginBottom: 18,
    alignSelf: 'stretch',
    textAlign: 'center',
    includeFontPadding: false,
  },
  addRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
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
  nameInput: { alignSelf: 'stretch', marginRight: 0, textAlign: 'center' },
  addButton: {
    backgroundColor: '#12855a',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
  list: { flex: 1, marginTop: 10 },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#164f3c',
  },
  playerName: { color: '#ffffff', fontSize: 17, flex: 1, includeFontPadding: false },
  removeHit: { padding: 6 },
  remove: { color: '#8fb3a5', fontSize: 13, textDecorationLine: 'underline' },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginBottom: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#164f3c',
  },
  pickRowOn: { backgroundColor: '#12855a', borderColor: '#12855a' },
  pickMain: { flex: 1 },
  // FIX: every right-hand character was missing from the per-player times.
  // Android measures a Text once; sitting beside a `flex: 1` sibling it gets
  // squeezed and the tail is cut. `flexShrink: 0` stops the squeeze,
  // `includeFontPadding: false` makes the box match the glyphs, and the
  // trailing pad absorbs the rounding that clipped the final digit.
  pickMinutes: {
    color: '#cfe3da',
    fontSize: 12,
    marginTop: 2,
    includeFontPadding: false,
    flexShrink: 0,
    paddingRight: 4,
  },
  rowMinutes: {
    color: '#cfe3da',
    fontSize: 13,
    includeFontPadding: false,
    flexShrink: 0,
    paddingRight: 4,
    textAlign: 'right',
    minWidth: 92,
  },
  subTimeRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  // Same metrics as styles.subTime — only the colour changes. Switching
  // fontWeight between states is what clipped the last glyph off the choice
  // boxes and the clock, three times.
  subTimeOff: { color: '#6e9787' },
  stepHit: { paddingHorizontal: 10, paddingVertical: 6 },
  step: { color: '#ffffff', fontSize: 20, includeFontPadding: false },
  subTime: {
    color: '#ffd166',
    fontSize: 15,
    fontWeight: '600',
    includeFontPadding: false,
    flexShrink: 0,
    paddingHorizontal: 2,
    textAlign: 'center',
    // A FIXED width, not minWidth. "No sub" is wider than "06:15", and a box
    // that sizes itself to its own text is what clipped the last glyph off
    // the clock and the choice boxes. Wide enough for both, so neither the
    // text nor the row reflows when the coach toggles a sub off.
    width: 68,
  },
  subDue: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#c47f1a',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 10,
  },
  subDueText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    includeFontPadding: false,
  },
  subDueButton: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    flexShrink: 0,
  },
  subDueButtonLabel: {
    color: '#8a5600',
    fontSize: 15,
    fontWeight: '700',
    includeFontPadding: false,
  },
  gkChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#cfe3da',
  },
  gkChipOn: { backgroundColor: '#ffd166', borderColor: '#ffd166' },
  gkLabel: { color: '#cfe3da', fontSize: 13, fontWeight: '600' },
  gkLabelOn: { color: '#3a2a00', fontSize: 13, fontWeight: '600' },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  button: {
    backgroundColor: '#12855a',
    paddingVertical: 15,
    paddingHorizontal: 26,
    borderRadius: 10,
  },
  buttonDisabled: { backgroundColor: '#2f6b55', opacity: 0.6 },
  buttonUrgent: { backgroundColor: '#c47f1a' },
  buttonPressed: { opacity: 0.7 },
  buttonLabel: { color: '#ffffff', fontSize: 18, fontWeight: '600' },
  linkHit: { padding: 10, marginRight: 8 },
  link: { color: '#8fb3a5', fontSize: 14, textDecorationLine: 'underline' },
});
