/**
 * The Tuesday tab bar — PO ruling, 2026-09-20 (#70).
 *
 * > *"But basically tabs is preferred."*
 *
 * Three destinations, one row, no navigator. **No React Navigation**: the app
 * already has a step machine that works, and a navigator would add a
 * dependency, a native linking surface and a second source of truth about
 * where the user is — for three tabs. Which tab is showing is decided in
 * `src/app/tabs.ts`, where it is testable in Node.
 *
 * Drawn on Tuesday screens only. The Saturday clock is full-screen; see the
 * note in `tabs.ts` for why.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TABS, type Tab } from '../app/tabs';
import { colours, TOUCH_TARGET } from './theme';

export function TabBar({
  active,
  onSelect,
}: {
  active: Tab;
  onSelect: (tab: Tab) => void;
}) {
  return (
    <View style={local.bar}>
      {TABS.map((spec) => {
        const on = spec.tab === active;
        return (
          <Pressable
            key={spec.tab}
            onPress={() => onSelect(spec.tab)}
            style={({ pressed }) => [local.tab, on && local.tabOn, pressed && local.pressed]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            {/*
              Colour changes on selection; metrics never do. A bold active tab
              is the same late Android re-measure that clipped the last glyph
              off the choice boxes three times.
            */}
            <Text style={[local.label, on && local.labelOn]} numberOfLines={1}>
              {spec.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const local = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    borderTopWidth: 1,
    borderTopColor: colours.line,
    backgroundColor: colours.pitchRaised,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // Comfortably over the 44dp floor: this is the control a coach hits
    // one-handed, and it is at the bottom edge of the screen.
    minHeight: TOUCH_TARGET + 12,
    paddingVertical: 10,
  },
  tabOn: { backgroundColor: colours.accent },
  pressed: { opacity: 0.7 },
  label: {
    color: colours.inkMuted,
    fontSize: 15,
    fontWeight: '600',
    includeFontPadding: false,
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  labelOn: { color: colours.ink },
});
