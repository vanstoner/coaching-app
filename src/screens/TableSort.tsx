/**
 * Sortable headings for the analytics tables — #208.
 *
 * The rules live in `src/app/tableSort.ts`; this is the heading a coach taps
 * and the memory of what they chose. The chosen sort is kept per table on
 * this phone (AC6) under one key in the device store, beside nothing in the
 * record. Forget everything removes it.
 *
 * The arrow is drawn as a box, not a character: the app's font (Barlow) has
 * no ▼ or ▲, and a glyph from a fallback font measures one way and draws
 * another — the clipped-last-glyph trap (theme.ts). The arrow's space is kept
 * whether it shows or not, so a heading never moves when tapped.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from './Text';

import type { KeyValueStore } from '../app/persistence';
import {
  TABLE_SORT_KEY,
  nextSort,
  parseTableSorts,
  serialiseTableSorts,
  sortFor,
  sortWords,
  type TableId,
  type TableSort,
  type TableSorts,
} from '../app/tableSort';
import { colours, TOUCH_TARGET } from './theme';

interface SortMemory {
  sorts: TableSorts;
  choose: (id: TableId, sort: TableSort) => void;
}

const Memory = createContext<SortMemory | null>(null);

/**
 * Holds every table's chosen sort and writes it to this phone's store when it
 * changes. `remember={false}` starts from the defaults without reading, for a
 * phone just cleared by Forget everything.
 */
export function TableSortProvider({
  store,
  remember = true,
  children,
}: {
  store: KeyValueStore;
  remember?: boolean;
  children: ReactNode;
}) {
  const [sorts, setSorts] = useState<TableSorts>({});
  useEffect(() => {
    if (!remember) return;
    let cancelled = false;
    store
      .getItem(TABLE_SORT_KEY)
      .then((raw) => {
        // A choice made before the read finished wins over what was stored.
        if (!cancelled) setSorts((now) => ({ ...parseTableSorts(raw), ...now }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [store, remember]);
  const choose = useCallback(
    (id: TableId, sort: TableSort) => {
      setSorts((now) => {
        const next = { ...now, [id]: sort };
        // A view choice: losing it costs a tap, so a failed write is let go.
        void store.setItem(TABLE_SORT_KEY, serialiseTableSorts(next)).catch(() => undefined);
        return next;
      });
    },
    [store]
  );
  const value = useMemo(() => ({ sorts, choose }), [sorts, choose]);
  return <Memory.Provider value={value}>{children}</Memory.Provider>;
}

/**
 * A table's sort and what a tap on a heading does (AC1). Without a provider
 * (a screen drawn on its own) the choice lasts while the screen is open.
 */
export function useTableSort(
  id: TableId,
  extra?: (key: string) => boolean
): { sort: TableSort; onSort: (key: string) => void } {
  const memory = useContext(Memory);
  const [own, setOwn] = useState<TableSorts>({});
  const sorts = memory ? memory.sorts : own;
  const sort = sortFor(sorts, id, extra);
  const onSort = (key: string) => {
    const next = nextSort(sort, key);
    if (memory) memory.choose(id, next);
    else setOwn({ ...own, [id]: next });
  };
  return { sort, onSort };
}

/**
 * One column heading. `style` gives it the same width (or flex) as the
 * column under it; `align` lines its words up with the figures.
 */
export function SortHeading({
  label,
  column,
  sort,
  onSort,
  align = 'right',
  style,
  children,
}: {
  label: string;
  column: string;
  sort: TableSort;
  onSort: (key: string) => void;
  align?: 'left' | 'center' | 'right';
  style?: StyleProp<ViewStyle>;
  /** Drawn in place of the label, as the season grid's match columns do. */
  children?: ReactNode;
}) {
  const active = sort.key === column;
  const edge = align === 'left' ? 'flex-start' : align === 'center' ? 'center' : 'flex-end';
  return (
    <Pressable
      onPress={() => onSort(column)}
      style={({ pressed }) => [local.hit, { alignItems: edge }, style, pressed && local.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={
        active ? `${label}, sorted ${sortWords(sort)}. Tap to reverse.` : `${label}. Tap to sort by it.`
      }
    >
      {children ?? (
        <Text style={[local.label, { textAlign: align }, active && local.labelActive]} numberOfLines={1}>
          {label}
        </Text>
      )}
      <View style={local.arrowSlot}>
        {active && <View style={sort.dir === 'desc' ? local.down : local.up} />}
      </View>
    </Pressable>
  );
}

const ARROW = 5;

const local = StyleSheet.create({
  hit: { minHeight: TOUCH_TARGET, justifyContent: 'center', flexShrink: 0 },
  pressed: { opacity: 0.6 },
  // Colour only between states: a weight change re-measures and clips (theme.ts).
  label: {
    alignSelf: 'stretch',
    color: colours.inkMuted,
    fontSize: 12,
    includeFontPadding: false,
    flexShrink: 0,
  },
  labelActive: { color: colours.ink },
  arrowSlot: { height: ARROW + 2, marginTop: 3, justifyContent: 'center' },
  // ▼ and ▲ as boxes: two clear sides and a coloured one.
  down: {
    width: 0,
    height: 0,
    borderLeftWidth: ARROW,
    borderRightWidth: ARROW,
    borderTopWidth: ARROW + 1,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: colours.ink,
  },
  up: {
    width: 0,
    height: 0,
    borderLeftWidth: ARROW,
    borderRightWidth: ARROW,
    borderBottomWidth: ARROW + 1,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: colours.ink,
  },
});
