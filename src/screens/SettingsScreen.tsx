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
 * The squad moved out: it is a tab now, not a button here.
 */

import { useRef, useState, type ReactNode } from 'react';
import { sameTeamName } from '../app/teamRows';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { Text } from './Text';
import { StatusBar } from 'expo-status-bar';

import { PERIOD_COUNT_CHOICES, TOTAL_MINUTES_CHOICES, periodNounPlural } from '../app/matchClock';
import { SHOW_AGAIN } from '../app/gettingStarted';
import { PLACEHOLDER_SQUAD_NAME } from '../app/placeholderSquad';
import { MAX_TEAM_NAME_LENGTH, describeDefaults, normaliseTeamName } from '../app/settings';
import { SHAPES, shapeLabel, type ShapeCode } from '../app/shapes';
import { BuildLabel } from './BuildLabel';
import { Chip, ChipRow } from './Chip';
import { colours, screen } from './theme';

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
  backup,
  testMatches,
  testKit,
  onForget,
  onShowGettingStarted = null,
  team = null,
  season = null,
}: {
  squadName: string;
  onSquadName: (s: string) => void;
  totalMinutes: number;
  periodCount: number;
  /** Null when the stored format matches neither shape — a custom one. */
  shape: ShapeCode | null;
  onTotalMinutes: (n: number) => void;
  onPeriodCount: (n: number) => void;
  onShape: (shape: ShapeCode) => void;
  /** "Buzz when a sub is due" (#137). */
  buzzWhenSubDue: boolean;
  onBuzzWhenSubDue: (on: boolean) => void;
  /** Player minutes: season, export, import (#75). Drawn by the caller. */
  minutes?: ReactNode;
  /** Back up this app, and restore it (#192). Drawn by the caller. */
  backup?: ReactNode;
  /** Earlier test matches: the clean-up, and what is hidden (#194). */
  testMatches?: ReactNode;
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
  season?: ReactNode;
}) {
  // Confirm before wiping, because the coach whose squad this deletes is the
  // one who typed all ten names in. Two taps, in-screen, no dialog module.
  const [confirmForget, setConfirmForget] = useState(false);
  // QA D9: a rename to another team's name is put back, with the reason.
  const lastName = useRef(squadName);
  const [nameError, setNameError] = useState('');

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
          <Text style={screen.caption}>
            Defaults for a new match. Changing one never alters a fixture you
            have already saved.
          </Text>
          {season}

          <Text style={screen.fieldLabel}>Team name</Text>
          <TextInput
            style={screen.input}
            value={squadName}
            onChangeText={onSquadName}
            // Cleaned when the coach leaves the field rather than as they
            // type, so a space mid-word is not eaten under their thumb.
            onBlur={() => {
              const next = normaliseTeamName(squadName, PLACEHOLDER_SQUAD_NAME);
              if (team && team.otherNames.some((n) => sameTeamName(n, next))) {
                setNameError(`Another team on this phone is called ${next}. Kept as ${lastName.current}.`);
                onSquadName(lastName.current);
                return;
              }
              setNameError('');
              lastName.current = next;
              onSquadName(next);
            }}
            placeholder="Your team"
            placeholderTextColor={colours.inkFaint}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={MAX_TEAM_NAME_LENGTH}
            returnKeyType="done"
          />
          {nameError !== '' && <Text style={screen.error}>{nameError}</Text>}
          {team && (
            <Pressable onPress={team.onSwitch} style={screen.linkHit} accessibilityRole="button">
              <Text style={screen.link}>
                {team.count} {team.count === 1 ? 'team' : 'teams'} on this phone · Switch team ›
              </Text>
            </Pressable>
          )}

          <Text style={screen.fieldLabel}>Default match length</Text>
          <ChipRow>
            {TOTAL_MINUTES_CHOICES.map((m) => (
              <Chip
                key={m}
                label={`${m}`}
                selected={m === totalMinutes}
                onPress={() => onTotalMinutes(m)}
                compact
              />
            ))}
          </ChipRow>
          <Text style={screen.hint}>minutes</Text>

          <Text style={screen.fieldLabel}>Default periods</Text>
          <ChipRow>
            {PERIOD_COUNT_CHOICES.map((pc) => (
              <Chip
                key={pc}
                label={periodNounPlural(pc)}
                selected={pc === periodCount}
                onPress={() => onPeriodCount(pc)}
              />
            ))}
          </ChipRow>

          {/* The arithmetic a coach should see before Saturday, not at kick-off. */}
          <Text style={screen.caption}>{describeDefaults(totalMinutes, periodCount)}</Text>

          <Text style={screen.fieldLabel}>Default shape</Text>
          <ChipRow>
            {SHAPES.map((s) => (
              <Chip
                key={s.code}
                label={shapeLabel(s.code)}
                detail={s.description}
                selected={s.code === shape}
                onPress={() => onShape(s.code)}
                wide
              />
            ))}
          </ChipRow>
          <Text style={screen.hint}>
            You can still name the positions whatever you want on the day.
          </Text>

          <Text style={screen.fieldLabel}>Buzz when a sub is due</Text>
          <ChipRow>
            <Chip label="On" selected={buzzWhenSubDue} onPress={() => onBuzzWhenSubDue(true)} />
            <Chip label="Off" selected={!buzzWhenSubDue} onPress={() => onBuzzWhenSubDue(false)} />
          </ChipRow>
          <Text style={screen.hint}>
            The phone buzzes once for each planned sub, 30 seconds before it is due, while the clock is on screen.
          </Text>

          {onShowGettingStarted && (
            <Pressable onPress={onShowGettingStarted} style={screen.linkHit}>
              <Text style={screen.link}>{SHOW_AGAIN}</Text>
            </Pressable>
          )}

          {minutes}
          {testMatches}
          {backup}
          {testKit}

          {team && (
            <>
              <Pressable onPress={team.onRemove} style={screen.linkHit} accessibilityRole="button">
                <Text style={screen.dangerLink}>Remove {squadName}</Text>
              </Pressable>
              {team.removeBlocked && <Text style={screen.hint}>{team.removeBlocked}</Text>}
            </>
          )}

          {confirmForget ? (
            <>
              <Text style={[screen.hint, screen.overtime]}>
                {team && team.forgetCount > 1
                  ? `This deletes all ${team.forgetCount} teams on this phone: each squad, team name, saved match and player's minutes, and any copies the app kept aside. Back up the app first if you want to keep them.`
                  : "This deletes the squad, the team name, every saved match, every player's minutes and any copies the app kept aside after a restore or a damaged save. Back up the app first if you want to keep them."}
              </Text>
              <Pressable onPress={onForget} style={screen.linkHit}>
                <Text style={screen.dangerLink}>Yes, forget everything</Text>
              </Pressable>
              <Pressable onPress={() => setConfirmForget(false)} style={screen.linkHit}>
                <Text style={screen.link}>Keep it</Text>
              </Pressable>
            </>
          ) : (
            <Pressable onPress={() => setConfirmForget(true)} style={screen.linkHit}>
              <Text style={screen.dangerLink}>
                {team && team.forgetCount > 1 ? `Forget everything (all ${team.forgetCount} teams)` : 'Forget everything'}
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <BuildLabel />
      <StatusBar style="light" />
    </View>
  );
}
