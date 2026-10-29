/**
 * A team's seasons on screen — #243; Dee's prototype, Q1–Q7 approved by Rob
 * (26 Oct), and his ruling 8A for AC8.
 *
 * - **Settings › Season** opens Settings (Q5): the current season, its four
 *   settings, when it began and how many matches; Start a new season; past
 *   seasons, each opening read-only (AC6).
 * - **The first season** (AC9): until the coach confirms it, "Age group not
 *   set", with U10 Development offered and nothing saved; its name is set at
 *   the same Confirm (Q7). Its main format stays unset until the coach sets
 *   it, with a line saying what that changes.
 * - **Start a new season** (AC4): one screen, copied from the last season,
 *   the age group moved up a year and named in the button (Q1).
 * - **The August prompt** (AC4, Q2, Q3) on Home, never blocking the match.
 * - **An off-format match** (AC8): left out, counted with a note (8A).
 *
 * Text is never sized to itself and never changes weight between states.
 */

import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text } from './Text';

import { AGE_GROUPS, MAIN_SIDES, SEASON_NAME_MAX, type LedgerSeason } from '../app/ledger';
import { seasonLine, seasonName } from '../app/seasons';
import { TEAM_FORMATS } from '../app/teamRows';
import type { ShapeCode } from '../app/shapes';
import { Chip, ChipRow } from './Chip';
import { colours, screen } from './theme';

type Level = 'development' | 'competitive';

const LEVEL_LABEL: Record<Level, string> = { development: 'Development', competitive: 'Competitive' };

const day = (t: number) =>
  new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** A past season in the Settings list. */
export interface PastSeasonRow {
  season: LedgerSeason;
  matches: number;
}

/** Settings › Season (Q5: the first block in Settings). */
export function SeasonSection({
  season,
  began,
  matches,
  sides,
  past,
  firstName,
  onConfirmFirst,
  onSetMainSide,
  onStart,
  onOpenPast,
}: {
  season: LedgerSeason;
  /** When it began, in ms, or null when not known. */
  began: number | null;
  /** Matches played in it. */
  matches: number;
  /** How many counted matches it has of each side, for "Set the main format" (AC9). */
  sides: ReadonlyMap<number, number>;
  past: readonly PastSeasonRow[];
  /** The first season's suggested name, from its earliest match (Q7). */
  firstName: string;
  onConfirmFirst: (name: string, ageGroup: string, level: Level) => string | null;
  onSetMainSide: (side: number) => string | null;
  onStart: () => void;
  onOpenPast: (id: LedgerSeason['id']) => void;
}) {
  const unconfirmed = season.ageGroup === null && season.level === null;
  return (
    <View style={local.block}>
      <Text style={screen.fieldLabel}>Season</Text>
      {unconfirmed ? (
        <ConfirmFirst season={season} firstName={firstName} onConfirm={onConfirmFirst} />
      ) : (
        <View style={local.card}>
          <Text style={local.cardTitle} numberOfLines={1}>
            {seasonName(season)}
          </Text>
          <Text style={local.cardText}>{seasonLine({ ...season, name: null }).replace(/^This season · ?/, '') || ' '}</Text>
          <Text style={local.cardText}>Fairness: Full equal time</Text>
          <Text style={local.cardHint}>
            {began !== null ? `Started ${day(began)} · ` : ''}
            {matches} {matches === 1 ? 'match' : 'matches'}
          </Text>
        </View>
      )}
      {season.mainSide === null && <MainFormat sides={sides} onSet={onSetMainSide} />}
      <Pressable
        onPress={onStart}
        accessibilityRole="button"
        style={({ pressed }) => [screen.buttonQuiet, pressed && screen.buttonPressed]}
      >
        <Text style={screen.buttonLabel}>Start a new season</Text>
      </Pressable>
      {past.length > 0 && (
        <>
          <Text style={screen.fieldLabel}>Past seasons</Text>
          {past.map((p) => (
            <Pressable
              key={p.season.id}
              onPress={() => onOpenPast(p.season.id)}
              accessibilityRole="button"
              style={({ pressed }) => [local.pastRow, pressed && screen.buttonPressed]}
            >
              <View style={local.grow}>
                <Text style={local.pastName} numberOfLines={1}>
                  {seasonName(p.season)}
                </Text>
                <Text style={local.cardHint} numberOfLines={1}>
                  {[seasonLine({ ...p.season, name: null }).replace(/^This season · ?/, ''), `${p.matches} matches`]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <Text style={local.chev}>›</Text>
            </Pressable>
          ))}
          <Text style={[screen.hint, local.left]}>Past seasons open read-only, with their own figures.</Text>
        </>
      )}
    </View>
  );
}

/** AC9, Q7: U10 Development offered, nothing saved until Confirm; the name set at the same time. */
function ConfirmFirst({
  season,
  firstName,
  onConfirm,
}: {
  season: LedgerSeason;
  firstName: string;
  onConfirm: (name: string, ageGroup: string, level: Level) => string | null;
}) {
  const [name, setName] = useState(season.name ?? firstName);
  const [age, setAge] = useState('U10');
  const [level, setLevel] = useState<Level>('development');
  const [error, setError] = useState('');
  return (
    <View style={local.card}>
      <Text style={local.cardTitle} numberOfLines={1}>
        {seasonName(season)}
      </Text>
      <View style={local.warnPill}>
        <Text style={local.warnPillText}>Age group not set</Text>
      </View>
      <Text style={screen.fieldLabel}>Season name</Text>
      <TextInput
        style={screen.input}
        value={name}
        onChangeText={setName}
        maxLength={SEASON_NAME_MAX}
        autoCorrect={false}
        accessibilityLabel="Season name"
      />
      <Text style={screen.fieldLabel}>Age group</Text>
      <ChipRow>
        {AGE_GROUPS.map((a) => (
          <Chip key={a} label={a} compact selected={age === a} onPress={() => setAge(a)} />
        ))}
      </ChipRow>
      <Text style={screen.fieldLabel}>Level</Text>
      <ChipRow>
        {(['development', 'competitive'] as const).map((l) => (
          <Chip key={l} label={LEVEL_LABEL[l]} selected={level === l} onPress={() => setLevel(l)} />
        ))}
      </ChipRow>
      <Text style={[screen.hint, local.left]}>
        Suggested: U10 Development. Not saved until you confirm. Fairness is Full equal time either way.
      </Text>
      {error !== '' && <Text style={screen.error}>{error}</Text>}
      <Pressable
        onPress={() => setError(onConfirm(name, age, level) ?? '')}
        accessibilityRole="button"
        style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]}
      >
        <Text style={screen.buttonLabel}>
          Confirm {age} · {LEVEL_LABEL[level]}
        </Text>
      </Pressable>
    </View>
  );
}

const sideName = (n: number) => `${n}-a-side`;

/** AC9: the main format left unset, saying what setting it would change. */
function MainFormat({ sides, onSet }: { sides: ReadonlyMap<number, number>; onSet: (side: number) => string | null }) {
  const [choice, setChoice] = useState<number | null>(null);
  const [error, setError] = useState('');
  const total = [...sides.values()].reduce((a, b) => a + b, 0);
  const most = [...sides].sort((a, b) => b[1] - a[1])[0];
  const others = choice === null ? 0 : total - (sides.get(choice) ?? 0);
  return (
    <View style={local.card}>
      <Text style={local.cardTitle}>Main format: not set</Text>
      <Text style={local.cardText}>
        {most
          ? `Until you set it, the season's figures use the format you've played most: ${sideName(most[0])} so far (${most[1]} of ${total} matches).`
          : "Until you set it, the season's figures use the format you play most."}
      </Text>
      <ChipRow>
        {MAIN_SIDES.map((s) => (
          <Chip key={s} label={sideName(s)} selected={choice === s} onPress={() => setChoice(s)} />
        ))}
      </ChipRow>
      {choice !== null && (
        <>
          <Text style={[screen.hint, local.left]}>
            {others === 0
              ? `Setting ${sideName(choice)} changes nothing you see today.`
              : `Setting ${sideName(choice)} leaves ${others} ${others === 1 ? 'match' : 'matches'} in another format out of the figures unless you count them.`}
          </Text>
          {error !== '' && <Text style={screen.error}>{error}</Text>}
          <Pressable
            onPress={() => setError(onSet(choice) ?? '')}
            accessibilityRole="button"
            style={({ pressed }) => [screen.buttonQuiet, pressed && screen.buttonPressed]}
          >
            <Text style={screen.buttonLabel}>Set {sideName(choice)}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

export interface NewSeason {
  name: string;
  ageGroup: string;
  level: Level;
  shape: ShapeCode;
  side: number;
}

/** Start a new season (AC4, AC6, AC7; Q1, Q4): one screen, copied from the last. */
export function StartSeasonScreen({
  from,
  fromMatches,
  players,
  defaultName,
  defaultAge,
  defaultShape,
  upcoming,
  onStart,
  onCancel,
}: {
  from: LedgerSeason;
  fromMatches: number;
  /** Fixtures still to be played, which move into the new season (Rob, 27 Oct). */
  upcoming: number;
  players: number;
  defaultName: string;
  defaultAge: string;
  defaultShape: ShapeCode;
  onStart: (s: NewSeason) => string | null;
  onCancel: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [age, setAge] = useState(defaultAge);
  const [level, setLevel] = useState<Level>(from.level ?? 'development');
  const [shape, setShape] = useState<ShapeCode>(defaultShape);
  const [error, setError] = useState('');
  const shown = name.trim() || 'the new season';
  const ready = name.trim() !== '';
  const ageHint =
    from.ageGroup === null
      ? 'Pick the age group the team plays at this season.'
      : age === from.ageGroup
        ? 'Same as last season. Fine if the team is staying down a year.'
        : `Last season: ${from.ageGroup}.`;
  return (
    <KeyboardAvoidingView style={screen.flex} behavior="padding">
      <ScrollView contentContainerStyle={screen.scroll} keyboardShouldPersistTaps="handled">
        <Pressable onPress={onCancel} style={[screen.linkHit, local.back]} accessibilityRole="button">
          <Text style={screen.link}>‹ Back to Settings</Text>
        </Pressable>
        <Text style={screen.title}>Start a new season</Text>
        <Text style={screen.caption}>
          Copied from {seasonName(from)}. Check the age group: teams move up a year.
        </Text>
        <Text style={screen.fieldLabel}>Season name</Text>
        <TextInput
          style={screen.input}
          value={name}
          onChangeText={setName}
          maxLength={SEASON_NAME_MAX}
          autoCorrect={false}
          accessibilityLabel="Season name"
        />
        <Text style={screen.fieldLabel}>Age group</Text>
        <ChipRow>
          {AGE_GROUPS.map((a) => (
            <Chip key={a} label={a} compact selected={age === a} onPress={() => setAge(a)} />
          ))}
        </ChipRow>
        <Text style={[screen.hint, local.left]}>{ageHint}</Text>
        <Text style={screen.fieldLabel}>Main format</Text>
        <ChipRow>
          {TEAM_FORMATS.map((f) => (
            <Chip
              key={f.shape}
              label={f.label}
              detail={f.detail}
              wide
              selected={shape === f.shape}
              onPress={() => setShape(f.shape)}
            />
          ))}
        </ChipRow>
        <Text style={[screen.hint, local.left]}>
          New fixtures start in this format. A match in another format is kept but left out of the season&apos;s
          figures unless you count it.
        </Text>
        <Text style={screen.fieldLabel}>Level</Text>
        <ChipRow>
          {(['development', 'competitive'] as const).map((l) => (
            <Chip key={l} label={LEVEL_LABEL[l]} selected={level === l} onPress={() => setLevel(l)} />
          ))}
        </ChipRow>
        <Text style={screen.fieldLabel}>Fairness</Text>
        <Text style={[local.cardText, local.left]}>✓ Full equal time. Other ways come in a later version.</Text>
        <View style={local.card}>
          <Text style={local.cardTitle}>What happens</Text>
          <Fact>
            {seasonName(from)} is kept, read-only, with its {fromMatches} {fromMatches === 1 ? 'match' : 'matches'} and
            its own figures.
          </Fact>
          {upcoming > 0 && (
            <Fact>
              {upcoming} {upcoming === 1 ? 'fixture' : 'fixtures'} still to be played {upcoming === 1 ? 'moves' : 'move'}{' '}
              to {shown}, so {upcoming === 1 ? 'it counts' : 'they count'} there.
            </Fact>
          )}
          <Fact>Nothing is deleted, and no played match changes.</Fact>
          <Fact>
            All {players} {players === 1 ? 'player comes' : 'players come'} with you. Remove or add them on Squad.
          </Fact>
          <Fact>Everyone&apos;s minutes start at zero for {shown}.</Fact>
        </View>
        {error !== '' && <Text style={screen.error}>{error}</Text>}
        <Pressable
          disabled={!ready}
          onPress={() => {
            const side = TEAM_FORMATS.find((f) => f.shape === shape)?.side ?? 7;
            setError(onStart({ name: name.trim(), ageGroup: age, level, shape, side }) ?? '');
          }}
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready }}
          style={({ pressed }) => [screen.button, !ready && screen.buttonDisabled, pressed && screen.buttonPressed]}
        >
          <Text style={screen.buttonLabel}>
            Start {shown} as {age}
          </Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          style={({ pressed }) => [screen.buttonQuiet, pressed && screen.buttonPressed]}
        >
          <Text style={screen.buttonLabel}>Cancel</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Fact({ children }: { children: ReactNode }) {
  return <Text style={[local.cardText, local.fact]}>• {children}</Text>;
}

/** One match in a past season's list. */
export interface PastMatchRow {
  id: string;
  title: string;
  detail: string;
  score: string;
  leftOut: boolean;
}

/** A past season, read-only (AC6): its own figures, never mixed with the current one. */
export function PastSeasonScreen({
  season,
  current,
  figures,
  matches,
  onBack,
}: {
  season: LedgerSeason;
  current: LedgerSeason;
  /** Its minutes table, drawn by the caller from this season's view. */
  figures: ReactNode;
  matches: readonly PastMatchRow[];
  onBack: () => void;
}) {
  const line = seasonLine({ ...season, name: null }).replace(/^This season · ?/, '');
  return (
    <ScrollView contentContainerStyle={screen.scroll}>
      <Pressable onPress={onBack} style={[screen.linkHit, local.back]} accessibilityRole="button">
        <Text style={screen.link}>‹ Back to Settings</Text>
      </Pressable>
      <Text style={screen.title} numberOfLines={1}>
        {seasonName(season)}
      </Text>
      <Text style={screen.caption}>{[line, 'Read-only'].filter(Boolean).join(' · ')}</Text>
      <View style={local.banner}>
        <Text style={local.bannerText}>
          A past season. You&apos;re looking at its record; nothing here counts towards {seasonName(current)}.
        </Text>
      </View>
      {figures}
      <Text style={screen.fieldLabel}>Matches</Text>
      {matches.length === 0 && <Text style={[screen.hint, local.left]}>No matches in this season.</Text>}
      {matches.map((m) => (
        <View key={m.id} style={local.pastRow}>
          <View style={local.grow}>
            <Text style={local.pastName} numberOfLines={1}>
              {m.title}
            </Text>
            <Text style={local.cardHint} numberOfLines={1}>
              {m.detail}
            </Text>
            {m.leftOut && <Text style={local.tagText}>Left out · other format</Text>}
          </View>
          <Text style={local.score}>{m.score}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

/** Home's August prompt (AC4, Q2, Q3): above the next match, never in its way. */
export function NewSeasonPrompt({
  name,
  onStart,
  onNotYet,
}: {
  name: string;
  onStart: () => void;
  onNotYet: () => void;
}) {
  return (
    <View style={[local.card, local.prompt]}>
      <Text style={local.cardTitle}>{name} is a year old</Text>
      <Text style={local.cardText}>
        Start a new season when you&apos;re ready. Nothing from this season is deleted, and the squad comes with you.
      </Text>
      <Pressable
        onPress={onStart}
        accessibilityRole="button"
        style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]}
      >
        <Text style={screen.buttonLabel}>Start a new season</Text>
      </Pressable>
      <Pressable onPress={onNotYet} style={screen.linkHit} accessibilityRole="button">
        <Text style={screen.link}>Not yet</Text>
      </Pressable>
    </View>
  );
}

/** AC8 (8A): an off-format match on its report, left out unless counted with a note. */
export function OffFormatCard({
  seasonName: name,
  seasonSide,
  ownSide,
  counted,
  countedNote,
  onCount,
}: {
  seasonName: string;
  seasonSide: number;
  ownSide: number;
  counted: boolean;
  countedNote: string | null;
  onCount: (counted: boolean, note: string) => string | null;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState('');
  const save = () => {
    const refused = onCount(!counted, note ?? '');
    if (refused === null) setNote(null);
    else setError(refused);
  };
  return (
    <View style={[local.card, !counted && local.prompt]}>
      <Text style={[local.cardTitle, !counted && local.warnText]}>
        {counted ? `Counted in ${name}` : `Left out of ${name}'s figures`}
      </Text>
      <Text style={local.cardText}>
        {counted
          ? `Played ${sideName(ownSide)} in a ${sideName(seasonSide)} season, and counted${countedNote ? `: “${countedNote}”` : '.'}`
          : `${name} is a ${sideName(seasonSide)} season. This ${sideName(ownSide)} match is kept and shown here, but it isn't in anyone's minutes a game or owed time.`}
      </Text>
      {note === null ? (
        <Pressable onPress={() => setNote('')} style={screen.linkHit} accessibilityRole="button">
          <Text style={screen.link}>{counted ? 'Leave it out again' : 'Count it'}</Text>
        </Pressable>
      ) : (
        <>
          <Text style={screen.fieldLabel}>{counted ? 'Why leave it out? (needed)' : 'Why count it? (needed)'}</Text>
          <TextInput
            style={screen.input}
            value={note}
            onChangeText={(t) => {
              setNote(t);
              setError('');
            }}
            placeholder={counted ? '' : 'e.g. Short of players, but it was a full league game'}
            placeholderTextColor={colours.inkFaint}
            maxLength={120}
            autoFocus
            accessibilityLabel="Why"
          />
          {error !== '' && <Text style={screen.error}>{error}</Text>}
          <Pressable
            disabled={note.trim() === ''}
            onPress={save}
            accessibilityRole="button"
            accessibilityState={{ disabled: note.trim() === '' }}
            style={({ pressed }) => [
              screen.button,
              note.trim() === '' && screen.buttonDisabled,
              pressed && screen.buttonPressed,
            ]}
          >
            <Text style={screen.buttonLabel}>{counted ? 'Leave it out' : `Count it in ${name}`}</Text>
          </Pressable>
          <Pressable onPress={() => setNote(null)} style={screen.linkHit} accessibilityRole="button">
            <Text style={screen.link}>Cancel</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const local = StyleSheet.create({
  block: { alignSelf: 'stretch' },
  card: {
    alignSelf: 'stretch',
    backgroundColor: colours.pitchRaised,
    borderWidth: 1,
    borderColor: colours.line,
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
  },
  prompt: { borderColor: colours.amber },
  cardTitle: { color: colours.ink, fontSize: 18, fontWeight: '600', marginBottom: 6, includeFontPadding: false },
  cardText: { alignSelf: 'stretch', color: colours.inkMuted, fontSize: 15, includeFontPadding: false },
  cardHint: { color: colours.inkFaint, fontSize: 13, marginTop: 4, includeFontPadding: false },
  fact: { marginTop: 6 },
  warnText: { color: colours.amber },
  warnPill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colours.amber,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  warnPillText: { color: colours.amber, fontSize: 13, includeFontPadding: false },
  left: { alignSelf: 'stretch', textAlign: 'left' },
  back: { alignSelf: 'flex-start' },
  grow: { flex: 1, minWidth: 0 },
  pastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    minHeight: 52,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colours.line,
  },
  pastName: { color: colours.ink, fontSize: 17, includeFontPadding: false },
  chev: { flexShrink: 0, color: colours.inkFaint, fontSize: 22, marginLeft: 8, includeFontPadding: false },
  score: { flexShrink: 0, width: 56, textAlign: 'right', color: colours.ink, fontSize: 17, includeFontPadding: false },
  tagText: { color: colours.amber, fontSize: 12, marginTop: 4, includeFontPadding: false },
  banner: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: colours.taint,
    borderRadius: 10,
    padding: 10,
    marginVertical: 6,
  },
  bannerText: { color: colours.taint, fontSize: 14, includeFontPadding: false },
});
