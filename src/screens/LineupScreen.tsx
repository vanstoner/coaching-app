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
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from './Text';
import { StatusBar } from 'expo-status-bar';

import { MatchEngine, type MatchState } from '../engine/MatchEngine';
import type { Format, Player, UUID } from '../types/index';
import { currentQuarter, formatClock, periodNoun } from '../app/matchClock';
import { pillDetail } from '../app/pitchLayout';
import { PLACEHOLDER_SQUAD_NAME } from '../app/placeholderSquad';
import { foldPlayerMinutes, type PlayerMinutes } from '../app/playerMinutes';
import { suggestLineup } from '../app/lineup';
import { lineupFromPlan, periodHasContent, type PlannedPeriod } from '../app/matchPlan';
import {
  NO_SUB_PLANNED,
  nudgeSubTime,
  planSubs,
  setSubFor,
  type PlannedSub,
} from '../app/subPlan';
import {
  addToSheet,
  editSheet,
  keeperOf,
  makeKeeper,
  placeInSlot,
  playersOn,
  removeFromSheet,
  sheetFromSelection,
  sheetIsComplete,
  type Sheet,
} from '../app/teamSheet';
import { Chip, ChipRow } from './Chip';
import { PitchView } from './PitchView';
import { PositionNameSheet, type PositionNaming } from './PositionNameSheet';
import { hasRenamedPositions } from '../app/positionNames';
import { shapeOfFormat } from '../app/shapes';
import { colours, screen, TOUCH_TARGET } from './theme';

export function LineupScreen({
  engine,
  state,
  format,
  players,
  squadName,
  planned,
  onStart,
  onLeave,
  onPlanRest,
  attendance,
  names,
}: {
  engine: MatchEngine;
  state: MatchState;
  /** The shape THIS match is played in, not the squad default. */
  format: Format;
  players: Player[];
  squadName: string;
  /** This period of the fixture's plan, if one was made (#72). */
  planned?: PlannedPeriod;
  onStart: (sheet: Sheet, plan: PlannedSub[]) => void;
  /** Back to Home. Does not kick off and does not end anything. */
  onLeave: () => void;
  /** Re-plan the periods still to come (#88). The clock keeps running. */
  onPlanRest?: () => void;
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
}) {
  const quarter = currentQuarter(state);
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
  /** The position whose name is being changed (#166). */
  const [renaming, setRenaming] = useState<UUID | null>(null);
  /** Which sub's "comes off" the picker is open for. */
  const [picking, setPicking] = useState<
    { kind: 'slot'; positionId: UUID } | { kind: 'off'; playerId: UUID } | null
  >(null);

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
  const shape = shapeOfFormat(format);
  const positions = [...format.positions].sort((a, b) => a.sortOrder - b.sortOrder);
  const nameOf = new Map(players.map((p) => [p.id, p.firstName]));

  const toggle = (id: UUID) => {
    setPicking(null);
    setSheet(selected.has(id) ? removeFromSheet(sheet, id) : addToSheet(sheet, format, id, prefersOf(id) ?? null));
  };

  const pickFor = (playerId: UUID | null) => {
    if (!picking) return;
    if (picking.kind === 'slot') {
      if (playerId !== null) setSheet(placeInSlot(sheet, picking.positionId, playerId));
      else setSheet({ ...sheet, [picking.positionId]: null });
    } else {
      setPlan((c) => setSubFor(c, picking.playerId, playerId));
    }
    setPicking(null);
  };

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

  return (
    <View style={screen.safe}>
      <View style={screen.pane}>
        <Text style={screen.title} numberOfLines={1}>
          {squadName || PLACEHOLDER_SQUAD_NAME}
        </Text>
        <Text style={screen.period}>
          {noun} {quarter?.index ?? 1} of {state.match.quarterCount}
          {shape ? ` · ${shape}` : ''}
        </Text>

        <ScrollView style={screen.list} scrollEnabled={!dragging}>
          {/* #83: the shape drawn as a pitch. Drag a player, or tap one and
              then where they go. Before kick-off this edits the sheet only. */}
          <Text style={screen.fieldLabel}>On the pitch</Text>
          {hasPlan && <Text style={local.fromPlan}>From your plan. Change anything.</Text>}
          <Text style={screen.hint}>
            {pitchPick
              ? `Now tap where ${nameOf.get(pitchPick) ?? ''} goes, or tap them again to cancel.`
              : 'Drag a player into place, or tap one and then where they go.'}
          </Text>
          <PitchView
            format={format}
            sheet={sheet}
            bench={players.map((p) => p.id).filter((id) => !selected.has(id))}
            nameOf={(id) => nameOf.get(id) ?? ''}
            detailOf={(id) => pillDetail(byId.get(id), id === goalkeeper)}
            selected={pitchPick}
            onSelect={setPitchPick}
            onDragging={setDragging}
            onMove={(id, target) => setSheet(editSheet(sheet, id, target))}
            onRenamePosition={names ? setRenaming : undefined}
          />
          {names && (
            <Text style={screen.hint}>Tap a gold position name to rename it for this match.</Text>
          )}
          {names && hasRenamedPositions(format) && (
            <Pressable style={screen.linkHit} onPress={names.onReset}>
              <Text style={screen.link}>Reset position names</Text>
            </Pressable>
          )}

          <Text style={screen.fieldLabel}>Who is on?</Text>
          <Text style={screen.hint}>
            Tap a name to bring them on or off; tap a position above to put
            someone there. The time beside a substitute is when you will be
            reminded to bring them on.
          </Text>

          {ordered.map((p) => {
            const m = byId.get(p.id);
            const on = selected.has(p.id);
            const isKeeper = goalkeeper === p.id;
            const pickingOff = picking?.kind === 'off' && picking.playerId === p.id;
            return (
              <View key={p.id}>
              <Pressable
                onPress={() => toggle(p.id)}
                style={({ pressed }) => [
                  local.pickRow,
                  on && local.pickRowOn,
                  pressed && screen.buttonPressed,
                ]}
              >
                <View style={local.pickMain}>
                  <Text style={screen.playerName} numberOfLines={1}>
                    {p.firstName}
                  </Text>
                  <Text style={local.pickMinutes} numberOfLines={1}>
                    {formatClock(m?.outfieldMs ?? 0)} outfield
                    {(m?.goalkeeperMs ?? 0) > 0
                      ? ` · ${formatClock(m!.goalkeeperMs)} in goal`
                      : ''}
                  </Text>
                  {/* AC10: who this sub replaces. Only once a time is set. */}
                  {!on && timeOf(p.id) !== NO_SUB_PLANNED && (
                    <Pressable
                      onPress={() =>
                        setPicking(
                          picking?.kind === 'off' && picking.playerId === p.id
                            ? null
                            : { kind: 'off', playerId: p.id }
                        )
                      }
                      style={local.offHit}
                    >
                      <Text style={local.off} numberOfLines={1}>
                        For:{' '}
                        {forOf(p.id) === null
                          ? 'whoever is on longest'
                          : (nameOf.get(forOf(p.id)!) ?? 'whoever is on longest')}
                      </Text>
                    </Pressable>
                  )}
                </View>
                {on ? (
                  <Pressable
                    onPress={() => setSheet(makeKeeper(sheet, format, p.id))}
                    style={[local.gkChip, isKeeper && local.gkChipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isKeeper }}
                  >
                    <Text style={[local.gkLabel, isKeeper && local.gkLabelOn]}>GK</Text>
                  </Pressable>
                ) : (
                  // A bench player carries the time they come on. The PO asked
                  // for exactly this: "set that time for a sub next to their
                  // name and that's the anchor for a reminder".
                  <View style={local.subTimeRow}>
                    <Pressable
                      onPress={() => setPlan((c) => nudgeSubTime(c, p.id, -30_000, periodMs))}
                      style={local.stepHit}
                    >
                      <Text style={local.step}>−</Text>
                    </Pressable>
                    <Text
                      style={[
                        local.subTime,
                        timeOf(p.id) === NO_SUB_PLANNED && local.subTimeOff,
                      ]}
                      numberOfLines={1}
                    >
                      {timeOf(p.id) === NO_SUB_PLANNED ? 'No sub' : formatClock(timeOf(p.id))}
                    </Text>
                    <Pressable
                      onPress={() => setPlan((c) => nudgeSubTime(c, p.id, 30_000, periodMs))}
                      style={local.stepHit}
                    >
                      <Text style={local.step}>+</Text>
                    </Pressable>
                  </View>
                )}
              </Pressable>
              {pickingOff && (
                <View style={local.picker}>
                  <ChipRow>
                    {outfieldOn.map((id) => (
                      <Chip
                        key={id}
                        label={nameOf.get(id) ?? ''}
                        selected={forOf(p.id) === id}
                        onPress={() => pickFor(id)}
                      />
                    ))}
                    <Chip
                      label="Longest on"
                      selected={forOf(p.id) === null}
                      onPress={() => pickFor(null)}
                    />
                  </ChipRow>
                </View>
              )}
              </View>
            );
          })}

          {attendance && attendance.arrivalsOnly && (() => {
            const away = attendance.squad.filter((p) => attendance.isAbsent(p.id));
            if (away.length === 0) return null;
            return (
              <>
                <Text style={screen.fieldLabel}>Arrived late?</Text>
                <Text style={screen.hint}>
                  Tap a name to mark them here. They can then be picked, and the
                  record notes they arrived after kick-off.
                </Text>
                <ChipRow>
                  {away.map((p) => (
                    <Chip
                      key={p.id}
                      label={p.firstName}
                      detail="Absent"
                      selected={false}
                      onPress={() => attendance.onToggle(p.id, false)}
                    />
                  ))}
                </ChipRow>
              </>
            );
          })()}

          {attendance && !attendance.arrivalsOnly && (
            <>
              <Text style={screen.fieldLabel}>Here today?</Text>
              <Text style={screen.hint}>
                Everyone is here unless you say so. Tap a name to mark them
                absent; an absent player can&apos;t be picked. After kick-off
                this can only be changed as a correction.
              </Text>
              <ChipRow>
                {attendance.squad.map((p) => {
                  const absent = attendance.isAbsent(p.id);
                  return (
                    <Chip
                      key={p.id}
                      label={p.firstName}
                      detail={absent ? 'Absent' : 'Here'}
                      selected={!absent}
                      onPress={() => {
                        // Off the sheet first, so an absent player is never left picked.
                        if (!absent) setSheet((s) => removeFromSheet(s, p.id));
                        attendance.onToggle(p.id, !absent);
                      }}
                    />
                  );
                })}
              </ChipRow>
            </>
          )}
        </ScrollView>

        <Text style={[screen.caption, !complete && screen.overtime]}>
          {onPitch.length} of {format.onFieldCount} picked
          {goalkeeper === null ? ' · no goalkeeper chosen' : ''}
        </Text>

        <Pressable
          disabled={!complete}
          style={({ pressed }) => [
            screen.button,
            !complete && screen.buttonDisabled,
            pressed && screen.buttonPressed,
          ]}
          onPress={() => onStart(sheet, plan)}
        >
          <Text style={screen.buttonLabel}>Start {noun.toLowerCase()}</Text>
        </Pressable>

        <View style={screen.actions}>
          {hasPlan && (
            <Pressable onPress={() => apply(fromPlan())} style={screen.linkHit}>
              <Text style={screen.link}>Use plan</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => {
              setPicking(null);
              setSheet(fromSuggestion().sheet);
            }}
            style={screen.linkHit}
          >
            <Text style={screen.link}>Use suggestion</Text>
          </Pressable>
          {onPlanRest && (
            <Pressable onPress={onPlanRest} style={screen.linkHit}>
              <Text style={screen.link}>Plan</Text>
            </Pressable>
          )}
          {/* Always. Between periods too: the match stays exactly as it is. */}
          <Pressable onPress={onLeave} style={screen.linkHit}>
            <Text style={screen.link}>Leave</Text>
          </Pressable>
        </View>
      </View>
      {names && (
        <PositionNameSheet
          format={format}
          positionId={renaming}
          offerKeep={names.offerKeep}
          onSave={names.onRename}
          onClose={() => setRenaming(null)}
        />
      )}
      <StatusBar style="light" />
    </View>
  );
}

const local = StyleSheet.create({
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#164f3c',
  },
  // A FIXED width: the labels are 2-3 characters and a box sized to its own
  // text is what clipped the last glyph off the clock.
  slotLabel: {
    color: colours.warn,
    fontSize: 14,
    fontWeight: '600',
    includeFontPadding: false,
    flexShrink: 0,
    width: 48,
  },
  slotName: { color: colours.ink, fontSize: 16, flex: 1, includeFontPadding: false },
  slotEmpty: { color: colours.inkFaint },
  picker: { paddingVertical: 8 },
  fromPlan: {
    alignSelf: 'stretch',
    color: colours.warn,
    fontSize: 13,
    includeFontPadding: false,
    marginBottom: 4,
  },
  offHit: { minHeight: TOUCH_TARGET, justifyContent: 'center' },
  off: {
    color: colours.ink,
    fontSize: 13,
    textDecorationLine: 'underline',
    includeFontPadding: false,
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOUCH_TARGET + 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginBottom: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#164f3c',
  },
  pickRowOn: { backgroundColor: colours.accent, borderColor: colours.accent },
  pickMain: { flex: 1 },
  // Every right-hand character was missing from the per-player times once.
  // Android measures a Text once; sitting beside a `flex: 1` sibling it gets
  // squeezed and the tail is cut. `flexShrink: 0` stops the squeeze.
  pickMinutes: {
    color: '#cfe3da',
    fontSize: 12,
    marginTop: 2,
    includeFontPadding: false,
    flexShrink: 0,
    paddingRight: 4,
  },
  subTimeRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  // Same metrics as subTime — only the colour changes.
  subTimeOff: { color: colours.inkFaint },
  stepHit: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
  },
  step: { color: colours.ink, fontSize: 22, includeFontPadding: false },
  subTime: {
    color: colours.warn,
    fontSize: 15,
    fontWeight: '600',
    includeFontPadding: false,
    flexShrink: 0,
    paddingHorizontal: 2,
    textAlign: 'center',
    // A FIXED width, not minWidth. "No sub" is wider than "06:15", and a box
    // that sizes itself to its own text is what clipped the last glyph off
    // the clock and the choice boxes.
    width: 68,
  },
  gkChip: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cfe3da',
    flexShrink: 0,
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
  },
  gkChipOn: { backgroundColor: colours.warn, borderColor: colours.warn },
  gkLabel: { color: '#cfe3da', fontSize: 14, fontWeight: '600', includeFontPadding: false },
  gkLabelOn: { color: '#3a2a00', fontSize: 14, fontWeight: '600', includeFontPadding: false },
});
