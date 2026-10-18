import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { MatchEngine } from './src/engine/MatchEngine';
import type { MatchState } from './src/engine/MatchEngine';
import { uuid } from './src/types/index';
import type { AvailabilityStatus, Format, MatchEvent, Player, TapEventKind, UUID } from './src/types/index';
import { currentBuildLabel } from './src/app/buildLabel';
import {
  appClockSetting,
  appNow,
  parseClockSetting,
  setAppClock,
  setAppClockSpeed,
  type ClockSpeed,
} from './src/app/appClock';
import { TEST_CLOCK_KEY, addTestData, isBetaBuild, showTestKit } from './src/app/testKit';
import { describeBackup, makePhoneBackup, readPhoneBackup, restorePhoneBackup, type ReadBackup } from './src/app/phoneBackup';
import { addTestSeason } from './src/app/testSeason';
import { currentDistribution } from './src/app/distribution';
import { seedDemo, shouldAutoSeed, storeContents } from './src/app/demoSeed';
import {
  canArchiveFixture,
  canDeleteFixture,
  fixtureList,
  inBucket,
  listedFixtures,
  matchIsUnderway,
  openDestination,
  whenLabel,
} from './src/app/fixtures';
import { currentQuarter, periodNounPlural } from './src/app/matchClock';
import {
  DEFAULT_QUARTER_COUNT,
  DEFAULT_TOTAL_MINUTES,
  PLACEHOLDER_SQUAD_NAME,
  makeSevenASideFormat,
} from './src/app/placeholderSquad';
import { DEFAULT_SHAPE, formatForShape, shapeOfFormat, type ShapeCode } from './src/app/shapes';
import {
  activePlayers,
  makePlayer,
  playedPlayerIds,
  playersForMatch,
  squadReadiness,
} from './src/app/squad';
import { lineupAtPeriodEnd, toTeamSheet, type LiveMove, type Sheet } from './src/app/teamSheet';
import { NO_NOT_NOW, type NotNowLog } from './src/app/clockSubs';
import {
  NO_BUZZES,
  periodSubsToSave,
  restoreSubPlan,
  type BuzzLog,
  type PlannedSub,
} from './src/app/subPlan';
import { BUZZ_WHEN_SUB_DUE_DEFAULT } from './src/app/settings';
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
  hasMatchUnderway,
  toMatchState,
  toSavedSession,
  type SavedMatch,
  type SavedSession,
  type SessionInput,
} from './src/app/persistence';
import { openStoredSession, saveSessionIfWritable } from './src/app/sessionStore';
import { forgetAppData } from './src/app/forget';
import { createDeviceStore } from './src/app/storage';
import { TableSortProvider } from './src/screens/TableSort';
import { periodsById, progressById, scoresById, withLiveMatch } from './src/app/liveMatch';
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
  cancelFixture,
  describeImport,
  emptyLedger,
  importLedger,
  parseLedger,
  recordMatches,
  recordRemovedPlayers,
  setMatchExcluded,
  setPlayerFairness,
  setMatchKind,
  visibleLedger,
  type Ledger,
  type MatchRecord,
} from './src/app/ledger';
import { ledgerWriter, openStoredLedger } from './src/app/ledgerStore';
import { setupFrom } from './src/app/ledgerSetup';
import { PLANS_NOT_RESTORED, extendFromRecord, restoreFromRecord } from './src/app/recordRestore';
import { exportBackupFile, exportLedgerFile, pickLedgerFile } from './src/app/ledgerFile';
import { installDeviceSigner } from './src/app/deviceKey';
import { timeSigning } from './src/app/entrySigning';
import { exportedMessage, importedMessage } from './src/app/ledgerAnchor';
import { absentIds, beforeKickoff, fillSquadAtKickoff, pickablePlayers } from './src/app/absence';
import { MinutesSection } from './src/screens/MinutesSection';
import { BackupSection } from './src/screens/BackupSection';
import { RecordMatchScreen } from './src/screens/RecordMatchScreen';
import { TestMatchBanner, TestMatchesSection } from './src/screens/TestMatchesSection';
import { formatClock } from './src/app/matchClock';
import {
  CLEANUP_NOTE,
  deleteTestMatches,
  hiddenMatches,
  isTestMatch,
  matchClock,
  newTestMark,
  playedMs,
  realMatches,
  recordable,
  testMatchCandidates,
  testMatchesOnPhone,
  withTestSpeed,
} from './src/app/testMatches';
import { recordMatchPage, recordOnlyMatches } from './src/app/recordOnly';
import { ClockScreen } from './src/screens/ClockScreen';
import { FixtureFormScreen, type FixtureDraft } from './src/screens/FixtureFormScreen';
import { FixturesScreen } from './src/screens/FixturesScreen';
import { LineupScreen } from './src/screens/LineupScreen';
import { MatchSummaryScreen } from './src/screens/MatchSummaryScreen';
import { MatchAnalysisScreen } from './src/screens/MatchAnalysisScreen';
import { PlanScreen } from './src/screens/PlanScreen';
import type { PositionNaming } from './src/screens/PositionNameSheet';
import {
  adoptPositionNames,
  canRenamePositions,
  renamePosition,
  resetPositionNames,
} from './src/app/positionNames';
import { ResumeScreen } from './src/screens/ResumeScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { TestKitSection } from './src/screens/TestKitSection';
import { GettingStartedCard, MadeUpBanner, Toast } from './src/screens/GettingStarted';
import {
  FORGOTTEN_TOAST,
  GETTING_STARTED_KEY,
  ALL_DONE_TOAST,
  CLOSED_TOAST,
  PLAY_NOW_TOAST,
  TOAST_MS,
  UNDO_MS,
  MADE_UP_GUARD,
  allStepsDone,
  clearMadeUpTeam,
  isMadeUpTeam,
  loadMadeUpTeam,
  nextAction,
  nothingPlayedYet,
  offerMadeUpTeam,
  offerShowAgain,
  parseCardClosed,
  serialiseCardClosed,
  showCard,
  startSteps,
  type StepKey,
} from './src/app/gettingStarted';
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

/**
 * An engine on the match's own clock: the app's for a real match, its own for
 * a test match (#194), so a test match's ×5 or ×10 reaches nothing else.
 */
const engineFor = (state: MatchState) => new MatchEngine({ nowFn: matchClock(state, appNow) });

/** The live match: the engine, its state, and the shape it is played in. */
interface LiveMatch {
  engine: MatchEngine;
  state: MatchState;
  format: Format;
}

export default function App() {
  const store = useMemo(() => createDeviceStore(), []);
  // #208 AC6: each analytics table's sort, remembered on this phone. Forget
  // everything removes it from the store and starts the memory afresh.
  const [sortsForgotten, setSortsForgotten] = useState(0);

  // The tap sheet's pictures (#185): loaded at launch so the first tap on
  // Saturday does not show empty stickers. A failure costs the pictures, not
  // the buttons: each still has its word.
  useEffect(() => {
    MaterialCommunityIcons.loadFont().catch(() => {});
  }, []);

  const [step, setStep] = useState<Step>('loading');

  // --- first open (#218) ----------------------------------------------------
  /** The coach closed Getting started: a view choice on this phone, never in the record (AC7). */
  const [cardClosed, setCardClosed] = useState(false);
  /** A short message at the foot of the screen; Undo when it has one. Screen state only. */
  const [toast, setToast] = useState<{ id: number; text: string; onUndo?: () => void; ms: number } | null>(null);
  const showToast = useCallback((text: string, onUndo?: () => void) => {
    setToast((t) => ({ id: (t?.id ?? 0) + 1, text, onUndo, ms: onUndo ? UNDO_MS : TOAST_MS }));
  }, []);
  // A timer that only takes a message away: it holds no value (invariant 2).
  useEffect(() => {
    if (!toast) return;
    const handle = setTimeout(() => setToast(null), toast.ms);
    return () => clearTimeout(handle);
  }, [toast]);
  /** The card's third step points at Play now for a moment. */
  const [pointAtPlayNow, setPointAtPlayNow] = useState(false);
  useEffect(() => {
    if (!pointAtPlayNow) return;
    const handle = setTimeout(() => setPointAtPlayNow(false), 2_400);
    return () => clearTimeout(handle);
  }, [pointAtPlayNow]);
  /** Squad opened to add the squad: the name box is ready. */
  const [focusName, setFocusName] = useState(false);
  /** Whether every step was done at the last draw, to say so once when they all are (AC2). */
  const wasAllDone = useRef<boolean | null>(null);
  const [squadName, setSquadName] = useState(PLACEHOLDER_SQUAD_NAME);
  /** Everyone ever in the squad, retired players included (#77). */
  const [players, setPlayers] = useState<Player[]>([]);
  /** Today's squad: who can be picked, planned and counted for new matches. */
  const squad = useMemo(() => activePlayers(players), [players]);
  const [squadId, setSquadId] = useState<UUID>(() => uuid());
  const [match, setMatch] = useState<LiveMatch | null>(null);
  const [pending, setPending] = useState<SavedSession | null>(null);
  const [subPlan, setSubPlan] = useState<PlannedSub[]>([]);
  /**
   * Which planned subs have buzzed this period (#137). Screen state, never
   * saved. Held here, not on the clock, so leaving the clock and coming back
   * does not buzz the same sub twice; keyed by match and period, so the next
   * period or match starts empty (`checkBuzz` in src/app/subPlan.ts).
   */
  const subBuzzLog = useRef<BuzzLog>(NO_BUZZES);
  /**
   * The planned subs the coach said "Not now" to this period (#203 C5).
   * Screen state, never saved, held here so the prompt stays put away when
   * the coach leaves the clock and comes back; keyed like the buzz log.
   */
  const subNotNowLog = useRef<NotNowLog>(NO_NOT_NOW);

  // --- the defaults. Settings owns these; a match copies them. --------------
  const [totalMinutes, setTotalMinutes] = useState(DEFAULT_TOTAL_MINUTES);
  const [periodCount, setPeriodCount] = useState(DEFAULT_QUARTER_COUNT);
  /** The DEFAULT shape, as a format. The one in play is on `match`. */
  const [format, setFormat] = useState<Format>(() => makeSevenASideFormat());
  /** Settings: buzz when a sub is due (#137). Not a default: it applies at once. */
  const [buzzWhenSubDue, setBuzzWhenSubDue] = useState(BUZZ_WHEN_SUB_DUE_DEFAULT);

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
  /**
   * What every screen and figure sees (#194 AC2): test matches left out. They
   * are saved in `matches` with the session, never recorded, and listed only
   * in Settings › Test matches. `matches` stays the list every save writes.
   */
  const real = useMemo(() => realMatches(matches), [matches]);
  /** The held match when it is a real one; a held test match is on no list. */
  const liveReal = match && !isTestMatch(match.state.match) ? match : null;
  const heldTest = match && isTestMatch(match.state.match) ? match : null;

  /** Whether archived fixtures are listed (#76). A view choice, not saved. */
  const [showArchived, setShowArchived] = useState(false);

  /** The fixture whose plan is open (#72). */
  const [planningId, setPlanningId] = useState<UUID | null>(null);
  /** The record-only match open read-only (#195), on the 'record' step. */
  const [recordId, setRecordId] = useState<UUID | null>(null);

  // --- the minutes ledger (#75, ADR-013) ------------------------------------
  //
  // Player time, kept under its own key and written alongside every save. The
  // ref is the value; the state is only so Settings repaints.
  // --- the Test kit (#95): Heart FC Beta Coach, the demo (#146) and dev builds (#134)
  const testKitOn = useMemo(() => showTestKit(currentBuildLabel(), __DEV__, currentDistribution()), []);
  const [clockSpeed, setClockSpeed] = useState<ClockSpeed>(1);
  const [testKitMessage, setTestKitMessage] = useState('');

  const ledgerRef = useRef<Ledger | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  /** What every screen sees: matches marked a test or void left out (#194). */
  const viewLedger = useMemo(() => (ledger ? visibleLedger(ledger) : null), [ledger]);
  const [testMatchMessage, setTestMatchMessage] = useState('');
  const [ledgerMessage, setLedgerMessage] = useState('');
  const [ledgerBusy, setLedgerBusy] = useState(false);
  // #192: back up this app, and restore it.
  const [backupMessage, setBackupMessage] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [pendingBackup, setPendingBackup] = useState<ReadBackup | null>(null);
  /** Bumped after a restore, to run the launch again over what was restored. */
  const [launchKey, setLaunchKey] = useState(0);
  /**
   * The stored ledger was written by a newer build that says this one cannot
   * safely write it back (#99 AC2). Nothing is recorded, imported or saved
   * over it until the app is updated — or Forget everything clears it.
   */
  const ledgerBlockedRef = useRef(false);

  /**
   * The stored session could not be read, or was written by a newer build
   * (#173). Nothing is saved over it this launch, exactly as for the ledger;
   * Forget everything is the deliberate way past it.
   */
  const sessionWritableRef = useRef(true);
  const [sessionMessage, setSessionMessage] = useState('');

  // Skips the write when nothing a coach cares about changed, and retries
  // one that failed (#177).
  const writeLedger = useMemo(() => ledgerWriter(store), [store]);
  const commitLedger = useCallback(
    (next: Ledger) => {
      if (ledgerBlockedRef.current) return;
      const current = ledgerRef.current;
      ledgerRef.current = next;
      setLedger(next);
      void writeLedger(current, next);
    },
    [writeLedger]
  );

  // --- load once at launch --------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // The beta's clock first (#95), before anything reads the time: its
      // stored offset keeps the clock from running backwards across a relaunch.
      if (testKitOn) {
        setAppClock(parseClockSetting(await store.getItem(TEST_CLOCK_KEY).catch(() => null)));
        setClockSpeed(appClockSetting().speed);
      }

      // #193: this install's key, before anything is recorded, so every entry
      // this launch writes is signed. Without one, recording goes on unsigned.
      await installDeviceSigner();

      // #218: whether the coach closed Getting started on this phone.
      const closedRaw = await store.getItem(GETTING_STARTED_KEY).catch(() => null);

      // Read once, before any save can run: launch must never write over
      // the ledger with an empty one.
      // #173: an unreadable session is set aside, a too-new one left alone;
      // either way the first save below cannot write over it.
      const openedSession = await openStoredSession(store, appNow());
      let saved = openedSession.session;
      // A ledger that will not read is set aside intact, never written over;
      // one this build may not write is left alone (#99, QA on #110).
      const opened = await openStoredLedger(store, appNow());
      if (cancelled) return;
      setCardClosed(parseCardClosed(closedRaw));
      if (!openedSession.writable) sessionWritableRef.current = false;
      if (openedSession.message !== '') setSessionMessage(openedSession.message);
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
      // #195 AC6: the first launch of this build also writes the phone's
      // fixtures, profiles and settings into the record, in that same entry.
      commitLedger(
        saved
          ? // A test match never enters the record (#194, ADR-021 D3), nor its fixture (#195).
            recordMatches(
              base,
              recordable(saved.matches),
              saved.players,
              saved.squadName,
              appNow(),
              openedSession.writable
                ? setupFrom({
                    players: saved.players,
                    matches: recordable(saved.matches),
                    live: null,
                    format: saved.format,
                    totalMinutes: saved.totalMinutes,
                    periodCount: saved.periodCount,
                    buzzWhenSubDue: saved.buzzWhenSubDue,
                  })
                : undefined
            )
          : base
      );

      // #146 AC4: the demo's first open, on an empty store, gets the Test
      // kit's squad and past season (demoSeed.ts). The season is recorded
      // into the ledger here as it is played; the session goes on as if it
      // had been loaded, and the save after launch writes it.
      if (shouldAutoSeed(currentDistribution(), storeContents(saved, opened))) {
        const seeded = seedDemo(
          saved,
          ledgerRef.current,
          { squadName, squadId, format, totalMinutes, periodCount, buzzWhenSubDue },
          appNow()
        );
        if (seeded.ledger) commitLedger(seeded.ledger);
        saved = seeded.session;
      }

      if (!saved) {
        setStep('fixtures');
        return;
      }
      setSquadName(saved.squadName || PLACEHOLDER_SQUAD_NAME);
      setTotalMinutes(saved.totalMinutes);
      setPeriodCount(saved.periodCount);
      setBuzzWhenSubDue(saved.buzzWhenSubDue);
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
    // Launch only, and again after a restore (#192). squadId is read for a
    // brand-new install's empty ledger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, launchKey]);

  // --- save on every change that matters ------------------------------------
  //
  // Fire and forget. `saveSession` swallows storage failure by design: a phone
  // with a full disk loses the save, never the match. A session this launch
  // may not write (#173) is not written at all.

  /** What a save writes: the app's state as it stands, with any overrides. */
  const sessionInput = useCallback(
    (overrides: Partial<SessionInput> = {}): SessionInput => ({
      squadName,
      squadId,
      players,
      format,
      totalMinutes,
      periodCount,
      buzzWhenSubDue,
      plan: {},
      matches,
      state: match?.state ?? null,
      // The shape the live match is played in, which is no longer the same
      // thing as the squad default.
      matchFormat: match?.format ?? null,
      // The running period's planned subs, so a relaunch mid-period brings
      // the reminders back (#139). Null between periods, which clears them.
      periodSubs: periodSubsToSave(match?.state.quarters, subPlan),
      ...overrides,
    }),
    [squadName, squadId, players, format, totalMinutes, periodCount, buzzWhenSubDue, match, matches, subPlan]
  );

  const persist = useCallback(
    (overrides: Partial<SessionInput> = {}) => {
      void saveSessionIfWritable(store, sessionWritableRef.current, sessionInput(overrides));

      // The ledger, from the same records. Only closed intervals reach it, so
      // a period ending is what puts minutes in; nothing is ever removed.
      if (ledgerRef.current) {
        const live = 'state' in overrides ? overrides.state : (match?.state ?? null);
        const records: MatchRecord[] = [...(overrides.matches ?? matches)];
        if (live) records.push(live);
        const input = sessionInput(overrides);
        const liveFormat = input.matchFormat ?? match?.format ?? null;
        commitLedger(
          recordMatches(
            ledgerRef.current,
            // A test match is saved with the session and never recorded (#194).
            recordable(records),
            overrides.players ?? players,
            overrides.squadName ?? squadName,
            appNow(),
            // #195 AC2, AC3: only from a session this launch may write (#173).
            sessionWritableRef.current
              ? setupFrom({
                  players: input.players,
                  // A test match is never a fixture in the record either (#194).
                  matches: recordable(input.matches ?? []),
                  live: live && liveFormat && !isTestMatch(live.match) ? { match: live.match, format: liveFormat } : null,
                  format: input.format,
                  totalMinutes: input.totalMinutes,
                  periodCount: input.periodCount,
                  buzzWhenSubDue: input.buzzWhenSubDue ?? true,
                })
              : undefined
          )
        );
      }
    },
    [store, sessionInput, squadName, players, match, matches, commitLedger]
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

    // #195 AC4: a phone with nothing on it is rebuilt from the record: squad,
    // players and their profiles, settings and planned fixtures. AC5: one
    // with data only gains what it is missing; nothing on it is overwritten.
    const fresh = players.length === 0 && matches.length === 0;
    let restoredFixtures = 0;
    if (fresh) {
      const r = restoreFromRecord(report.ledger, squadId, format, appNow());
      const nextName = r.squadName || squadName;
      restoredFixtures = r.fixtures.length;
      setPlayers(r.players);
      setSquadId(r.squadId);
      setSquadName(nextName);
      setMatches(r.fixtures);
      if (r.settings) {
        setFormat(r.settings.format);
        setTotalMinutes(r.settings.totalMinutes);
        setPeriodCount(r.settings.periodCount);
        setBuzzWhenSubDue(r.settings.buzzWhenSubDue);
      }
      persist({
        players: r.players,
        squadId: r.squadId,
        squadName: nextName,
        matches: r.fixtures,
        ...(r.settings
          ? {
              format: r.settings.format,
              totalMinutes: r.settings.totalMinutes,
              periodCount: r.settings.periodCount,
              buzzWhenSubDue: r.settings.buzzWhenSubDue,
            }
          : {}),
      });
    } else {
      const x = extendFromRecord(report.ledger, players, matches, squadId, format, appNow());
      restoredFixtures = x.addedFixtures;
      setPlayers(x.players);
      setMatches(x.matches);
      persist({ players: x.players, matches: x.matches });
    }
    const said = describeImport(report);
    setLedgerMessage(
      importedMessage(
        restoredFixtures > 0
          ? `${said} ${restoredFixtures} upcoming ${restoredFixtures === 1 ? 'fixture' : 'fixtures'} added. ${PLANS_NOT_RESTORED}`
          : said,
        parsed.ledger,
        report.ledger
      )
    );
  }, [squadId, squadName, players, matches, format, persist, commitLedger]);

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
  const recordPage = step === 'record' && recordId ? recordMatchPage(viewLedger, recordId) : null;
  const effectiveStep: Step =
    (!match && (step === 'lineup' || step === 'playing' || step === 'summary' || step === 'analysis')) ||
    (step === 'plan' && !planning) ||
    (step === 'record' && !recordPage)
      ? 'fixtures'
      : step;

  const tab = tabForStep(effectiveStep, squadErrand);

  const goToTab = useCallback(
    (next: Tab) => {
      // A tab is housekeeping by definition, so the squad editor reached this
      // way must not offer to start a match.
      setSquadErrand('home');
      // #218: an empty squad opens with the name box ready, as the card's step does.
      setFocusName(next === 'squad' && players.length === 0);
      setStep(stepForTab(next));
    },
    [players.length]
  );

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
   * Leave the lineup or the clock. A test match goes back to Settings, where
   * it was started and is listed (#194): it is on no list at Home.
   */
  const leaveMatch = useCallback(() => {
    if (match && isTestMatch(match.state.match)) {
      persist();
      setSquadErrand('home');
      setStep('settings');
      return;
    }
    goHome();
  }, [match, persist, goHome]);

  /**
   * Hold a different live match, or none, without losing the one held now.
   * The held match is folded into the list FIRST — the rule, and the match
   * day 4 defect it fixes, are in `matchesOnRelease` (src/app/matchLifecycle.ts).
   */
  const releaseMatch = useCallback(
    (next: LiveMatch | null) => {
      if (match && match !== next) {
        const held = match;
        // With its running period's subs (#139): a match let go of mid-period
        // and opened again is rebuilt from this, and gets its reminders back.
        const subs = periodSubsToSave(held.state.quarters, subPlan);
        setMatches((prev) => matchesOnRelease(prev, held, next, subs));
      }
      setMatch(next);
    },
    [match, subPlan]
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
          excludeFromStats: draft.excludeFromStats,
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
      // #195 AC2: the record says it was cancelled; it is never deleted from it.
      if (ledgerRef.current && !ledgerBlockedRef.current) {
        commitLedger(cancelFixture(ledgerRef.current, matchId, appNow()));
      }
    },
    [matches, persist, match, commitLedger]
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

  /**
   * Rename one match's positions (#166). The new format goes onto the match
   * everywhere it is held — the stored copy and, if it is the one held, the
   * live one — so every screen showing that match shows the new names. Only
   * labels change (positionNames.ts), so no minute moves.
   *
   * With "Use these names for new matches" (ruling Q2) the names are copied
   * onto the squad default too; never otherwise.
   */
  const setMatchFormat = useCallback(
    (matchId: UUID, next: Format, keepForNew: boolean) => {
      const nextMatches = matches.map((m) => (m.match.id === matchId ? { ...m, format: next } : m));
      setMatches(nextMatches);
      const held = match && match.state.match.id === matchId ? match : null;
      if (held) setMatch({ ...held, format: next });
      const adopted = keepForNew ? adoptPositionNames(format, next) : null;
      if (adopted) setFormat(adopted);
      persist({
        matches: nextMatches,
        ...(held ? { matchFormat: next } : {}),
        ...(adopted ? { format: adopted } : {}),
      });
    },
    [matches, match, format, persist]
  );

  /** What the Plan and the lineup are handed to rename a match's positions. */
  const namingFor = (matchId: UUID, current: Format): PositionNaming => ({
    onRename: (positionId, typed, keep) => {
      const result = renamePosition(current, positionId, typed);
      if (!result.ok) return result.reason;
      setMatchFormat(matchId, result.format, keep);
      return null;
    },
    onReset: () => setMatchFormat(matchId, resetPositionNames(current), false),
    offerKeep: adoptPositionNames(format, current) !== null,
  });

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
        releaseMatch({ engine: engineFor(state), state, format: matchFormat });
        // Its running period's subs, if one is running (#139); else none.
        setSubPlan(outcome.subPlan);
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
  const beginMatch = useCallback((test?: boolean) => {
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
        // #194: a test match from Settings, on its own clock, never recorded.
        ...(test === true ? { test: newTestMark(appNow().getTime()) } : {}),
      },
      appNow
    );
    releaseMatch({ engine: engineFor(held.state), ...held });
    setSubPlan([]);
    setStep('lineup');
  }, [squadId, format, totalMinutes, periodCount, squad, releaseMatch]);

  const playNow = useCallback(() => {
    if (squadReadiness(squad, format.onFieldCount).ready) {
      beginMatch(false);
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
      engine: engineFor(state),
      state,
      format: stored?.format ?? pending.format,
    });
    // The running period's subs come back, those already made read from the
    // record (#139). The buzz log is empty after a relaunch, so a sub that
    // fell due while the app was gone buzzes once on the clock (#137 AC3).
    setSubPlan(restoreSubPlan(stored?.periodSubs, state));
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
        engine: engineFor(state),
        state,
        format: stored?.format ?? pending.format,
      });
      // As resume does (#139): the clock is one tap away from Home, and the
      // next save writes these back rather than an empty plan over them.
      setSubPlan(restoreSubPlan(stored?.periodSubs, state));
    }
    setPending(null);
    setSquadErrand('home');
    setStep('fixtures');
  }, [pending]);

  /**
   * Forget everything, including the squad. Deliberately harder to reach — it
   * is how a coach hands the phone on, not how they start next Saturday.
   */
  /** #192 AC1: everything this app keeps, as it stands now, in one file. */
  const backUpApp = useCallback(async () => {
    setBackupBusy(true);
    const label = currentBuildLabel();
    const text = makePhoneBackup(
      toSavedSession({ ...sessionInput(), now: appNow() }),
      ledgerRef.current,
      { app: isBetaBuild(label) ? 'Heart FC Beta Coach' : 'Heart FC Coach', build: label },
      appNow()
    );
    const outcome = await exportBackupFile(text, appNow());
    setBackupBusy(false);
    setBackupMessage(outcome.ok ? '' : outcome.reason);
  }, [sessionInput]);

  /** #192 AC2, AC5: read and check a backup; nothing changes until the coach confirms. */
  const pickBackup = useCallback(async () => {
    setBackupBusy(true);
    const picked = await pickLedgerFile();
    setBackupBusy(false);
    if (!picked.ok) {
      setBackupMessage(picked.reason);
      return;
    }
    if (picked.text === null) return; // cancelled
    const read = readPhoneBackup(picked.text);
    if (!read.ok) {
      setBackupMessage(read.reason);
      return;
    }
    setBackupMessage('');
    setPendingBackup(read);
  }, []);

  /**
   * #192 AC3, AC4: replace what this app keeps, then run the launch again over
   * it, exactly as opening the app would. Everything held in memory is let go
   * first, so nothing from before the restore can be saved over it.
   */
  const restoreBackup = useCallback(async () => {
    const backup = pendingBackup;
    if (!backup) return;
    setPendingBackup(null);
    setBackupBusy(true);
    setStep('loading');
    const outcome = await restorePhoneBackup(store, backup, appNow());
    setBackupBusy(false);
    if (!outcome.ok) {
      setBackupMessage(outcome.reason);
      setStep('settings');
      return;
    }
    sessionWritableRef.current = true;
    setSessionMessage('');
    ledgerBlockedRef.current = false;
    ledgerRef.current = null;
    setLedger(null);
    setLedgerMessage('');
    setMatch(null);
    setPending(null);
    setSubPlan([]);
    setPlayers([]);
    setMatches([]);
    setSquadErrand('home');
    setBackupMessage('Restored. What was on this phone before is kept aside, unchanged.');
    setLaunchKey((k) => k + 1);
  }, [pendingBackup, store]);

  /**
   * The squad changed on the Squad screen. A player taken out before ever
   * playing is gone from the squad; the record says so, so a restore from it
   * leaves them out (#195 AC4). The record itself keeps every player.
   */
  const changeSquad = useCallback(
    (next: Player[]) => {
      const kept = new Set(next.map((p) => p.id));
      const gone = players.filter((p) => !kept.has(p.id)).map((p) => p.id);
      setPlayers(next);
      if (gone.length > 0 && ledgerRef.current && !ledgerBlockedRef.current) {
        commitLedger(recordRemovedPlayers(ledgerRef.current, gone, appNow()));
      }
    },
    [players, commitLedger]
  );

  /** #190: mark a child not counted in fairness, or counted again, with a note. */
  const squadFairness = useMemo(
    () => ({
      set: (playerId: UUID, counted: boolean, note: string): string | null => {
        if (ledgerBlockedRef.current) return 'Player minutes cannot be written on this phone.';
        // Saved first, so a child added a moment ago is in the record.
        persist();
        const current = ledgerRef.current;
        if (!current) return 'There is no record on this phone yet.';
        const r = setPlayerFairness(current, playerId, counted, note, appNow());
        if (!r.ok) return r.reason;
        commitLedger(r.ledger);
        return null;
      },
    }),
    [persist, commitLedger]
  );

  /** #194: the ids of matches marked a test or void, kept off every list. */
  const hiddenIds = useMemo(() => new Set(hiddenMatches(ledger).map((m) => m.id)), [ledger]);

  /** "Fri 16 Oct · 19:40 · lasted 00:58", for Settings › Test matches. */
  const testMatchLabel = (m: { id: UUID; kickoffAt: string | null; intervals: { endMs: number }[] }) => {
    const at = m.kickoffAt ?? kickoffTimes(withLiveMatch(matches, match)).get(m.id) ?? null;
    return `${whenLabel(at ? new Date(at) : null, appNow())} · lasted ${formatClock(playedMs(m))}`;
  };

  /** A test match on this phone (#194): "Sun 18 Oct · 10:02 · 2 of 4 quarters played". */
  const sessionTestLabel = (m: SavedMatch) => {
    // Created on the app's clock; its periods ran on the test match's own.
    const at = m.match.createdAt;
    const done = m.quarters.filter((q) => q.status === 'ended').length;
    const of = `${done} of ${m.quarters.length} ${periodNounPlural(m.quarters.length).toLowerCase()} played`;
    return `${whenLabel(at ? new Date(at) : null, appNow())} · ${of}`;
  };

  /** #194 AC5: the coach confirmed the clean-up; each match is marked a test, with a note. */
  const hideTestMatches = useCallback(() => {
    if (ledgerBlockedRef.current || !ledgerRef.current) return;
    let next = ledgerRef.current;
    let hidden = 0;
    for (const m of testMatchCandidates(next)) {
      const r = setMatchKind(next, m.id, 'test', CLEANUP_NOTE, appNow());
      if (r.ok) {
        next = r.ledger;
        hidden++;
      }
    }
    if (hidden > 0) commitLedger(next);
    setTestMatchMessage(
      hidden > 0
        ? `${hidden} ${hidden === 1 ? 'match is' : 'matches are'} hidden from every screen. The record keeps ${hidden === 1 ? 'it' : 'them'}.`
        : 'Nothing was hidden.'
    );
  }, [commitLedger]);

  /** Show a hidden match again: a `real` record with a note (invariant 5). */
  const showMatchAgain = useCallback(
    (matchId: string) => {
      if (ledgerBlockedRef.current || !ledgerRef.current) return;
      const r = setMatchKind(ledgerRef.current, matchId as UUID, 'real', 'Shown again by the coach', appNow());
      if (r.ok) commitLedger(r.ledger);
      setTestMatchMessage(r.ok ? 'Shown again on every screen.' : r.reason);
    },
    [commitLedger]
  );

  /** #194 AC1: Settings › Start a test match. Plays today's squad; never recorded. */
  const startTestMatch = useCallback(() => {
    if (!squadReadiness(squad, format.onFieldCount).ready) return;
    if (liveReal && matchIsUnderway(liveReal.state.quarters)) return;
    setTestMatchMessage('');
    beginMatch(true);
  }, [squad, format, liveReal, beginMatch]);

  /** #194 AC3: delete test matches outright. They were never in the record. */
  const deleteTests = useCallback(
    (ids: UUID[]) => {
      const outcome = deleteTestMatches(matches, match, ids);
      if (outcome.deleted === 0) return;
      setMatches(outcome.matches);
      // Let go of a deleted held match directly, not through releaseMatch,
      // which would fold it back into the list.
      if (outcome.releaseLive) setMatch(null);
      persist({
        matches: outcome.matches,
        ...(outcome.releaseLive ? { state: null, matchFormat: null } : {}),
      });
      setTestMatchMessage(
        `${outcome.deleted === 1 ? 'Test match' : `${outcome.deleted} test matches`} deleted from this phone.`
      );
    },
    [matches, match, persist]
  );

  /**
   * Void this played match, with a note (#194, PO ruling 18 Oct). A
   * `match-kind: void` record: hidden from every screen, kept in the record,
   * shown again from Settings › Test matches. The reason when refused, else null.
   */
  const voidOnReport = useCallback(
    (note: string): string | null => {
      if (!match) return 'No match is open.';
      if (ledgerBlockedRef.current) return 'Player minutes cannot be written on this phone.';
      const current = ledgerRef.current;
      if (!current) return 'That match is not in the ledger.';
      const result = setMatchKind(current, match.state.match.id, 'void', note, appNow());
      if (!result.ok) return result.reason;
      commitLedger(result.ledger);
      // Nothing left to show: the match is on no screen now.
      releaseMatch(null);
      setStep('fixtures');
      showToast('Match voided. Settings › Test matches can show it again.');
      return null;
    },
    [match, commitLedger, releaseMatch, showToast]
  );

  const forgetEverything = useCallback(() => {
    // Every key this app owns, copies kept aside included (#207): this is how
    // a phone is handed on, and children's data must not stay behind. The
    // confirm text says to back up first.
    void forgetAppData(store);
    // Cleared above: nothing is left for the session block (#173) to protect.
    sessionWritableRef.current = true;
    setSessionMessage('');
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
    setSortsForgotten((n) => n + 1);
    // #218 Q4: a forgotten phone is a fresh install, Getting started included
    // (its key went with the rest above).
    setCardClosed(false);
    wasAllDone.current = null;
    showToast(FORGOTTEN_TOAST);
  }, [store, showToast]);

  /** Change the DEFAULT shape. Saved fixtures keep the shape they were saved with. */
  const setDefaultShape = useCallback((shape: ShapeCode) => {
    setFormat((current) => formatForShape(shape, current));
  }, []);

  /** The engine changes the live match in place; this repaints after an absence mark. */
  const [, repaint] = useReducer((n: number) => n + 1, 0);

  /** The test match's own clock speed (#194, PO ruling 18 Oct): ×1, ×5 or ×10. */
  const setTestSpeed = useCallback(
    (speed: ClockSpeed) => {
      const mark = match?.state.match.test;
      if (!match || !mark || mark.clock.speed === speed) return;
      // The engine reads the mark on every call (matchClock), so the change is
      // continuous: no jump, and every elapsed figure stays exact.
      match.state.match = { ...match.state.match, test: withTestSpeed(mark, speed, appNow().getTime()) };
      repaint();
      persist();
    },
    [match, persist]
  );


  /**
   * Mark a player absent, or present again, before kick-off (#102 AC1). The
   * ledger snapshots it at kick-off (ADR-014 §4); after that, nothing here
   * can change it.
   */
  const toggleAbsent = useCallback(
    (playerId: UUID, absent: boolean) => {
      if (!match) return;
      // #194: a test match has no record to correct. After kick-off an
      // arrival is the engine's mark alone, and nothing is written.
      if (isTestMatch(match.state.match) && !beforeKickoff(match.state)) {
        if (absent || match.state.quarters.some((q) => q.status === 'running')) return;
        match.engine.setAvailability(match.state, playerId, 'available');
        repaint();
        persist();
        return;
      }
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
      if (!match) return;
      // #194: a test match writes nothing; the arrival is the engine's mark alone.
      if (isTestMatch(match.state.match)) {
        if ((match.state.playerAvailability.get(playerId) ?? 'available') !== 'available') {
          match.engine.setAvailability(match.state, playerId, 'available');
        }
        return;
      }
      if (ledgerBlockedRef.current) return;
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

  /**
   * Leave this match out of the figures, or count it again (#187, ADR-020).
   * Works on a match already played, so it applies retrospectively. The reason
   * when refused, else null.
   */
  const setExcludedOnReport = useCallback(
    (excluded: boolean, note: string): string | null => {
      if (!match) return 'No match is open.';
      if (ledgerBlockedRef.current) return 'Player minutes cannot be written on this phone.';
      const current = ledgerRef.current;
      if (!current) return 'That match is not in the ledger.';
      const result = setMatchExcluded(current, match.state.match.id, excluded, note, appNow());
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
      // Named here: this save still holds the last period's plan (#139).
      persist({ periodSubs: periodSubsToSave(match.state.quarters, plan) });
    },
    [match, persist, squad]
  );

  /**
   * Change the running period's planned subs from the clock (#203 AC2): a
   * time, who comes off, or a sub removed or added. The plan only, never the
   * record (#72 AC8); saved with the period so a relaunch keeps it (#139).
   * Made subs are still read from the record, never from this.
   */
  const changeSubPlan = useCallback(
    (plan: PlannedSub[]) => {
      if (!match) return;
      setSubPlan(plan);
      persist({ periodSubs: periodSubsToSave(match.state.quarters, plan) });
    },
    [match, persist]
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

  /** A goal, save or goal conceded (#84); a tackle, corner or free kick won (#185). Null when refused. */
  const recordEvent = useCallback(
    (kind: TapEventKind, playerId: UUID): MatchEvent | null => {
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

  /** A goal's assist (#185). Null when the engine refuses it. */
  const recordAssist = useCallback(
    (goalId: UUID, playerId: UUID): MatchEvent | null => {
      if (!match) return null;
      try {
        const event = match.engine.recordAssist(match.state, goalId, playerId);
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

  /** With a time: the coach said when an overrun period ended (#180). */
  const endQuarter = useCallback((atQuarterElapsedMs?: number) => {
    if (!match) return;
    const quarter = currentQuarter(match.state);
    if (!quarter) return;
    try {
      match.engine.endQuarter(match.state, quarter, atQuarterElapsedMs);
    } catch {
      // Refused (before the last thing recorded, or after now): the period
      // keeps running and the clock still offers End.
      return;
    }
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

  // --- first open (#218): worked out on every draw, never stored -----------

  // #194 AC2: a test match ticks no step and counts as nothing played.
  const everyMatch = withLiveMatch(real, liveReal);
  const startProgress = startSteps({
    activePlayers: squad.length,
    onFieldCount: format.onFieldCount,
    matches: everyMatch,
    ledgerMatches: ledger?.matches.length ?? 0,
  });
  const everyStepDone = allStepsDone(startProgress);
  const recordOnlyList = recordOnlyMatches(viewLedger, new Set(everyMatch.map((m) => m.match.id)));
  /** Q3: nothing played yet, so empty Played and squad views say what comes next. */
  const firstTime = nothingPlayedYet(everyMatch, recordOnlyList.length);
  const nextUp = inBucket(
    fixtureList(
      real.filter((m) => !m.archived && !hiddenIds.has(m.match.id)).map((m) => m.match),
      appNow(),
      liveReal?.state.match.id ?? null,
      progressById(real, liveReal)
    ),
    'future'
  )[0]?.match;
  const next = nextAction(nextUp);
  const doNext = () => {
    setSquadErrand('home');
    if (next.kind === 'plan') {
      setPlanningId(next.matchId);
      setPlanReturn('fixtures');
      setStep('plan');
    } else {
      setStep('fixtureForm');
    }
  };
  const nextButton = firstTime ? { label: next.label, onPress: doNext } : null;

  // AC2: when the last step ticks with the card showing, say so once.
  useEffect(() => {
    if (step === 'loading' || step === 'resume') {
      wasAllDone.current = null;
      return;
    }
    const before = wasAllDone.current;
    wasAllDone.current = everyStepDone;
    if (before === false && everyStepDone && !cardClosed) showToast(ALL_DONE_TOAST);
  }, [step, everyStepDone, cardClosed, showToast]);

  const closeCard = useCallback(() => {
    setCardClosed(true);
    // A view choice: losing it costs a tap, so a failed write is let go.
    void store.setItem(GETTING_STARTED_KEY, serialiseCardClosed()).catch(() => undefined);
    showToast(CLOSED_TOAST, () => {
      setCardClosed(false);
      setToast(null);
      void store.removeItem(GETTING_STARTED_KEY).catch(() => undefined);
    });
  }, [store, showToast]);

  /** Q4: from Settings, while a step is undone. */
  const showCardAgain = useCallback(() => {
    setCardClosed(false);
    void store.removeItem(GETTING_STARTED_KEY).catch(() => undefined);
    setSquadErrand('home');
    setStep('fixtures');
  }, [store]);

  /** AC1: each step goes straight to where it is done. */
  const onStartStep = useCallback(
    (key: StepKey) => {
      if (key === 'squad') {
        setSquadErrand('home');
        setFocusName(true);
        setStep('squad');
      } else if (key === 'match') {
        setStep('fixtureForm');
      } else {
        setPointAtPlayNow(true);
        showToast(PLAY_NOW_TOAST);
      }
    },
    [showToast]
  );

  /**
   * AC5, Q5: the Test kit's squad and season, into this app as it stands, as
   * the demo seeds them (`loadMadeUpTeam`). Only on an empty squad, so made-up
   * children never mix with real ones. Forget everything takes it away.
   */
  const tryMadeUpTeam = useCallback(() => {
    if (!offerMadeUpTeam(players)) return;
    const team = loadMadeUpTeam({
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
    if (team.ledger && team.ledger !== ledgerRef.current) commitLedger(team.ledger);
    setPlayers(team.players);
    setMatches(team.matches);
    persist({ players: team.players, matches: team.matches });
    // The loaded message, not "all three steps done", is the one to read.
    wasAllDone.current = null;
    showToast(team.message);
    setSquadErrand('home');
    setFocusName(false);
    setStep('fixtures');
  }, [players, matches, squadId, squadName, format, totalMinutes, periodCount, commitLedger, persist, showToast]);

  /**
   * The made-up guard's "Clear it and start" (approve made-up guard, #218):
   * the made-up squad, fixtures and matches leave the session and the record,
   * anything real stays untouched (`clearMadeUpTeam`), then the coach's first
   * real player is added.
   */
  const clearMadeUpAndAdd = useCallback(
    (firstName: string) => {
      const writable = !ledgerBlockedRef.current;
      const out = clearMadeUpTeam({
        players,
        matches,
        live: match,
        ledger: writable ? ledgerRef.current : null,
        squadName,
        now: appNow(),
      });
      if (out.releaseLive) {
        // Let go directly, not through releaseMatch, which would fold it back in.
        setMatch(null);
        setSubPlan([]);
      }
      if (out.ledger && out.ledger !== ledgerRef.current) commitLedger(out.ledger);
      const nextPlayers = [...out.players, makePlayer(squadId, firstName)];
      setPlayers(nextPlayers);
      setMatches(out.matches);
      persist({
        players: nextPlayers,
        matches: out.matches,
        ...(out.releaseLive ? { state: null, matchFormat: null, periodSubs: null } : {}),
      });
      wasAllDone.current = null;
      showToast(MADE_UP_GUARD.done);
    },
    [players, matches, match, squadName, squadId, commitLedger, persist, showToast]
  );

  // --- routing --------------------------------------------------------------

  /** #194 AC1: every screen of a test match says so, with its clock speed. */
  const testBanner = (() => {
    if (effectiveStep === 'resume') {
      const held = pending ? toMatchState(pending) : null;
      return held?.match.test ? <TestMatchBanner speed={held.match.test.clock.speed} /> : null;
    }
    if (!heldTest?.state.match.test) return null;
    const onMatchScreen =
      effectiveStep === 'lineup' ||
      effectiveStep === 'playing' ||
      effectiveStep === 'summary' ||
      effectiveStep === 'analysis' ||
      (effectiveStep === 'plan' && planningId === heldTest.state.match.id);
    return onMatchScreen ? (
      <TestMatchBanner speed={heldTest.state.match.test.clock.speed} onSpeed={setTestSpeed} />
    ) : null;
  })();

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
            excludeFromStats: false,
          }}
          onSave={saveFixture}
          onCancel={() => setStep('fixtures')}
        />
      );
    }

    if (effectiveStep === 'plan' && planning) {
      // The held match's quarters, not the stored copy's, which may be stale.
      const planQuarters =
        match && match.state.match.id === planning.match.id ? match.state.quarters : planning.quarters;
      const planFormat = planning.format ?? format;
      // #165: who is marked unavailable, kept off the shared image's bench.
      // The held match's marks when it is this one, else the stored copy's.
      const planAbsent =
        match && match.state.match.id === planning.match.id
          ? absentIds(match.state)
          : absentIds({ playerAvailability: new Map(planning.availability ?? []) });
      return (
        <PlanScreen
          match={planning.match}
          // The shape THIS fixture is played in (ADR-012).
          format={planFormat}
          // #166 Q1: names change on the Plan before kick-off only.
          names={
            canRenamePositions('plan', planQuarters) ? namingFor(planning.match.id, planFormat) : undefined
          }
          players={squad}
          absent={planAbsent}
          squadName={squadName}
          plan={planning.plan}
          onChange={(plan) => savePlan(planning.match.id, plan)}
          onBack={() => setStep(planReturn)}
          live={liveForPlan(planning)}
        />
      );
    }

    // Each match's kick-off, for ruling E: who was in the squad for it.
    const kickoffs = () => kickoffTimes(withLiveMatch(real, liveReal));

    if (effectiveStep === 'record' && recordPage) {
      return <RecordMatchScreen page={recordPage} now={appNow()} onBack={() => setStep('fixtures')} />;
    }

    if (effectiveStep === 'summary' && match) {
      return (
        <MatchSummaryScreen
          engine={match.engine}
          state={match.state}
          format={match.format}
          players={playersForMatch(players, match.state.appearances)}
          ledger={viewLedger}
          kickoffs={kickoffs()}
          now={appNow()}
          // Ruling D: after the last period, the coach closes the match here.
          onEndMatch={canEndMatch(match.state) ? closeMatch : undefined}
          // #194: a test match has no record to correct, leave out or void.
          onCorrectAttendance={heldTest ? undefined : correctAttendanceOnReport}
          onSetExcluded={heldTest ? undefined : setExcludedOnReport}
          onVoid={heldTest ? undefined : voidOnReport}
          backLabel={heldTest ? 'Back to Settings' : 'Back to Home'}
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
            // A test match came from Settings and goes back there (#194).
            setStep(heldTest ? 'settings' : 'fixtures');
          }}
        />
      );
    }

    if (effectiveStep === 'analysis' && match) {
      return (
        <MatchAnalysisScreen
          engine={match.engine}
          state={match.state}
          format={match.format}
          players={playersForMatch(players, match.state.appearances)}
          ledger={viewLedger}
          kickoffs={kickoffs()}
          backLabel={analysisReturn === 'playing' ? 'Back to the clock' : 'Back to the report'}
          onBack={() => setStep(analysisReturn)}
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
          buzzWhenSubDue={buzzWhenSubDue}
          onBuzzWhenSubDue={setBuzzWhenSubDue}
          minutes={
            <MinutesSection
              ledger={viewLedger}
              players={players}
              kickoffs={kickoffTimes(withLiveMatch(real, liveReal))}
              message={ledgerMessage}
              busy={ledgerBusy}
              onExport={() => void exportMinutes()}
              onImport={() => void importMinutes()}
            />
          }
          testMatches={
            <TestMatchesSection
              start={{
                onStart: startTestMatch,
                blocked: !squadReadiness(squad, format.onFieldCount).ready
                  ? `Add at least ${format.onFieldCount} players to the squad first.`
                  : liveReal && matchIsUnderway(liveReal.state.quarters)
                    ? 'A match is under way. Start a test match after it.'
                    : null,
              }}
              played={testMatchesOnPhone(matches, match).map((m) => ({
                id: m.match.id,
                label: sessionTestLabel(m),
              }))}
              onOpen={(id) => openFixture(id as UUID)}
              onDelete={(id) => deleteTests([id as UUID])}
              onDeleteAll={() => deleteTests(testMatchesOnPhone(matches, match).map((m) => m.match.id))}
              candidates={testMatchCandidates(ledger).map((m) => ({ id: m.id, label: testMatchLabel(m) }))}
              hidden={hiddenMatches(ledger).map((m) => ({
                id: m.id,
                label: testMatchLabel(m),
                note: m.matchKind?.note ?? null,
                kind: m.matchKind?.kind === 'void' ? 'void' : 'test',
              }))}
              message={testMatchMessage}
              onHideAll={hideTestMatches}
              onShow={showMatchAgain}
            />
          }
          backup={
            <BackupSection
              message={backupMessage}
              busy={backupBusy}
              pending={pendingBackup ? describeBackup(pendingBackup.preview) : null}
              onBackup={() => void backUpApp()}
              onPick={() => void pickBackup()}
              onConfirm={() => void restoreBackup()}
              onCancel={() => setPendingBackup(null)}
            />
          }
          testKit={
            testKitOn ? (
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
                onTimeSigning={() => {
                  const t = timeSigning();
                  setTestKitMessage(
                    `Signing on this phone: ${t.signMs.toFixed(1)} ms to sign, ${t.verifyMs.toFixed(1)} ms to check (average of 5).`
                  );
                }}
                message={testKitMessage}
              />
            ) : undefined
          }
          onForget={forgetEverything}
          onShowGettingStarted={offerShowAgain(cardClosed, startProgress) ? showCardAgain : null}
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
          ledger={viewLedger}
          kickoffs={kickoffs()}
          onPlayers={changeSquad}
          fairness={squadFairness}
          onFieldCount={format.onFieldCount}
          onStartMatch={forMatch ? () => beginMatch(false) : null}
          onLeave={forMatch ? goHome : null}
          onTryMadeUp={offerMadeUpTeam(players) ? tryMadeUpTeam : null}
          focusName={focusName}
          firstTime={nextButton}
          onClearMadeUp={isMadeUpTeam(players, everyMatch) ? clearMadeUpAndAdd : null}
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
          onLeave={leaveMatch}
          onPlanRest={planTheRest}
          // #166 Q1: before a period starts; never while one runs.
          names={
            canRenamePositions('lineup', match.state.quarters)
              ? namingFor(match.state.match.id, match.format)
              : undefined
          }
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
          buzzOnDue={buzzWhenSubDue}
          buzzLog={subBuzzLog}
          notNowLog={subNotNowLog}
          onChangePlan={changeSubPlan}
          onLiveMove={liveMove}
          onRecord={recordEvent}
          onRecordAssist={recordAssist}
          onWithdraw={withdrawEvent}
          onEndQuarter={endQuarter}
          onFinish={() => setStep('summary')}
          onLeave={leaveMatch}
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
        matches={listedFixtures(real, showArchived)
          .map((m) => m.match)
          // #194: a match marked a test or void is on no screen.
          .filter((m) => !hiddenIds.has(m.id))}
        currentMatchId={liveReal?.state.match.id ?? null}
        now={appNow()}
        onOpen={openFixture}
        progress={progressById(real, liveReal)}
        scores={scoresById(real, liveReal)}
        periods={periodsById(real, liveReal)}
        notClosed={notClosedIds(withLiveMatch(real, liveReal))}
        onDelete={deleteFixture}
        // #195: the record's played matches with no fixture here, archived fixtures included in "here".
        recordOnly={recordOnlyList.filter((m) => showArchived || !m.archived)}
        onOpenRecord={(id) => {
          setRecordId(id);
          setStep('record');
        }}
        onAdd={() => setStep('fixtureForm')}
        onPlan={(id) => {
          setPlanningId(id);
          setStep('plan');
        }}
        plannedIds={new Set(real.filter((m) => planHasContent(m.plan)).map((m) => m.match.id))}
        housekeeping={{
          // The live match's quarters, not the stored copy's: a fixture kicked
          // off a moment ago must not still be offered for deletion.
          deletable: new Set(
            real
              .filter((m) => {
                const live = liveReal?.state.match.id === m.match.id ? liveReal.state : m;
                return canDeleteFixture(live.quarters, live.match.status);
              })
              .map((m) => m.match.id)
          ),
          archivable: new Set(
            real
              .filter((m) => {
                const live = liveReal?.state.match.id === m.match.id ? liveReal.state : m;
                return canArchiveFixture(live.quarters, live.match.status);
              })
              .map((m) => m.match.id)
          ),
          archived: new Set(real.filter((m) => m.archived).map((m) => m.match.id)),
          onArchive: archiveFixture,
          archivedCount: real.filter((m) => m.archived).length + recordOnlyList.filter((m) => m.archived).length,
          showingArchived: showArchived,
          onToggleArchived: () => setShowArchived((v) => !v),
        }}
        onPlayNow={liveReal && matchIsUnderway(liveReal.state.quarters) ? null : playNow}
        buildLabel={currentBuildLabel()}
        notice={sessionMessage}
        // #218: the made-up team's line (Q6) and Getting started (AC1, AC2).
        // Neither shows on a phone with a real squad that has played (AC6).
        guide={
          <>
            {isMadeUpTeam(players, everyMatch) && <MadeUpBanner onSettings={() => goToTab('settings')} />}
            {showCard(cardClosed, startProgress) && (
              <GettingStartedCard
                steps={startProgress}
                onStep={onStartStep}
                onClose={closeCard}
                onTry={offerMadeUpTeam(players) ? tryMadeUpTeam : null}
              />
            )}
          </>
        }
        nothingPlayed={nextButton}
        highlightPlayNow={pointAtPlayNow}
      />
    );
  })();

  /**
   * One frame: one safe area, one status bar, and the tab bar when the screen
   * is a Tuesday one. Screens render their own content and none of the frame,
   * so a screen cannot disagree with the shell about whether it has tabs.
   */
  // #174: react-native-safe-area-context, not React Native's SafeAreaView,
  // which is a plain View on Android. Android draws edge to edge, so without
  // this the top of every screen sat under the status bar and the tab bar
  // under the navigation bar. The shell pads once; screens never pad again.
  return (
    <SafeAreaProvider>
    <SafeAreaView style={screen.safe}>
      {/* #143 AC9: a centred column on a wide screen; a phone is narrower, so unchanged. */}
      <TableSortProvider key={sortsForgotten} store={store} remember={sortsForgotten === 0}>
        <View style={screen.column}>
          {testBanner}
          {body}
          {toast && <Toast key={toast.id} text={toast.text} onUndo={toast.onUndo ?? null} />}
        </View>
      </TableSortProvider>
      {tab !== null && <TabBar active={tab} onSelect={goToTab} />}
      <StatusBar style="light" />
    </SafeAreaView>
    </SafeAreaProvider>
  );
}
