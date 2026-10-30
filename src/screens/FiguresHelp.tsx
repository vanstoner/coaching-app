/**
 * The help on the figures — #261 item 2, AC13 to AC16.
 *
 * - **About the figures** (AC13): "How the figures are worked out", one
 *   screen, the first row of Settings › Player minutes (Rob, Q2), with
 *   ‹ Settings at the top left.
 * - **Info tap** (AC15): an info icon beside a figure. It opens a sheet with
 *   that figure's step and `All the steps ›`.
 *
 * Both draw `ABOUT_FIGURES`, the words the spec section holds too (AC14). The
 * help explains; it never shows a child's name or figures (AC16).
 */

import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './Text';

import { ABOUT_FIGURES, type FigureStep } from '../app/aboutFigures';
import { BackLink, FormSheet, Icon, RowNav, TopBar } from './controls';
import { colours, screen, TOUCH_TARGET } from './theme';

type Figure = FigureStep['figure'];

/** What the info tap's accessible name and the sheet's title call each figure. */
export const FIGURE_NAME: Record<Figure, string> = {
  minutes: 'Minutes on the pitch',
  matches: 'Matches that count',
  childMatches: "A child's matches",
  perGame: 'Minutes a game',
  squadAverage: 'The squad average',
  gap: 'The gap a game',
  underOver: 'Under or over the average',
  matchShare: 'The fair share',
  planShare: "The Plan's fair share",
  playerMinutes: 'Player minutes',
};

function Step({ step, n }: { step: FigureStep; n: number }) {
  return (
    <View style={local.step}>
      <Text style={local.stepNo}>{n}.</Text>
      <Text style={local.stepText}>
        <Text style={local.stepTitle}>{step.title}</Text> {step.text}
      </Text>
    </View>
  );
}

function AllSteps() {
  return (
    <>
      {ABOUT_FIGURES.map((s, i) => (
        <Step key={s.figure} step={s} n={i + 1} />
      ))}
    </>
  );
}

/** AC13: the screen. A Modal, so Settings keeps its place underneath. */
export function AboutFiguresScreen({
  visible,
  onBack,
  backLabel = 'Settings',
}: {
  visible: boolean;
  onBack: () => void;
  /** Where Back goes: Settings, or the screen it was opened from. */
  backLabel?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onBack}>
      <View style={[local.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <ScrollView contentContainerStyle={screen.scroll}>
          <TopBar back={<BackLink label={backLabel} onPress={onBack} />} />
          <Text style={screen.title}>How the figures are worked out</Text>
          <Text style={[screen.hint, local.left]}>
            Each step is one column if you check the figures in a spreadsheet.
          </Text>
          <AllSteps />
        </ScrollView>
      </View>
    </Modal>
  );
}

/** The first row of Settings › Player minutes (Q2). */
export function AboutFiguresRow({ backLabel = 'Settings' }: { backLabel?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <RowNav first label="About the figures" detail="How every figure is worked out" onPress={() => setOpen(true)} />
      <AboutFiguresScreen visible={open} onBack={() => setOpen(false)} backLabel={backLabel} />
    </>
  );
}

/** AC15: the sheet an info tap opens: that figure's step, then all of them on request. */
export function FigureSheet({ figure, visible, onClose }: { figure: Figure; visible: boolean; onClose: () => void }) {
  const [all, setAll] = useState(false);
  const n = ABOUT_FIGURES.findIndex((s) => s.figure === figure);
  const close = () => {
    setAll(false);
    onClose();
  };
  return (
    <FormSheet
      visible={visible}
      title={all ? 'How the figures are worked out' : FIGURE_NAME[figure]}
      onCancel={close}
      cancelLabel="Close"
    >
      {all ? (
        <AllSteps />
      ) : (
        <>
          {n >= 0 && <Step step={ABOUT_FIGURES[n]} n={n + 1} />}
          <RowNav first label="All the steps" onPress={() => setAll(true)} />
        </>
      )}
    </FormSheet>
  );
}

/** AC15: the info icon beside a figure, 48 dp to touch. */
export function InfoTap({ figure }: { figure: Figure }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`How ${FIGURE_NAME[figure].toLowerCase()} is worked out`}
        style={({ pressed }) => [local.info, pressed && local.pressed]}
      >
        <Icon name="information-outline" size={20} color={colours.inkMuted} />
      </Pressable>
      <FigureSheet figure={figure} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.pitch },
  left: { alignSelf: 'stretch', textAlign: 'left' },
  step: { flexDirection: 'row', alignSelf: 'stretch', marginTop: 12 },
  stepNo: {
    width: 26,
    color: colours.inkMuted,
    fontSize: 15,
    includeFontPadding: false,
  },
  stepText: {
    flex: 1,
    color: colours.ink,
    fontSize: 15,
    lineHeight: 21,
    includeFontPadding: false,
  },
  stepTitle: { fontWeight: '700' },
  // The icon is 20; the box is the 48 dp target, pulled in so the row keeps its height.
  info: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: -12,
  },
  pressed: { opacity: 0.6 },
});
