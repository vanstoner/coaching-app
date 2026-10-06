/**
 * A child's page — #121 AC3, as a stack of lens cards (#143 AC6, the design
 * Rob approved on #138).
 *
 * Opened by tapping a name in Squad or in a squad view. Each card is one way
 * of looking at the same season:
 *
 * 1. **Playing time**, first and always there: their minutes a game (goal
 *    plus outfield, invariant 3), matches played and missed, each
 *    competition in words, and for a keeper the in-goal / outfield split
 *    beside their outfield-share target (ADR-015 §3: shown, never a fairness
 *    input). The split adds up to the minutes a game above it (#142).
 * 2. **Match by match**, once they have played: a column per closed match,
 *    in goal and outfield, against the squad average.
 * 3. **Positions tried**, once they have played: a record, not a target.
 * 4. **Position preference**, last: the chips that guide suggestions (#121).
 *
 * Every figure arrives folded from the ledger by `src/app/childSeason.ts`
 * and `src/app/squadViews.ts`; nothing here is stored (invariant 1).
 *
 * First names only (invariant 4).
 */

import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import type { Player } from '../types/index';
import { wholeMinutes } from '../app/analysis';
import { MAIN_KEEPER_NOTE, goalOutfieldLine, type ChildSeason } from '../app/childSeason';
import { LENS_TITLE, childMatches, lensCards, positionsLine, type LensCard, type SquadViews } from '../app/squadViews';
import {
  KEEPER_LABEL,
  UNIT_PREF_LABEL,
  displayName,
  setKeeperPreference,
  setUnitPreference,
} from '../app/squad';
import { OUTFIELD_TARGET_CHOICES, setOutfieldTarget } from '../app/outfieldTarget';
import { Chip, ChipRow } from './Chip';
import { AverageBar, ColumnChart, KeyItem, UnitStack, chartColours, type Column } from './Charts';
import { Picked, UnitKey } from './SquadViews';
import { colours, screen } from './theme';

export function ChildScreen({
  player,
  views,
  everyone,
  onPlayers,
  onBack,
  backLabel = 'Back to Squad',
}: {
  player: Player;
  /** The squad views' fold, which holds this child's season too (#143). */
  views: SquadViews;
  /** The whole squad, so a preference change is written through `onPlayers`. */
  everyone: Player[];
  onPlayers: (p: Player[]) => void;
  onBack: () => void;
  /** "Back to Squad", or back to the view the child was opened from (#143). */
  backLabel?: string;
}) {
  const name = displayName(player);
  const s = views.season.children.find((c) => c.playerId === player.id);
  const card = (lens: LensCard): ReactNode => {
    switch (lens) {
      case 'playing':
        return (
          <PlayingTime name={name} s={s} squadAverageMs={views.season.squadAverageMs} scaleMs={views.season.scaleMs} />
        );
      case 'matches':
        return s ? <MatchByMatch views={views} player={player} s={s} /> : null;
      case 'positions':
        return <PositionsCard views={views} player={player} name={name} />;
      case 'preference':
        return <Preferences player={player} everyone={everyone} onPlayers={onPlayers} />;
    }
  };

  return (
    <View style={screen.flex}>
      <ScrollView contentContainerStyle={screen.scroll}>
        <Pressable onPress={onBack} style={screen.linkHit}>
          <Text style={screen.link}>{backLabel}</Text>
        </Pressable>
        <Text style={screen.title} numberOfLines={1}>
          {name}
        </Text>
        {player.keeper === 'main' && <Text style={screen.caption}>{KEEPER_LABEL.main}</Text>}

        {/* AC6: Playing time first and always; the order is `lensCards`. */}
        {lensCards(s).map((lens) => (
          <Card key={lens} title={LENS_TITLE[lens]}>
            {card(lens)}
          </Card>
        ))}

        <Pressable
          style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]}
          onPress={onBack}
        >
          <Text style={screen.buttonLabel}>{backLabel}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

/** One way of looking at the child's season: a titled card. */
function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={local.card}>
      <Text style={local.cardTitle} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

// --- 1. Playing time: the #121 page, always first ---------------------------

function PlayingTime({
  name,
  s,
  squadAverageMs,
  scaleMs,
}: {
  name: string;
  s: ChildSeason | undefined;
  squadAverageMs: number | null;
  scaleMs: number;
}) {
  if (s === undefined || s.averageMs === null) {
    return (
      <Text style={[screen.caption, local.empty]}>
        No matches yet. {name}&apos;s minutes appear here after their first match is closed.
      </Text>
    );
  }
  const line = s.mainKeeper ? null : squadAverageMs;
  const target = s.share.targetPct;
  const showKeeper = (s.goalMsPerGame ?? 0) > 0 || target !== null;
  return (
    <>
      <Text style={local.big} numberOfLines={1}>
        {wholeMinutes(s.averageMs)}
      </Text>
      <Text style={screen.caption}>min a game</Text>
      <Text style={local.sub}>
        Played {s.played} of {s.of}
        {s.missed > 0 ? ` · missed ${s.missed}` : ''}
      </Text>
      <AverageBar value={s.averageMs} line={line} scale={scaleMs} wide />
      <View style={local.scale}>
        <Text style={local.scaleText}>0</Text>
        <Text style={local.scaleText}>
          {line === null ? (s.mainKeeper ? MAIN_KEEPER_NOTE : '') : `Line: squad average ${wholeMinutes(line)}`}
        </Text>
        <Text style={local.scaleText}>{wholeMinutes(scaleMs)} min</Text>
      </View>
      <Text style={screen.hint}>Minutes a game counts only the matches {name} played.</Text>

      <Text style={screen.fieldLabel}>By competition</Text>
      {s.competitions.map((c) => (
        <Text key={c.key} style={[local.line, c.played === 0 && local.dim]}>
          {c.text}
        </Text>
      ))}

      {showKeeper && (
        <>
          <Text style={screen.fieldLabel}>In goal and outfield</Text>
          {/* #142: the two parts add up to the minutes a game above. */}
          {goalOutfieldLine(s) !== null && <Text style={local.line}>{goalOutfieldLine(s)}</Text>}
          {target !== null && (
            <>
              <Text style={local.line}>
                Outfield share: {s.share.sharePct === null ? 'no matches yet' : `${s.share.sharePct}%`} · target{' '}
                {target}%
              </Text>
              {s.share.sharePct !== null && <AverageBar value={s.share.sharePct} line={target} scale={100} wide />}
            </>
          )}
          <Text style={screen.hint}>
            The target only guides who is suggested in goal. Fairness counts time in goal and outfield together.
          </Text>
        </>
      )}
    </>
  );
}

// --- 2. Match by match -------------------------------------------------------

function MatchByMatch({ views, player, s }: { views: SquadViews; player: Player; s: ChildSeason }) {
  const [picked, setPicked] = useState<string | null>(null);
  const matches = childMatches(views, player.id);
  const average = s.mainKeeper || views.season.squadAverageMs === null ? null : wholeMinutes(views.season.squadAverageMs);
  const keeper = matches.some((m) => (m.cell?.goal ?? 0) > 0);
  const columns: Column[] = matches.map((m) => ({
    // In goal at the foot, outfield above it: whole minutes that add up to the figure under the column.
    segments:
      m.cell === null
        ? null
        : [
            { value: m.cell.goal, colour: chartColours.goal },
            { value: m.cell.outfield, colour: chartColours.outfield },
          ],
    value: m.cell === null ? '–' : String(m.cell.total),
    day: m.day,
    month: m.month,
    label: m.label,
  }));
  const top = Math.ceil(Math.max(10, wholeMinutes(views.season.scaleMs), ...matches.map((m) => m.cell?.total ?? 0)) / 10) * 10;
  return (
    <>
      <View style={local.key}>
        <KeyItem fill={chartColours.outfield} label="Outfield" />
        {keeper && <KeyItem fill={chartColours.goal} label="In goal" />}
        {average !== null && <KeyItem shape="line" label={`Squad average, ${average}`} />}
      </View>
      <ColumnChart columns={columns} max={top} step={10} reference={average} onSelect={(j) => setPicked(columns[j].label)} />
      <Picked text={picked} onClear={() => setPicked(null)} />
      <Text style={[screen.hint, local.left]}>
        {s.missed > 0 ? `A dash: not there. Missed ${s.missed} of ${s.of}.` : `Played all ${s.of}.`}
        {s.mainKeeper ? ` ${MAIN_KEEPER_NOTE}.` : ''}
      </Text>
    </>
  );
}

// --- 3. Positions tried ------------------------------------------------------

function PositionsCard({ views, player, name }: { views: SquadViews; player: Player; name: string }) {
  const r = views.positions.find((p) => p.playerId === player.id);
  if (!r) return <Text style={[screen.hint, local.left]}>No time on the pitch yet.</Text>;
  // QA D2: time with no position recorded is shown and named, never read as "no time".
  return (
    <>
      {r.total > 0 && <UnitKey />}
      {r.total > 0 && <UnitStack minutes={r.minutes} />}
      <Text style={local.unitText}>{positionsLine(r)}</Text>
      <Text style={[screen.hint, local.left]}>Where {name} has played this season. A record, not a target.</Text>
    </>
  );
}

// --- 4. Position preference: last ----------------------------------------------

function Preferences({
  player,
  everyone,
  onPlayers,
}: {
  player: Player;
  everyone: Player[];
  onPlayers: (p: Player[]) => void;
}) {
  return (
    <>
      <Text style={[screen.hint, local.first]}>In goal</Text>
      <ChipRow>
        {(['main', 'backup', 'never'] as const).map((k) => (
          <Chip
            key={k}
            label={KEEPER_LABEL[k]}
            selected={player.keeper === k}
            // Tapping the chosen one clears it.
            onPress={() => onPlayers(setKeeperPreference(everyone, player.id, player.keeper === k ? null : k))}
          />
        ))}
      </ChipRow>
      <Text style={screen.hint}>Prefers, outfield</Text>
      <ChipRow>
        {(['DEF', 'MID', 'ATT'] as const).map((u) => (
          <Chip
            key={u}
            label={UNIT_PREF_LABEL[u]}
            selected={player.prefers === u}
            onPress={() => onPlayers(setUnitPreference(everyone, player.id, player.prefers === u ? null : u))}
            narrow
          />
        ))}
      </ChipRow>
      {/* #101 AC2: shown beside their figures; never a fairness input. */}
      <Text style={screen.hint}>Outfield share target</Text>
      <ChipRow>
        {OUTFIELD_TARGET_CHOICES.map((t) => (
          <Chip
            key={t}
            label={`${t}%`}
            selected={player.outfieldTargetPct === t}
            onPress={() => onPlayers(setOutfieldTarget(everyone, player.id, player.outfieldTargetPct === t ? null : t))}
            narrow
          />
        ))}
      </ChipRow>
      <Text style={screen.hint}>Only decides who is suggested where. Minutes and fairness are not affected.</Text>
    </>
  );
}

const local = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    marginTop: 14,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: colours.pitchRaised,
    borderColor: colours.line,
    borderWidth: 1,
    borderRadius: 14,
  },
  cardTitle: {
    alignSelf: 'stretch',
    color: colours.ink,
    fontSize: 17,
    fontWeight: '600',
    includeFontPadding: false,
    marginBottom: 8,
  },
  empty: { marginTop: 8, marginBottom: 4 },
  first: { marginTop: 0 },
  left: { textAlign: 'left' },
  // One weight in every state, sized to the slot not the glyphs (theme.ts).
  big: {
    alignSelf: 'stretch',
    textAlign: 'center',
    includeFontPadding: false,
    flexShrink: 0,
    color: colours.ink,
    fontSize: 64,
    marginTop: 4,
  },
  sub: {
    alignSelf: 'stretch',
    textAlign: 'center',
    includeFontPadding: false,
    color: colours.ink,
    fontSize: 17,
  },
  scale: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch', marginTop: 4 },
  scaleText: { color: colours.inkFaint, fontSize: 12, includeFontPadding: false, flexShrink: 0 },
  line: {
    alignSelf: 'stretch',
    color: colours.ink,
    fontSize: 17,
    includeFontPadding: false,
    paddingVertical: 10,
    borderBottomColor: colours.line,
    borderBottomWidth: 1,
  },
  dim: { color: colours.inkMuted },
  key: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', alignSelf: 'stretch' },
  unitText: { alignSelf: 'stretch', color: colours.ink, fontSize: 15, includeFontPadding: false, marginTop: 8 },
});
