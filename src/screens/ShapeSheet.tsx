/**
 * The Shape list sheet — #249 I36 to I41 (Rob, 30 Oct, `approve 2b`; Dee's
 * prototype, shape list B), on the #264 list sheet.
 *
 * The season's size first, under "9-a-side · this season", then an **Other
 * team sizes** action that opens the rest in place, each under its own
 * heading. It opens already expanded when the current shape is another size.
 * Tapping a line picks it and closes; Cancel or a tap outside changes
 * nothing. What it lists is `src/app/shapeList.ts`.
 *
 * `ShapeCost` is the line under the Shape row when the picked shape is
 * another size than the season's (I40): shown, never refused (I41).
 */

import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Text } from './Text';

import { OTHER_SIZES_NOTE, opensExpanded, shapeCostLine, shapeGroups, type SeasonSize, type ShapeGroup } from '../app/shapeList';
import type { ShapeCode } from '../app/shapes';
import { Action, CheckLine, FormSheet, SheetNote } from './controls';
import { colours } from './theme';

export function ShapeSheet({
  visible,
  season,
  value,
  onPick,
  onCancel,
}: {
  visible: boolean;
  season: SeasonSize;
  value: ShapeCode | null;
  onPick: (code: ShapeCode) => void;
  onCancel: () => void;
}) {
  const [more, setMore] = useState(false);
  // I37: each time it opens, expanded when the current shape is another size.
  useEffect(() => {
    if (visible) setMore(opensExpanded(season, value));
    // Only on opening: `season` may be a new object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const { first, others } = shapeGroups(season, value);
  const lines = (g: ShapeGroup) =>
    g.items.map((it) => (
      <CheckLine
        key={it.value}
        label={it.label}
        detail={it.detail}
        checked={it.value === value}
        onPress={() => onPick(it.value)}
      />
    ));
  const heading = (g: ShapeGroup) => (
    <Text key={`h${g.side}`} style={local.heading} accessibilityRole="header">
      {g.heading}
    </Text>
  );
  return (
    <FormSheet visible={visible} title="Shape" onCancel={onCancel}>
      {heading(first)}
      {lines(first)}
      {more ? (
        <>
          <SheetNote>{OTHER_SIZES_NOTE}</SheetNote>
          {others.map((g) => [heading(g), ...lines(g)])}
        </>
      ) : (
        <Action label="Other team sizes" onPress={() => setMore(true)} />
      )}
    </FormSheet>
  );
}

/** I40: what a shape of another size costs, under the Shape row, before saving. */
export function ShapeCost({ season, shape }: { season: SeasonSize; shape: ShapeCode | null }) {
  const line = shapeCostLine(season, shape);
  if (line === null) return null;
  return <Text style={local.cost}>{line}</Text>;
}

const local = StyleSheet.create({
  heading: {
    alignSelf: 'stretch',
    includeFontPadding: false,
    color: colours.inkMuted,
    fontSize: 13,
    paddingTop: 14,
    paddingBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  cost: {
    alignSelf: 'stretch',
    color: colours.warn,
    fontSize: 13,
    includeFontPadding: false,
    marginVertical: 4,
  },
});
