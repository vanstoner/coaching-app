/**
 * A child's page — #121 AC3.
 *
 * Opened by tapping a name in Squad. Their minutes a game (goal plus outfield,
 * invariant 3), matches played and missed, each competition in words, and for
 * a keeper the in-goal / outfield split beside their outfield-share target
 * (ADR-015 §3: shown, never a fairness input). Their position preferences live
 * here too (PO ruling, #121). Every figure arrives folded from the ledger by
 * `src/app/childSeason.ts`; nothing here is stored (invariant 1).
 *
 * First names only (invariant 4).
 */

import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import type { Player } from '../types/index';
import { wholeMinutes } from '../app/analysis';
import { MAIN_KEEPER_NOTE, type ChildSeason } from '../app/childSeason';
import {
  KEEPER_LABEL,
  UNIT_PREF_LABEL,
  displayName,
  setKeeperPreference,
  setUnitPreference,
} from '../app/squad';
import { OUTFIELD_TARGET_CHOICES, setOutfieldTarget } from '../app/outfieldTarget';
import { Chip, ChipRow } from './Chip';
import { AverageBar } from './Charts';
import { colours, screen } from './theme';

export function ChildScreen({
  player,
  season,
  squadAverageMs,
  scaleMs,
  everyone,
  onPlayers,
  onBack,
}: {
  player: Player;
  season: ChildSeason | undefined;
  squadAverageMs: number | null;
  scaleMs: number;
  /** The whole squad, so a preference change is written through `onPlayers`. */
  everyone: Player[];
  onPlayers: (p: Player[]) => void;
  onBack: () => void;
}) {
  const name = displayName(player);
  const s = season;
  const line = s?.mainKeeper ? null : squadAverageMs;
  const target = s?.share.targetPct ?? null;
  const showKeeper = s !== undefined && ((s.goalMsPerGame ?? 0) > 0 || target !== null);

  return (
    <View style={screen.flex}>
      <ScrollView contentContainerStyle={screen.scroll}>
        <Pressable onPress={onBack} style={screen.linkHit}>
          <Text style={screen.link}>Back to Squad</Text>
        </Pressable>
        <Text style={screen.title} numberOfLines={1}>
          {name}
        </Text>
        {player.keeper === 'main' && <Text style={screen.caption}>{KEEPER_LABEL.main}</Text>}

        {s === undefined || s.averageMs === null ? (
          <Text style={[screen.caption, local.empty]}>
            No matches yet. {name}&apos;s minutes appear here after their first match is closed.
          </Text>
        ) : (
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
                {line === null
                  ? s.mainKeeper
                    ? MAIN_KEEPER_NOTE
                    : ''
                  : `Line: squad average ${wholeMinutes(line)}`}
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
          </>
        )}

        {showKeeper && s !== undefined && (
          <>
            <Text style={screen.fieldLabel}>In goal and outfield</Text>
            {s.goalMsPerGame !== null && s.outfieldMsPerGame !== null && (
              <Text style={local.line}>
                In goal {wholeMinutes(s.goalMsPerGame)} min a game, outfield {wholeMinutes(s.outfieldMsPerGame)}
              </Text>
            )}
            {target !== null && (
              <>
                <Text style={local.line}>
                  Outfield share: {s.share.sharePct === null ? 'no matches yet' : `${s.share.sharePct}%`} · target{' '}
                  {target}%
                </Text>
                {s.share.sharePct !== null && (
                  <AverageBar value={s.share.sharePct} line={target} scale={100} wide />
                )}
              </>
            )}
            <Text style={screen.hint}>
              The target only guides who is suggested in goal. Fairness counts time in goal and outfield together.
            </Text>
          </>
        )}

        <Text style={screen.fieldLabel}>Position preference</Text>
        <Text style={screen.hint}>In goal</Text>
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
              onPress={() =>
                onPlayers(setOutfieldTarget(everyone, player.id, player.outfieldTargetPct === t ? null : t))
              }
              narrow
            />
          ))}
        </ChipRow>
        <Text style={screen.hint}>Only decides who is suggested where. Minutes and fairness are not affected.</Text>

        <Pressable
          style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]}
          onPress={onBack}
        >
          <Text style={screen.buttonLabel}>Back to Squad</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const local = StyleSheet.create({
  empty: { marginTop: 24 },
  // One weight in every state, sized to the slot not the glyphs (theme.ts).
  big: {
    alignSelf: 'stretch',
    textAlign: 'center',
    includeFontPadding: false,
    flexShrink: 0,
    color: colours.ink,
    fontSize: 64,
    marginTop: 8,
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
});
