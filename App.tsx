import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, SafeAreaView, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { MatchEngine } from './src/engine/MatchEngine';
import type { MatchState } from './src/engine/MatchEngine';
import { uuid } from './src/types/index';
import type { AvailabilityStatus, Format, MatchEvent, Player, UUID } from './src/types/index';
import { currentBuildLabel } from './src/app/buildLabel';
import {
  appClockSetting,
  appNow,
  parseClockSetting,
  setAppClock,
  setAppClockSpeed,
  type ClockSpeed,
} from './src/app/appClock';
import { TEST_CLOCK_KEY, addTestData, isBetaBuild } from './src/app/testKit';
import { addTestSeason } from './src/app/testSeason';
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
import { lineupAtPeriodEnd, toTeamSheet, type LiveMove, type Sheet } from './src/app/teamSheet';
import { markDone, type PlannedSub } from './src/app/subPlan';
import { liveBaseline, planHasContent, type MatchPlan } from './src/app/matchPlan';
import { foldPlayerMinutes } from './src/app/playerMinutes';
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
import { progressById, scoresById, withLiveMatch } from './src/app/liveMatch';
import { kickoffTimes } from './src/app/attendance';
import {
  canEndMatch,
  correctMatchAttendance,
  endMatch,
  notClosedIds,
  recordLateArrival,
  setHereToday,
} from './src/app/matchClosing';
import {
  deleteMatch,
  matchesOnRelease,
  newMatch,
  openMatch,
  storedFromHeld,
} from './src/app/matchLifecycle';
import {
  describeImport,
  emptyLedger,
  importLedger,
  parseLedger,
  recordMatches,
  type Ledger,
  type MatchRecord,
} from './src/app/ledger';
import { clearLedger, openStoredLedger, sameRecords, saveLedger } from './src/app/ledgerStore';
import { exportLedgerFile, pickLedgerFile } from './src/app/ledgerFile';
import { exportedMessage, importedMessage } from './src/app/ledgerAnchor';
import { beforeKickoff, fillSquadAtKickoff, pickablePlayers } from './src/app/absence';
import { MinutesSection } from './src/screens/MinutesSection';
import { ClockScreen } from './src/screens/ClockScreen';
import { FixtureFormScreen, type FixtureDraft } from './src/screens/FixtureFormScreen';
import { FixturesScreen } from './src/screens/FixturesScreen';
import { LineupScreen } from './src/screens/LineupScreen';
import { MatchSummaryScreen } from './src/screens/MatchSummaryScreen';
import { MatchAnalysisScreen } from './src/screens/MatchAnalysisScreen';
import { SeasonChartLink, SeasonScreen } from './src/screens/SeasonScreen';
import { PlanScreen } from './src/screens/PlanScreen';
import { ResumeScreen } from './src/screens/ResumeScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { TestKitSection } from './src/screens/TestKitSection';
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
  // --- the Test kit (#95): Coaching Beta only ---------------------------------
  const isBeta = useMemo(() => isBetaBuild(currentBuildLabel()), []);
  const [clockSpeed, setClockSpeed] = useState<ClockSpeed>(1);
  const [testKitMessage, setTestKitMessage] = useState('');

  const ledgerRef = useRef<Ledger | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [ledgerMessage, setLedgerMessage] = useState('');
  const [ledgerBusy, setLedgerBusy] = useState(false);
  /**
   * The stored ledger was written by a newer build that says this one cannot
   * safely write it back (#99 AC2). Nothing is recorded, imported or saved
   * over it until the app is updated — or Forget everything clears it.
   */
  const ledgerBlockedRef = useRef(false);

  const commitLedger = useCallback(
    (next: Ledger) => {
      if (ledgerBlockedRef.current) return;
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
      // The beta's clock first (#95), before anything reads the time: its
      // stored offset keeps the clock from running backwards across a relaunch.
      if (isBeta) {
        setAppClock(parseClockSetting(await store.getItem(TEST_CLOCK_KEY).catch(() => null)));
        setClockSpeed(appClockSetting().speed);
      }

      // Read once, before any save can run: launch must never write over
      // the ledger with an empty one.
      const saved = await loadSession(store);
      // A ledger that will not read is set aside intact, never written over;
      // one this build may not write is left alone (#99, QA on #110).
      const opened = await openStoredLedger(store, appNow());
      if (cancelled) return;
      if (!opened.writable) ledgerBlockedRef.current = true;
      if (opened.message !== '') setLedgerMessage(opened.message);
      // A newer build's ledger that verified: shown, never written (ADR-014 §10).
      if (opened.view) setLedger(opened.view);
      const storedLedger = opened.ledger;

      // AC7: back-fill. Every match already played is copied in from its
      // recorded appearances — measured values, never estimated ones. On
      // every later launch this is a no-op: recording is idempotent by id.
      const base =
        storedLedger ??
        emptyLedger(
          saved?.squadId ?? squadId,
          saved?.squadName ?? PLACEHOLDER_SQUAD_NAME,
          appNow(),
          // A new chain after an unreadable one names where it was set aside (#100 AC7).
          opened.follows
        );
      commitLedger(
        saved
          ? recordMatches(base, saved.matches, saved.players, saved.squadName, appNow())
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
            appNow()
          )
        );
      }
    },
    [store, squadName, squadId, players, format, totalMinutes, periodCount, match, matches, commitLedger]
  );

  /** Export the minutes file — an explicit act, to where the coach chooses (ADR-011 §4). */
  const exportMinutes = useCallback(async () => {
    const written = ledgerRef.current;
    if (!written) return;
    setLedgerBusy(true);
    const result = await exportLedgerFile(written, appNow());
    setLedgerBusy(false);
    // Ruling N1: the count and fingerprint, for two coaches to compare.
    setLedgerMessage(result.ok ? exportedMessage(written) : result.reason);
  }, []);

  /**
   * Import a minutes file (#100 AC2, AC5; ADR-014 §9). Verified, then the
   * chain is extended — never merged: a file whose chain has diverged from
   * this phone's is refused. Players the squad does not have come back with
   * the same ids, so later matches line up with the imported ones.
   */
  const importMinutes = useCallback(async () => {
    // The ledger on this phone came from a newer build: merging into an empty
    // one and saving would write over it.
    if (ledgerBlockedRef.current) return;
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
    const current = ledgerRef.current ?? emptyLedger(squadId, squadName, appNow());
    const report = importLedger(current, parsed.ledger);
    if (!report.ok) {
      setLedgerMessage(importedMessage(report.reason, parsed.ledger, current));
      return;
    }
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
        createdAt: appNow().toISOString(),
      }));
    const nextPlayers = [...players, ...restored];
    const nextSquadId = fresh && report.ledger.squad.id ? report.ledger.squad.id : squadId;
    const nextName = fresh && report.ledger.squad.name ? report.ledger.squad.name : squadName;
    setPlayers(nextPlayers);
    setSquadId(nextSquadId);
    setSquadName(nextName);
    persist({ players: nextPlayers, squadId: nextSquadId, squadName: nextName });
    setLedgerMessage(importedMessage(describeImport(report), parsed.ledger, report.ledger));
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
  // The live match may not be in `matches` yet (Play now writes it on the
  // next save), so planning it during play (#88) builds the entry from state.
  const planning: SavedMatch | undefined =
    matches.find((m) => m.match.id === planningId) ??
    (match && match.state.match.id === planningId ? storedFromHeld(match) : undefined);
  const effectiveStep: Step =
    (!match && (step === 'lineup' || step === 'playing' || step === 'summary' || step === 'analysis')) ||
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

  /**
   * Hold a different live match, or none, without losing the one held now.
   * The held match is folded into the list FIRST — the rule, and the match
   * day 4 defect it fixes, are in `matchesOnRelease` (src/app/matchLifecycle.ts).
   */
  const releaseMatch = useCallback(
    (next: LiveMatch | null) => {
      if (match && match !== next) {
        const held = match;
        setMatches((prev) => matchesOnRelease(prev, held, next));
      }
      setMatch(next);
    },
    [match]
  );

  // --- actions --------------------------------------------------------------

  /**
   * Save a planned fixture, built by the one match builder (#99 AC1): the
   * draft's length, period count and shape are copied onto it (#70), and
   * today's squad is recorded as available (#64).
   */
  const saveFixture = useCallback(
    (draft: FixtureDraft) => {
      const { stored } = newMatch(
        {
          squadId,
          // Snapshotted, not referenced: changing the default shape later
          // must not re-shape a fixture already saved.
          format: formatForShape(draft.shape, format),
          totalMinutes: draft.totalMinutes,
          periodCount: draft.periodCount,
          players: squad,
          opponent: draft.opponent,
          competition: draft.competition,
          kickoffAt: draft.kickoffAt,
        },
        appNow
      );
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
      // Judged on the live state, never the stored copy (deleteMatch).
      const outcome = deleteMatch(matches, match, matchId);
      if (!outcome.ok) return;
      setMatches(outcome.matches);
      // A fixture opened and left without kicking off is still held as the
      // live match. Saving with it would write the deleted fixture straight
      // back (mergeCurrentMatch), so it is let go of first — directly, not
      // through releaseMatch, which would fold it back in.
      if (outcome.releaseLive) setMatch(null);
      persist({
        matches: outcome.matches,
        ...(outcome.releaseLive ? { state: null, matchFormat: null } : {}),
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
      const stored = matches.some((m) => m.match.id === matchId);
      const next = stored
        ? matches.map((m) => (m.match.id === matchId ? { ...m, plan } : m))
        : planning && planning.match.id === matchId
          ? [...matches, { ...planning, plan }]
          : matches;
      setMatches(next);
      persist({ matches: next });
    },
    [matches, persist, planning]
  );

  /** Where the analysis goes back to: the report or the clock (#105 AC3). */
  const [analysisReturn, setAnalysisReturn] = useState<'summary' | 'playing'>('summary');

  /** Where Done on the plan goes back to: Home, or the match in play (#88). */
  const [planReturn, setPlanReturn] = useState<Step>('fixtures');

  /** Re-plan the rest of the match in progress (#88). The clock keeps running. */
  const planTheRest = useCallback(() => {
    if (!match) return;
    setPlanningId(match.state.match.id);
    setPlanReturn(step);
    setStep('plan');
  }, [match, step]);

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
      // The live match is gone back to as it is; any other is rebuilt from
      // its stored copy, availability back-filled only if not yet started and
      // events carried over. The rules, and the bugs behind them, are in
      // openMatch (src/app/matchLifecycle.ts).
      const outcome = openMatch(matches, match, matchId, squad, format);
      if (outcome.kind === 'not_found') return;
      const { state, format: matchFormat } = outcome.held;
      if (outcome.kind === 'open') {
        releaseMatch({ engine: new MatchEngine({ nowFn: appNow }), state, format: matchFormat });
        setSubPlan([]);
      }

      // The rule lives in fixtures.ts and is tested there: two defects lived
      // in this decision at once and no gate could have caught either.
      const to = openDestination(
        state.quarters,
        state.match.status,
        squadReadiness(squad, matchFormat.onFieldCount).ready
      );
      if (to === 'squad') setSquadErrand('match');
      setStep(to);
    },
    [matches, squad, format, match, releaseMatch]
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
    // The same builder as a saved fixture (#99 AC1). The match is held, not
    // added to the list: the next save folds it in on disk, and letting go of
    // it folds it into the list (matchesOnRelease), so it is never lost.
    const { held } = newMatch(
      {
        squadId,
        format: formatForShape(shapeOfFormat(format) ?? DEFAULT_SHAPE, format),
        totalMinutes,
        periodCount,
        players: squad,
      },
      appNow
    );
    releaseMatch({ engine: new MatchEngine({ nowFn: appNow }), ...held });
    setSubPlan([]);
    setStep('lineup');
  }, [squadId, format, totalMinutes, periodCount, squad, releaseMatch]);

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
      engine: new MatchEngine({ nowFn: appNow }),
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
        engine: new MatchEngine({ nowFn: appNow }),
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
    const fresh = emptyLedger(nextSquadId, PLACEHOLDER_SQUAD_NAME, appNow());
    // Cleared above, so nothing newer is left to protect.
    ledgerBlockedRef.current = false;
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

  /** The engine changes the live match in place; this repaints after an absence mark. */
  const [, repaint] = useReducer((n: number) => n + 1, 0);

  /**
   * Mark a player absent, or present again, before kick-off (#102 AC1). The
   * ledger snapshots it at kick-off (ADR-014 §4); after that, nothing here
   * can change it.
   */
  const toggleAbsent = useCallback(
    (playerId: UUID, absent: boolean) => {
      if (!match) return;
      // Before kick-off a plain mark; between periods, marking an absent
      // child arrived is a late-arrival correction (ruling F, QA).
      const ledgerNow = ledgerBlockedRef.current ? null : ledgerRef.current;
      const result = setHereToday(match.engine, match.state, ledgerNow, playerId, absent, appNow());
      if (!result.changed) return;
      if (result.ledger) commitLedger(result.ledger);
      repaint();
      persist();
    },
    [match, persist, commitLedger]
  );

  /**
   * A child marked absent has just come on: they arrived late (ruling F). An
   * explicit, noted correction in the ledger — before the save that follows,
   * so the save builds on it.
   */
  const noteLateArrival = useCallback(
    (playerId: UUID) => {
      if (!match || ledgerBlockedRef.current) return;
      const result = recordLateArrival(match.engine, match.state, ledgerRef.current, playerId, appNow());
      if (result?.ok) commitLedger(result.ledger);
    },
    [match, commitLedger]
  );

  /** End match (ruling D): close it, so it counts towards season averages. */
  const closeMatch = useCallback(() => {
    if (!match || !endMatch(match.engine, match.state)) return;
    repaint();
    persist();
  }, [match, persist]);

  /** Correct attendance on the report (ruling F). The reason when refused, else null. */
  const correctAttendanceOnReport = useCallback(
    (playerId: UUID, status: AvailabilityStatus, note: string): string | null => {
      if (!match) return 'No match is open.';
      if (ledgerBlockedRef.current) return 'Player minutes cannot be written on this phone.';
      const result = correctMatchAttendance(
        match.engine,
        match.state,
        ledgerRef.current,
        playerId,
        status,
        note,
        appNow()
      );
      if (!result.ok) return result.reason;
      commitLedger(result.ledger);
      repaint();
      persist();
      return null;
    },
    [match, persist, commitLedger]
  );

  const startQuarter = useCallback(
    (sheet: Sheet, plan: PlannedSub[]) => {
      if (!match) return;
      const quarter = currentQuarter(match.state);
      if (!quarter) return;
      // What the coach started with, position by position (#72, AC9). Never
      // the plan: the plan only filled the screen in (AC8).
      // Everyone in today's squad is in the kick-off snapshot (QA on #102).
      fillSquadAtKickoff(match.engine, match.state, squad);
      match.engine.startQuarter(match.state, quarter, toTeamSheet(sheet), match.format);
      setSubPlan(plan);
      setStep('playing');
      persist();
    },
    [match, persist, squad]
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
      noteLateArrival(inPlayerId);
      setSubPlan((plan) => markDone(plan, inPlayerId));
      persist();
    },
    [match, persist, noteLateArrival]
  );

  /**
   * A swap or a substitution during play (#83 AC4, #82). The engine records
   * it at this moment; a sub also settles the planned reminder for whoever
   * came on. An Undo of a sub puts the reminder of the player brought back
   * off as it was, so a mis-drop does not silently cancel a planned change.
   */
  const liveMove = useCallback(
    (m: LiveMove, isUndo = false): boolean => {
      if (!match) return false;
      const quarter = currentQuarter(match.state);
      if (!quarter) return false;
      try {
        if (m.kind === 'swap') match.engine.swapPositions(match.state, quarter, m.a, m.b);
        else match.engine.substitute(match.state, quarter, m.out, m.in);
      } catch {
        return false;
      }
      if (m.kind === 'sub') {
        noteLateArrival(m.in);
        setSubPlan((plan) =>
          plan.map((s) =>
            s.playerId === m.in
              ? { ...s, done: true }
              : isUndo && s.playerId === m.out
                ? { ...s, done: false }
                : s
          )
        );
      }
      persist();
      return true;
    },
    [match, persist, noteLateArrival]
  );

  /** A goal, save or goal conceded (#84). Null when the engine refuses it. */
  const recordEvent = useCallback(
    (kind: 'goal' | 'save' | 'conceded', playerId: UUID): MatchEvent | null => {
      if (!match) return null;
      const quarter = currentQuarter(match.state);
      if (!quarter) return null;
      try {
        const event = match.engine.recordEvent(match.state, quarter, kind, playerId);
        persist();
        return event;
      } catch {
        return null;
      }
    },
    [match, persist]
  );

  /** Take an event back with its note (invariant 5). */
  const withdrawEvent = useCallback(
    (eventId: UUID, note: string): boolean => {
      if (!match) return false;
      try {
        match.engine.withdrawEvent(match.state, eventId, note);
      } catch {
        return false;
      }
      persist();
      return true;
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

  /**
   * For a match under way (#88): the first period still to come, and what
   * each player already has — minutes played, plus the rest of the period in
   * progress with the players on now. Recomputed on each render, never stored.
   */
  const liveForPlan = (planned: SavedMatch) => {
    if (!match || match.state.match.id !== planned.match.id) return undefined;
    const started = match.state.quarters.filter((q) => q.status !== 'pending').length;
    if (started === 0) return undefined;
    const running = match.state.quarters.find((q) => q.status === 'running');
    const remaining = running
      ? match.engine.getPlannedQuarterMs(match.state.match) - match.engine.getQuarterElapsedMs(running)
      : 0;
    const onNow = running
      ? match.state.appearances
          .filter((a) => a.quarterId === running.id && a.endElapsedMs === null)
          .map((a) => ({ playerId: a.playerId, positionKind: a.positionKind }))
      : [];
    return {
      fromPeriod: started,
      baseline: liveBaseline(foldPlayerMinutes(match.engine, match.state, players), onNow, remaining),
      // Who finished each period already started, for "Same as" (#111).
      recordedEnd: [...match.state.quarters]
        .sort((a, b) => a.index - b.index)
        .map((q) => (q.status === 'pending' ? null : lineupAtPeriodEnd(match.state.appearances, q.id))),
    };
  };

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
          squadName={squadName}
          plan={planning.plan}
          onChange={(plan) => savePlan(planning.match.id, plan)}
          onBack={() => setStep(planReturn)}
          live={liveForPlan(planning)}
        />
      );
    }

    if (effectiveStep === 'summary' && match) {
      return (
        <MatchSummaryScreen
          engine={match.engine}
          state={match.state}
          format={match.format}
          players={playersForMatch(players, match.state.appearances)}
          now={appNow()}
          // Ruling D: after the last period, the coach closes the match here.
          onEndMatch={canEndMatch(match.state) ? closeMatch : undefined}
          onCorrectAttendance={correctAttendanceOnReport}
          onAnalysis={() => {
            setAnalysisReturn('summary');
            setStep('analysis');
          }}
          onBack={() => {
            // A finished match is history: it is safe to let go of, and
            // holding it would make Home think one is still current. Folded
            // into the list first, or the save that follows writes the copy
            // from before kick-off over it (match day 4).
            releaseMatch(null);
            setStep('fixtures');
          }}
        />
      );
    }

    // Each match's kick-off, for ruling E: who was in the squad for it.
    const kickoffs = () => kickoffTimes(withLiveMatch(matches, match));

    if (effectiveStep === 'analysis' && match) {
      return (
        <MatchAnalysisScreen
          engine={match.engine}
          state={match.state}
          format={match.format}
          players={playersForMatch(players, match.state.appearances)}
          ledger={ledger}
          kickoffs={kickoffs()}
          backLabel={analysisReturn === 'playing' ? 'Back to the clock' : 'Back to the report'}
          onBack={() => setStep(analysisReturn)}
        />
      );
    }

    if (effectiveStep === 'season') {
      return (
        <SeasonScreen
          ledger={ledger}
          players={players}
          kickoffs={kickoffs()}
          onBack={() => setStep('settings')}
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
            <>
              <MinutesSection
                ledger={ledger}
                players={players}
                kickoffs={kickoffTimes(withLiveMatch(matches, match))}
                message={ledgerMessage}
                busy={ledgerBusy}
                onExport={() => void exportMinutes()}
                onImport={() => void importMinutes()}
              />
              <SeasonChartLink onPress={() => setStep('season')} />
            </>
          }
          testKit={
            isBeta ? (
              <TestKitSection
                speed={clockSpeed}
                onSpeed={(speed) => {
                  const setting = setAppClockSpeed(speed);
                  void store.setItem(TEST_CLOCK_KEY, JSON.stringify(setting)).catch(() => undefined);
                  setClockSpeed(speed);
                }}
                onAddTestData={() => {
                  const data = addTestData(
                    players,
                    matches,
                    squadId,
                    format,
                    totalMinutes,
                    periodCount,
                    appNow()
                  );
                  setPlayers(data.players);
                  setMatches(data.matches);
                  persist({ players: data.players, matches: data.matches });
                  setTestKitMessage(data.summary);
                }}
                onAddTestSeason={() => {
                  // Played through the engine and recorded into the ledger as
                  // each save would (#106 AC2); the save below then finds
                  // nothing new to record.
                  const data = addTestSeason({
                    players,
                    matches,
                    squadId,
                    squadName,
                    format,
                    totalMinutes,
                    periodCount,
                    ledger: ledgerBlockedRef.current ? null : ledgerRef.current,
                    now: appNow(),
                  });
                  if (data.ledger && data.ledger !== ledgerRef.current) commitLedger(data.ledger);
                  setPlayers(data.players);
                  setMatches(data.matches);
                  persist({ players: data.players, matches: data.matches });
                  setTestKitMessage(data.summary);
                }}
                message={testKitMessage}
              />
            ) : undefined
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
          // An absent player cannot be picked (#102 AC1).
          players={pickablePlayers(playersForMatch(players, match.state.appearances), match.state)}
          // Before kick-off: mark absent or here. Between periods: mark an
          // absent child arrived (a noted correction, ruling F).
          attendance={
            !match.state.quarters.some((q) => q.status === 'running')
              ? {
                  arrivalsOnly: !beforeKickoff(match.state),
                  squad: playersForMatch(players, match.state.appearances),
                  isAbsent: (id) =>
                    (match.state.playerAvailability.get(id) ?? 'available') !== 'available',
                  onToggle: toggleAbsent,
                }
              : undefined
          }
          squadName={squadName}
          // This period of the fixture's plan, if one was made (#72, AC7).
          planned={
            matches.find((m) => m.match.id === match.state.match.id)?.plan?.periods[
              (currentQuarter(match.state)?.index ?? 1) - 1
            ]
          }
          onStart={startQuarter}
          onLeave={goHome}
          onPlanRest={planTheRest}
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
          format={match.format}
          subPlan={subPlan}
          onMakeSub={makeSub}
          onLiveMove={liveMove}
          onRecord={recordEvent}
          onWithdraw={withdrawEvent}
          onEndQuarter={endQuarter}
          onFinish={() => setStep('summary')}
          onLeave={goHome}
          onPlanRest={planTheRest}
          onAnalysis={() => {
            setAnalysisReturn('playing');
            setStep('analysis');
          }}
        />
      );
    }

    // Home, and the recovery for any step that needs a match and has none.
    return (
      <FixturesScreen
        squadName={squadName}
        matches={listedFixtures(matches, showArchived).map((m) => m.match)}
        currentMatchId={match?.state.match.id ?? null}
        now={appNow()}
        onOpen={openFixture}
        progress={progressById(matches, match)}
        scores={scoresById(matches, match)}
        notClosed={notClosedIds(withLiveMatch(matches, match))}
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
