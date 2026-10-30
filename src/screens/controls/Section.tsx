/**
 * The Section heading, the one twisty, and the save states — #264 V9 to V11,
 * V28, V29; #263 AC8, AC14.
 *
 * **The twisty is a › on the left, before the title, and it turns 90° to
 * point down when open** (Rob, 29 Oct), like Finder and iOS outline lists. A
 * › on the right never turns: that is a Row ›, which goes somewhere.
 *
 * While closed, a one-line summary sits under the title; it ends in "…" and
 * never wraps. The right end of the heading is the **✓ Saved** slot, the same
 * width open or closed, so nothing moves when the tick comes and goes. A
 * closed section's body is not drawn at all, so nothing in it can be focused
 * or tapped (#263 AC15).
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';

import {
  SAVED_TICK_MS,
  formStatusText,
  savedTickRemainingMs,
  savedTickVisible,
  type FormPhase,
} from '../../app/saveState';
import { colours, TOUCH_TARGET } from '../theme';
import { Icon } from './Icon';

export function Section({
  title,
  summary,
  open,
  onToggle,
  saved = false,
  danger = false,
  tall = false,
  children,
  accessibilityLabel,
}: {
  title: string;
  /** One line, shown only while closed. */
  summary?: string;
  open: boolean;
  onToggle: () => void;
  /** ✓ Saved shows now (useSavedTick). */
  saved?: boolean;
  /** The Danger zone's heading: its title in the danger colour (#263 AC12). */
  danger?: boolean;
  /** 60 dp, as Settings draws it (#263 AC14). */
  tall?: boolean;
  children?: ReactNode;
  /** Defaults to "title, summary". Maestro matches it. */
  accessibilityLabel?: string;
}) {
  return (
    <View style={section.wrap}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={accessibilityLabel ?? [title, summary].filter(Boolean).join(', ')}
        style={({ pressed }) => [section.head, tall && section.tall, pressed && section.pressed]}
      >
        <View style={section.twistySlot}>
          <Icon
            name="chevron-right"
            size={22}
            color={danger ? colours.danger : colours.back}
            style={open ? section.turned : undefined}
          />
        </View>
        <View style={section.words}>
          <Text style={[section.title, danger && section.dangerTitle]} numberOfLines={1}>
            {title}
          </Text>
          {!open && summary ? (
            <Text style={section.summary} numberOfLines={1} ellipsizeMode="tail">
              {summary}
            </Text>
          ) : null}
        </View>
        <SavedTick visible={saved} />
      </Pressable>
      {open && <View style={section.body}>{children}</View>}
    </View>
  );
}

/** ✓ Saved, in a slot that is always there (V11, V28). Announced politely to TalkBack. */
export function SavedTick({ visible }: { visible: boolean }) {
  return (
    <View style={section.savedSlot} accessibilityLiveRegion="polite">
      {visible && (
        <View style={section.savedInner} accessibilityLabel="Saved">
          <Icon name="check-bold" size={14} color={colours.saved} />
          <Text style={section.savedText}>Saved</Text>
        </View>
      )}
    </View>
  );
}

/**
 * The 2-second ✓ Saved after a setting saves (V28). `mark()` after the save
 * has completed; another `mark()` restarts the two seconds. Visibility is
 * worked out from the wall clock on each draw; the one timer only asks for
 * the repaint that hides it. View state: nothing is stored.
 */
export function useSavedTick(): { visible: boolean; mark: () => void } {
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [, repaint] = useState(0);
  useEffect(() => {
    const left = savedTickRemainingMs(savedAt, uiNow());
    if (left <= 0) return;
    const t = setTimeout(() => repaint((n) => n + 1), Math.min(left, SAVED_TICK_MS) + 20);
    return () => clearTimeout(t);
  }, [savedAt]);
  const mark = useCallback(() => setSavedAt(uiNow()), []);
  return { visible: savedTickVisible(savedAt, uiNow()), mark };
}

/**
 * Several sections' ticks at once, keyed by section: Settings has ten
 * headings and each shows its own.
 */
export function useSavedTicks<K extends string>(): { visible: (k: K) => boolean; mark: (k: K) => void } {
  const [at, setAt] = useState<Partial<Record<K, number>>>({});
  const [, repaint] = useState(0);
  useEffect(() => {
    const now = uiNow();
    const left = Math.max(0, ...Object.values<number | undefined>(at).map((t) => savedTickRemainingMs(t ?? null, now)));
    if (left <= 0) return;
    const t = setTimeout(() => repaint((n) => n + 1), left + 20);
    return () => clearTimeout(t);
  }, [at]);
  const mark = useCallback((k: K) => setAt((now) => ({ ...now, [k]: uiNow() })), []);
  return { visible: (k: K) => savedTickVisible(at[k] ?? null, uiNow()), mark };
}

/** A form's status line (V29): "Nothing to save yet", or "Not saved yet" with a dot. */
export function FormStatus({ phase }: { phase: FormPhase }) {
  const dirty = phase === 'dirty';
  return (
    <View style={section.status} accessibilityLiveRegion="polite">
      <View style={section.dotSlot}>{dirty && <Icon name="circle" size={10} color={colours.saved} />}</View>
      <Text style={[section.statusText, dirty && section.statusDirty]} numberOfLines={1}>
        {formStatusText(phase)}
      </Text>
    </View>
  );
}

/**
 * A monotonic UI clock for the 2-second tick. Not the app clock (#95): the
 * tick is a visual, timed in real seconds even when the beta's test clock
 * runs ×10, and it is never a time of day or a value anything is folded from.
 */
function uiNow(): number {
  return performance.now();
}

const SAVED_SLOT = 76;

const section = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    minHeight: TOUCH_TARGET,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colours.hair,
  },
  tall: { minHeight: 60 },
  pressed: { opacity: 0.6 },
  twistySlot: { width: 28, height: 24, alignItems: 'flex-start', justifyContent: 'center', flexShrink: 0 },
  turned: { transform: [{ rotate: '90deg' }] },
  words: { flex: 1, minWidth: 0 },
  title: {
    color: colours.ink,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    includeFontPadding: false,
  },
  dangerTitle: { color: colours.danger },
  summary: { color: colours.inkMuted, fontSize: 14, includeFontPadding: false, marginTop: 3 },
  savedSlot: { width: SAVED_SLOT, flexShrink: 0, alignItems: 'flex-end', justifyContent: 'center' },
  savedInner: { flexDirection: 'row', alignItems: 'center' },
  savedText: { color: colours.saved, fontSize: 14, fontWeight: '600', includeFontPadding: false, marginLeft: 3 },
  body: { alignSelf: 'stretch', paddingTop: 4, paddingBottom: 10 },
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', minHeight: 24 },
  dotSlot: { width: 16, alignItems: 'center', flexShrink: 0 },
  statusText: { color: colours.inkMuted, fontSize: 14, includeFontPadding: false },
  statusDirty: { color: colours.saved },
});
