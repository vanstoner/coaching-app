/**
 * The pitch: positions fixed on screen, players as pills — #83.
 *
 * > *"make the positions a fixture on the screen and the boxes movable pills
 * > (e.g. with UX handles so you can drag and drop them)"* — PO, 2026-10-03
 *
 * One component for the plan, the lineup and the live clock. It draws and it
 * reports; it decides nothing. `onMove` says "this player was dropped on that
 * target" and the screen decides what that means: edit a sheet before kick-off,
 * a substitution or a position swap during play.
 *
 * **Every move works without dragging** (PO ruling 11): tap one pill, then a
 * position or another pill. Dragging with a cold hand fails, and a drag is a
 * shortcut, never the only way.
 *
 * **The floating copy is cleared on every way a drag can end** — release,
 * cancel, a system gesture taking the touch, the screen going away. The
 * prototype left copies stranded on the pitch when it was not (#83, PO
 * screenshot), and that is the bug this file is written around.
 *
 * Drag uses React Native's own PanResponder: no dependency. The geometry is
 * `src/app/pitchLayout.ts`, tested in Node.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { Text } from './Text';

import type { Format, UUID } from '../types/index';
import {
  PILL_HEIGHT,
  PITCH_ASPECT,
  dropTargetAt,
  fitPitchHeight,
  pillWidthFor,
  slotBox,
  slotSpots,
  type DropTarget,
  type Rect,
} from '../app/pitchLayout';
import type { Sheet } from '../app/teamSheet';
import { colours } from './theme';

export interface PitchViewProps {
  format: Format;
  sheet: Sheet;
  bench: UUID[];
  nameOf: (id: UUID) => string;
  /** The small line under a name: minutes, usually. */
  detailOf?: (id: UUID) => string;
  /** Children the coach placed by hand on the team sheet: a green dot (#277). */
  markedIds?: ReadonlySet<UUID>;
  /** Bench children who come on at the sub: a gold outline (#277). */
  goldIds?: ReadonlySet<UUID>;
  /** The pill picked by a first tap, waiting for where it goes. */
  selected: UUID | null;
  onSelect: (id: UUID | null) => void;
  /** A player dropped (or tapped across) onto a target. */
  onMove: (playerId: UUID, target: DropTarget) => void;
  /**
   * When set, a tap on a pill with nothing selected calls this instead of
   * selecting it — the clock's Goal / Save / Move sheet.
   */
  onTapPlayer?: (id: UUID) => void;
  /** Tells the screen to stop its ScrollView fighting the drag. */
  onDragging?: (dragging: boolean) => void;
  /** Hide the bench strip (the plan's subs live elsewhere). */
  hideBench?: boolean;
  /**
   * When set, a tap on a gold position name renames it (#166). The Plan and
   * the lineup pass it; the live clock never does (ruling Q1).
   */
  onRenamePosition?: (positionId: UUID) => void;
  /**
   * #276: room for the pitch in the scrolling area, so a small phone shows the
   * whole pitch and the bench at once (`fitPitchHeight`). Omitted: the pitch's
   * natural shape, as before.
   */
  room?: number | null;
  /**
   * #276: where the finger is while a player is dragged (window y), and null
   * when the drag ends, so the screen can scroll near its edges.
   */
  onDragAt?: (pageY: number | null) => void;
  /**
   * #276: the containing ScrollView's offset. A drag that scrolls the screen
   * moves this component under the finger; the drop is worked out against
   * the offset at the drag's start, synchronously, never a stale measure.
   */
  scrollOffset?: number;
}

export function PitchView(props: PitchViewProps) {
  const { format, sheet, bench, nameOf, detailOf, selected, onSelect, onMove } = props;
  const spots = useMemo(() => slotSpots(format), [format]);
  const keeperPosition = format.positions.find((p) => p.kind === 'goalkeeper')?.id;

  // Layout, in this component's own coordinates.
  const [pitch, setPitch] = useState<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  const [rootWidth, setRootWidth] = useState(0);

  // The responders below are made ONCE per player and must outlive renders: a
  // PanResponder recreated mid-gesture loses the gesture. They read whatever
  // is current through these refs instead of closing over one render's props.
  const latest = useRef({ props, pitch });
  latest.current = { props, pitch };
  const benchRect = useRef<Rect | null>(null);
  const benchPills = useRef(new Map<UUID, Rect>());
  const rootPage = useRef({ x: 0, y: 0 });
  const root = useRef<View>(null);
  /** The ScrollView's offset when rootPage was last measured (#276). */
  const offsetAtMeasure = useRef(0);

  // The drag in progress: who, and where the finger is (window coordinates).
  const [drag, setDrag] = useState<{ id: UUID; pageX: number; pageY: number } | null>(null);
  const dragRef = useRef<{ id: UUID } | null>(null);

  const endDrag = () => {
    dragRef.current = null;
    setDrag(null);
    latest.current.props.onDragging?.(false);
    latest.current.props.onDragAt?.(null);
  };
  // The screen going away mid-drag must not leave anything behind.
  useEffect(() => () => props.onDragging?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const measureRoot = () => {
    const offset = latest.current.props.scrollOffset ?? 0;
    root.current?.measureInWindow((x, y) => {
      rootPage.current = { x, y };
      offsetAtMeasure.current = offset;
    });
  };

  /**
   * A window point in this component's coordinates. If the screen has
   * scrolled since the measure (#276's edge scrolling), this component has
   * moved up by that much, so the point is that much further down it.
   */
  const toLocal = (pageX: number, pageY: number) => ({
    x: pageX - rootPage.current.x,
    y: pageY - rootPage.current.y + ((latest.current.props.scrollOffset ?? 0) - offsetAtMeasure.current),
  });
  const local = (e: GestureResponderEvent) => toLocal(e.nativeEvent.pageX, e.nativeEvent.pageY);

  const targetAt = (x: number, y: number) =>
    dropTargetAt(
      x,
      y,
      latest.current.pitch,
      slotSpots(latest.current.props.format),
      // Pill rects are kept relative to the bench and offset here, so the
      // order the two onLayout calls arrive in does not matter. Only players
      // still on the bench are candidates.
      [...benchPills.current.entries()]
        .filter(([playerId]) => latest.current.props.bench.includes(playerId))
        .map(([playerId, r]) => ({
          playerId,
          rect: { ...r, x: r.x + (benchRect.current?.x ?? 0), y: r.y + (benchRect.current?.y ?? 0) },
        })),
      latest.current.props.hideBench ? null : benchRect.current
    );

  /** A tap, or a second tap completing a move. */
  const tap = (id: UUID) => {
    const { selected, sheet, onSelect, onMove, onTapPlayer } = latest.current.props;
    if (selected === null) {
      if (onTapPlayer) onTapPlayer(id);
      else onSelect(id);
      return;
    }
    if (selected === id) {
      onSelect(null);
      return;
    }
    const slot = (Object.keys(sheet) as UUID[]).find((p) => sheet[p] === id);
    onMove(selected, slot ? { kind: 'slot', positionId: slot } : { kind: 'player', playerId: id });
    onSelect(null);
  };

  const responders = useRef(new Map<UUID, ReturnType<typeof PanResponder.create>>());
  /** One responder per player, created once and kept across renders. */
  const responderFor = (id: UUID) => {
    const existing = responders.current.get(id);
    if (existing) return existing;
    const made = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // Hold the touch once it is ours: a ScrollView must not steal a drag.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        measureRoot();
      },
      onPanResponderMove: (e, g) => {
        if (!dragRef.current && Math.hypot(g.dx, g.dy) > 8) {
          dragRef.current = { id };
          latest.current.props.onDragging?.(true);
        }
        if (dragRef.current) {
          setDrag({ id, pageX: e.nativeEvent.pageX, pageY: e.nativeEvent.pageY });
          latest.current.props.onDragAt?.(e.nativeEvent.pageY);
        }
      },
      onPanResponderRelease: (e) => {
        if (!dragRef.current) {
          endDrag();
          tap(id);
          return;
        }
        const p = local(e);
        const target = targetAt(p.x, p.y);
        endDrag();
        if (target) latest.current.props.onMove(id, target);
      },
      // A system gesture took the touch: drop nothing, leave nothing behind.
      onPanResponderTerminate: () => endDrag(),
    });
    responders.current.set(id, made);
    return made;
  };

  // #249 F25: 72dp for every pill at 11-a-side, so a row of four fits a phone.
  const pillWidth = pillWidthFor(format.onFieldCount, pitch.width);

  // A render FUNCTION, not a component: a component defined in here would be a
  // new type every render, remounting the pill under the finger mid-drag.
  const pill = (id: UUID, keeper: boolean, onBench: boolean) => {
    const dragging = drag?.id === id;
    return (
      <View
        key={id}
        {...responderFor(id).panHandlers}
        accessibilityRole="button"
        accessibilityLabel={`${nameOf(id)}${keeper ? ', in goal' : ''}`}
        style={[
          s.pill,
          { width: onBench ? undefined : pillWidth },
          onBench && s.benchPill,
          keeper && s.keeperPill,
          onBench && props.goldIds?.has(id) && s.goldPill,
          selected === id && s.selectedPill,
          dragging && s.dimmed,
        ]}
      >
        {/* One line, ending in "…" when too long, never clipped mid-letter (#249 F29).
            #277 (Rob, 6 Nov): a long name shrinks a little first, to 3/4 size. */}
        <Text style={[s.name, onBench && s.benchName]} numberOfLines={1} ellipsizeMode="tail" adjustsFontSizeToFit minimumFontScale={0.75}>
          {nameOf(id)}
        </Text>
        {props.markedIds?.has(id) && <View style={s.markDot} accessibilityLabel="placed by you" />}
        {detailOf && (
          <Text style={[s.detail, onBench && s.benchDetail]} numberOfLines={1}>
            {detailOf(id)}
          </Text>
        )}
      </View>
    );
  };

  return (
    <View
      ref={root}
      onLayout={(e) => {
        setRootWidth(e.nativeEvent.layout.width);
        measureRoot();
      }}
      style={s.root}
    >
      <View
        style={
          // #276: sized to the room on a small phone; the natural shape until measured.
          // Two separate styles, never the shaped one with its ratio cleared:
          // Android kept the ratio, so a shorter pitch came out narrower (Rob,
          // 7 Nov, on the team talk's Lineup).
          props.room !== undefined && rootWidth > 0
            ? [s.pitchFrame, { width: rootWidth, height: fitPitchHeight(rootWidth, props.room) }]
            : s.pitch
        }
        onLayout={(e: LayoutChangeEvent) => setPitch(e.nativeEvent.layout)}
      >
        <View style={s.halfway} />
        <View style={s.box} />
        <Text style={s.attacking}>Attacking this way ↑</Text>
        {pitch.width > 0 &&
          spots.map((spot) => {
            const who = sheet[spot.positionId] ?? null;
            const box = slotBox(spot, pitch.width, pitch.height, pillWidth);
            return (
              <View
                key={spot.positionId}
                style={[s.slot, { width: box.width, left: box.x, top: box.y }]}
              >
                {props.onRenamePosition ? (
                  <Pressable
                    onPress={() => props.onRenamePosition?.(spot.positionId)}
                    accessibilityRole="button"
                    accessibilityLabel={`Rename ${spot.label}`}
                    // 13dp of text plus 32 of slop: a full TOUCH_TARGET, reaching up into the
                    // clear grass above, never down onto the pill.
                    hitSlop={{ top: 28, bottom: 4, left: 4, right: 4 }}
                    style={s.slotLabelHit}
                  >
                    <Text style={[s.slotLabel, s.slotLabelTappable]} numberOfLines={1}>
                      {spot.label}
                    </Text>
                  </Pressable>
                ) : (
                  <Text style={s.slotLabel} numberOfLines={1}>
                    {spot.label}
                  </Text>
                )}
                {who ? (
                  pill(who, spot.positionId === keeperPosition, false)
                ) : (
                  <Text
                    style={[s.empty, { width: pillWidth }, selected && s.emptyReady]}
                    onPress={() => {
                      if (selected) {
                        onMove(selected, { kind: 'slot', positionId: spot.positionId });
                        onSelect(null);
                      }
                    }}
                  >
                    {selected ? 'Put here' : 'empty'}
                  </Text>
                )}
              </View>
            );
          })}
      </View>

      {!props.hideBench && (
        <Text style={s.benchLabel}>Subs bench</Text>
      )}
      {!props.hideBench && (
        <View
          style={s.bench}
          onLayout={(e) => {
            benchRect.current = e.nativeEvent.layout;
          }}
        >
          {bench.length === 0 && <Text style={s.benchEmpty}>Nobody on the subs bench.</Text>}
          {bench.map((id) => (
            <View
              key={id}
              style={s.benchSlot}
              onLayout={(e) => {
                benchPills.current.set(id, e.nativeEvent.layout);
              }}
            >
              {pill(id, false, true)}
            </View>
          ))}
        </View>
      )}
      {/* The plank the subs sit on, and its legs (Rob, 6 Nov). */}
      {!props.hideBench && (
        <View style={s.plank} pointerEvents="none">
          <View style={[s.leg, s.legLeft]} />
          <View style={[s.leg, s.legRight]} />
        </View>
      )}

      {drag && (
        <View
          pointerEvents="none"
          style={[
            s.pill,
            // Its place is worked out on every draw, so it stays under the finger while the screen scrolls.
            s.ghost,
            { width: pillWidth, left: toLocal(drag.pageX, drag.pageY).x - pillWidth / 2, top: toLocal(drag.pageX, drag.pageY).y - PILL_HEIGHT },
          ]}
        >
          <Text style={s.name} numberOfLines={1}>
            {nameOf(drag.id)}
          </Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { alignSelf: 'stretch' },
  pitch: {
    alignSelf: 'stretch',
    aspectRatio: PITCH_ASPECT,
    backgroundColor: '#13573f',
    borderColor: colours.line,
    borderWidth: 2,
    borderRadius: 12,
    overflow: 'hidden',
  },
  /** The same pitch with no ratio: its width and height are given (#276). */
  pitchFrame: {
    backgroundColor: '#13573f',
    borderColor: colours.line,
    borderWidth: 2,
    borderRadius: 12,
    overflow: 'hidden',
  },
  halfway: { position: 'absolute', left: 0, right: 0, top: 0, borderTopWidth: 2, borderTopColor: colours.line },
  box: {
    position: 'absolute',
    left: '26%',
    right: '26%',
    bottom: 0,
    height: '14%',
    borderWidth: 2,
    borderBottomWidth: 0,
    borderColor: colours.line,
  },
  attacking: {
    position: 'absolute',
    top: 4,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: colours.inkFaint,
    fontSize: 11,
    includeFontPadding: false,
  },
  slot: { position: 'absolute', alignItems: 'center' },
  slotLabel: {
    color: colours.warn,
    fontSize: 11,
    fontWeight: '700',
    includeFontPadding: false,
    marginBottom: 2,
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  slotLabelHit: { alignSelf: 'stretch' },
  // An underline only: the same metrics as the plain label (theme.ts).
  slotLabelTappable: { textDecorationLine: 'underline' },
  pill: {
    minHeight: PILL_HEIGHT,
    borderRadius: PILL_HEIGHT / 2,
    backgroundColor: colours.ink,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  keeperPill: { backgroundColor: colours.warn },
  // Colour and outline only: metrics never change between states (theme.ts).
  selectedPill: { borderWidth: 3, borderColor: colours.warn },
  dimmed: { opacity: 0.35 },
  name: {
    color: '#0b3d2e',
    fontSize: 15,
    fontWeight: '700',
    includeFontPadding: false,
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  detail: {
    color: '#3f6b5b',
    fontSize: 11,
    includeFontPadding: false,
    alignSelf: 'stretch',
    textAlign: 'center',
    flexShrink: 0,
  },
  empty: {
    minHeight: PILL_HEIGHT,
    borderRadius: PILL_HEIGHT / 2,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colours.inkFaint,
    color: colours.inkFaint,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 13,
    includeFontPadding: false,
  },
  emptyReady: { borderColor: colours.warn, color: colours.warn },
  bench: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignSelf: 'stretch',
    paddingHorizontal: 2,
    minHeight: PILL_HEIGHT + 8,
  },
  plank: { alignSelf: 'stretch', height: 10, borderRadius: 4, backgroundColor: colours.wood, marginTop: -2, marginBottom: 12 },
  leg: { position: 'absolute', top: 10, width: 8, height: 10, backgroundColor: colours.wood, opacity: 0.75 },
  legLeft: { left: '12%' },
  legRight: { right: '12%' },
  goldPill: { borderColor: colours.warn, borderWidth: 2 },
  markDot: { position: 'absolute', top: 6, right: 10, width: 7, height: 7, borderRadius: 4, backgroundColor: colours.main },
  // Rob, 4 October: "make it clear the subs bench is a subs bench".
  benchLabel: {
    alignSelf: 'stretch',
    includeFontPadding: false,
    color: colours.inkMuted,
    fontSize: 13,
    marginTop: 12,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  benchSlot: { width: '33.33%', padding: 4 },
  benchPill: { backgroundColor: colours.pitchRaised, borderWidth: 1, borderColor: colours.line },
  benchName: { color: colours.ink },
  benchDetail: { color: colours.inkMuted },
  benchEmpty: { color: colours.inkFaint, fontSize: 13, padding: 8, includeFontPadding: false },
  ghost: { position: 'absolute', opacity: 0.9, elevation: 8 },
});
