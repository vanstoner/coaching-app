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
 * First names by default (invariant 4, #54).
 */

import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text } from './Text';

import type { Player } from '../types/index';
import { wholeMinutes } from '../app/analysis';
import { FILL_IN_NOTE, MAIN_KEEPER_NOTE, goalOutfieldLine, type ChildSeason } from '../app/childSeason';
import type { FairnessChange } from '../app/ledger';
import { whenOf } from '../app/ledgerChain';
import { LENS_TITLE, childMatches, lensCards, positionsLine, type LensCard, type SquadViews } from '../app/squadViews';
import {
  KEEPER_LABEL,
  UNIT_PREF_LABEL,
  displayName,
  sameNameAs,
  setKeeperPreference,
  splitName,
  validateName,
  setUnitPreference,
} from '../app/squad';
import { OUTFIELD_TARGET_CHOICES, setOutfieldTarget } from '../app/outfieldTarget';
import { Chip, ChipRow } from './Chip';
import { AverageBar, ColumnChart, KeyItem, UnitStack, chartColours, type Column } from './Charts';
import { Picked, UnitKey } from './SquadViews';
import { colours, screen } from './theme';
import { MoreThanFirstName, guard } from './NameWarning';

export function ChildScreen({
  player,
  views,
  everyone,
  onPlayers,
  fairness,
  roleLine = '',
  onBack,
  backLabel = 'Back to Squad',
}: {
  player: Player;
  /** The squad views' fold, which holds this child's season too (#143). */
  views: SquadViews;
  /** The whole squad, so a preference change is written through `onPlayers`. */
  everyone: Player[];
  onPlayers: (p: Player[]) => void;
  /** #190: counted in fairness or a fill-in, its history, and how to change it (a reason when refused). */
  fairness: ChildFairness;
  /** #196 AC4: their season's minutes by position, "RB 20 · LW 15 min"; empty when none recorded. */
  roleLine?: string;
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
          <PlayingTime
            name={name}
            s={s}
            squadAverageMs={views.season.squadAverageMs}
            scaleMs={views.season.scaleMs}
            formatNote={views.season.formatNote}
          />
        );
      case 'matches':
        return s ? <MatchByMatch views={views} player={player} s={s} /> : null;
      case 'positions':
        return <PositionsCard views={views} player={player} name={name} roleLine={roleLine} />;
      case 'preference':
        return (
          <>
            <Preferences player={player} everyone={everyone} onPlayers={onPlayers} />
            <FairnessMark name={name} fairness={fairness} />
          </>
        );
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
        <Rename player={player} everyone={everyone} onPlayers={onPlayers} />
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
  formatNote,
}: {
  name: string;
  s: ChildSeason | undefined;
  squadAverageMs: number | null;
  scaleMs: number;
  /** ADR-015 §6a (#223): the matches left out for their format, and why; null when none is. */
  formatNote: string | null;
}) {
  // §6a: the squad average and this child's figures use the dominating format's matches only.
  const note = formatNote !== null ? <Text style={screen.hint}>{formatNote}.</Text> : null;
  if (s !== undefined && s.averageMs === null && s.offFormat > 0) {
    // R5: they have played, in the other format only. Never "No matches yet".
    return (
      <>
        <Text style={[screen.caption, local.empty]}>{s.summary}.</Text>
        {note}
      </>
    );
  }
  if (s === undefined || s.averageMs === null) {
    return (
      <Text style={[screen.caption, local.empty]}>
        No matches yet. {name}&apos;s minutes appear here after their first match is closed.
      </Text>
    );
  }
  const line = s.mainKeeper || s.fillIn ? null : squadAverageMs;
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
          {line === null
            ? s.fillIn
              ? FILL_IN_NOTE
              : s.mainKeeper
                ? MAIN_KEEPER_NOTE
                : ''
            : `Line: squad average ${wholeMinutes(line)}`}
        </Text>
        <Text style={local.scaleText}>{wholeMinutes(scaleMs)} min</Text>
      </View>
      <Text style={screen.hint}>Minutes a game counts only the matches {name} played.</Text>
      {note}

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
  const average =
    s.mainKeeper || s.fillIn || views.season.squadAverageMs === null ? null : wholeMinutes(views.season.squadAverageMs);
  const keeper = matches.some((m) => (m.cell?.goal ?? 0) > 0);
  const columns: Column[] = matches.map((m) => ({
    // In goal at the foot, outfield above it: whole minutes that add up to the figure under the column.
    segments:
      m.cell === null
        ? null
        : m.cell.counted === false
          ? // Left out of the figures (ADR-020): shown, in no hue.
            [{ value: m.cell.total, colour: chartColours.quiet }]
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

function PositionsCard({
  views,
  player,
  name,
  roleLine,
}: {
  views: SquadViews;
  player: Player;
  name: string;
  roleLine: string;
}) {
  const r = views.positions.find((p) => p.playerId === player.id);
  if (!r) return <Text style={[screen.hint, local.left]}>No time on the pitch yet.</Text>;
  // QA D2: time with no position recorded is shown and named, never read as "no time".
  return (
    <>
      {r.total > 0 && <UnitKey />}
      {r.total > 0 && <UnitStack minutes={r.minutes} />}
      <Text style={local.unitText}>{positionsLine(r)}</Text>
      {roleLine !== '' && <Text style={[screen.hint, local.left]}>By position: {roleLine}</Text>}
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

export interface ChildFairness {
  counted: boolean;
  history: FairnessChange[];
  set: (counted: boolean, note: string) => string | null;
}

/**
 * #190: a fill-in from another team is recorded like anyone, and left out of
 * the squad average, the fairness figures and "who's owed time" for the
 * season. Changing it needs a note (invariant 5); every change is listed.
 */
function FairnessMark({ name, fairness }: { name: string; fairness: ChildFairness }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const save = () => {
    const refused = fairness.set(!fairness.counted, note);
    if (refused) {
      setError(refused);
      return;
    }
    setEditing(false);
    setNote('');
    setError('');
  };
  return (
    <>
      <Text style={screen.hint}>Fairness</Text>
      <Text style={[local.line, local.left]}>
        {fairness.counted ? 'Counted in the squad’s fairness figures' : FILL_IN_NOTE}
      </Text>
      {fairness.history.map((h, i) => (
        <Text key={i} style={[screen.hint, local.left]}>
          {`${whenOf(h.at)}: ${h.counted ? 'counted again' : 'marked a fill-in'}${h.note ? ` — ${h.note}` : ''}`}
        </Text>
      ))}
      {editing ? (
        <>
          <TextInput
            style={screen.input}
            value={note}
            onChangeText={(t) => {
              setNote(t);
              if (error) setError('');
            }}
            placeholder="Why? (needed)"
            placeholderTextColor={colours.inkFaint}
          />
          {error !== '' && <Text style={screen.error}>{error}</Text>}
          <Pressable style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]} onPress={save}>
            <Text style={screen.buttonLabel}>{fairness.counted ? 'Mark as a fill-in' : 'Count them again'}</Text>
          </Pressable>
          <Pressable onPress={() => setEditing(false)} style={screen.linkHit}>
            <Text style={screen.link}>Cancel</Text>
          </Pressable>
        </>
      ) : (
        <Pressable onPress={() => setEditing(true)} style={screen.linkHit}>
          <Text style={screen.link}>
            {fairness.counted ? `${name} is a fill-in: don’t count them in fairness` : 'Count them in fairness again'}
          </Text>
        </Pressable>
      )}
      <Text style={screen.hint}>Their minutes are always recorded. On the day they still get a fair share.</Text>
    </>
  );
}

const local = StyleSheet.create({
  rename: { alignSelf: 'stretch', marginBottom: 8 },
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

/**
 * #54 AC6, AC8: rename a child. The same check and warning as Squad › Add;
 * the id, minutes and history never change, and the save writes a new
 * `player` record (latest wins, the earlier one stays in the chain).
 */
function Rename({
  player,
  everyone,
  onPlayers,
}: {
  player: Player;
  everyone: Player[];
  onPlayers: (p: Player[]) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [more, setMore] = useState<string | null>(null);
  const [same, setSame] = useState<{ name: string; other: string } | null>(null);
  const close = () => {
    setDraft(null);
    setError('');
    setMore(null);
    setSame(null);
  };
  const commit = (name: string) => {
    const { firstName, displaySuffix } = splitName(name);
    onPlayers(everyone.map((p) => (p.id === player.id ? { ...p, firstName, displaySuffix } : p)));
    close();
  };
  const settle = (name: string) => {
    setMore(null);
    const other = sameNameAs(everyone, name, player.id);
    if (other) setSame({ name, other: displayName(other) });
    else commit(name);
  };
  const save = () => {
    const check = validateName(draft ?? '');
    if (check.reason === 'more-than-one-word') return setMore(check.cleaned);
    if (!check.ok) return setError(check.message);
    settle(check.cleaned);
  };
  if (draft === null) {
    return (
      <Pressable onPress={() => setDraft(displayName(player))} style={screen.linkHit} accessibilityRole="button">
        <Text style={screen.link}>Rename</Text>
      </Pressable>
    );
  }
  return (
    <View style={local.rename}>
      <TextInput
        style={screen.input}
        value={draft}
        onChangeText={(t) => {
          setDraft(t);
          setError('');
          setMore(null);
          setSame(null);
        }}
        autoFocus
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={save}
        accessibilityLabel="New name"
      />
      <Text style={screen.hint}>Every match shows the new name. Minutes don&apos;t change.</Text>
      {error !== '' && <Text style={screen.error}>{error}</Text>}
      {more !== null && <MoreThanFirstName cleaned={more} onUse={settle} onChange={() => setMore(null)} />}
      {same !== null && (
        <View style={guard.box}>
          <Text style={guard.text}>You already have {same.other}. Add an initial so you can tell them apart.</Text>
          <Pressable
            onPress={() => {
              setDraft(`${same.name} `);
              setSame(null);
            }}
            accessibilityRole="button"
            style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]}
          >
            <Text style={screen.buttonLabel}>Add an initial</Text>
          </Pressable>
          <Pressable
            onPress={() => commit(same.name)}
            accessibilityRole="button"
            style={({ pressed }) => [screen.buttonQuiet, pressed && screen.buttonPressed]}
          >
            <Text style={screen.buttonLabel}>Use “{same.name}” anyway</Text>
          </Pressable>
        </View>
      )}
      {more === null && same === null && (
        <Pressable onPress={save} accessibilityRole="button" style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]}>
          <Text style={screen.buttonLabel}>Save the name</Text>
        </Pressable>
      )}
      <Pressable onPress={close} style={screen.linkHit} accessibilityRole="button">
        <Text style={screen.link}>Cancel</Text>
      </Pressable>
    </View>
  );
}
