/**
 * Settings — **defaults only** (PO ruling, 2026-09-20, #70).
 *
 * > *"the match length and format are probably match specific - but happy to
 * > have defaults in the settings."*
 *
 * So nothing on this screen changes a match. Every control here is the value a
 * NEW fixture starts with, and the value **Play now** copies. A cup game saved
 * as halves does not touch the league default, and changing the default does
 * not reach back into a fixture already saved — each match carries its own
 * length, period count and shape (ADR-012).
 *
 * "Buzz when a sub is due" (#137) is not a match default: it is about the
 * phone, and applies at once, to a match in play as well.
 *
 * **In collapsible sections** (#263, approved by Rob 29 Oct): Season, Team,
 * Match defaults, Player minutes, Awards, Tallies, Backup, Test matches, Test
 * kit (beta only) and the Danger zone, last. Season and Team start open; which
 * are open is remembered on this phone as a view choice, never in the record.
 * Danger zone always starts closed, and closing it or leaving cancels a
 * half-done Forget. Each closed heading carries a one-line summary.
 *
 * **Settings save on the tap** (#264 V28): after each change, ✓ Saved shows
 * right-justified on its section's heading for two seconds.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { sameTeamName } from '../app/teamRows';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { StatusBar } from 'expo-status-bar';

import { PERIOD_COUNT_CHOICES, TOTAL_MINUTES_CHOICES, periodNounPlural } from '../app/matchClock';
import { SHOW_AGAIN } from '../app/gettingStarted';
import type { KeyValueStore } from '../app/persistence';
import { PLACEHOLDER_SQUAD_NAME } from '../app/placeholderSquad';
import { tickWhenSaved } from '../app/saveState';
import { MAX_TEAM_NAME_LENGTH, describeDefaults, normaliseTeamName } from '../app/settings';
import {
  SETTINGS_SECTIONS_KEY,
  TEST_KIT_SUMMARY,
  dangerSummary,
  defaultsSummary,
  parseOpenSections,
  serialiseOpenSections,
  teamSummary,
  toggleSection,
  type SettingsSectionId,
} from '../app/settingsSections';
import { SHAPES, shapeLabel, type ShapeCode } from '../app/shapes';
import { BuildLabel } from './BuildLabel';
import {
  Action,
  Danger,
  DangerRow,
  FieldRow,
  ListSheet,
  RowNav,
  Section,
  SegmentedRow,
  useSavedTicks,
} from './controls';
import { colours, screen } from './theme';

/** A section another file draws: its body and its closed heading's summary (#263 AC9). */
export interface SettingsPart {
  node: ReactNode;
  summary: string;
}

/**
 * Which sections are open, read from and written to this phone (AC5). Danger
 * zone is never among them (AC6). A failed read or write costs a tap, so it
 * is let go.
 */
function useOpenSections(store: KeyValueStore | null) {
  const [open, setOpen] = useState<Set<SettingsSectionId>>(() => parseOpenSections(null));
  const [dangerOpen, setDangerOpen] = useState(false);
  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    store
      .getItem(SETTINGS_SECTIONS_KEY)
      .then((raw) => {
        if (!cancelled) setOpen(parseOpenSections(raw));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [store]);
  const toggle = useCallback(
    (id: SettingsSectionId) => {
      if (id === 'danger') {
        setDangerOpen((o) => !o);
        return;
      }
      setOpen((now) => {
        const next = toggleSection(now, id);
        if (store) void store.setItem(SETTINGS_SECTIONS_KEY, serialiseOpenSections(next)).catch(() => undefined);
        return next;
      });
    },
    [store]
  );
  const isOpen = (id: SettingsSectionId) => (id === 'danger' ? dangerOpen : open.has(id));
  return { isOpen, toggle };
}

export function SettingsScreen({
  squadName,
  onSquadName,
  totalMinutes,
  periodCount,
  shape,
  onTotalMinutes,
  onPeriodCount,
  onShape,
  buzzWhenSubDue,
  onBuzzWhenSubDue,
  minutes,
  awards,
  tallies,
  backup,
  testMatches,
  testKit,
  onForget,
  onShowGettingStarted = null,
  team = null,
  season = null,
  store = null,
}: {
  squadName: string;
  /** Resolves true once the session is written (V28: the tick waits for it). */
  onSquadName: (s: string) => Promise<boolean>;
  totalMinutes: number;
  periodCount: number;
  /** Null when the stored format matches neither shape — a custom one. */
  shape: ShapeCode | null;
  onTotalMinutes: (n: number) => Promise<boolean>;
  onPeriodCount: (n: number) => Promise<boolean>;
  onShape: (shape: ShapeCode) => Promise<boolean>;
  /** "Buzz when a sub is due" (#137). */
  buzzWhenSubDue: boolean;
  onBuzzWhenSubDue: (on: boolean) => Promise<boolean>;
  /** Player minutes: season, export, import (#75). Drawn by the caller. */
  minutes?: SettingsPart | null;
  /** Settings › Awards (#197). */
  awards?: SettingsPart | null;
  /** Settings › Tallies (#198). */
  tallies?: SettingsPart | null;
  /** Back up this app, and restore it (#192). Drawn by the caller. */
  backup?: SettingsPart | null;
  /** Earlier test matches: the clean-up, and what is hidden (#194). */
  testMatches?: SettingsPart | null;
  /** The Test kit (#95). Passed only in a Heart FC Beta Coach build. */
  testKit?: ReactNode;
  onForget: () => void;
  /** #218 Q4: the Getting started card back, while it is closed and a step is undone. */
  onShowGettingStarted?: (() => void) | null;
  /**
   * #224: the teams on this phone (T1, T2, AC10). Switch opens the team list;
   * Remove is for the open team only, and refused with a reason while its
   * match is on (T7).
   */
  team?: {
    count: number;
    /** Every team Forget everything removes, set-aside ones included (QA D2). */
    forgetCount: number;
    /** The other teams' names: a team's name is unique on the phone (#224 AC5, QA D9). */
    otherNames: readonly string[];
    onSwitch: () => void;
    onRemove: () => void;
    removeBlocked: string | null;
  } | null;
  /** #243 Q5: Settings › Season, drawn by the caller, first in Settings. */
  season?: SettingsPart | null;
  /** This phone's store, for which sections are open (#263 AC5). */
  store?: KeyValueStore | null;
}) {
  const { isOpen, toggle } = useOpenSections(store);
  const ticks = useSavedTicks<SettingsSectionId>();
  const [shapeSheet, setShapeSheet] = useState(false);
  // QA D9, N4: a name another team on this phone has is never saved, not even
  // while typed: it stays in the box, with the reason, and leaving the box
  // puts back the name that is saved. Any other name saves as it is typed.
  const [clash, setClash] = useState<string | null>(null);
  const taken = (name: string) =>
    team !== null && team.otherNames.some((n) => sameTeamName(n, normaliseTeamName(name, PLACEHOLDER_SQUAD_NAME)));

  const forgetCount = team?.forgetCount ?? 1;
  const section = (id: SettingsSectionId, title: string, summary: string, body: ReactNode) => (
    <Section
      key={id}
      title={title}
      summary={summary}
      open={isOpen(id)}
      onToggle={() => toggle(id)}
      saved={ticks.visible(id)}
      danger={id === 'danger'}
      tall
    >
      {body}
    </Section>
  );

  return (
    <View style={screen.safe}>
      <KeyboardAvoidingView
        style={screen.flex}
        // #174: Android draws edge to edge, so the window no longer resizes for
        // the keyboard; pad on both platforms.
        behavior="padding"
      >
        <ScrollView contentContainerStyle={screen.scroll} keyboardShouldPersistTaps="handled">
          <Text style={screen.title}>Settings</Text>

          {season && section('season', 'Season', season.summary, season.node)}

          {section(
            'team',
            'Team',
            teamSummary(squadName || PLACEHOLDER_SQUAD_NAME, team?.count ?? 1),
            <>
              <FieldRow
                label="Name"
                value={clash ?? squadName}
                onChangeText={(text) => {
                  if (taken(text)) {
                    setClash(text);
                    return;
                  }
                  setClash(null);
                  void tickWhenSaved(onSquadName(text), () => ticks.mark('team'));
                }}
                // Cleaned when the coach leaves the field rather than as they
                // type, so a space mid-word is not eaten under their thumb.
                onBlur={() => {
                  setClash(null);
                  const next = normaliseTeamName(squadName, PLACEHOLDER_SQUAD_NAME);
                  // A name cleaned into another team's stays as it was saved.
                  if (!taken(next)) void onSquadName(next);
                }}
                placeholder="Your team"
                autoCapitalize="words"
                autoCorrect={false}
                maxLength={MAX_TEAM_NAME_LENGTH}
                returnKeyType="done"
                accessibilityLabel="Team name"
              />
              {clash !== null && (
                <Text style={screen.error}>
                  Another team on this phone is called {normaliseTeamName(clash, PLACEHOLDER_SQUAD_NAME)}. It stays{' '}
                  {squadName} until the name is different.
                </Text>
              )}
              {team && (
                <RowNav
                  label="Switch team"
                  value={`${team.count} ${team.count === 1 ? 'team' : 'teams'} on this phone`}
                  onPress={team.onSwitch}
                />
              )}
              {onShowGettingStarted && <Action label={SHOW_AGAIN} onPress={onShowGettingStarted} />}
            </>
          )}

          {section(
            'defaults',
            'Match defaults',
            defaultsSummary({ totalMinutes, periodCount, shape, buzz: buzzWhenSubDue }),
            <>
              <Text style={local.caption}>
                Defaults for a new match. Changing one never alters a fixture you have already saved.
              </Text>
              <SegmentedRow
                label="Minutes"
                options={TOTAL_MINUTES_CHOICES.map((m) => ({
                  value: m as number,
                  label: `${m}`,
                  accessibilityLabel: `${m} minutes`,
                }))}
                value={totalMinutes}
                onChange={(m) => {
                  if (m === null) return;
                  void tickWhenSaved(onTotalMinutes(m), () => ticks.mark('defaults'));
                }}
              />
              <SegmentedRow
                label="Periods"
                options={PERIOD_COUNT_CHOICES.map((pc) => ({ value: pc as number, label: periodNounPlural(pc) }))}
                value={periodCount}
                onChange={(pc) => {
                  if (pc === null) return;
                  void tickWhenSaved(onPeriodCount(pc), () => ticks.mark('defaults'));
                }}
              />
              {/* The arithmetic a coach should see before Saturday, not at kick-off. */}
              <Text style={local.caption}>{describeDefaults(totalMinutes, periodCount)}</Text>
              <RowNav
                label="Shape"
                value={shape ? shapeLabel(shape) : 'Custom'}
                onPress={() => setShapeSheet(true)}
              />
              <Text style={local.hint}>You can still name the positions whatever you want on the day.</Text>
              <SegmentedRow
                label="Buzz for subs"
                options={[
                  { value: true, label: 'On' },
                  { value: false, label: 'Off' },
                ]}
                value={buzzWhenSubDue}
                onChange={(on) => {
                  if (on === null) return;
                  void tickWhenSaved(onBuzzWhenSubDue(on), () => ticks.mark('defaults'));
                }}
              />
              <Text style={local.hint}>
                The phone buzzes once for each planned sub, 30 seconds before it is due, while the clock is on screen.
              </Text>
            </>
          )}

          {minutes && section('minutes', 'Player minutes', minutes.summary, minutes.node)}
          {awards && section('awards', 'Awards', awards.summary, awards.node)}
          {tallies && section('tallies', 'Tallies', tallies.summary, tallies.node)}
          {backup && section('backup', 'Backup', backup.summary, backup.node)}
          {testMatches && section('tests', 'Test matches', testMatches.summary, testMatches.node)}
          {testKit && section('testkit', 'Test kit (beta only)', TEST_KIT_SUMMARY, testKit)}

          {section(
            'danger',
            'Danger zone',
            dangerSummary(team ? squadName || PLACEHOLDER_SQUAD_NAME : null, forgetCount),
            <>
              <Text style={local.hint}>This section always starts closed.</Text>
              {team && (
                <>
                  <DangerRow label={`Remove ${squadName}`} onPress={team.onRemove} />
                  {team.removeBlocked && <Text style={local.hint}>{team.removeBlocked}</Text>}
                </>
              )}
              <Danger
                label={forgetCount > 1 ? `Forget everything (all ${forgetCount} teams)` : 'Forget everything'}
                confirmLabel="Yes, forget everything"
                warning={
                  forgetCount > 1
                    ? `This deletes all ${forgetCount} teams on this phone: each squad, team name, saved match and player's minutes, and any copies the app kept aside. Back up the app first if you want to keep them.`
                    : "This deletes the squad, the team name, every saved match, every player's minutes and any copies the app kept aside after a restore or a damaged save. Back up the app first if you want to keep them."
                }
                onConfirm={onForget}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <BuildLabel />
      <ListSheet
        visible={shapeSheet}
        title="Shape"
        items={SHAPES.map((s) => ({ value: s.code, label: shapeLabel(s.code), detail: s.description }))}
        value={shape}
        onPick={(code) => {
          setShapeSheet(false);
          void tickWhenSaved(onShape(code), () => ticks.mark('defaults'));
        }}
        onCancel={() => setShapeSheet(false)}
      />
      <StatusBar style="light" />
    </View>
  );
}

const local = StyleSheet.create({
  caption: { alignSelf: 'stretch', color: colours.inkMuted, fontSize: 14, includeFontPadding: false, marginVertical: 8 },
  hint: { alignSelf: 'stretch', color: colours.inkFaint, fontSize: 13, includeFontPadding: false, marginTop: 6 },
});
