/**
 * Every control glyph — #264 V2.
 *
 * Barlow, the app's face, has no ▾ ▴ ✓ ⌄ (Dee checked its cmap). Drawn as
 * text they fall back to another font, which measures one way and draws
 * another: the #89 clipping trap. So chevrons, ticks, the dot and the warning
 * sign are MaterialCommunityIcons, at a fixed size in a fixed box.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import type { StyleProp, TextStyle } from 'react-native';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function Icon({
  name,
  size = 20,
  color,
  style,
}: {
  name: IconName;
  size?: number;
  color: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <MaterialCommunityIcons
      name={name}
      size={size}
      color={color}
      style={style}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
