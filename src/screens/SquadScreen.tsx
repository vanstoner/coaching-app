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
  activePlayers,
  displayName,
  duplicatedNames,
  makePlayer,
  KEEPER_LABEL,
  UNIT_PREF_LABEL,
  preferenceSummary,
  setKeeperPreference,
  setUnitPreference,
  removePlayer,
  restorePlayer,
  squadReadiness,
  validateName,
} from '../app/squad';
import { Chip, ChipRow } from './Chip';
import { colours, screen, TOUCH_TARGET } from './theme';

export function SquadScreen({
  squadId,
  players: everyone,
  played,
  onPlayers,
  onFieldCount,
  /** Offered only on the way to a match; the tab has tabs instead. */
  onStartMatch,
  /** Offered only on the way to a match. Leaves without kicking off. */
  onLeave,
}: {
  squadId: UUID;
  /** Everyone ever in the squad, retired players included (#77). */
  players: Player[];
  /** Players with recorded time: removing one retires rather than deletes. */
  played: ReadonlySet<UUID>;
  onPlayers: (p: Player[]) => void;
  onFieldCount: number;
  onStartMatch: (() => void) | null;
  onLeave: (() => void) | null;
}) {
  const players = activePlayers(everyone);
  const retired = everyone.filter((p) => !players.includes(p));
  const [draft, setDraft] = useState('');
  /** Whose position preference is open (#86). */
  const [openPrefs, setOpenPrefs] = useState<UUID | null>(null);
  const [error, setError] = useState('');

  const readiness = squadReadiness(players, onFieldCount);
  const dupes = duplicatedNames(players);

  const add = useCallback(() => {
    const check = validateName(draft);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    onPlayers([...everyone, makePlayer(squadId, check.cleaned)]);
    setDraft('');
    setError('');
  }, [draft, everyone, onPlayers, squadId]);

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
            {players.map((p) => {
              const open = openPrefs === p.id;
              const summary = preferenceSummary(p);
              return (
                <View key={p.id}>
                  <View style={screen.playerRow}>
                    {/* #86: tap a name for their position preference. */}
                    <Pressable
                      onPress={() => setOpenPrefs(open ? null : p.id)}
                      style={local.nameHit}
                    >
                      <Text style={screen.playerName} numberOfLines={1}>
                        {displayName(p)}
                      </Text>
                      <Text style={local.prefSummary} numberOfLines={1}>
                        {summary === '' ? 'Tap to set a position preference' : summary}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => onPlayers(removePlayer(everyone, p.id, played))}
                      style={local.removeHit}
                    >
                      <Text style={local.remove}>Remove</Text>
                    </Pressable>
                  </View>
                  {open && (
                    <View style={local.prefs}>
                      <Text style={screen.hint}>In goal</Text>
                      <ChipRow>
                        {(['main', 'backup', 'never'] as const).map((k) => (
                          <Chip
                            key={k}
                            label={KEEPER_LABEL[k]}
                            selected={p.keeper === k}
                            // Tapping the chosen one clears it.
                            onPress={() =>
                              onPlayers(setKeeperPreference(everyone, p.id, p.keeper === k ? null : k))
                            }
                          />
                        ))}
                      </ChipRow>
                      <Text style={screen.hint}>Prefers, outfield</Text>
                      <ChipRow>
                        {(['DEF', 'MID', 'ATT'] as const).map((u) => (
                          <Chip
                            key={u}
                            label={UNIT_PREF_LABEL[u]}
                            selected={p.prefers === u}
                            onPress={() =>
                              onPlayers(setUnitPreference(everyone, p.id, p.prefers === u ? null : u))
                            }
                            narrow
                          />
                        ))}
                      </ChipRow>
                      <Text style={screen.hint}>
                        Only decides who is suggested where. Minutes and fairness are not affected.
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
            {players.length === 0 && <Text style={screen.caption}>No players yet.</Text>}

            {retired.length > 0 && (
              <>
                <Text style={screen.fieldLabel}>Removed, still in past matches</Text>
                {retired.map((p) => (
                  <View key={p.id} style={screen.playerRow}>
                    <Text style={[screen.playerName, local.retired]}>{displayName(p)}</Text>
                    <Pressable
                      onPress={() => onPlayers(restorePlayer(everyone, p.id))}
                      style={local.removeHit}
                    >
                      <Text style={local.remove}>Bring back</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            )}
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
  nameHit: { flex: 1, minHeight: TOUCH_TARGET, justifyContent: 'center' },
  prefSummary: { color: colours.inkMuted, fontSize: 12, marginTop: 2, includeFontPadding: false },
  prefs: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#164f3c' },
  // 44dp even though the word is small: a mis-hit here deletes a child from
  // the squad, and the row it sits in is 44 high anyway.
  removeHit: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET + 24,
  },
  // Colour only: a weight change re-measures and clips (theme.ts).
  retired: { color: colours.inkFaint },
  remove: {
    color: colours.inkMuted,
    fontSize: 13,
    includeFontPadding: false,
    textDecorationLine: 'underline',
  },
});
