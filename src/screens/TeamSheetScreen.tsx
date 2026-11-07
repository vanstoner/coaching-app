/**
 * The team sheet — #277, built to Dee's mock v2 (Rob, 6 Nov: "Let's build
 * this"; criteria on #277). One screen, top to bottom:
 *
 *   Who's coming ›
 *   › Keepers and subs (a Section, closed by default, with its summary)
 *   Pitch | All | Table: the same flow in each, a choice of screen space
 *   Fill: Positions (Fairly | By position), Fill the rest, Reset
 *   › Minutes (a Section)
 *   Share plan, the Main button, off until every place is filled
 *
 * The sheet is the match's ordinary plan (B12, D6): it moves no minute
 * (invariant 1). Places the coach fills by hand carry a green dot and are
 * kept by Fill and ⟳ Rearrange. Every figure is worked out on each draw.
 */

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import type { AvailabilityStatus, Format, Match, Player, UUID } from '../types/index';
import { displayName } from '../app/squad';
import { formatClock, formatSubTime, periodNoun } from '../app/matchClock';
import {
  defaultSwapTimeMs,
  emptyPlan,
  periodLengthMs,
  planFor,
  planHasContent,
  projectPlan,
  setPeriodSlots,
  type MatchPlan,
} from '../app/matchPlan';
import { comingRows, comingSummary } from '../app/whosComing';
import { buildTeamSheet, fairestSubs, rotateKeepers, type Fill, type SeasonKeeping } from '../app/teamSheetBuilder';
import {
  applyKeepers,
  benchOf,
  canRearrange,
  isPinned,
  keepPinned,
  keepersOf,
  minutesThrough,
  pinPlaces,
  rearrangePeriod,
  swapInPeriod,
  type SheetView,
} from '../app/teamSheetEdit';
import { editSheet } from '../app/teamSheet';
import { Action, BackLink, Icon, ListSheet, RowNav, SavedTick, Section, Segmented, Stepper, TopBar, useSavedTick } from './controls';
import { PitchView } from './PitchView';
import { PlannedSubPanel, subRequestFor, type SubRequest } from './PlannedSubPanel';
import { SharePlanFoot } from './SharePlan';
import { TeamSheetViews } from './TeamSheetViews';
import { useEdgeScroll } from './useEdgeScroll';
import { colours, screen, TOUCH_TARGET } from './theme';

export function TeamSheetScreen({
  match,
  squadName,
  format,
  players,
  availability,
  plan: stored,
  season,
  view,
  onView,
  onChange,
  onComing,
  onSquad,
  onEditPeriods,
  onUndo,
  onBack,
}: {
  match: Match;
  squadName: string;
  format: Format;
  /** The whole squad, in squad order. */
  players: Player[];
  availability: [UUID, AvailabilityStatus][] | undefined;
  plan: MatchPlan | undefined;
  season: ReadonlyMap<UUID, SeasonKeeping>;
  /** Pitch, All or Table, as last chosen on this phone (C13). */
  view: SheetView;
  onView: (view: SheetView) => void;
  onChange: (plan: MatchPlan) => void;
  onComing: () => void;
  /** The Squad tab, from the never-in-goal line (B8). */
  onSquad: () => void;
  /** The Plan screen: sub times and who comes off, period by period (B12). */
  onEditPeriods: () => void;
  /** A toast with Undo, as elsewhere. */
  onUndo: (text: string, undo: () => void) => void;
  onBack: () => void;
}) {
  const tick = useSavedTick();
  const periodCount = match.quarterCount;
  const noun = periodNoun(periodCount);
  const short = noun === 'Quarter' ? 'Q' : 'H';
  const periodMs = periodLengthMs(match.totalMinutes, periodCount);
  const subAt = formatSubTime(defaultSwapTimeMs(periodMs));
  const rows = comingRows(availability, players);
  const coming = rows.filter((r) => r.coming === 'coming').map((r) => r.player);
  const comingIds = coming.map((p) => p.id);
  const absent = new Set(rows.filter((r) => r.coming !== 'coming').map((r) => r.player.id));
  const name = (id: UUID | null) =>
    id ? displayName(players.find((p) => p.id === id) ?? { firstName: '?', displaySuffix: null }) : 'Nobody';
  const prefersOf = (id: UUID) => players.find((p) => p.id === id)?.prefers ?? null;

  const rotated = rotateKeepers(coming, periodCount, periodMs, season);
  // Before anything is saved: the empty quarters with the keepers in goal.
  const made = planHasContent(stored);
  const sheet = made ? planFor(stored, periodCount) : applyKeepers(emptyPlan(periodCount), format, rotated);
  const keepers = keepersOf(sheet, format);

  const [setupOpen, setSetupOpen] = useState(false);
  const [minutesOpen, setMinutesOpen] = useState(false);
  const [keeperMode, setKeeperMode] = useState<'auto' | 'choose'>('auto');
  const [subsChosen, setSubsChosen] = useState<number | null>(null);
  const [fill, setFill] = useState<Fill>('fair');
  const [picking, setPicking] = useState<number | null>(null);
  const [quarter, setQuarter] = useState(0);
  const [pick, setPick] = useState<UUID | null>(null);
  // Rob, 7 Nov: a sub made from a tap, as on the Plan (PlannedSubPanel).
  const [subAsk, setSubAsk] = useState<SubRequest | null>(null);
  const [dragging, setDragging] = useState(false);
  const [turn, setTurn] = useState(1);
  // #276: drag near the scrolling area's edge to scroll it; the pitch fits with the bench.
  const edge = useEdgeScroll(dragging);

  // The Subs stepper starts at the fewest subs with the fairest split (Rob, 6 Nov).
  const outfield = format.positions.filter((p) => p.kind !== 'goalkeeper').length;
  const benchSize = Math.max(0, coming.length - outfield - 1);
  const fairest = fairestSubs({ format, totalMinutes: match.totalMinutes, periodCount, coming, keepers, fill, season });
  const subs = Math.min(subsChosen ?? fairest, benchSize);

  const save = (next: MatchPlan) => {
    onChange(next);
    tick.mark();
  };
  /** A change with Undo in the toast, as elsewhere. */
  const undoable = (next: MatchPlan, text: string) => {
    const before = stored;
    save(next);
    onUndo(text, () => onChange(before ?? emptyPlan(periodCount)));
  };

  /** By hand: swap two, or a child into a place, and mark the places (the green dot). */
  const byHand = (p: number, next: MatchPlan, text: string) => {
    const before = sheet.periods[p].slots;
    const after = next.periods[p].slots;
    const changed = (Object.keys(after) as UUID[]).filter((pos) => before[pos] !== after[pos] && after[pos]);
    undoable(pinPlaces(next, p, changed), text);
  };
  const swap = (p: number, a: UUID, b: UUID) => byHand(p, swapInPeriod(sheet, p, a, b), `Swapped ${name(a)} and ${name(b)}`);
  const place = (p: number, id: UUID, positionId: UUID) =>
    byHand(p, setPeriodSlots(sheet, p, editSheet(sheet.periods[p].slots, id, { kind: 'slot', positionId })), `${name(id)} placed`);

  const fillRest = () => {
    const start = keepPinned(sheet, format);
    const built = buildTeamSheet({
      format,
      totalMinutes: match.totalMinutes,
      periodCount,
      coming,
      keepers,
      subs,
      fill,
      season,
      existing: start,
    }).plan;
    undoable(
      { periods: built.periods.map((period, i) => ({ ...period, pinned: start.periods[i].pinned })) },
      'Filled: anyone you placed stayed put'
    );
  };
  const reset = () => undoable(applyKeepers(emptyPlan(periodCount), format, keepers), 'Reset: keepers kept');
  const rearrange = (p: number) => {
    setTurn((t) => t + 1);
    undoable(rearrangePeriod(sheet, p, format, turn, fill === 'positions' ? prefersOf : undefined), `${short}${p + 1} rearranged`);
  };

  const isFull = (p: number) => format.positions.every((pos) => sheet.periods[p].slots[pos.id]);
  const full = made && sheet.periods.every((_, p) => isFull(p));
  const anyPlaced = sheet.periods.some((period) => Object.values(period.slots).filter(Boolean).length > 1);

  // Keepers: who keeps, in a few words (Rob, 6 Nov: no long sentences).
  const main = coming.find((p) => p.keeper === 'main');
  const backup = coming.find((p) => p.keeper === 'backup');
  const sameKeeper = keepers.length > 0 && keepers.every((k) => k !== null && k === keepers[0]);
  const keeperWhy =
    main && sameKeeper && keepers[0] === main.id
      ? 'main keeper'
      : !main && backup && sameKeeper && keepers[0] === backup.id
        ? 'back-up keeper'
        : 'least time in goal first';
  const keeperSummary =
    keeperMode === 'choose'
      ? 'Keepers chosen by you'
      : sameKeeper
        ? `${name(keepers[0])} in goal all match`
        : 'Keepers rotate: least time in goal first';
  const subsSummary = subs === 0 ? 'no subs' : `${subs} ${subs === 1 ? 'sub' : 'subs'} a ${noun.toLowerCase()} at ${subAt}`;
  const eligible = coming.filter((p) => p.keeper !== 'never');
  const never = coming.filter((p) => p.keeper === 'never').map(displayName);
  const neverNames = never.length === 1 ? never[0] : `${never.slice(0, -1).join(', ')} and ${never[never.length - 1]}`;

  // Minutes: the fair share and the range, a Main keeper left out (ADR-015).
  const projection = made ? projectPlan(sheet, format, match.totalMinutes, periodCount, coming, null, new Set()) : null;
  const inShare = projection ? projection.rows.filter((r) => !(main && r.playerId === main.id)) : [];
  const minutes = [...inShare].sort((a, b) => a.pitchMs - b.pitchMs);
  const range = minutes.length ? `${formatClock(minutes[0].pitchMs)}–${formatClock(minutes[minutes.length - 1].pitchMs)}` : '';
  const minutesOf = (id: UUID) => projection?.rows.find((r) => r.playerId === id)?.pitchMs ?? 0;

  const period = sheet.periods[quarter];
  const soFar = minutesThrough(sheet, quarter, format, match.totalMinutes, periodCount, coming);
  const subsHere = period.subs.filter((s) => s.onId && s.offId);

  return (
    <View style={screen.flex}>
      <ScrollView contentContainerStyle={screen.scroll} {...edge.scrollProps}>
        <TopBar
          back={<BackLink label="Done" accessibilityLabel="Done" onPress={onBack} />}
          title="Team sheet"
          right={<SavedTick visible={tick.visible} />}
        />
        <Text style={screen.caption} numberOfLines={1}>
          {`${squadName} v ${match.opponent || 'Opponent TBC'}`}
        </Text>
        <RowNav label="Who's coming" value={comingSummary(rows)} onPress={onComing} first />

        <Section
          title="Keepers and subs"
          summary={`${keeperSummary} · ${subsSummary}`}
          open={setupOpen}
          onToggle={() => setSetupOpen((o) => !o)}
        >
          <View style={local.line}>
            <Text style={local.lineLabel}>Keepers</Text>
            <View style={local.lineControl}>
              <Segmented<'auto' | 'choose'>
                name="Keepers"
                options={[
                  { value: 'auto', label: 'Automatic' },
                  { value: 'choose', label: "I'll choose" },
                ]}
                value={keeperMode}
                onChange={(v) => {
                  if (!v) return;
                  setKeeperMode(v);
                  if (v === 'auto') undoable(applyKeepers(sheet, format, rotated), 'Keepers saved');
                }}
              />
            </View>
          </View>
          {keeperMode === 'auto' ? (
            <View style={local.inGoalBlock}>
              <Text style={local.inGoal}>
                <Text style={local.inGoalLabel}>In goal </Text>
                {keepers.map((k, i) => `${short}${i + 1} ${name(k)}`).join(' · ')}
              </Text>
              <Text style={local.why}>{keeperWhy}</Text>
            </View>
          ) : (
            <View style={local.keeperGrid}>
              {keepers.map((k, i) => (
                <Pressable
                  key={i}
                  onPress={() => setPicking(i)}
                  accessibilityRole="button"
                  accessibilityLabel={`${noun} ${i + 1} keeper, ${name(k)}. Change`}
                  style={({ pressed }) => [local.keeperButton, pressed && local.pressed]}
                >
                  <Text style={local.keeperQ}>{`${short}${i + 1}`}</Text>
                  <Text style={local.keeperName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                    {k ? name(k) : 'Pick'}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          <View style={local.line}>
            <Text style={local.lineLabel}>{`Subs at ${subAt}`}</Text>
            <Text style={local.subCount}>{subs}</Text>
            <Stepper
              onMinus={() => setSubsChosen(Math.max(0, subs - 1))}
              onPlus={() => setSubsChosen(Math.min(benchSize, subs + 1))}
              minusLabel="One sub fewer"
              plusLabel="One sub more"
              minusDisabled={subs <= 0}
              plusDisabled={subs >= benchSize}
            />
            <Text style={local.why}>{subs === fairest ? 'fairest' : `fairest is ${fairest}`}</Text>
          </View>
          {never.length > 0 && (
            // B8: one neutral line, never blocking, never the warning colour.
            <Pressable onPress={onSquad} accessibilityRole="button" style={local.neverRow}>
              <Text style={local.why}>{`${neverNames} never ${never.length === 1 ? 'goes' : 'go'} in goal. Fewer on that list shares keeping more fairly. `}</Text>
              <Text style={local.link}>Squad</Text>
            </Pressable>
          )}
          {made && <RowNav label="Sub times and who comes off" onPress={onEditPeriods} first />}
        </Section>

        <View style={local.views}>
          <Text style={[screen.fieldLabel, local.viewsLabel]}>{made ? 'Tap two to swap, the bench to sub' : 'Place anyone you want to'}</Text>
          <View style={local.viewControl}>
            <Segmented<SheetView>
              name="View"
              options={[
                { value: 'formation', label: 'Pitch' },
                { value: 'all', label: 'All' },
                { value: 'table', label: 'Table' },
              ]}
              value={view}
              onChange={(v) => v && onView(v)}
            />
          </View>
        </View>

        {view === 'formation' && (
          <View>
            <View style={local.tabs}>
              {sheet.periods.map((_, i) => (
                <Pressable
                  key={i}
                  onPress={() => {
                    setQuarter(i);
                    setPick(null);
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: i === quarter }}
                  accessibilityLabel={`${noun} ${i + 1}${isFull(i) ? ', full' : ''}`}
                  style={[local.tab, i === quarter && local.tabOn]}
                >
                  <Text style={[local.tabText, i === quarter && local.tabTextOn]}>{`${short}${i + 1}`}</Text>
                  <View style={[local.tabDot, isFull(i) && local.tabDotFull]} />
                </Pressable>
              ))}
            </View>
            <View style={local.qbar}>
              <Text style={local.subLine} numberOfLines={2}>
                {subsHere.length
                  ? subsHere.map((s) => `${name(s.onId)} for ${name(s.offId)} at ${formatSubTime(s.atMs)}`).join(', ')
                  : subs
                    ? `Subs at ${subAt} are placed when you fill`
                    : `No subs this ${noun.toLowerCase()}`}
              </Text>
              <Pressable
                onPress={() => rearrange(quarter)}
                disabled={!canRearrange(period, format)}
                accessibilityRole="button"
                accessibilityLabel={`Rearrange ${noun} ${quarter + 1}: same children, new places`}
                style={({ pressed }) => [local.rearrange, !canRearrange(period, format) && local.off, pressed && local.pressed]}
              >
                <Text style={local.rearrangeText}>⟳ Rearrange</Text>
              </Pressable>
            </View>
            <PitchView
              format={format}
              sheet={period.slots}
              bench={benchOf(period, comingIds)}
              nameOf={(id) => name(id)}
              detailOf={(id) => {
                const on = subsHere.find((s) => s.onId === id);
                if (on) return `on at ${formatSubTime(on.atMs)} for ${name(on.offId)}`;
                const off = subsHere.find((s) => s.offId === id);
                if (off) return `off at ${formatSubTime(off.atMs)}`;
                // Rob, 7 Nov: the running total to the end of this quarter, not the whole match.
                return made ? formatClock(soFar.get(id) ?? 0) : '';
              }}
              markedIds={
                new Set(
                  format.positions
                    .filter((pos) => pos.kind !== 'goalkeeper' && isPinned(period, pos.id))
                    .map((pos) => period.slots[pos.id]!)
                )
              }
              goldIds={new Set(subsHere.map((s) => s.onId!))}
              selected={pick}
              onSelect={setPick}
              // A bench child opens their sub; a child on the pitch is picked
              // up, to swap or to sub off (Rob, 7 Nov).
              onTapPlayer={(id) => {
                if (Object.values(period.slots).includes(id)) setPick(id);
                else setSubAsk(subRequestFor(period, id, false));
              }}
              onDragging={setDragging}
              {...edge.pitchProps}
              onMove={(id, target) => {
                // Onto someone it is a swap, and a sub follows its place (C17);
                // onto an empty place or the bench, an ordinary move.
                const other =
                  target.kind === 'player'
                    ? target.playerId
                    : target.kind === 'slot'
                      ? (period.slots[target.positionId] ?? null)
                      : null;
                if (other) swap(quarter, id, other);
                else byHand(quarter, setPeriodSlots(sheet, quarter, editSheet(period.slots, id, target)), `${name(id)} moved`);
              }}
            />
            {pick && Object.values(period.slots).includes(pick) && (
              <Action
                label={`Sub ${name(pick)} off`}
                onPress={() => {
                  setSubAsk(subRequestFor(period, pick, true));
                  setPick(null);
                }}
              />
            )}
          </View>
        )}
        {view !== 'formation' && (
          <TeamSheetViews
            plan={sheet}
            format={format}
            coming={comingIds}
            name={(id) => name(id)}
            short={short}
            view={view === 'all' ? 'formation' : 'table'}
            onSwap={swap}
            onPlace={place}
            onRearrange={rearrange}
            onOpen={(p) => {
              setQuarter(p);
              onView('formation');
            }}
          />
        )}

        {/* Fill sits in the flow, under the quarters, on the pitch's raised panel (mock v2). */}
        <View style={local.fillCard}>
          <View style={local.line}>
            <Text style={local.lineLabel}>Positions</Text>
            <View style={local.lineControl}>
              <Segmented<Fill>
                name="Positions"
                options={[
                  { value: 'fair', label: 'Fairly' },
                  { value: 'positions', label: 'By position' },
                ]}
                value={fill}
                onChange={(v) => v && setFill(v)}
              />
            </View>
          </View>
          <View style={local.fillRow}>
            <Pressable
              onPress={fillRest}
              disabled={full || coming.length === 0}
              accessibilityRole="button"
              accessibilityLabel={full ? 'Every place filled' : 'Fill the rest'}
              style={({ pressed }) => [local.fillButton, full && local.fillDone, pressed && local.pressed]}
            >
              <View style={local.fillInner}>
                {full && <Icon name="check-bold" size={18} color={colours.inkMuted} />}
                <Text style={[local.fillText, full && local.fillTextDone]}>{full ? 'Every place filled' : 'Fill the rest'}</Text>
              </View>
            </Pressable>
            <Pressable
              onPress={reset}
              disabled={!anyPlaced}
              accessibilityRole="button"
              accessibilityLabel="Reset: keepers kept"
              style={({ pressed }) => [local.resetButton, !anyPlaced && local.off, pressed && local.pressed]}
            >
              <Text style={local.resetText}>Reset</Text>
            </Pressable>
          </View>
        </View>

        <Section
          title="Minutes"
          summary={projection && full ? `${range} · fair share ${formatClock(projection.fairShareMs)}` : 'Shown once every place is filled'}
          open={minutesOpen}
          onToggle={() => setMinutesOpen((o) => !o)}
        >
          {projection ? (
            <View>
              <View style={local.minuteRow}>
                <Text style={local.minuteName}>Fair share</Text>
                <Text style={local.minuteTime}>{formatClock(projection.fairShareMs)}</Text>
              </View>
              {minutes.map((row) => (
                <View key={row.playerId} style={local.minuteRow}>
                  <Text style={local.minuteName} numberOfLines={1}>
                    {row.name}
                  </Text>
                  <Text style={local.minuteTime}>{formatClock(row.pitchMs)}</Text>
                </View>
              ))}
              {main && (
                <View style={local.minuteRow}>
                  <Text style={local.minuteName} numberOfLines={1}>{`${displayName(main)}, main keeper (not in the share)`}</Text>
                  <Text style={local.minuteTime}>{formatClock(minutesOf(main.id))}</Text>
                </View>
              )}
            </View>
          ) : (
            <Text style={screen.hint}>Fill the sheet to see everyone's minutes.</Text>
          )}
        </Section>
      </ScrollView>

      {/* Rob, 6 Nov: "I make final tweaks and share". Off until every place is filled. */}
      <PlannedSubPanel
        request={subAsk}
        plan={sheet}
        periodIndex={quarter}
        periodMs={periodMs}
        format={format}
        players={coming}
        noun={noun}
        name={(id) => name(id)}
        onChange={(next) => undoable(next, 'Sub planned')}
        onClose={() => setSubAsk(null)}
        onPutInLineup={setPick}
      />

      <SharePlanFoot
        match={match}
        squadName={squadName}
        format={format}
        plan={sheet}
        players={players}
        absent={absent}
        periodCount={periodCount}
        noun={noun}
        disabled={!full}
        note={full ? undefined : 'Fill every place first'}
      />

      <ListSheet
        visible={picking !== null}
        title={picking === null ? '' : `In goal, ${noun} ${picking + 1}`}
        items={eligible.map((p) => {
          const kept = season.get(p.id)?.timesKept ?? 0;
          return { value: p.id, label: displayName(p), detail: `kept ${kept} ${kept === 1 ? 'time' : 'times'} this season` };
        })}
        value={picking === null ? null : keepers[picking]}
        onPick={(id) => {
          if (picking === null) return;
          const next = [...keepers];
          next[picking] = id;
          undoable(applyKeepers(sheet, format, next), 'Keeper saved');
          setPicking(null);
        }}
        onCancel={() => setPicking(null)}
      />
    </View>
  );
}

const local = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginVertical: 6 },
  lineLabel: { color: colours.ink, fontSize: 15, fontWeight: '600', width: 96, includeFontPadding: false },
  lineControl: { flex: 1, minWidth: 0 },
  inGoalBlock: { marginBottom: 4 },
  inGoal: { color: colours.ink, fontSize: 14, lineHeight: 20, includeFontPadding: false },
  inGoalLabel: { color: colours.warn, fontWeight: '600' },
  why: { color: colours.inkMuted, fontSize: 13, includeFontPadding: false },
  keeperGrid: { flexDirection: 'row', gap: 6, marginVertical: 6 },
  keeperButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: colours.warn,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  keeperQ: { color: '#3f6b5b', fontSize: 11, fontWeight: '600', includeFontPadding: false },
  keeperName: {
    alignSelf: 'stretch',
    textAlign: 'center',
    color: '#0b3d2e',
    fontSize: 13,
    fontWeight: '700',
    includeFontPadding: false,
    flexShrink: 0,
  },
  subCount: { color: colours.ink, fontSize: 20, fontWeight: '700', minWidth: 18, textAlign: 'center', includeFontPadding: false },
  views: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 14 },
  viewsLabel: { flex: 1, marginTop: 0, marginBottom: 0 },
  viewControl: { width: 190 },
  tabs: { flexDirection: 'row', gap: 6, marginTop: 8 },
  tab: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colours.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabOn: { borderColor: colours.action, backgroundColor: colours.pitchRaised },
  tabText: { color: colours.inkMuted, fontSize: 15, fontWeight: '600', includeFontPadding: false },
  tabTextOn: { color: colours.ink },
  tabDot: { position: 'absolute', top: 6, right: 8, width: 7, height: 7, borderRadius: 4, backgroundColor: colours.line },
  tabDotFull: { backgroundColor: colours.action },
  qbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginVertical: 6 },
  subLine: { flex: 1, color: colours.inkMuted, fontSize: 13, includeFontPadding: false },
  rearrange: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colours.line,
  },
  rearrangeText: { color: colours.action, fontSize: 14, fontWeight: '700', includeFontPadding: false },
  off: { opacity: 0.35 },
  pressed: { opacity: 0.6 },
  fillCard: {
    marginTop: 12,
    marginBottom: 6,
    padding: 12,
    backgroundColor: colours.pitchRaised,
    borderWidth: 2,
    borderColor: colours.line,
    borderRadius: 14,
  },
  fillRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  // Rob, 6 Nov: Fill and Reset as obvious buttons (a deliberate exception to Action's mint text).
  fillButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colours.action,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fillDone: { borderColor: colours.line },
  fillInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fillText: { color: colours.action, fontSize: 18, fontWeight: '700', includeFontPadding: false },
  fillTextDone: { color: colours.inkMuted },
  resetButton: {
    minHeight: 52,
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colours.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetText: { color: colours.inkMuted, fontSize: 16, fontWeight: '700', includeFontPadding: false },
  neverRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', minHeight: TOUCH_TARGET },
  link: { color: colours.action, fontSize: 13, fontWeight: '600', includeFontPadding: false },
  minuteRow: { flexDirection: 'row', alignItems: 'center', minHeight: 28 },
  minuteName: { flex: 1, color: colours.ink, fontSize: 15, includeFontPadding: false },
  minuteTime: { color: colours.inkMuted, fontSize: 15, includeFontPadding: false, flexShrink: 0 },
});
