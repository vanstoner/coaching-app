import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, SafeAreaView, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { MatchEngine } from './src/engine/MatchEngine';
import type { MatchState } from './src/engine/MatchEngine';
import { uuid } from './src/types/index';
import type { Format, Player, UUID } from './src/types/index';
import { currentBuildLabel } from './src/app/buildLabel';
import {
  canArchiveFixture,
  canDeleteFixture,
  listedFixtures,
  matchIsUnderway,
  openDestination,
} from './src/app/fixtures';
import { currentQuarter } from './src/app/matchClock';
import {
  DEFAULT_QUARTER_COUNT,
  DEFAULT_TOTAL_MINUTES,
  PLACEHOLDER_SQUAD_NAME,
  makeSevenASideFormat,
} from './src/app/placeholderSquad';
import { DEFAULT_SHAPE, formatForShape, shapeOfFormat, type ShapeCode } from './src/app/shapes';
import {
  activePlayers,
  playedPlayerIds,
  playersForMatch,
  squadReadiness,
} from './src/app/squad';
import { toTeamSheet, type Sheet } from './src/app/teamSheet';
import { markDone, type PlannedSub } from './src/app/subPlan';
import { planHasContent, type MatchPlan } from './src/app/matchPlan';
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
import {
  describeMerge,
  emptyLedger,
  mergeLedger,
  parseLedger,
  recordMatches,
  type Ledger,
  type MatchRecord,
} from './src/app/ledger';
import { clearLedger, loadLedger, sameRecords, saveLedger } from './src/app/ledgerStore';
import { exportLedgerFile, pickLedgerFile } from './src/app/ledgerFile';
import { MinutesSection } from './src/screens/MinutesSection';
import { ClockScreen } from './src/screens/ClockScreen';
import { FixtureFormScreen, type FixtureDraft } from './src/screens/FixtureFormScreen';
import { FixturesScreen } from './src/screens/FixturesScreen';
import { LineupScreen } from './src/screens/LineupScreen';
import { MatchSummaryScreen } from './src/screens/MatchSummaryScreen';
import { PlanScreen } from './src/screens/PlanScreen';
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
  /** Everyone ever in the squad, retired players included (#77). */
  const [players, setPlayers] = useState<Player[]>([]);
  /** Today's squad: who can be picked, planned and counted for new matches. */
  const squad = useMemo(() => activePlayers(players), [players]);
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

  /** Whether archived fixtures are listed (#76). A view choice, not saved. */
  const [showArchived, setShowArchived] = useState(false);

  /** The fixture whose plan is open (#72). */
  const [planningId, setPlanningId] = useState<UUID | null>(null);

  // --- the minutes ledger (#75, ADR-013) ------------------------------------
  //
  // Player time, kept under its own key and written alongside every save. The
  // ref is the value; the state is only so Settings repaints.
  const ledgerRef = useRef<Ledger | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [ledgerMessage, setLedgerMessage] = useState('');
  const [ledgerBusy, setLedgerBusy] = useState(false);

  const commitLedger = useCallback(
    (next: Ledger) => {
      const current = ledgerRef.current;
      ledgerRef.current = next;
      setLedger(next);
      // Skip the write when nothing a coach cares about changed.
      if (current && sameRecords(current, next)) return;
      void saveLedger(store, next);
    },
    [store]
  );

  // --- load once at launch --------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Read once, before any save can run: launch must never write over
      // the ledger with an empty one.
      const saved = await loadSession(store);
      const storedLedger = await loadLedger(store);
      if (cancelled) return;

      // AC7: back-fill. Every match already played is copied in from its
      // recorded appearances — measured values, never estimated ones. On
      // every later launch this is a no-op: recording is idempotent by id.
      const base =
        storedLedger ??
        emptyLedger(saved?.squadId ?? squadId, saved?.squadName ?? PLACEHOLDER_SQUAD_NAME);
      commitLedger(
        saved
          ? recordMatches(base, saved.matches, saved.players, saved.squadName, new Date())
          : base
      );

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
    // Launch only. squadId is read for a brand-new install's empty ledger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      // The ledger, from the same records. Only closed intervals reach it, so
      // a period ending is what puts minutes in; nothing is ever removed.
      if (ledgerRef.current) {
        const live = 'state' in overrides ? overrides.state : (match?.state ?? null);
        const records: MatchRecord[] = [...(overrides.matches ?? matches)];
        if (live) records.push(live);
        commitLedger(
          recordMatches(
            ledgerRef.current,
            records,
            overrides.players ?? players,
            overrides.squadName ?? squadName,
            new Date()
          )
        );
      }
    },
    [store, squadName, squadId, players, format, totalMinutes, periodCount, match, matches, commitLedger]
  );

  /** Export the minutes file — an explicit act, to where the coach chooses (ADR-011 §4). */
  const exportMinutes = useCallback(async () => {
    if (!ledgerRef.current) return;
    setLedgerBusy(true);
    const result = await exportLedgerFile(ledgerRef.current, new Date());
    setLedgerBusy(false);
    setLedgerMessage(result.ok ? '' : result.reason);
  }, []);

  /**
   * Import a minutes file (AC5, AC6). Merged by id: new things are added,
   * nothing is overwritten or deleted. Players the squad does not have come
   * back with the same ids, so later matches line up with the imported ones.
   */
  const importMinutes = useCallback(async () => {
    setLedgerBusy(true);
    const picked = await pickLedgerFile();
    setLedgerBusy(false);
    if (!picked.ok) {
      setLedgerMessage(picked.reason);
      return;
    }
    if (picked.text === null) return; // cancelled
    const parsed = parseLedger(picked.text);
    if (!parsed.ok) {
      setLedgerMessage(parsed.reason);
      return;
    }
    const current = ledgerRef.current ?? emptyLedger(squadId, squadName);
    const report = mergeLedger(current, parsed.ledger, new Date());
    commitLedger(report.ledger);

    const fresh = players.length === 0 && matches.length === 0;
    const known = new Set(players.map((p) => p.id));
    const restored: Player[] = report.ledger.players
      .filter((p) => !known.has(p.id))
      .map((p) => ({
        id: p.id,
        squadId: fresh ? report.ledger.squad.id : squadId,
        firstName: p.firstName,
        displaySuffix: p.displaySuffix,
        squadNumber: null,
        active: p.active,
        createdAt: new Date().toISOString(),
      }));
    const nextPlayers = [...players, ...restored];
    const nextSquadId = fresh && report.ledger.squad.id ? report.ledger.squad.id : squadId;
    const nextName = fresh && report.ledger.squad.name ? report.ledger.squad.name : squadName;
    setPlayers(nextPlayers);
    setSquadId(nextSquadId);
    setSquadName(nextName);
    persist({ players: nextPlayers, squadId: nextSquadId, squadName: nextName });
    setLedgerMessage(describeMerge(report));
  }, [squadId, squadName, players, matches, persist, commitLedger]);

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
  const planning = matches.find((m) => m.match.id === planningId);
  const effectiveStep: Step =
    (!match && (step === 'lineup' || step === 'playing' || step === 'summary')) ||
    (step === 'plan' && !planning)
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
        availablePlayerIds: squad.map((p) => p.id),
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
    [squadId, format, matches, persist, match, squad]
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
      // A fixture opened and left without kicking off is still held as the
      // live match. Saving with it would write the deleted fixture straight
      // back (mergeCurrentMatch), so it is let go of first.
      const holding = match?.state.match.id === matchId;
      if (holding) setMatch(null);
      persist({
        matches: next,
        ...(holding ? { state: null, matchFormat: null } : {}),
      });
    },
    [matches, persist, match]
  );

  /**
   * Save a fixture's plan — #72. Called on every edit, so there is no Save
   * button to forget. A plan is intent: nothing here touches a minute.
   */
  const savePlan = useCallback(
    (matchId: UUID, plan: MatchPlan) => {
      const next = matches.map((m) => (m.match.id === matchId ? { ...m, plan } : m));
      setMatches(next);
      persist({ matches: next });
    },
    [matches, persist]
  );

  /**
   * Archive or unarchive a played fixture — #76. A listing choice only: no
   * event is written and its minutes are untouched.
   */
  const archiveFixture = useCallback(
    (matchId: UUID, archived: boolean) => {
      const next = matches.map((m) => (m.match.id === matchId ? { ...m, archived } : m));
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
        for (const player of squad) availability.set(player.id, 'available');
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
        squadReadiness(squad, matchFormat.onFieldCount).ready
      );
      if (to === 'squad') setSquadErrand('match');
      setStep(to);
    },
    [matches, squad, format]
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
      availablePlayerIds: squad.map((p) => p.id),
    });
    setMatch({ engine, state, format: matchFormat });
    setSubPlan([]);
    setStep('lineup');
  }, [squadId, format, totalMinutes, periodCount, squad]);

  const playNow = useCallback(() => {
    if (squadReadiness(squad, format.onFieldCount).ready) {
      beginMatch();
      return;
    }
    // Not enough players yet. The squad editor, then the lineup — never the
    // fixture form, which is the thing Play now exists to skip.
    setSquadErrand('match');
    setStep('squad');
  }, [squad, format, beginMatch]);

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
    // The minutes go too: this is how a phone is handed on, and children's
    // data must not stay behind. The confirm text says to export first.
    void clearLedger(store);
    const nextSquadId = uuid();
    // A fresh, empty ledger rather than none, so the next match is recorded.
    const fresh = emptyLedger(nextSquadId, PLACEHOLDER_SQUAD_NAME);
    ledgerRef.current = fresh;
    setLedger(fresh);
    setLedgerMessage('');
    setMatch(null);
    setPending(null);
    setSubPlan([]);
    setPlayers([]);
    setMatches([]);
    setSquadId(nextSquadId);
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
    (sheet: Sheet, plan: PlannedSub[]) => {
      if (!match) return;
      const quarter = currentQuarter(match.state);
      if (!quarter) return;
      // What the coach started with, position by position (#72, AC9). Never
      // the plan: the plan only filled the screen in (AC8).
      match.engine.startQuarter(match.state, quarter, toTeamSheet(sheet), match.format);
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

    if (effectiveStep === 'plan' && planning) {
      return (
        <PlanScreen
          match={planning.match}
          // The shape THIS fixture is played in (ADR-012).
          format={planning.format ?? format}
          players={squad}
          plan={planning.plan}
          onChange={(plan) => savePlan(planning.match.id, plan)}
          onBack={() => setStep('fixtures')}
        />
      );
    }

    if (effectiveStep === 'summary' && match) {
      return (
        <MatchSummaryScreen
          engine={match.engine}
          state={match.state}
          players={playersForMatch(players, match.state.appearances)}
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
          minutes={
            <MinutesSection
              ledger={ledger}
              message={ledgerMessage}
              busy={ledgerBusy}
              onExport={() => void exportMinutes()}
              onImport={() => void importMinutes()}
            />
          }
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
          played={playedPlayerIds([...matches, ...(match ? [match.state] : [])])}
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
          players={playersForMatch(players, match.state.appearances)}
          squadName={squadName}
          // This period of the fixture's plan, if one was made (#72, AC7).
          planned={
            matches.find((m) => m.match.id === match.state.match.id)?.plan?.periods[
              (currentQuarter(match.state)?.index ?? 1) - 1
            ]
          }
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
          players={playersForMatch(players, match.state.appearances)}
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
        matches={listedFixtures(matches, showArchived).map((m) => m.match)}
        currentMatchId={match?.state.match.id ?? null}
        now={new Date()}
        onOpen={openFixture}
        onDelete={deleteFixture}
        onAdd={() => setStep('fixtureForm')}
        onPlan={(id) => {
          setPlanningId(id);
          setStep('plan');
        }}
        plannedIds={new Set(matches.filter((m) => planHasContent(m.plan)).map((m) => m.match.id))}
        housekeeping={{
          // The live match's quarters, not the stored copy's: a fixture kicked
          // off a moment ago must not still be offered for deletion.
          deletable: new Set(
            matches
              .filter((m) => {
                const live = match?.state.match.id === m.match.id ? match.state : m;
                return canDeleteFixture(live.quarters, live.match.status);
              })
              .map((m) => m.match.id)
          ),
          archivable: new Set(
            matches
              .filter((m) => {
                const live = match?.state.match.id === m.match.id ? match.state : m;
                return canArchiveFixture(live.quarters, live.match.status);
              })
              .map((m) => m.match.id)
          ),
          archived: new Set(matches.filter((m) => m.archived).map((m) => m.match.id)),
          onArchive: archiveFixture,
          archivedCount: matches.filter((m) => m.archived).length,
          showingArchived: showArchived,
          onToggleArchived: () => setShowArchived((v) => !v),
        }}
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
