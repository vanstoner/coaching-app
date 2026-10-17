/**
 * Settings › Test matches — #194.
 *
 * The one-off clean-up: earlier matches that look like tests are offered, the
 * coach confirms, and each is marked a test in the record (with a note), which
 * hides it from every screen. Hidden matches are listed here, and only here,
 * each with a way to show it again. Nothing is ever deleted (invariant 5).
 */

import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { colours, screen } from './theme';

export interface TestMatchRow {
  id: string;
  /** "Fri 16 Oct · 19:40 · lasted 0:58". */
  label: string;
  /** Why it is hidden, for a hidden one. */
  note?: string | null;
}

export function TestMatchesSection({
  candidates,
  hidden,
  message,
  onHideAll,
  onShow,
}: {
  candidates: TestMatchRow[];
  hidden: TestMatchRow[];
  message: string;
  onHideAll: () => void;
  onShow: (matchId: string) => void;
}) {
  if (candidates.length === 0 && hidden.length === 0 && message === '') return null;
  const n = candidates.length;
  return (
    <View style={local.section}>
      <Text style={screen.fieldLabel}>Test matches</Text>

      {n > 0 && (
        <View style={local.offer}>
          <Text style={local.offerTitle}>
            {n} earlier {n === 1 ? 'match looks' : 'matches look'} like {n === 1 ? 'a test' : 'tests'}
          </Text>
          {candidates.map((c) => (
            <Text key={c.id} style={local.row} numberOfLines={1}>
              {c.label}
            </Text>
          ))}
          <Text style={screen.hint}>
            No opponent, and left out as a test or over within a period. Hiding takes{' '}
            {n === 1 ? 'it' : 'them'} off every screen. The record keeps {n === 1 ? 'it' : 'them'}, and{' '}
            {n === 1 ? 'it' : 'each'} can be shown again here.
          </Text>
          <Pressable
            onPress={onHideAll}
            style={({ pressed }) => [screen.buttonQuiet, pressed && screen.buttonPressed]}
          >
            <Text style={screen.buttonLabel}>Hide {n === 1 ? 'it' : `them`} everywhere</Text>
          </Pressable>
        </View>
      )}

      {hidden.length > 0 && (
        <>
          <Text style={screen.hint}>Hidden from every screen, kept in the record:</Text>
          {hidden.map((h) => (
            <View key={h.id} style={local.hiddenRow}>
              <View style={local.hiddenText}>
                <Text style={local.row} numberOfLines={1}>
                  {h.label}
                </Text>
                {h.note ? (
                  <Text style={local.note} numberOfLines={1}>
                    {`"${h.note}"`}
                  </Text>
                ) : null}
              </View>
              <Pressable onPress={() => onShow(h.id)} style={screen.linkHit}>
                <Text style={screen.link}>Show it again</Text>
              </Pressable>
            </View>
          ))}
        </>
      )}

      {message !== '' && <Text style={local.message}>{message}</Text>}
    </View>
  );
}

const local = StyleSheet.create({
  section: { alignSelf: 'stretch', marginTop: 20 },
  offer: {
    alignSelf: 'stretch',
    backgroundColor: colours.pitchRaised,
    borderColor: colours.warn,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  offerTitle: { color: colours.ink, fontSize: 16, fontWeight: '600', includeFontPadding: false, marginBottom: 6 },
  row: { color: colours.ink, fontSize: 15, includeFontPadding: false, marginTop: 2 },
  note: { color: colours.inkMuted, fontSize: 13, includeFontPadding: false, marginTop: 2 },
  hiddenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    borderBottomWidth: 1,
    borderBottomColor: '#164f3c',
  },
  hiddenText: { flex: 1, minWidth: 0 },
  message: { alignSelf: 'stretch', color: colours.warn, fontSize: 14, includeFontPadding: false, marginTop: 10 },
});
