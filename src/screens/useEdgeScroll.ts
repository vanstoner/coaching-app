/**
 * #276: the scrolling area around a draggable pitch. Every screen that draws
 * PitchView inside a ScrollView uses this, so dragging behaves the same on
 * each: a finger within EDGE_SCROLL_ZONE of the area's top or bottom edge (or
 * past it) scrolls the area, and the pitch is sized to show with one row of
 * the bench where the area allows (`fitPitchHeight`).
 *
 * The area's scrolling is off while a drag is held (so the drag is not
 * stolen); the scroll here is programmatic, and PitchView is told the offset
 * so a drop lands under the finger.
 */

import { useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';
import { EDGE_SCROLL_STEP, edgeScrollDirection } from '../app/pitchLayout';

/** What must show under the pitch with it: the bench label and one row of the bench. */
export const BENCH_ROOM = 110;

/** How often an edge scroll steps, in ms. */
const TICK = 40;

export function useEdgeScroll(dragging: boolean) {
  const scroller = useRef<ScrollView>(null);
  const [scrollY, setScrollY] = useState(0);
  const scrollYRef = useRef(0);
  const viewport = useRef({ top: 0, height: 0, content: 0 });
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const direction = useRef<-1 | 0 | 1>(0);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    direction.current = 0;
  };
  useEffect(() => stop, []);

  /** While dragging: scroll a step every tick the finger stays near an edge. */
  const onDragAt = (pageY: number | null) => {
    const dir = pageY === null ? 0 : edgeScrollDirection(pageY, viewport.current.top, viewport.current.height);
    if (dir === direction.current) return;
    stop();
    if (dir === 0) return;
    direction.current = dir;
    timer.current = setInterval(() => {
      const max = Math.max(0, viewport.current.content - viewport.current.height);
      const next = Math.min(max, Math.max(0, scrollYRef.current + dir * EDGE_SCROLL_STEP));
      if (next === scrollYRef.current) return;
      scrollYRef.current = next;
      setScrollY(next);
      scroller.current?.scrollTo({ y: next, animated: false });
    }, TICK);
  };

  return {
    /** Spread on the ScrollView. */
    scrollProps: {
      ref: scroller,
      scrollEnabled: !dragging,
      scrollEventThrottle: 16,
      onLayout: (e: LayoutChangeEvent) => {
        viewport.current.height = e.nativeEvent.layout.height;
        setViewportHeight(e.nativeEvent.layout.height);
        // The edge zones are in window coordinates, as a finger's pageY is.
        scroller.current?.getNativeScrollRef()?.measureInWindow((_x, y) => {
          viewport.current.top = y;
        });
      },
      onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        scrollYRef.current = e.nativeEvent.contentOffset.y;
        setScrollY(e.nativeEvent.contentOffset.y);
      },
      onContentSizeChange: (_w: number, h: number) => {
        viewport.current.content = h;
      },
    },
    /** Spread on the PitchView inside it. */
    pitchProps: {
      room: viewportHeight === null ? null : viewportHeight - BENCH_ROOM,
      onDragAt,
      scrollOffset: scrollY,
    },
  };
}
