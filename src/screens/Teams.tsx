/**
 * Teams on one phone — #224, Dee's prototype (Rob approved T1–T10, 26 Oct).
 *
 * - **The team chip** replaces Home's title (T1): the team's badge and name,
 *   with its season line under it. A tap opens the switcher.
 * - **The switcher** lists every team, like browser profiles: badge, name,
 *   season, "Match on" (T3), "Open". It ends with Add a team, and the teams
 *   set aside, to bring back (AC9).
 * - **Remove** is in Settings for the open team only (T2); typing its name,
 *   capitals aside, is the confirmation (T7).
 * - **Add a team** asks for its name and first season (AC5). Fairness reads
 *   Full equal time, the only one in 2.0.0.
 * - **No teams on this phone yet** (AC6): a fresh install, or after the
 *   last team is removed.
 *
 * Text is never sized to itself and never changes weight between states
 * (the clipped-glyph trap); every Modal pads itself (#174).
 *
 * #264: the switcher and Remove are the shared sheet (Cancel top-left; a tap
 * outside is Cancel), not hand-built copies. Add a team is a Row ›, Bring
 * back an Action. Add a team's screen is a form: Cancel top-left, which asks
 * once anything is typed; Not saved yet; Add and open pinned at the bottom.
 * The chip's caret and the fairness tick are icons.
 */

import { useReducer, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { AGE_GROUPS } from '../app/ledger';
import { MAX_TEAM_NAME_LENGTH } from '../app/settings';
import { TEAM_FORMATS, formatForAge, sameTeamName, startingHint, teamNameProblem } from '../app/teamRows';
import type { TeamSummary } from '../app/storage/teams';
import type { ShapeCode } from '../app/shapes';
import { formReducer, leaveNeedsAsking } from '../app/saveState';
import {
  Action,
  BackLink,
  FieldRow,
  FormSheet,
  FormStatus,
  Icon,
  LeaveAsk,
  ListSheet,
  MainButton,
  MainFoot,
  RowNav,
  SegmentedRow,
  TopBar,
  useBackLeaves,
} from './controls';
import { CONTENT_MAX_WIDTH, colours, screen } from './theme';

/** Six badge colours, given in turn (T5). The name is always beside the badge, so colour is never the only cue. */
const BADGE = ['#12855a', '#2f5fa8', '#8a4fb0', '#a8562a', '#3b7d8c', '#6b6f2a'] as const;

export function TeamBadge({ name, badge, size = 36 }: { name: string; badge: number; size?: number }) {
  return (
    <View
      style={[local.badge, { width: size, height: size, borderRadius: size / 2, backgroundColor: BADGE[badge % 6] }]}
      accessible={false}
    >
      <Text style={[local.badgeText, { fontSize: Math.round(size * 0.47) }]}>{(name.trim()[0] ?? '?').toUpperCase()}</Text>
    </View>
  );
}

/** Home's title, made tappable (T1): the open team, and its season under it. */
export function TeamChip({
  name,
  badge,
  season,
  onPress,
}: {
  name: string;
  badge: number;
  season: string;
  onPress: () => void;
}) {
  return (
    <View style={local.chipWrap}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Team: ${name}. Switch team`}
        style={({ pressed }) => [local.chip, pressed && screen.buttonPressed]}
      >
        <TeamBadge name={name} badge={badge} />
        <Text style={local.chipName} numberOfLines={1}>
          {name}
        </Text>
        {/* #264: it opens a sheet, so a › on the right that never turns; an icon, not ▾ text. */}
        <Icon name="chevron-right" size={22} color={colours.back} style={local.caret} />
      </Pressable>
      <Text style={local.seasonLine} numberOfLines={1}>
        {season}
      </Text>
    </View>
  );
}

/** The team list (AC1), as a sheet over the screen. */
export function TeamSwitcher({
  visible,
  teams,
  currentId,
  onOpen,
  onAdd,
  onBringBack,
  onClose,
}: {
  visible: boolean;
  teams: readonly TeamSummary[];
  currentId: string | null;
  onOpen: (id: TeamSummary['id']) => void;
  onAdd: () => void;
  onBringBack: (id: TeamSummary['id']) => void;
  onClose: () => void;
}) {
  const listed = teams.filter((t) => !t.removed);
  const aside = teams.filter((t) => t.removed);
  return (
    <FormSheet visible={visible} title="Teams" onCancel={onClose}>
      <Text style={[screen.hint, local.left]}>Each team has its own squad, fixtures and minutes. Nothing is shared.</Text>
      {listed.map((t) => {
        const open = t.id === currentId;
        return (
          <Pressable
            key={t.id}
            onPress={() => onOpen(t.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: open }}
            accessibilityLabel={`${t.name}, ${t.season}${t.live ? ', match on' : ''}${open ? ', open' : ''}`}
            style={({ pressed }) => [local.row, open && local.rowOpen, pressed && screen.buttonPressed]}
          >
            <TeamBadge name={t.name} badge={t.badge} />
            <View style={local.rowText}>
              <Text style={local.rowName} numberOfLines={1}>
                {t.name}
              </Text>
              <Text style={local.rowSeason} numberOfLines={1}>
                {t.season}
              </Text>
            </View>
            {t.live && (
              <View style={[local.tag, local.tagLive]}>
                <Text style={local.tagLiveText}>Match on</Text>
              </View>
            )}
            {open && (
              <View style={[local.tag, local.tagOpen]}>
                <Text style={local.tagOpenText}>Open</Text>
              </View>
            )}
          </Pressable>
        );
      })}
      <RowNav label="+ Add a team" accessibilityLabel="Add a team" onPress={onAdd} first />
      {aside.map((t) => (
        <Action key={t.id} label={`Set aside: ${t.name} · Bring back`} onPress={() => onBringBack(t.id)} />
      ))}
    </FormSheet>
  );
}

/** Remove the open team (AC9, T2, T7): typing its name confirms. Set aside, never deleted. */
export function RemoveTeamSheet({
  visible,
  name,
  onRemove,
  onClose,
}: {
  visible: boolean;
  name: string;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const ok = sameTeamName(typed, name);
  const close = () => {
    setTyped('');
    onClose();
  };
  return (
    <FormSheet
      visible={visible}
      title={`Remove ${name}?`}
      onCancel={close}
      saveLabel="Remove team"
      saveDanger
      saveDisabled={!ok}
      onSave={() => {
        setTyped('');
        onRemove();
      }}
    >
      <Text style={[local.body, local.left]}>
        Its squad, fixtures and minutes record leave the team list. They are set aside on this phone, not deleted, and
        you can bring them back from the team list until you Forget everything.
      </Text>
      <Text style={screen.fieldLabel}>Type the team&apos;s name to remove it</Text>
      <FieldRow
        label="Name"
        value={typed}
        onChangeText={setTyped}
        placeholder={name}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Team name, to confirm"
        autoFocus
      />
    </FormSheet>
  );
}

export interface NewTeam {
  name: string;
  seasonName: string;
  ageGroup: string;
  level: 'development' | 'competitive';
  shape: ShapeCode;
  side: number;
}

/** Add a team and its first season (AC5, T9, T10). Full screen, with a way back. */
export function AddTeamScreen({
  otherNames,
  defaultSeasonName,
  onAdd,
  onCancel,
  cancelLabel,
}: {
  otherNames: readonly string[];
  defaultSeasonName: string;
  onAdd: (team: NewTeam) => void;
  onCancel: () => void;
  cancelLabel: string;
}) {
  const [name, setNameRaw] = useState('');
  const [seasonName, setSeasonNameRaw] = useState(defaultSeasonName);
  const [ageGroup, setAgeGroupRaw] = useState('U10');
  const [level, setLevelRaw] = useState<NewTeam['level']>('development');
  const [shape, setShapeRaw] = useState<ShapeCode>('2-3-1');
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
  const setSeasonName = changed(setSeasonNameRaw);
  const setLevel = changed(setLevelRaw);
  const setShape = changed(setShapeRaw);
  const setAgeGroup = changed((a: string) => {
    setAgeGroupRaw(a);
    setShapeRaw((s) => formatForAge(a, s));
  });
  const leave = () => (leaveNeedsAsking(phase) ? setAsking(true) : onCancel());
  // Android Back asks too (V30; QA on #260, D6).
  useBackLeaves(leave);
  const problem = teamNameProblem(name, otherNames);
  const shownProblem = name.trim() === '' ? null : problem;
  const lighter = Number(ageGroup.slice(1)) >= 12 || level === 'competitive';
  const ready = problem === null && seasonName.trim() !== '';
  const side = TEAM_FORMATS.find((f) => f.shape === shape)?.side ?? 7;
  const format = TEAM_FORMATS.find((f) => f.shape === shape);
  // #249 D18 (Q1): what a 9- or 11-a-side team's matches start at.
  const starting = startingHint(side);

  return (
    <KeyboardAvoidingView style={screen.flex} behavior="padding">
      <ScrollView contentContainerStyle={screen.scroll} keyboardShouldPersistTaps="handled">
        {/* #264 V31: the way out, top left; it asks first once anything is typed (V30). */}
        <TopBar back={<BackLink label={cancelLabel} onPress={leave} />} />
        <Text style={screen.title}>Add a team</Text>
        <Text style={screen.caption}>It opens as a fresh team with its own Getting started.</Text>

        <FieldRow
          first
          label="Team name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Unicorns U10"
          maxLength={MAX_TEAM_NAME_LENGTH}
          autoCorrect={false}
          blurOnSubmit
        />
        <Text style={[screen.hint, local.left]}>A team&apos;s name, never a child&apos;s.</Text>
        {shownProblem && <Text style={screen.error}>{shownProblem}</Text>}

        <FieldRow
          label="First season"
          value={seasonName}
          onChangeText={setSeasonName}
          maxLength={16}
          autoCorrect={false}
          accessibilityLabel="Season name"
        />
        <RowNav label="Age group" value={ageGroup} onPress={() => setSheet('age')} />
        <SegmentedRow
          label="Level"
          options={[
            { value: 'development' as const, label: 'Development' },
            { value: 'competitive' as const, label: 'Competitive' },
          ]}
          value={level}
          onChange={(l) => l !== null && setLevel(l)}
        />
        <RowNav
          label="Main format"
          value={format ? `${format.label} · ${format.detail}` : ''}
          onPress={() => setSheet('format')}
        />
        <Text style={[screen.hint, local.left]}>New matches start in this format. You can still change one match.</Text>
        {starting !== null && <Text style={[screen.hint, local.left]}>{starting}</Text>}

        <Text style={screen.fieldLabel}>Fairness</Text>
        <View style={local.lens}>
          <View style={local.lensHead}>
            {/* #264 V2: the tick is an icon; Barlow has no ✓. */}
            <Icon name="check-bold" size={16} color={colours.ink} />
            <Text style={[local.lensName, local.lensNameText]}>Full equal time</Text>
          </View>
          <Text style={local.lensText}>
            Every child towards the same total time on the pitch, goal plus outfield.
          </Text>
        </View>
        <Text style={[screen.hint, local.left]}>
          {lighter
            ? `${ageGroup} ${level} teams will be offered a lighter setting in a later version. In 2.0.0 every team uses Full equal time.`
            : `The setting for ${ageGroup} development football. It is the only one in 2.0.0.`}
        </Text>
      </ScrollView>
      <MainFoot>
        <FormStatus phase={phase} />
        <MainButton
          label="Add and open"
          disabled={!ready}
          onPress={() => onAdd({ name: name.trim(), seasonName: seasonName.trim(), ageGroup, level, shape, side })}
        />
      </MainFoot>
      <ListSheet
        visible={sheet === 'age'}
        title="Age group"
        items={AGE_GROUPS.map((a) => ({ value: a, label: a }))}
        value={ageGroup}
        onPick={(a) => {
          setAgeGroup(a);
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
        onPick={(s) => {
          setShape(s);
          setSheet(null);
        }}
        onCancel={() => setSheet(null)}
      />
      <LeaveAsk visible={asking} thing="team" onKeep={() => setAsking(false)} onLeave={onCancel} />
    </KeyboardAvoidingView>
  );
}

/** A phone with no team (AC6): a fresh install, or every team set aside. */
export function NoTeamsScreen({
  aside,
  notice = null,
  onAdd,
  onBringBack,
  restore = null,
}: {
  aside: readonly TeamSummary[];
  /** "Restore from a backup", for a coach whose teams are in a file (Rob, 29 Oct). */
  restore?: ReactNode;
  /** After Forget everything: what happened, said once (#207). */
  notice?: string | null;
  onAdd: () => void;
  onBringBack: (id: TeamSummary['id']) => void;
}) {
  return (
    <ScrollView contentContainerStyle={[screen.scroll, local.welcome]}>
      <Text style={screen.title}>Heart FC Coach</Text>
      <Text style={screen.caption}>Who comes off next, and is everyone getting a fair share?</Text>
      {notice !== null && <Text style={[screen.hint, local.left]}>{notice}</Text>}
      <View style={local.empty}>
        <Text style={local.emptyText}>
          No teams on this phone yet. Start by naming the team you coach. You can add more teams later, each with its own
          squad.
        </Text>
      </View>
      {/* #264: the screen's one job is the Main button (label kept: ADD_YOUR_TEAM). */}
      <MainButton label="Add your team" onPress={onAdd} />
      {restore}
      {aside.map((t) => (
        <Action key={t.id} label={`Bring back ${t.name}`} onPress={() => onBringBack(t.id)} align="center" />
      ))}
    </ScrollView>
  );
}

const local = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  badgeText: {
    alignSelf: 'stretch',
    textAlign: 'center',
    color: '#ffffff',
    fontWeight: '700',
    includeFontPadding: false,
  },
  chipWrap: { alignSelf: 'stretch', alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
    minHeight: 48,
    paddingLeft: 6,
    paddingRight: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colours.line,
    backgroundColor: colours.pitchRaised,
  },
  chipName: {
    flexShrink: 1,
    marginLeft: 10,
    color: colours.ink,
    fontSize: 22,
    fontWeight: '700',
    includeFontPadding: false,
  },
  caret: { flexShrink: 0, marginLeft: 6 },
  seasonLine: {
    alignSelf: 'stretch',
    textAlign: 'center',
    marginTop: 8,
    color: colours.inkMuted,
    fontSize: 14,
    includeFontPadding: false,
  },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    maxHeight: '88%',
    backgroundColor: colours.pitchRaised,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
    paddingHorizontal: 16,
  },
  sheetScroll: { flexGrow: 1 },
  sheetTitle: { color: colours.ink, fontSize: 22, fontWeight: '700', marginBottom: 8, includeFontPadding: false },
  left: { alignSelf: 'stretch', textAlign: 'left', marginBottom: 10 },
  body: { color: colours.ink, fontSize: 16, includeFontPadding: false },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    minHeight: 60,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colours.line,
    backgroundColor: colours.pitch,
  },
  // Same border width in both states: only the colour changes, so nothing re-measures.
  rowOpen: { borderColor: colours.accent },
  rowText: { flex: 1, minWidth: 0, marginLeft: 12 },
  rowName: { color: colours.ink, fontSize: 17, fontWeight: '600', includeFontPadding: false },
  rowSeason: { color: colours.inkMuted, fontSize: 13, marginTop: 2, includeFontPadding: false },
  tag: { flexShrink: 0, marginLeft: 6, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  tagLive: { backgroundColor: colours.amber },
  tagLiveText: { color: colours.amberInk, fontSize: 12, fontWeight: '600', includeFontPadding: false },
  tagOpen: { backgroundColor: colours.accent },
  tagOpenText: { color: colours.ink, fontSize: 12, fontWeight: '600', includeFontPadding: false },
  danger: {
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: colours.late,
  },
  dangerText: { color: colours.ink, fontSize: 18, fontWeight: '600', includeFontPadding: false },
  backHit: { alignSelf: 'flex-start' },
  lens: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: colours.line,
    borderRadius: 12,
    padding: 12,
    backgroundColor: colours.pitchRaised,
  },
  lensName: { color: colours.ink, fontSize: 17, fontWeight: '700', includeFontPadding: false },
  lensHead: { flexDirection: 'row', alignItems: 'center' },
  lensNameText: { marginLeft: 6, flex: 1 },
  lensText: { color: colours.inkMuted, fontSize: 14, marginTop: 4, includeFontPadding: false },
  welcome: { flexGrow: 1, justifyContent: 'center' },
  empty: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colours.line,
    borderRadius: 12,
    padding: 14,
    marginVertical: 12,
  },
  emptyText: { color: colours.inkMuted, fontSize: 15, textAlign: 'center', includeFontPadding: false },
});
