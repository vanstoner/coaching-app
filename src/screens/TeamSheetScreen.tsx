/**
 * Build the team sheet — #277 B6–B12, C (Dee's prototype; Rob's P1–P5).
 *
 * Four steps on one screen (P1), each a default the coach can change:
 * Who's coming, Keepers, Mid-quarter subs, Everyone else. Make the team sheet
 * fills every period's plan from them (`buildTeamSheet`). The sheet is the
 * match's ordinary plan (B12, D6): it moves no minute, and the Plan screen,
 * Share plan and the clock read it as before. Make it again asks first, and
 * comes with Undo.
 *
 * Below the steps: the sheet itself, as Formation or Table (C13–C15), and
 * the fair share, the range and each child's minutes (C16), every figure
 * worked out from the plan each time it draws (invariant 1).
 */

import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import type { AvailabilityStatus, Format, Player, UUID } from '../types/index';
import { displayName } from '../app/squad';
import { formatClock, periodNoun } from '../app/matchClock';
import { periodLengthMs, planFor, planHasContent, projectPlan, type MatchPlan } from '../app/matchPlan';
import { comingRows, comingSummary } from '../app/whosComing';
import { buildTeamSheet, rotateKeepers, type Fill, type SeasonKeeping } from '../app/teamSheetBuilder';
import {
  Action,
  BackLink,
  FormSheet,
  GroupLabel,
  ListSheet,
  MainButton,
  RowNav,
  SavedTick,
  Segmented,
  SheetNote,
  TopBar,
  useSavedTick,
} from './controls';
import { colours, screen } from './theme';

/** C16: more than this under the fair share is marked, in neutral text. */
export const SHORT_MS = 3 * 60_000;

export function TeamSheetScreen({
  title,
  format,
  totalMinutes,
  periodCount,
  players,
  availability,
  plan: stored,
  season,
  sheet,
  onChange,
  onComing,
  onSquad,
  onEditPeriods,
  onUndo,
  onBack,
}: {
  /** "Heart FC v Rovers". */
  title: string;
  format: Format;
  totalMinutes: number;
  periodCount: number;
  /** The whole squad, in squad order. */
  players: Player[];
  availability: [UUID, AvailabilityStatus][] | undefined;
  plan: MatchPlan | undefined;
  season: ReadonlyMap<UUID, SeasonKeeping>;
  /** The sheet's views (Formation or Table), drawn under the steps. */
  sheet?: ReactNode;
  onChange: (plan: MatchPlan) => void;
  onComing: () => void;
  onSquad: () => void;
  /** The Plan screen, period by period: Share plan, subs, Same as previous (B12). */
  onEditPeriods: () => void;
  /** A toast with Undo, as elsewhere. */
  onUndo: (text: string, undo: () => void) => void;
  onBack: () => void;
}) {
  const tick = useSavedTick();
  const noun = periodNoun(periodCount);
  const short = noun === 'Quarter' ? 'Q' : 'H';
  const periodMs = periodLengthMs(totalMinutes, periodCount);
  const rows = comingRows(availability, players);
  const coming = rows.filter((r) => r.coming === 'coming').map((r) => r.player);
  const name = (id: UUID | null) => (id ? displayName(players.find((p) => p.id === id) ?? { firstName: '?', displaySuffix: null }) : 'Nobody');

  const [keeperMode, setKeeperMode] = useState<'rotate' | 'choose'>('rotate');
  const [subs, setSubs] = useState(true);
  const [fill, setFill] = useState<Fill>('even');
  const rotated = rotateKeepers(coming, periodCount, periodMs, season);
  const [chosen, setChosen] = useState<(UUID | null)[] | null>(null);
  const keepers = keeperMode === 'rotate' || chosen === null ? rotated : chosen;
  const [picking, setPicking] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);
  /** Shuffle's seed: a new one each make, never the clock (#95). */
  const [shuffles, setShuffles] = useState(1);

  const plan = planFor(stored, periodCount);
  const made = planHasContent(stored);

  const make = () => {
    const before = stored;
    const built = buildTeamSheet({
      format,
      totalMinutes,
      periodCount,
      coming,
      keepers,
      subs,
      fill,
      seed: shuffles,
      season,
    });
    onChange(built.plan);
    setShuffles((n) => n + 1);
    tick.mark();
    if (before && planHasContent(before)) onUndo('Team sheet made again', () => onChange(before));
  };

  // B8: one neutral line, only with a coming child marked Not in goal.
  const never = coming.filter((p) => p.keeper === 'never').map(displayName);
  const neverLine =
    never.length === 0
      ? null
      : `${never.length === 1 ? never[0] : `${never.slice(0, -1).join(', ')} and ${never[never.length - 1]}`} never ${
          never.length === 1 ? 'goes' : 'go'
        } in goal. Fewer on that list shares keeping more fairly.`;
  const eligible = coming.filter((p) => p.keeper !== 'never');

  // C16: the fair share, the range and each child's minutes, least first.
  const projection = made
    ? projectPlan(plan, format, totalMinutes, periodCount, coming, null, new Set())
    : null;
  const minutes = projection ? [...projection.rows].sort((a, b) => a.pitchMs - b.pitchMs) : [];
  const low = minutes.length ? minutes[0].pitchMs : 0;
  const high = minutes.length ? minutes[minutes.length - 1].pitchMs : 0;

  return (
    <View style={screen.flex}>
      <ScrollView contentContainerStyle={screen.scroll}>
        <TopBar
          back={<BackLink label="Done" accessibilityLabel="Done" onPress={onBack} />}
          title="Team sheet"
          right={<SavedTick visible={tick.visible} />}
        />
        <Text style={screen.caption} numberOfLines={1}>
          {title}
        </Text>

        <GroupLabel>1. Who's coming</GroupLabel>
        <RowNav label="Who's coming" value={comingSummary(rows)} onPress={onComing} first />

        <GroupLabel>2. Keepers</GroupLabel>
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
            if (v === 'choose' && chosen === null) setChosen(rotated);
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

        <GroupLabel>{`3. Mid-${noun.toLowerCase()} subs`}</GroupLabel>
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

        <GroupLabel>4. Everyone else</GroupLabel>
        <Segmented<Fill>
          name="Everyone else"
          options={[
            { value: 'even', label: 'Even' },
            { value: 'shuffle', label: 'Shuffle' },
          ]}
          value={fill}
          onChange={(v) => v && setFill(v)}
        />
        <Text style={screen.hint}>
          {fill === 'even'
            ? 'Equal time, positions rotated: the same answer every time.'
            : 'Equal time, positions rotated: a different mix each time.'}
        </Text>

        <View style={local.make}>
          <MainButton
            label={made ? 'Make it again' : 'Make the team sheet'}
            onPress={() => (made ? setAsking(true) : make())}
            disabled={coming.length === 0}
          />
        </View>

        {made && (
          <>
            {sheet}
            {projection && (
              <View>
                <GroupLabel>Minutes</GroupLabel>
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
              </View>
            )}
            <RowNav label={`Edit ${noun.toLowerCase()} by ${noun.toLowerCase()}`} detail="Subs, Share plan" onPress={onEditPeriods} first />
          </>
        )}
      </ScrollView>

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
          setChosen(next);
          setPicking(null);
        }}
        onCancel={() => setPicking(null)}
      />

      <FormSheet
        visible={asking}
        title="Make the team sheet again?"
        saveLabel="Make it again"
        onCancel={() => setAsking(false)}
        onSave={() => {
          setAsking(false);
          make();
        }}
      >
        <SheetNote>It replaces the sheet you have now. You can undo it straight after.</SheetNote>
      </FormSheet>
    </View>
  );
}

const local = StyleSheet.create({
  keeperLine: { flexDirection: 'row', alignItems: 'baseline', minHeight: 32, paddingVertical: 4 },
  keeperPeriod: { color: colours.inkMuted, fontSize: 14, width: 36, includeFontPadding: false, flexShrink: 0 },
  keeperName: { color: colours.ink, fontSize: 16, includeFontPadding: false, flexShrink: 1 },
  keeperDetail: { color: colours.inkMuted, fontSize: 13, includeFontPadding: false, marginLeft: 8, flexShrink: 0 },
  make: { marginTop: 16, marginBottom: 8 },
  share: { color: colours.ink, fontSize: 15, includeFontPadding: false, marginBottom: 6 },
  minuteRow: { flexDirection: 'row', alignItems: 'center', minHeight: 28 },
  minuteName: { flex: 1, color: colours.ink, fontSize: 15, includeFontPadding: false },
  minuteTime: { color: colours.inkMuted, fontSize: 15, includeFontPadding: false, flexShrink: 0 },
  // #261 AC7: neutral, never the warning colour.
  minuteShort: { color: colours.ink },
});
