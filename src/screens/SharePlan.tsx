/**
 * Share plan (#165), as one piece: the Main button at the foot of a screen,
 * the layout question, and the picture laid out off-screen, captured and
 * shared. The Plan and the Team sheet (#277, Rob 6 Nov: "I make final
 * tweaks and share") both end in it, so the picture is the same from either.
 */

import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Text } from './Text';
import type { Format, Match, Player, UUID } from '../types/index';
import type { MatchPlan } from '../app/matchPlan';
import { PLAN_IMAGE_WIDTH, planImage, shareFirstStep, type PlanImageLayout } from '../app/planImage';
import { currentDistribution } from '../app/distribution';
import { releasePlanImage, sharePlanImage } from '../app/planImageFile';
import { PlanImageView } from './PlanImageView';
import { ActionSheet, SheetButton } from './Sheet';
import { MainButton, MainFoot } from './controls';
import { screen } from './theme';

export function SharePlanFoot({
  match,
  squadName,
  format,
  plan,
  players,
  absent,
  periodCount,
  noun,
  disabled = false,
}: {
  match: Match;
  squadName: string;
  format: Format;
  plan: MatchPlan;
  players: Player[];
  /** Kept off the picture's bench. */
  absent: ReadonlySet<UUID>;
  periodCount: number;
  /** "Quarter" or "Half". */
  noun: string;
  disabled?: boolean;
}) {
  const [shareAsk, setShareAsk] = useState(false);
  const [shareLayout, setShareLayout] = useState<PlanImageLayout | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const imageRef = useRef<View>(null);
  const captured = useRef(false);
  // The capture lives only for the share; let it go when the screen closes.
  useEffect(() => releasePlanImage, []);

  const startShare = (layout: PlanImageLayout) => {
    setShareAsk(false);
    setShareNote(null);
    captured.current = false;
    setShareLayout(layout);
  };
  // Quarters offer 2×2 or four in a row; halves sit side by side either way.
  // The store build alone skips the question (shareFirstStep, #226).
  const askShare = () =>
    shareFirstStep(periodCount, currentDistribution()) === 'ask' ? setShareAsk(true) : startShare('grid');
  const onImageLayout = (e: LayoutChangeEvent) => {
    if (captured.current || !shareLayout) return;
    captured.current = true;
    const { width, height } = e.nativeEvent.layout;
    const target = PLAN_IMAGE_WIDTH[shareLayout];
    // One frame after layout, so the capture sees what was drawn.
    requestAnimationFrame(() => {
      void sharePlanImage(imageRef, target, { width, height }).then((outcome) => {
        setShareLayout(null);
        if (!outcome.ok) setShareNote(outcome.reason);
      });
    });
  };

  return (
    <>
      {/* #264 V26: Share plan is the screen's one job, pinned at the bottom (label kept: SHARE_PLAN). */}
      <MainFoot>
        <MainButton label="Share plan" onPress={askShare} disabled={disabled || shareLayout !== null} />
        <Text style={screen.hint}>
          {shareNote ??
            'One picture of every ' +
              noun.toLowerCase() +
              ' and its subs, for parents. No minutes, and nobody marked absent.'}
        </Text>
      </MainFoot>

      {/* The image being shared (#165): laid out off-screen, captured, gone. */}
      {shareLayout && (
        <View style={local.offscreen} pointerEvents="none">
          <PlanImageView
            ref={imageRef}
            layout={shareLayout}
            onLayout={onImageLayout}
            image={planImage({ match, squadName, format, plan, players, absent })}
          />
        </View>
      )}

      <ActionSheet visible={shareAsk} title="Share plan" onClose={() => setShareAsk(false)}>
        <SheetButton label="2 × 2, best on a phone" strong onPress={() => startShare('grid')} />
        <SheetButton label="Four in a row" onPress={() => startShare('row')} />
      </ActionSheet>
    </>
  );
}

const local = StyleSheet.create({
  offscreen: { position: 'absolute', left: -10000, top: 0 },
});
