/**
 * First open — #218. What a new coach sees, drawn from the rules in
 * `src/app/gettingStarted.ts`, as the approved prototype draws it:
 *
 * - Getting started on Home: one line with a progress bar, its steps in a
 *   sheet (#228, superseding AC4's full card on a fresh Home);
 * - the dashed box an empty screen gets where nothing has happened yet (AC3);
 * - the yellow line while the made-up team is on the phone (Q6);
 * - the message at the foot of the screen, with Undo after closing the card.
 *
 * The tick and the close are icons, not ✓ and ×: the app's font may not
 * carry them, and a glyph from a fallback font measures one way and draws
 * another (theme.ts). Nothing here changes a font weight between states.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ActionSheet } from './Sheet';
import { Text } from './Text';

import {
  CARD_SUBTITLE,
  CARD_TITLE,
  MADE_UP_BANNER,
  PURPOSE_LINE,
  TRY_HINT,
  TRY_MADE_UP_TEAM,
  progressLabel,
  stepsDone,
  type StartStep,
  type StepKey,
} from '../app/gettingStarted';
import { colours, screen, TOUCH_TARGET } from './theme';

/** Dee's one-line Getting started: dark ink on a pale green, as in her prototype. */
const LINE_BG = '#e9f5ef';
const LINE_INK = '#14231d';
const LINE_TRACK = '#cfe3d8';

/**
 * #228 (Dee's clutter fix 2, PO ruling `both`, 23 Oct): Getting started on
 * Home is one line with a progress bar, "Getting started ▬▬ 1 of 3 ›". A tap
 * opens the purpose line and the three steps in a sheet; the close icon still
 * closes it (Q4). This supersedes #218 AC4's full card on a fresh Home.
 */
export function GettingStartedLine({
  steps,
  onStep,
  onClose,
  onTry,
}: {
  steps: readonly StartStep[];
  onStep: (key: StepKey) => void;
  onClose: () => void;
  /** Q5: only while the squad is empty; null hides it. */
  onTry: (() => void) | null;
}) {
  const [open, setOpen] = useState(false);
  const done = stepsDone(steps);
  return (
    <>
      <View style={local.line}>
        <Pressable
          onPress={() => setOpen(true)}
          style={({ pressed }) => [local.lineHit, pressed && screen.buttonPressed]}
          accessibilityRole="button"
          accessibilityLabel={`${CARD_TITLE}, ${progressLabel(steps)} steps done. Open the steps.`}
        >
          <Text style={local.lineTitle} numberOfLines={1}>
            {CARD_TITLE}
          </Text>
          <View style={local.bar}>
            <View style={[local.barFill, { flex: done }]} />
            <View style={{ flex: steps.length - done }} />
          </View>
          <Text style={local.lineCount} numberOfLines={1}>
            {progressLabel(steps)} ›
          </Text>
        </Pressable>
        <Pressable
          onPress={onClose}
          style={local.lineClose}
          accessibilityRole="button"
          accessibilityLabel="Close Getting started"
        >
          <MaterialCommunityIcons name="close" size={20} color={LINE_INK} />
        </Pressable>
      </View>
      <ActionSheet visible={open} title={CARD_TITLE} onClose={() => setOpen(false)} closeLabel="Close">
        <Text style={local.purpose}>{PURPOSE_LINE}</Text>
        <Text style={local.sub}>{CARD_SUBTITLE}</Text>
        {steps.map((s) => (
          <Pressable
            key={s.key}
            onPress={() => {
              setOpen(false);
              onStep(s.key);
            }}
            style={({ pressed }) => [local.step, pressed && screen.buttonPressed]}
            accessibilityRole="button"
            accessibilityLabel={`${s.name}, ${s.done ? 'done' : 'not done yet'}. ${s.detail}`}
          >
            <View style={[local.tick, s.done && local.tickDone]}>
              {s.done && <MaterialCommunityIcons name="check-bold" size={16} color={colours.ink} />}
            </View>
            <View style={local.stepText}>
              {/* Colour only when done: a weight change re-measures and clips. */}
              <Text style={[local.stepName, s.done && local.stepNameDone]}>{s.name}</Text>
              <Text style={local.stepDetail}>{s.detail}</Text>
            </View>
            <Text style={local.chevron}>›</Text>
          </Pressable>
        ))}
        {onTry && (
          <>
            <Pressable
              onPress={() => {
                setOpen(false);
                onTry();
              }}
              style={({ pressed }) => [screen.buttonQuiet, local.smallButton, pressed && screen.buttonPressed]}
            >
              <Text style={local.smallButtonLabel}>{TRY_MADE_UP_TEAM}</Text>
            </Pressable>
            <Text style={screen.hint}>{TRY_HINT}</Text>
          </>
        )}
      </ActionSheet>
    </>
  );
}

/** One plain sentence and, where there is one, the button for what to do next (AC3). */
export function EmptyState({
  text,
  action,
  style,
}: {
  text: string;
  action?: { label: string; onPress: () => void } | null;
  style?: object;
}) {
  return (
    <View style={[local.empty, style]}>
      <Text style={local.emptyText}>{text}</Text>
      {action && (
        <Pressable
          onPress={action.onPress}
          style={({ pressed }) => [screen.buttonQuiet, local.smallButton, pressed && screen.buttonPressed]}
        >
          <Text style={local.smallButtonLabel}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Q6: while the made-up team is on the phone, and the way out of it. */
export function MadeUpBanner({ onSettings }: { onSettings: () => void }) {
  return (
    <View style={local.banner}>
      <Text style={local.bannerText}>{MADE_UP_BANNER}</Text>
      <Pressable onPress={onSettings} style={local.bannerLinkHit} accessibilityRole="button">
        <Text style={local.bannerLink}>Settings</Text>
      </Pressable>
    </View>
  );
}

/** A short message at the foot of the screen, with Undo when there is one. */
export function Toast({ text, onUndo }: { text: string; onUndo?: (() => void) | null }) {
  return (
    <View style={local.toast} accessibilityLiveRegion="polite" pointerEvents="box-none">
      <Text style={local.toastText}>{text}</Text>
      {onUndo && (
        <Pressable onPress={onUndo} style={local.toastUndo} accessibilityRole="button">
          <Text style={local.toastUndoLabel}>Undo</Text>
        </Pressable>
      )}
    </View>
  );
}

const local = StyleSheet.create({
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: LINE_BG,
    borderRadius: 12,
    marginTop: 8,
    minHeight: TOUCH_TARGET,
  },
  lineHit: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: TOUCH_TARGET, paddingLeft: 12 },
  lineTitle: { color: LINE_INK, fontSize: 15, fontWeight: '700', includeFontPadding: false, flexShrink: 0 },
  bar: {
    flex: 1,
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: LINE_TRACK,
    marginHorizontal: 10,
  },
  barFill: { backgroundColor: colours.accent },
  // A fixed box, never sized to its text (the clipped-glyph trap).
  lineCount: { width: 64, textAlign: 'right', color: LINE_INK, fontSize: 15, includeFontPadding: false, flexShrink: 0 },
  lineClose: { width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  purpose: {
    alignSelf: 'stretch',
    color: colours.ink,
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 25,
    includeFontPadding: false,
    marginBottom: 4,
  },
  sub: { alignSelf: 'stretch', color: colours.inkMuted, fontSize: 14, includeFontPadding: false, marginBottom: 8 },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    minHeight: 56,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#164f3c',
  },
  tick: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colours.inkFaint,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginRight: 12,
  },
  tickDone: { backgroundColor: colours.accent, borderColor: colours.accent },
  stepText: { flex: 1, minWidth: 0 },
  stepName: { alignSelf: 'stretch', color: colours.ink, fontSize: 17, fontWeight: '600', includeFontPadding: false },
  stepNameDone: { color: colours.inkMuted },
  stepDetail: { alignSelf: 'stretch', color: colours.inkMuted, fontSize: 13, includeFontPadding: false, marginTop: 2 },
  chevron: { color: colours.inkMuted, fontSize: 22, includeFontPadding: false, flexShrink: 0, marginLeft: 8 },
  smallButton: { marginTop: 12, paddingVertical: 12 },
  smallButtonLabel: { color: colours.ink, fontSize: 16, fontWeight: '600', includeFontPadding: false },
  empty: {
    alignSelf: 'stretch',
    borderColor: colours.line,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 14,
    marginTop: 14,
  },
  emptyText: {
    alignSelf: 'stretch',
    textAlign: 'center',
    color: colours.inkMuted,
    fontSize: 15,
    lineHeight: 21,
    includeFontPadding: false,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    borderColor: colours.warn,
    borderWidth: 1,
    borderRadius: 10,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 4,
    marginTop: 6,
    marginBottom: 4,
  },
  bannerText: { flex: 1, color: colours.warn, fontSize: 14, lineHeight: 18, includeFontPadding: false },
  bannerLinkHit: { minHeight: TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 8, flexShrink: 0 },
  bannerLink: { color: colours.warn, fontSize: 14, textDecorationLine: 'underline', includeFontPadding: false },
  toast: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e9f5ef',
    borderRadius: 10,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    minHeight: TOUCH_TARGET + 12,
    elevation: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  toastText: { flex: 1, color: colours.pitch, fontSize: 15, includeFontPadding: false },
  toastUndo: { minHeight: TOUCH_TARGET, minWidth: TOUCH_TARGET + 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  toastUndoLabel: {
    color: colours.pitch,
    fontSize: 15,
    fontWeight: '700',
    textDecorationLine: 'underline',
    includeFontPadding: false,
  },
});
