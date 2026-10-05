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

import { useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  TextInput,
} from 'react-native';
import { Text } from './Text';
import { StatusBar } from 'expo-status-bar';

import { PERIOD_COUNT_CHOICES, TOTAL_MINUTES_CHOICES, periodNounPlural } from '../app/matchClock';
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
  testKit,
  onForget,
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
  /** The Test kit (#95). Passed only in a Coaching Beta build. */
  testKit?: ReactNode;
  onForget: () => void;
}) {
  // Confirm before wiping, because the coach whose squad this deletes is the
  // one who typed all ten names in. Two taps, in-screen, no dialog module.
  const [confirmForget, setConfirmForget] = useState(false);

  return (
    <SafeAreaView style={screen.safe}>
      <KeyboardAvoidingView
        style={screen.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={screen.scroll} keyboardShouldPersistTaps="handled">
          <Text style={screen.title}>Settings</Text>
          <Text style={screen.caption}>
            Defaults for a new match. Changing one never alters a fixture you
            have already saved.
          </Text>

          <Text style={screen.fieldLabel}>Team name</Text>
          <TextInput
            style={screen.input}
            value={squadName}
            onChangeText={onSquadName}
            // Cleaned when the coach leaves the field rather than as they
            // type, so a space mid-word is not eaten under their thumb.
            onBlur={() => onSquadName(normaliseTeamName(squadName, PLACEHOLDER_SQUAD_NAME))}
            placeholder="Your team"
            placeholderTextColor={colours.inkFaint}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={MAX_TEAM_NAME_LENGTH}
            returnKeyType="done"
          />

          <Text style={screen.fieldLabel}>Default match length</Text>
          <ChipRow>
            {TOTAL_MINUTES_CHOICES.map((m) => (
              <Chip
                key={m}
                label={`${m}`}
                selected={m === totalMinutes}
                onPress={() => onTotalMinutes(m)}
                narrow
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
            The phone buzzes once for each planned sub, while the clock is on screen.
          </Text>

          {minutes}
          {testKit}

          {confirmForget ? (
            <>
              <Text style={[screen.hint, screen.overtime]}>
                This deletes the squad, the team name, every saved match and
                every player's minutes. Export the minutes file first if you
                want to keep them.
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
              <Text style={screen.dangerLink}>Forget everything</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <BuildLabel />
      <StatusBar style="light" />
    </SafeAreaView>
  );
}
