import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, SafeAreaView, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { MatchEngine } from './src/engine/MatchEngine';
import type { MatchState } from './src/engine/MatchEngine';
import { uuid } from './src/types/index';
import type { Format, Player, UUID } from './src/types/index';
import { currentBuildLabel } from './src/app/buildLabel';
import { canDeleteFixture, matchIsUnderway, openDestination } from './src/app/fixtures';
import { currentQuarter } from './src/app/matchClock';
import {
  DEFAULT_QUARTER_COUNT,
  DEFAULT_TOTAL_MINUTES,
  PLACEHOLDER_SQUAD_NAME,
  makeSevenASideFormat,
} from './src/app/placeholderSquad';
import { DEFAULT_SHAPE, formatForShape, shapeOfFormat, type ShapeCode } from './src/app/shapes';
import { squadReadiness } from './src/app/squad';
import { teamSheetFor } from './src/app/lineup';
import { markDone, type PlannedSub } from './src/app/subPlan';
import {
  stepForTab,
  tabForStep,
  type SquadErrand,
  type Step,
  type Tab,
} from './src/app/tabs';
import {
  clearSession,
  hasMatchUnderway,
  loadSession,
  saveSession,
  toMatchState,
  type SavedMatch,
  type SavedSession,
} from './src/app/persistence';
import { createDeviceStore } from './src/app/storage';
import { ClockScreen } from './src/screens/ClockScreen';
import { FixtureFormScreen, type FixtureDraft } from './src/screens/FixtureFormScreen';
import { FixturesScreen } from './src/screens/FixturesScreen';
import { LineupScreen } from './src/screens/LineupScreen';
import { MatchSummaryScreen } from './src/screens/MatchSummaryScreen';
import { ResumeScreen } from './src/screens/ResumeScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SquadScreen } from './src/screens/SquadScreen';
import { TabBar } from './src/screens/TabBar';
import { screen } from './src/screens/theme';

/**
 * The shell — #70.
 *
 * This file is the router and the actions, and nothing else: every screen
 * lives in `src/screens/`, every rule it routes on is a tested pure function
 * in `src/app/`. It held 1,714 lines and every screen before this slice, which
 * is why the next feature would have made build 55 worse rather than better.
 *
 * ---------------------------------------------------------------------------
 * Tuesday and Saturday
 * ---------------------------------------------------------------------------
 *
 * **Tuesday** is three tabs — Home, Squad, Settings — and the frame below
 * draws them. **Saturday** is full-screen: the lineup and the clock get the
 * whole display, and their only exit is an explicit Leave which returns to
 * Home and leaves the match running. `src/app/tabs.ts` decides which is which.
 *
 * ---------------------------------------------------------------------------
 * What belongs to the squad and what belongs to the match
 * ---------------------------------------------------------------------------
 *
 * Settings holds **defaults**: team name, default length, default periods,
 * default shape. A match holds the length, period count and shape it is
 * actually played in, and carries its own format snapshot (ADR-012). So a cup
 * game in halves does not change next Saturday's league default, and changing
 * a default does not reach back into a fixture already saved.
 *
 * Invariant 2: a timer may trigger a repaint; the value it paints is always
 * recomputed from the engine's wall-clock anchors. Nothing here increments
 * anything.
 *
 * Invariant 4: first names only, enforced in `src/app/squad.ts` at entry.
 * ADR-011: everything stays on this device.
 */

/** The live match: the engine, its state, and the shape it is played in. */
interface LiveMatch {
  engine: MatchEngine;
  state: MatchState;
  format: Format;
}

export default function App() {
  const store = useMemo(() => createDeviceStore(), []);

  const [step, setStep] = useState<Step>('loading');
  const [squadName, setSquadName] = useState(PLACEHOLDER_SQUAD_NAME);
  const [players, setPlayers] = useState<Player[]>([]);
  const [squadId, setSquadId] = useState<UUID>(() => uuid());
  const [match, setMatch] = useState<LiveMatch | null>(null);
  const [pending, setPending] = useState<SavedSession | null>(null);
  const [subPlan, setSubPlan] = useState<PlannedSub[]>([]);

  // --- the defaults. Settings owns these; a match copies them. --------------
  const [totalMinutes, setTotalMinutes] = useState(DEFAULT_TOTAL_MINUTES);
  const [periodCount, setPeriodCount] = useState(DEFAULT_QUARTER_COUNT);
  /** The DEFAULT shape, as a format. The one in play is on `match`. */
  const [format, setFormat] = useState<Format>(() => makeSevenASideFormat());

  /**
   * Why the squad editor is open. As a tab it is housekeeping; on the way to a
   * match it is step one of a kick-off, and the same screen must not behave
   * the same in both — see `SquadErrand`.
   */
  const [squadErrand, setSquadErrand] = useState<SquadErrand>('home');

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
        // The shape the live match is played in, which is no longer the same
        // thing as the squad default.
        matchFormat: match?.format ?? null,
        ...overrides,
      });
    },
    [store, squadName, squadId, players, format, totalMinutes, periodCount, match, matches]
  );

  useEffect(() => {
    if (step === 'loading' || step === 'resume') return;
    persist();
  }, [step, persist]);

  // --- navigation -----------------------------------------------------------

  /**
   * The step actually rendered.
   *
   * A Saturday step with no match behind it cannot be drawn, and rendering a
   * recovery screen while the shell still believes it is on the clock is how
   * the tab bar and the body end up disagreeing. Collapsing it here keeps one
   * answer for both.
   */
  const effectiveStep: Step =
    !match && (step === 'lineup' || step === 'playing' || step === 'summary')
      ? 'fixtures'
      : step;

  const tab = tabForStep(effectiveStep, squadErrand);

  const goToTab = useCallback((next: Tab) => {
    // A tab is housekeeping by definition, so the squad editor reached this
    // way must not offer to start a match.
    setSquadErrand('home');
    setStep(stepForTab(next));
  }, []);

  /**
   * Home, without committing to anything.
   *
   * Used by every Leave on every screen. The match is deliberately KEPT in
   * state: it stays `in_progress` with its anchors intact, it stays the
   * current match on disk, and it sits at the top of Home as "In progress".
   * Clearing it here would drop `currentMatchId`, and a relaunch would then
   * not offer to resume the game the coach is standing in the middle of.
   */
  const goHome = useCallback(() => {
    persist();
    setSquadErrand('home');
    setStep('fixtures');
  }, [persist]);

  // --- actions --------------------------------------------------------------

  /**
   * Save a planned fixture. A fixture IS a Match with status 'planned', so
   * this goes through the engine rather than building a parallel record.
   *
   * The draft's length, period count and shape are copied onto the match here
   * and belong to it from then on (#70).
   */
  const saveFixture = useCallback(
    (draft: FixtureDraft) => {
      const engine = new MatchEngine();
      const matchFormat = formatForShape(draft.shape, format);
      const state = engine.createMatch(squadId, matchFormat.id, {
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
        // Snapshotted, not referenced: changing the default shape later must
        // not re-shape a fixture already saved.
        format: matchFormat,
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
      persist({ matches: next, state: match?.state ?? null, matchFormat: match?.format ?? null });
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
      persist({ matches: next });
    },
    [matches, persist]
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

      // The shape THIS match is played in. A v3 save that somehow arrives
      // unmigrated has none, and the squad default is the only honest
      // fallback — it is the format that match was created against.
      const matchFormat = stored.format ?? format;

      setMatch({
        engine,
        format: matchFormat,
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
        squadReadiness(players, matchFormat.onFieldCount).ready
      );
      if (to === 'squad') setSquadErrand('match');
      setStep(to);
    },
    [matches, players, format]
  );

  /**
   * Start a match now, from the defaults, with no fixture form — PO ruling,
   * 2026-09-20: *Play now: **yes.***
   *
   * > *"an unplanned kickabout must not force the fixture form."*
   *
   * The defaults are COPIED onto the match: its length, its period count and
   * its shape are its own from this moment, and changing Settings afterwards
   * does not touch it.
   */
  const beginMatch = useCallback(() => {
    const engine = new MatchEngine();
    const matchFormat = formatForShape(shapeOfFormat(format) ?? DEFAULT_SHAPE, format);
    const state = engine.createMatch(squadId, matchFormat.id, {
      totalMinutes,
      quarterCount: periodCount,
      // #64: without this the bench ledger is never written at all.
      availablePlayerIds: players.map((p) => p.id),
    });
    setMatch({ engine, state, format: matchFormat });
    setSubPlan([]);
    setStep('lineup');
  }, [squadId, format, totalMinutes, periodCount, players]);

  const playNow = useCallback(() => {
    if (squadReadiness(players, format.onFieldCount).ready) {
      beginMatch();
      return;
    }
    // Not enough players yet. The squad editor, then the lineup — never the
    // fixture form, which is the thing Play now exists to skip.
    setSquadErrand('match');
    setStep('squad');
  }, [players, format, beginMatch]);

  const resume = useCallback(() => {
    if (!pending) return;
    const state = toMatchState(pending);
    if (!state) {
      // The saved match could not be rebuilt. The fixtures list is somewhere
      // a coach can act from; the setup screen is no longer a front door.
      setPending(null);
      setStep('fixtures');
      return;
    }
    const stored = pending.matches.find((m) => m.match.id === state.match.id);
    setMatch({
      engine: new MatchEngine(),
      state,
      format: stored?.format ?? pending.format,
    });
    // A quarter still running goes straight to the clock; between quarters the
    // coach is owed the lineup screen, which is the whole point of the app.
    setStep(state.quarters.some((q) => q.status === 'running') ? 'playing' : 'lineup');
    setPending(null);
  }, [pending]);

  /**
   * Leave the resume prompt without resuming and without ending anything.
   *
   * The match is loaded anyway rather than dropped: it stays the current match
   * with its anchors, so Home shows it as in progress and a relaunch still
   * offers to resume it.
   */
  const leaveResume = useCallback(() => {
    if (!pending) {
      setStep('fixtures');
      return;
    }
    const state = toMatchState(pending);
    if (state) {
      const stored = pending.matches.find((m) => m.match.id === state.match.id);
      setMatch({
        engine: new MatchEngine(),
        state,
        format: stored?.format ?? pending.format,
      });
    }
    setPending(null);
    setSquadErrand('home');
    setStep('fixtures');
  }, [pending]);

  /**
   * Forget everything, including the squad. Deliberately harder to reach — it
   * is how a coach hands the phone on, not how they start next Saturday.
   */
  const forgetEverything = useCallback(() => {
    void clearSession(store);
    setMatch(null);
    setPending(null);
    setSubPlan([]);
    setPlayers([]);
    setMatches([]);
    setSquadId(uuid());
    setFormat(makeSevenASideFormat());
    setSquadName(PLACEHOLDER_SQUAD_NAME);
    setSquadErrand('home');
    setStep('fixtures');
  }, [store]);

  /** Change the DEFAULT shape. Saved fixtures keep the shape they were saved with. */
  const setDefaultShape = useCallback((shape: ShapeCode) => {
    setFormat((current) => formatForShape(shape, current));
  }, []);

  const startQuarter = useCallback(
    (onPitch: UUID[], goalkeeper: UUID | null, plan: PlannedSub[]) => {
      if (!match) return;
      const quarter = currentQuarter(match.state);
      if (!quarter) return;
      match.engine.startQuarter(
        match.state,
        quarter,
        teamSheetFor(onPitch, goalkeeper, match.format),
        match.format
      );
      setSubPlan(plan);
      setStep('playing');
      persist();
    },
    [match, persist]
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

  const body = (() => {
    if (effectiveStep === 'loading') {
      return (
        <View style={[screen.pane, screen.centre]}>
          <ActivityIndicator color="#ffffff" />
        </View>
      );
    }

    if (effectiveStep === 'resume' && pending) {
      return <ResumeScreen saved={pending} onResume={resume} onLeave={leaveResume} />;
    }

    if (effectiveStep === 'fixtureForm') {
      return (
        <FixtureFormScreen
          // Seeded from the defaults, owned by the fixture from here on.
          initial={{
            opponent: '',
            competition: null,
            kickoffAt: null,
            totalMinutes,
            periodCount,
            shape: shapeOfFormat(format) ?? DEFAULT_SHAPE,
          }}
          onSave={saveFixture}
          onCancel={() => setStep('fixtures')}
        />
      );
    }

    if (effectiveStep === 'summary' && match) {
      return (
        <MatchSummaryScreen
          engine={match.engine}
          state={match.state}
          players={players}
          now={new Date()}
          onBack={() => {
            // A finished match is history: it is safe to let go of, and
            // holding it would make Home think one is still current.
            setMatch(null);
            setStep('fixtures');
          }}
        />
      );
    }

    if (effectiveStep === 'settings') {
      return (
        <SettingsScreen
          squadName={squadName}
          onSquadName={setSquadName}
          totalMinutes={totalMinutes}
          periodCount={periodCount}
          shape={shapeOfFormat(format)}
          onTotalMinutes={setTotalMinutes}
          onPeriodCount={setPeriodCount}
          onShape={setDefaultShape}
          onForget={forgetEverything}
        />
      );
    }

    if (effectiveStep === 'squad') {
      const forMatch = squadErrand === 'match';
      return (
        <SquadScreen
          squadId={squadId}
          players={players}
          onPlayers={setPlayers}
          onFieldCount={format.onFieldCount}
          onStartMatch={forMatch ? beginMatch : null}
          onLeave={forMatch ? goHome : null}
        />
      );
    }

    if (effectiveStep === 'lineup' && match) {
      return (
        <LineupScreen
          engine={match.engine}
          state={match.state}
          format={match.format}
          players={players}
          squadName={squadName}
          onStart={startQuarter}
          onLeave={goHome}
        />
      );
    }

    if (effectiveStep === 'playing' && match) {
      return (
        <ClockScreen
          engine={match.engine}
          state={match.state}
          players={players}
          squadName={squadName}
          subPlan={subPlan}
          onMakeSub={makeSub}
          onEndQuarter={endQuarter}
          onFinish={() => setStep('summary')}
          onLeave={goHome}
        />
      );
    }

    // Home, and the recovery for any step that needs a match and has none.
    return (
      <FixturesScreen
        squadName={squadName}
        matches={matches.map((m) => m.match)}
        currentMatchId={match?.state.match.id ?? null}
        now={new Date()}
        onOpen={openFixture}
        onDelete={deleteFixture}
        onAdd={() => setStep('fixtureForm')}
        onPlayNow={match && matchIsUnderway(match.state.quarters) ? null : playNow}
        buildLabel={currentBuildLabel()}
      />
    );
  })();

  /**
   * One frame: one safe area, one status bar, and the tab bar when the screen
   * is a Tuesday one. Screens render their own content and none of the frame,
   * so a screen cannot disagree with the shell about whether it has tabs.
   */
  return (
    <SafeAreaView style={screen.safe}>
      {body}
      {tab !== null && <TabBar active={tab} onSelect={goToTab} />}
      <StatusBar style="light" />
    </SafeAreaView>
  );
}
