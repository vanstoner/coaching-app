/**
 * The team sheet — #277, in Rob's order (6 Nov, "approve flow"):
 *
 *   keepers → mid-quarter subs → place anyone you want → fill the rest
 *   (Fairly, or Using positions) → tweak → Share plan.
 *
 * One screen. The quarters show from the start with the keepers in goal and
 * everyone else on the bench. The pitch is the real pitch, one quarter at a
 * time, with drag and tap as on the Lineup (Rob: "pitch view need to remain
 * awesome"); All quarters and the Table show them together.
 *
 * The sheet is the match's ordinary plan (B12, D6): it moves no minute
 * (invariant 1), and the clock and the Lineup read it as before. Every
 * figure under it is worked out from the plan each time it draws.
 */

import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import type { AvailabilityStatus, Format, Match, Player, UUID } from '../types/index';
import { displayName } from '../app/squad';
import { formatClock, formatSubTime, periodNoun } from '../app/matchClock';
import { emptyPlan, periodLengthMs, planFor, planHasContent, projectPlan, setPeriodSlots, type MatchPlan } from '../app/matchPlan';
import { comingRows, comingSummary } from '../app/whosComing';
import { buildTeamSheet, rotateKeepers, type Fill, type SeasonKeeping } from '../app/teamSheetBuilder';
import { applyKeepers, benchOf, keepersOf, swapInPeriod, type SheetView } from '../app/teamSheetEdit';
import { editSheet } from '../app/teamSheet';
import {
  Action,
  ActionRow,
  BackLink,
  GroupLabel,
  ListSheet,
  RowNav,
  SavedTick,
  Segmented,
  TopBar,
  useSavedTick,
} from './controls';
import { PitchView } from './PitchView';
import { SharePlanFoot } from './SharePlan';
import { TeamSheetViews } from './TeamSheetViews';
import { useEdgeScroll } from './useEdgeScroll';
import { colours, screen } from './theme';

/** C16: more than this under the fair share is marked, in neutral text. */
export const SHORT_MS = 3 * 60_000;

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
  /** Pitch, All quarters or Table, as last chosen on this phone (C13). */
  view: SheetView;
  onView: (view: SheetView) => void;
  onChange: (plan: MatchPlan) => void;
  onComing: () => void;
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
  const rows = comingRows(availability, players);
  const coming = rows.filter((r) => r.coming === 'coming').map((r) => r.player);
  const comingIds = coming.map((p) => p.id);
  const absent = new Set(rows.filter((r) => r.coming !== 'coming').map((r) => r.player.id));
  const name = (id: UUID | null) =>
    id ? displayName(players.find((p) => p.id === id) ?? { firstName: '?', displaySuffix: null }) : 'Nobody';

  const rotated = rotateKeepers(coming, periodCount, periodMs, season);
  // The sheet as it stands: the stored plan, or, before anything is saved,
  // the empty quarters with the rotation's keepers in goal. Nothing is saved
  // until the coach changes something.
  const made = planHasContent(stored);
  const sheet = made ? planFor(stored, periodCount) : applyKeepers(emptyPlan(periodCount), format, rotated);
  const keepers = keepersOf(sheet, format);

  const [keeperMode, setKeeperMode] = useState<'rotate' | 'choose'>('rotate');
  const [subs, setSubs] = useState(true);
  const [fill, setFill] = useState<Fill>('fair');
  const [picking, setPicking] = useState<number | null>(null);
  const [quarter, setQuarter] = useState(0);
  const [pick, setPick] = useState<UUID | null>(null);
  const [dragging, setDragging] = useState(false);
  // #276: drag near the scrolling area's edge to scroll it; the pitch fits with the bench.
  const edge = useEdgeScroll(dragging);

  const save = (next: MatchPlan) => {
    onChange(next);
    tick.mark();
  };
  /** A change that comes with Undo in the toast, as elsewhere. */
  const undoable = (next: MatchPlan, text: string) => {
    const before = stored;
    save(next);
    onUndo(text, () => onChange(before ?? emptyPlan(periodCount)));
  };
  const swap = (p: number, a: UUID, b: UUID) => undoable(swapInPeriod(sheet, p, a, b), `Swapped ${name(a)} and ${name(b)}`);

  const fillRest = () =>
    undoable(
      buildTeamSheet({
        format,
        totalMinutes: match.totalMinutes,
        periodCount,
        coming,
        keepers,
        subs: subs ? 1 : 0,
        fill,
        season,
        existing: sheet,
      }).plan,
      'Filled the rest'
    );
  const startAgain = () => undoable(applyKeepers(emptyPlan(periodCount), format, keepers), 'Started again: keepers kept');

  // B8: one neutral line, only with a coming child marked Not in goal.
  const never = coming.filter((p) => p.keeper === 'never').map(displayName);
  const neverLine =
    never.length === 0
      ? null
      : `${never.length === 1 ? never[0] : `${never.slice(0, -1).join(', ')} and ${never[never.length - 1]}`} never ${
          never.length === 1 ? 'goes' : 'go'
        } in goal. Fewer on that list shares keeping more fairly.`;
  const eligible = coming.filter((p) => p.keeper !== 'never');

  // How many places are still empty, across the match.
  const outfieldCount = format.positions.length;
  const empty = sheet.periods.reduce((n, p) => n + outfieldCount - Object.values(p.slots).filter(Boolean).length, 0);

  // C16: the fair share, the range and each child's minutes, least first.
  const projection = made ? projectPlan(sheet, format, match.totalMinutes, periodCount, coming, null, new Set()) : null;
  const minutes = projection ? [...projection.rows].sort((a, b) => a.pitchMs - b.pitchMs) : [];
  const low = minutes.length ? minutes[0].pitchMs : 0;
  const high = minutes.length ? minutes[minutes.length - 1].pitchMs : 0;

  const period = sheet.periods[quarter];
  const sub = period.subs.find((s) => s.onId && s.offId);

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

        <GroupLabel>1. Keepers</GroupLabel>
        <Segmented<'rotate' | 'choose'>
          name="Keepers"
          options={[
            { value: 'rotate', label: 'Rotate for me' },
            { value: 'choose', label: "I'll choose" },
          ]}
          value={keeperMode}
          onChange={(v) => {
            if (!v) return;
            setKeeperMode(v);
            if (v === 'rotate') save(applyKeepers(sheet, format, rotated));
          }}
        />
        {keepers.map((id, i) => {
          const kept = id ? (season.get(id)?.timesKept ?? 0) : 0;
          const detail = id ? `kept ${kept} ${kept === 1 ? 'time' : 'times'} this season` : undefined;
          return keeperMode === 'choose' ? (
            <RowNav key={i} first={i === 0} label={`${short}${i + 1}`} value={name(id)} detail={detail} onPress={() => setPicking(i)} />
          ) : (
            <View key={i} style={local.keeperLine}>
              <Text style={local.keeperPeriod}>{`${short}${i + 1}`}</Text>
              <Text style={local.keeperName} numberOfLines={1}>
                {name(id)}
              </Text>
              {detail && <Text style={local.keeperDetail}>{detail}</Text>}
            </View>
          );
        })}
        {neverLine && (
          <View>
            <Text style={screen.hint}>{neverLine}</Text>
            <Action label="Squad" onPress={onSquad} />
          </View>
        )}

        <GroupLabel>{`2. Mid-${noun.toLowerCase()} subs`}</GroupLabel>
        <Segmented<boolean>
          name={`Mid-${noun.toLowerCase()} subs`}
          options={[
            { value: true, label: 'Place them' },
            { value: false, label: 'None' },
          ]}
          value={subs}
          onChange={(v) => v !== null && setSubs(v)}
        />
        <Text style={screen.hint}>
          {subs
            ? `One a ${noun.toLowerCase()}, halfway: whoever has played most comes off for whoever has played least.`
            : `Everyone plays whole ${noun.toLowerCase()}s.`}
        </Text>

        <GroupLabel>3. Place anyone you want to</GroupLabel>
        <Text style={screen.hint}>
          Drag a child onto the pitch, or tap them and then a place. Or skip this and fill it all.
        </Text>
        <Segmented<SheetView>
          name="View"
          options={[
            { value: 'formation', label: 'Pitch' },
            { value: 'all', label: `All ${noun.toLowerCase()}s` },
            { value: 'table', label: 'Table' },
          ]}
          value={view}
          onChange={(v) => v && onView(v)}
        />
        {view === 'formation' && (
          <View>
            <Segmented<number>
              name={noun}
              options={sheet.periods.map((_, i) => ({ value: i, label: `${short}${i + 1}`, accessibilityLabel: `${noun} ${i + 1}` }))}
              value={quarter}
              onChange={(v) => {
                if (v === null) return;
                setQuarter(v);
                setPick(null);
              }}
            />
            <Text style={local.subLine} numberOfLines={1}>
              {sub ? `${name(sub.onId)} on for ${name(sub.offId)} at ${formatSubTime(sub.atMs)}` : ' '}
            </Text>
            <PitchView
              format={format}
              sheet={period.slots}
              bench={benchOf(period, comingIds)}
              nameOf={(id) => name(id)}
              selected={pick}
              onSelect={setPick}
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
                else save(setPeriodSlots(sheet, quarter, editSheet(period.slots, id, target)));
              }}
            />
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
            onPlace={(p, id, positionId) =>
              save(setPeriodSlots(sheet, p, editSheet(sheet.periods[p].slots, id, { kind: 'slot', positionId })))
            }
            onOpen={(p) => {
              setQuarter(p);
              onView('formation');
            }}
          />
        )}

        <GroupLabel>4. Fill the rest</GroupLabel>
        <Segmented<Fill>
          name="Fill the rest"
          options={[
            { value: 'fair', label: 'Fairly' },
            { value: 'positions', label: 'Using positions' },
          ]}
          value={fill}
          onChange={(v) => v && setFill(v)}
        />
        <Text style={screen.hint}>
          {fill === 'fair'
            ? 'Equal time for everyone, positions rotated. Anyone you placed stays put.'
            : 'Equal time first, then each child in their area from the Squad tab where the minutes allow. Anyone you placed stays put.'}
        </Text>
        <ActionRow>
          <Action label={empty > 0 ? 'Fill the rest' : 'Fill again'} onPress={fillRest} disabled={coming.length === 0 || empty === 0} />
          {made && <Action label="Start again" onPress={startAgain} quiet />}
        </ActionRow>

        {projection && (
          <View>
            <GroupLabel>5. Minutes</GroupLabel>
            <Text style={local.share}>
              {`Fair share ${formatClock(projection.fairShareMs)} · ${formatClock(low)}–${formatClock(high)}`}
            </Text>
            {minutes.map((row) => (
              <View key={row.playerId} style={local.minuteRow}>
                <Text style={local.minuteName} numberOfLines={1}>
                  {row.name}
                </Text>
                <Text style={[local.minuteTime, projection.fairShareMs - row.pitchMs > SHORT_MS && local.minuteShort]}>
                  {formatClock(row.pitchMs)}
                  {projection.fairShareMs - row.pitchMs > SHORT_MS ? ' · short' : ''}
                </Text>
              </View>
            ))}
            <RowNav label="Sub times and who comes off" detail={`${noun} by ${noun.toLowerCase()}`} onPress={onEditPeriods} first />
          </View>
        )}
      </ScrollView>

      {/* Rob, 6 Nov: "I make final tweaks and share". */}
      <SharePlanFoot
        match={match}
        squadName={squadName}
        format={format}
        plan={sheet}
        players={players}
        absent={absent}
        periodCount={periodCount}
        noun={noun}
        disabled={!made}
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
          save(applyKeepers(sheet, format, next));
          setPicking(null);
        }}
        onCancel={() => setPicking(null)}
      />
    </View>
  );
}

const local = StyleSheet.create({
  keeperLine: { flexDirection: 'row', alignItems: 'baseline', minHeight: 32, paddingVertical: 4 },
  keeperPeriod: { color: colours.inkMuted, fontSize: 14, width: 36, includeFontPadding: false, flexShrink: 0 },
  keeperName: { color: colours.ink, fontSize: 16, includeFontPadding: false, flexShrink: 1 },
  keeperDetail: { color: colours.inkMuted, fontSize: 13, includeFontPadding: false, marginLeft: 8, flexShrink: 0 },
  subLine: { color: colours.inkMuted, fontSize: 13, includeFontPadding: false, marginVertical: 6 },
  share: { color: colours.ink, fontSize: 15, includeFontPadding: false, marginBottom: 6 },
  minuteRow: { flexDirection: 'row', alignItems: 'center', minHeight: 28 },
  minuteName: { flex: 1, color: colours.ink, fontSize: 15, includeFontPadding: false },
  minuteTime: { color: colours.inkMuted, fontSize: 15, includeFontPadding: false, flexShrink: 0 },
  // #261 AC7: neutral, never the warning colour.
  minuteShort: { color: colours.ink },
});
