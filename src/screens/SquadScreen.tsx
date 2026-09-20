/**
 * The squad — REQ-09 (#9).
 *
 * First names only, enforced in `src/app/squad.ts` at entry (invariant 4).
 * Nothing leaves the phone (ADR-011).
 *
 * ---------------------------------------------------------------------------
 * One screen, two errands
 * ---------------------------------------------------------------------------
 *
 * As the **Squad tab** it is housekeeping: add a player, remove a player,
 * leave by tapping another tab. A short squad is a normal state there, so
 * nothing blocks.
 *
 * On the way to a **match** it is step one of a kick-off: the tabs are gone,
 * it offers the lineup, and it offers Leave. A screen whose only exit commits
 * the coach to starting a game is a trap — the lineup screen was one.
 */

import { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Player, UUID } from '../types/index';
import {
  MAX_NAME_LENGTH,
  displayName,
  duplicatedNames,
  makePlayer,
  squadReadiness,
  validateName,
} from '../app/squad';
import { colours, screen, TOUCH_TARGET } from './theme';

export function SquadScreen({
  squadId,
  players,
  onPlayers,
  onFieldCount,
  /** Offered only on the way to a match; the tab has tabs instead. */
  onStartMatch,
  /** Offered only on the way to a match. Leaves without kicking off. */
  onLeave,
}: {
  squadId: UUID;
  players: Player[];
  onPlayers: (p: Player[]) => void;
  onFieldCount: number;
  onStartMatch: (() => void) | null;
  onLeave: (() => void) | null;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const readiness = squadReadiness(players, onFieldCount);
  const dupes = duplicatedNames(players);

  const add = useCallback(() => {
    const check = validateName(draft);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    onPlayers([...players, makePlayer(squadId, check.cleaned)]);
    setDraft('');
    setError('');
  }, [draft, players, onPlayers, squadId]);

  return (
    <View style={screen.flex}>
      <KeyboardAvoidingView
        style={screen.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={screen.pane}>
          <Text style={screen.title}>Squad</Text>
          <Text style={screen.hint}>First names only. Nothing leaves this phone.</Text>

          <View style={local.addRow}>
            <TextInput
              style={[screen.input, local.nameInput]}
              value={draft}
              onChangeText={(t) => {
                setDraft(t);
                if (error) setError('');
              }}
              placeholder="First name"
              placeholderTextColor={colours.inkFaint}
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={MAX_NAME_LENGTH + 8}
              returnKeyType="done"
              onSubmitEditing={add}
            />
            <Pressable
              style={({ pressed }) => [local.addButton, pressed && screen.buttonPressed]}
              onPress={add}
            >
              <Text style={screen.buttonLabel}>Add</Text>
            </Pressable>
          </View>

          {error !== '' && <Text style={screen.error}>{error}</Text>}

          <ScrollView style={screen.list} keyboardShouldPersistTaps="handled">
            {players.map((p) => (
              <View key={p.id} style={screen.playerRow}>
                <Text style={screen.playerName}>{displayName(p)}</Text>
                <Pressable
                  onPress={() => onPlayers(players.filter((x) => x.id !== p.id))}
                  style={local.removeHit}
                >
                  <Text style={local.remove}>Remove</Text>
                </Pressable>
              </View>
            ))}
            {players.length === 0 && <Text style={screen.caption}>No players yet.</Text>}
          </ScrollView>

          {dupes.length > 0 && (
            <Text style={screen.hint}>Two players called {dupes.join(', ')}.</Text>
          )}
          <Text style={[screen.caption, !readiness.ready && screen.overtime]}>
            {readiness.message}
          </Text>

          {onStartMatch && (
            <Pressable
              disabled={!readiness.ready}
              style={({ pressed }) => [
                screen.button,
                !readiness.ready && screen.buttonDisabled,
                pressed && screen.buttonPressed,
              ]}
              onPress={onStartMatch}
            >
              <Text style={screen.buttonLabel}>Pick the lineup</Text>
            </Pressable>
          )}
          {onLeave && (
            <Pressable onPress={onLeave} style={screen.linkHit}>
              <Text style={screen.link}>Leave — go to Home</Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const local = StyleSheet.create({
  addRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  nameInput: { flex: 1, alignSelf: 'auto', marginRight: 8 },
  addButton: {
    backgroundColor: colours.accent,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: TOUCH_TARGET,
    minWidth: 72,
    paddingHorizontal: 18,
  },
  // 44dp even though the word is small: a mis-hit here deletes a child from
  // the squad, and the row it sits in is 44 high anyway.
  removeHit: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET + 24,
  },
  remove: {
    color: colours.inkMuted,
    fontSize: 13,
    includeFontPadding: false,
    textDecorationLine: 'underline',
  },
});
