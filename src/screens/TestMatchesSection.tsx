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
 *
 * #264: Start and each test match are Rows ›; Delete and Delete all keep the
 * Danger look where they are (Rob, Q1(a): a delete belongs next to what it
 * deletes, and it cannot be undone), with the two-tap confirm; Hide and Show
 * it again are Actions.
 */

import { StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { CLOCK_SPEEDS, type ClockSpeed } from '../app/appClock';
import { Action, Danger, RowNav, Segmented } from './controls';
import { colours, TOUCH_TARGET } from './theme';

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
  const n = candidates.length;
  return (
    <View style={local.section}>
      <RowNav label="Start a test match" onPress={start.onStart} disabled={start.blocked !== null} />
      <Text style={local.hint}>
        {start.blocked ??
          'Plays the squad on the real screens, at ×1, ×5 or ×10. Never recorded: no minutes, no figures, not on Home.'}
      </Text>

      {played.length > 0 && (
        <>
          <Text style={local.hint}>
            {played.length === 1 ? 'One test match' : `${played.length} test matches`} on this phone, never recorded:
          </Text>
          {played.map((t) => (
            <View key={t.id} style={local.played}>
              <RowNav label={t.label} onPress={() => onOpen(t.id)} accessibilityLabel={`Open ${t.label}`} />
              <Danger
                label="Delete"
                confirmLabel="Yes, delete it"
                keepLabel="Keep"
                warning="This test match goes from this phone. It was never in the record."
                onConfirm={() => onDelete(t.id)}
              />
            </View>
          ))}
          <Danger
            label="Delete all test matches"
            confirmLabel={`Delete ${played.length === 1 ? 'it' : `all ${played.length}`}`}
            keepLabel="Keep"
            warning="Every test match goes from this phone. None was ever in the record."
            onConfirm={onDeleteAll}
          />
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
          <Text style={local.hint}>
            No opponent, and left out as a test or over within a period. Hiding takes {n === 1 ? 'it' : 'them'} off
            every screen. The record keeps {n === 1 ? 'it' : 'them'}, and {n === 1 ? 'it' : 'each'} can be shown again
            here.
          </Text>
          <Action label={`Hide ${n === 1 ? 'it' : 'them'} everywhere`} onPress={onHideAll} />
        </View>
      )}

      {hidden.length > 0 && (
        <>
          <Text style={local.hint}>Hidden or voided: off every screen, kept in the record.</Text>
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
              <Action label="Show it again" onPress={() => onShow(h.id)} />
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
      {onSpeed && (
        <View style={local.bannerSpeed}>
          <Segmented
            name="Clock speed"
            options={CLOCK_SPEEDS.map((s) => ({ value: s, label: `×${s}` }))}
            value={speed}
            onChange={(s) => s !== null && onSpeed(s)}
          />
        </View>
      )}
    </View>
  );
}

const local = StyleSheet.create({
  section: { alignSelf: 'stretch' },
  hint: { alignSelf: 'stretch', color: colours.inkFaint, fontSize: 13, includeFontPadding: false, marginVertical: 4 },
  played: { alignSelf: 'stretch', marginBottom: 4 },
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
    minHeight: TOUCH_TARGET,
    borderBottomWidth: 1,
    borderBottomColor: colours.hair,
  },
  hiddenText: { flex: 1, minWidth: 0 },
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
    paddingRight: 6,
    marginHorizontal: 8,
    marginTop: 4,
  },
  bannerText: { flex: 1, minWidth: 0, color: colours.ink, fontSize: 14, fontWeight: '600', includeFontPadding: false },
  // A fixed width: three segments share it, never sized to their own text.
  bannerSpeed: { width: 170, flexShrink: 0 },
});
