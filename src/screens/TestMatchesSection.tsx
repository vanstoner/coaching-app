/**
 * Settings › Test matches — #194.
 *
 * Part B: **Start a test match** plays the squad on the real screens and is
 * never written to the minutes record (ADR-021 D3). Test matches are listed
 * here and only here, each with Open and Delete, and Delete all. They delete
 * outright, because the record never had them.
 *
 * Part A: the one-off clean-up. Earlier matches that look like tests are
 * offered, the coach confirms, and each is marked a test in the record (with a
 * note), which hides it from every screen. Hidden matches, and matches voided
 * from their report, are listed here with a way to show each again. Nothing
 * in the record is ever deleted (invariant 5).
 */

import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { CLOCK_SPEEDS, type ClockSpeed } from '../app/appClock';
import { Chip } from './Chip';
import { colours, screen, TOUCH_TARGET } from './theme';

export interface TestMatchRow {
  id: string;
  /** "Fri 16 Oct · 19:40 · lasted 0:58". */
  label: string;
  /** Why it is hidden, for a hidden one. */
  note?: string | null;
  /** For a hidden one: marked a test, or voided from its report. */
  kind?: 'test' | 'void';
}

export interface StartTestMatch {
  onStart: () => void;
  /** Why it cannot start yet (too few players), or null. */
  blocked: string | null;
}

export function TestMatchesSection({
  start,
  played,
  onOpen,
  onDelete,
  onDeleteAll,
  candidates,
  hidden,
  message,
  onHideAll,
  onShow,
}: {
  start: StartTestMatch;
  /** Test matches on this phone, never in the record. */
  played: TestMatchRow[];
  onOpen: (matchId: string) => void;
  onDelete: (matchId: string) => void;
  onDeleteAll: () => void;
  candidates: TestMatchRow[];
  hidden: TestMatchRow[];
  message: string;
  onHideAll: () => void;
  onShow: (matchId: string) => void;
}) {
  const [confirmAll, setConfirmAll] = useState(false);
  const n = candidates.length;
  return (
    <View style={local.section}>
      <Text style={screen.fieldLabel}>Test matches</Text>

      <Pressable
        onPress={start.onStart}
        disabled={start.blocked !== null}
        accessibilityRole="button"
        style={({ pressed }) => [
          screen.buttonQuiet,
          start.blocked !== null && screen.buttonDisabled,
          pressed && screen.buttonPressed,
        ]}
      >
        <Text style={screen.buttonLabel}>Start a test match</Text>
      </Pressable>
      <Text style={screen.hint}>
        {start.blocked ??
          'Plays the squad on the real screens, at ×1, ×5 or ×10. Never recorded: no minutes, no figures, not on Home.'}
      </Text>

      {played.length > 0 && (
        <>
          <Text style={screen.hint}>
            {played.length === 1 ? 'One test match' : `${played.length} test matches`} on this phone, never recorded:
          </Text>
          {played.map((t) => (
            <View key={t.id} style={local.hiddenRow}>
              <View style={local.hiddenText}>
                <Text style={local.row} numberOfLines={1}>
                  {t.label}
                </Text>
              </View>
              <Pressable onPress={() => onOpen(t.id)} style={local.rowHit}>
                <Text style={screen.link}>Open</Text>
              </Pressable>
              <Pressable onPress={() => onDelete(t.id)} style={local.rowHit}>
                <Text style={screen.dangerLink}>Delete</Text>
              </Pressable>
            </View>
          ))}
          {confirmAll ? (
            <View style={local.confirmRow}>
              <Pressable
                onPress={() => {
                  setConfirmAll(false);
                  onDeleteAll();
                }}
                style={local.rowHit}
              >
                <Text style={screen.dangerLink}>
                  Delete {played.length === 1 ? 'it' : `all ${played.length}`}
                </Text>
              </Pressable>
              <Pressable onPress={() => setConfirmAll(false)} style={local.rowHit}>
                <Text style={screen.link}>Keep</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => setConfirmAll(true)} style={screen.linkHit}>
              <Text style={screen.link}>Delete all test matches</Text>
            </Pressable>
          )}
        </>
      )}

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
          <Text style={screen.hint}>Hidden or voided: off every screen, kept in the record.</Text>
          {hidden.map((h) => (
            <View key={h.id} style={local.hiddenRow}>
              <View style={local.hiddenText}>
                <Text style={local.row} numberOfLines={1}>
                  {h.kind === 'void' ? 'Voided · ' : 'Test · '}
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

/**
 * Across the top of every screen of a test match (#194 AC1): it says so, and
 * holds the clock speed (PO ruling, 18 Oct: ×5 and ×10 in Heart FC Coach too).
 * The speed is the test match's own, so nothing else on the phone runs fast.
 */
export function TestMatchBanner({
  speed,
  onSpeed,
}: {
  speed: ClockSpeed;
  /** Absent where the speed is not for changing (the resume prompt). */
  onSpeed?: (speed: ClockSpeed) => void;
}) {
  return (
    <View style={local.banner}>
      <Text style={local.bannerText} numberOfLines={2}>
        Test match · not recorded
      </Text>
      {onSpeed &&
        CLOCK_SPEEDS.map((s) => (
          <View key={s} style={local.bannerChip}>
            <Chip label={`×${s}`} selected={s === speed} onPress={() => onSpeed(s)} narrow />
          </View>
        ))}
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
    marginTop: 12,
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
  rowHit: { justifyContent: 'center', minHeight: TOUCH_TARGET, paddingHorizontal: 10, flexShrink: 0 },
  confirmRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center' },
  message: { alignSelf: 'stretch', color: colours.warn, fontSize: 14, includeFontPadding: false, marginTop: 10 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: '#5a3d00',
    borderColor: colours.warn,
    borderWidth: 1,
    borderRadius: 10,
    paddingLeft: 10,
    paddingTop: 4,
    marginHorizontal: 8,
    marginTop: 4,
  },
  bannerText: { flex: 1, minWidth: 0, color: colours.ink, fontSize: 14, fontWeight: '600', includeFontPadding: false },
  // The chip carries its own bottom margin; this keeps the row balanced.
  bannerChip: { flexShrink: 0, marginBottom: -4 },
});
