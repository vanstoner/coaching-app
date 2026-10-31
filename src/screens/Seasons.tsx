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

import { useReducer, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text } from './Text';

import { AGE_GROUPS, MAIN_SIDES, SEASON_NAME_MAX, type LedgerSeason } from '../app/ledger';
import { seasonLine, seasonName } from '../app/seasons';
import { TEAM_FORMATS, formatForAge } from '../app/teamRows';
import type { ShapeCode } from '../app/shapes';
import { formReducer, leaveNeedsAsking } from '../app/saveState';
import {
  Action,
  BackLink,
  FieldRow,
  FormStatus,
  Icon,
  LeaveAsk,
  FormSheet,
  ListSheet,
  MainButton,
  MainFoot,
  RowNav,
  SegmentedRow,
  TopBar,
  useBackLeaves,
} from './controls';
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
      {/* #264: each opens another screen, so each is a Row ›. */}
      <RowNav label="Start a new season" onPress={onStart} />
      {past.length > 0 && (
        <>
          <Text style={screen.fieldLabel}>Past seasons</Text>
          {past.map((p) => (
            <RowNav
              key={p.season.id}
              label={seasonName(p.season)}
              detail={[seasonLine({ ...p.season, name: null }).replace(/^This season · ?/, ''), `${p.matches} matches`]
                .filter(Boolean)
                .join(' · ')}
              onPress={() => onOpenPast(p.season.id)}
            />
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
  const [ageSheet, setAgeSheet] = useState(false);
  return (
    <View style={local.card}>
      <Text style={local.cardTitle} numberOfLines={1}>
        {seasonName(season)}
      </Text>
      <View style={local.warnPill}>
        <Text style={local.warnPillText}>Age group not set</Text>
      </View>
      <FieldRow
        label="Season name"
        value={name}
        onChangeText={setName}
        maxLength={SEASON_NAME_MAX}
        autoCorrect={false}
      />
      <RowNav label="Age group" value={age} onPress={() => setAgeSheet(true)} />
      <LevelRow level={level} onLevel={setLevel} />
      <Text style={[screen.hint, local.left]}>
        Suggested: U10 Development. Not saved until you confirm. Fairness is Full equal time either way.
      </Text>
      {error !== '' && <Text style={screen.error}>{error}</Text>}
      <Action label={`Confirm ${age} · ${LEVEL_LABEL[level]}`} onPress={() => setError(onConfirm(name, age, level) ?? '')} />
      <AgeSheet visible={ageSheet} age={age} onPick={(a) => { setAge(a); setAgeSheet(false); }} onCancel={() => setAgeSheet(false)} />
    </View>
  );
}

const sideName = (n: number) => `${n}-a-side`;

/** AC9: the main format left unset, saying what setting it would change. */
function MainFormat({ sides, onSet }: { sides: ReadonlyMap<number, number>; onSet: (side: number) => string | null }) {
  const [choice, setChoice] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
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
      {/* #249 B8: four sizes do not fit a segmented row at 360dp, so a list sheet (#264). */}
      <RowNav label="Main format" value={choice === null ? 'Pick one' : sideName(choice)} onPress={() => setPicking(true)} />
      <ListSheet
        visible={picking}
        title="Main format"
        items={MAIN_SIDES.map((s) => ({ value: s, label: sideName(s) }))}
        value={choice}
        onPick={(s) => {
          setChoice(s);
          setPicking(false);
        }}
        onCancel={() => setPicking(false)}
      />
      {choice !== null && (
        <>
          <Text style={[screen.hint, local.left]}>
            {others === 0
              ? `Setting ${sideName(choice)} changes nothing you see today.`
              : `Setting ${sideName(choice)} leaves ${others} ${others === 1 ? 'match' : 'matches'} in another format out of the figures unless you count them.`}
          </Text>
          {error !== '' && <Text style={screen.error}>{error}</Text>}
          <Action label={`Set ${sideName(choice)}`} onPress={() => setError(onSet(choice) ?? '')} />
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
  const [name, setNameRaw] = useState(defaultName);
  const [age, setAgeRaw] = useState(defaultAge);
  const [level, setLevelRaw] = useState<Level>(from.level ?? 'development');
  const [shape, setShapeRaw] = useState<ShapeCode>(defaultShape);
  const [error, setError] = useState('');
  // #264 V29, V30: a form. It starts from a suggestion that is already valid,
  // so Start is offered at once; any change shows "Not saved yet", and
  // leaving after one asks first.
  const [phase, dispatch] = useReducer(formReducer, 'pristine');
  const [sheet, setSheet] = useState<'age' | 'format' | null>(null);
  const [asking, setAsking] = useState(false);
  const changed =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      dispatch({ type: 'change' });
    };
  const setName = changed(setNameRaw);
  // #249 E23 (Q2): the same age nudge as Add a team, on the format only;
  // Match defaults stay as they are.
  const setAge = changed((a: string) => {
    setAgeRaw(a);
    setShapeRaw((s) => formatForAge(a, s));
  });
  const setLevel = changed(setLevelRaw);
  const setShape = changed(setShapeRaw);
  const leave = () => (leaveNeedsAsking(phase) ? setAsking(true) : onCancel());
  // Android Back asks too (V30; QA on #260, D6).
  useBackLeaves(leave);
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
        <TopBar back={<BackLink label="Cancel" chevron={false} onPress={leave} />} />
        <Text style={screen.title}>Start a new season</Text>
        <Text style={screen.caption}>
          Copied from {seasonName(from)}. Check the age group: teams move up a year.
        </Text>
        <FieldRow
          label="Season name"
          value={name}
          onChangeText={setName}
          maxLength={SEASON_NAME_MAX}
          autoCorrect={false}
          first
        />
        <RowNav label="Age group" value={age} onPress={() => setSheet('age')} />
        <Text style={[screen.hint, local.left]}>{ageHint}</Text>
        <RowNav
          label="Main format"
          value={(() => {
            const f = TEAM_FORMATS.find((x) => x.shape === shape);
            return f ? `${f.label} · ${f.detail}` : '';
          })()}
          onPress={() => setSheet('format')}
        />
        <Text style={[screen.hint, local.left]}>
          New fixtures start in this format. A match in another format is kept but left out of the season&apos;s
          figures unless you count it.
        </Text>
        <LevelRow level={level} onLevel={setLevel} />
        <Text style={screen.fieldLabel}>Fairness</Text>
        {/* #264 V2: the tick is an icon; Barlow has no ✓. */}
        <View style={local.tickLine}>
          <Icon name="check-bold" size={16} color={colours.inkMuted} />
          <Text style={[local.cardText, local.tickText]}>Full equal time. Other ways come in a later version.</Text>
        </View>
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
      </ScrollView>
      <MainFoot>
        <FormStatus phase={phase} />
        <MainButton
          label={`Start ${shown} as ${age}`}
          disabled={!ready}
          onPress={() => {
            const side = TEAM_FORMATS.find((f) => f.shape === shape)?.side ?? 7;
            setError(onStart({ name: name.trim(), ageGroup: age, level, shape, side }) ?? '');
          }}
        />
      </MainFoot>
      <AgeSheet
        visible={sheet === 'age'}
        age={age}
        onPick={(a) => {
          setAge(a);
          setSheet(null);
        }}
        onCancel={() => setSheet(null)}
      />
      <ListSheet
        visible={sheet === 'format'}
        title="Main format"
        // #249 Q3: all eight shapes, one line each, "9-a-side · 3-3-2".
        items={TEAM_FORMATS.map((f) => ({ value: f.shape, label: `${f.label} · ${f.detail}` }))}
        value={shape}
        onPick={(v) => {
          setShape(v);
          setSheet(null);
        }}
        onCancel={() => setSheet(null)}
      />
      <LeaveAsk visible={asking} thing="season" onKeep={() => setAsking(false)} onLeave={onCancel} />
    </KeyboardAvoidingView>
  );
}

/** Level: two short options, so a segmented row (#264 V12). */
function LevelRow({ level, onLevel }: { level: Level; onLevel: (l: Level) => void }) {
  return (
    <SegmentedRow
      label="Level"
      options={(['development', 'competitive'] as const).map((l) => ({ value: l, label: LEVEL_LABEL[l] }))}
      value={level}
      onChange={(l) => l !== null && onLevel(l)}
    />
  );
}

/** Age group: twelve options, so a list sheet with a tick (#264 V14). */
function AgeSheet({
  visible,
  age,
  onPick,
  onCancel,
}: {
  visible: boolean;
  age: string;
  onPick: (age: string) => void;
  onCancel: () => void;
}) {
  return (
    <ListSheet
      visible={visible}
      title="Age group"
      items={AGE_GROUPS.map((a) => ({ value: a, label: a }))}
      value={age}
      onPick={onPick}
      onCancel={onCancel}
    />
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
      <TopBar back={<BackLink label="Settings" onPress={onBack} />} />
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
      {/* #264: Start opens a screen (a Row ›); Not yet only quiets the prompt (an Action). */}
      <RowNav label="Start a new season" onPress={onStart} first />
      <Action label="Not yet" onPress={onNotYet} />
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
  // #264: the note form is a sheet (Cancel, Save); only Save writes.
  return (
    <View style={[local.card, !counted && local.prompt]}>
      <Text style={[local.cardTitle, !counted && local.warnText]}>
        {counted ? `Counted in ${name}` : `Left out of ${name}'s figures`}
      </Text>
      <Text style={local.cardText}>
        {counted
          ? `Played ${sideName(ownSide)} in a ${sideName(seasonSide)} season, and counted${countedNote ? `: “${countedNote}”` : '.'}`
          : `${name} is a ${sideName(seasonSide)} season. This ${sideName(ownSide)} match is kept and shown here, but it isn't in anyone's minutes a game or the squad average.`}
      </Text>
      <RowNav label={counted ? 'Leave it out again' : 'Count it'} onPress={() => setNote('')} first />
      <FormSheet
        visible={note !== null}
        title={counted ? 'Leave it out' : `Count it in ${name}`}
        onCancel={() => {
          setNote(null);
          setError('');
        }}
        onSave={save}
        saveDisabled={(note ?? '').trim() === ''}
        dirty={(note ?? '') !== ''}
        thing="note"
      >
        <Text style={screen.fieldLabel}>{counted ? 'Why leave it out? (needed)' : 'Why count it? (needed)'}</Text>
        <TextInput
          style={screen.input}
          value={note ?? ''}
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
      </FormSheet>
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
  tickLine: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  tickText: { flex: 1, marginLeft: 6 },
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
