/**
 * The plan image, drawn — #165.
 *
 * Laid out off-screen at the PNG's own size (1200 px for 2×2, 1600 px for
 * four in a row), captured once, shared, and unmounted. Every word on it comes
 * from `src/app/planImage.ts`; this file only places them, in the look Rob
 * approved on the mock: light paper, dark ink, green mini pitches, gold
 * position names, white name pills and a gold one for the keeper.
 *
 * Sizes are written in IMAGE pixels and divided by the phone's pixel ratio,
 * so the captured bitmap comes out at the target width whatever the phone,
 * and the image looks the same from every phone. Font scaling is off: a
 * coach's large-text setting must not reflow a picture for parents.
 */

import { forwardRef } from 'react';
import { PixelRatio, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Text } from './Text';

import { PLAN_IMAGE_WIDTH, type PlanImage, type PlanImageLayout } from '../app/planImage';

const PAPER = '#f7f4ea';
const INK = '#13261f';
const INK_SOFT = '#44584f';
const INK_FAINT = '#6b7d75';
const PITCH = '#2f7a52';
const POSITION = '#ffe7a3';
const GOLD = '#ffd166';
const PILL = '#ffffff';
const LINE = 'rgba(255,255,255,0.35)';

/** Image pixels, per layout. The grid's pitches are wider, so its type is larger. */
const SIZES = {
  grid: { pad: 40, gap: 32, title: 60, details: 30, period: 36, position: 26, name: 40, sub: 34, bench: 30, footer: 26 },
  row: { pad: 36, gap: 28, title: 60, details: 30, period: 32, position: 20, name: 30, sub: 28, bench: 24, footer: 24 },
} as const;

/** A slot's width as a fraction of the pitch: three in a row at 0.18 / 0.5 / 0.82 never touch. */
const SLOT_WIDTH = 0.3;

export const PlanImageView = forwardRef<View, {
  image: PlanImage;
  layout: PlanImageLayout;
  onLayout?: (e: LayoutChangeEvent) => void;
}>(function PlanImageView({ image, layout, onLayout }, ref) {
  const k = 1 / PixelRatio.get();
  const px = (n: number) => n * k;
  const s = SIZES[layout];
  const width = PLAN_IMAGE_WIDTH[layout];
  // Four in a row is for quarters; halves sit side by side either way.
  const cols = layout === 'row' ? image.periods.length : Math.min(2, image.periods.length);
  const colWidth = (width - 2 * s.pad - s.gap * (cols - 1)) / cols;
  const pitchHeight = (colWidth * 4) / 3;

  const t = (size: number, colour: string, weight: '400' | '600' | '700' = '400') => ({
    fontSize: px(size),
    lineHeight: px(size * 1.2),
    color: colour,
    fontWeight: weight,
  });

  return (
    <View
      ref={ref}
      collapsable={false}
      onLayout={onLayout}
      style={[local.paper, { width: px(width), padding: px(s.pad) }]}
    >
      <Text allowFontScaling={false} style={[local.centre, t(s.title, INK, '700')]}>
        {image.title}
      </Text>
      <Text allowFontScaling={false} style={[local.centre, t(s.details, INK_SOFT), { marginTop: px(6) }]}>
        {image.details}
      </Text>

      <View style={[local.periods, { marginTop: px(s.gap), rowGap: px(s.gap), columnGap: px(s.gap) }]}>
        {image.periods.map((period) => (
          <View key={period.title} style={{ width: px(colWidth) }}>
            <Text allowFontScaling={false} style={[local.upper, t(s.period, INK, '700'), { marginBottom: px(12), letterSpacing: px(2) }]}>
              {period.title}
            </Text>
            <View style={[local.pitch, { height: px(pitchHeight), borderRadius: px(16) }]}>
              <View
                style={[
                  local.box,
                  { height: px(pitchHeight * 0.13), borderWidth: px(3), borderColor: LINE },
                ]}
              />
              {period.slots.map((slot) => (
                <View
                  key={slot.positionId}
                  style={[
                    local.slot,
                    {
                      width: px(colWidth * SLOT_WIDTH),
                      left: px(colWidth * (slot.x - SLOT_WIDTH / 2)),
                      // Centred on the spot: the label and pill together are about this tall.
                      top: px(pitchHeight * slot.y - (s.position * 1.2 + s.name * 1.2 + 16) / 2),
                    },
                  ]}
                >
                  <Text
                    allowFontScaling={false}
                    numberOfLines={1}
                    style={[local.stretch, t(s.position, POSITION, '700'), { marginBottom: px(4) }]}
                  >
                    {slot.label}
                  </Text>
                  <View
                    style={[
                      local.pill,
                      { backgroundColor: slot.keeper ? GOLD : PILL, paddingVertical: px(6) },
                    ]}
                  >
                    <Text
                      allowFontScaling={false}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.6}
                      style={[local.stretch, t(s.name, INK, '700')]}
                    >
                      {slot.firstName ?? '–'}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={{ marginTop: px(12) }}>
              {period.subLines.map((line, i) => (
                <Text key={i} allowFontScaling={false} style={[t(s.sub, INK, '600'), { marginBottom: px(6) }]}>
                  {line}
                </Text>
              ))}
              {period.noSubs && (
                <Text allowFontScaling={false} style={[t(s.sub, INK_FAINT), { marginBottom: px(6) }]}>
                  {period.noSubs}
                </Text>
              )}
              <Text allowFontScaling={false} style={[t(s.bench, INK_SOFT), { marginTop: px(4) }]}>
                {period.bench}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <Text allowFontScaling={false} style={[local.centre, t(s.footer, INK_SOFT), { marginTop: px(s.gap) }]}>
        {image.footer}
      </Text>
    </View>
  );
});

const local = StyleSheet.create({
  paper: { backgroundColor: PAPER },
  centre: { alignSelf: 'stretch', textAlign: 'center', includeFontPadding: false },
  upper: { textTransform: 'uppercase', includeFontPadding: false },
  periods: { flexDirection: 'row', flexWrap: 'wrap' },
  pitch: { backgroundColor: PITCH, overflow: 'hidden' },
  box: { position: 'absolute', left: '30%', right: '30%', bottom: 0, borderBottomWidth: 0 },
  slot: { position: 'absolute', alignItems: 'stretch' },
  stretch: { alignSelf: 'stretch', textAlign: 'center', includeFontPadding: false, flexShrink: 0 },
  pill: { borderRadius: 999, alignSelf: 'stretch' },
});
