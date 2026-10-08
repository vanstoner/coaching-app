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
  PILL_WIDTH_FRACTION,
  dropTargetAt,
  slotSpots,
  type DropTarget,
  type Rect,
} from '../app/pitchLayout';
import type { Sheet } from '../app/teamSheet';
import { colours, TOUCH_TARGET } from './theme';

const PILL_HEIGHT = 46;

export interface PitchViewProps {
  format: Format;
  sheet: Sheet;
  bench: UUID[];
  nameOf: (id: UUID) => string;
  /** The small line under a name: minutes, usually. */
  detailOf?: (id: UUID) => string;
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
}

export function PitchView(props: PitchViewProps) {
  const { format, sheet, bench, nameOf, detailOf, selected, onSelect, onMove, onTapPlayer } = props;
  const spots = useMemo(() => slotSpots(format), [format]);
  const keeperPosition = format.positions.find((p) => p.kind === 'goalkeeper')?.id;

  // Layout, in this component's own coordinates.
  const [pitch, setPitch] = useState<Rect>({ x: 0, y: 0, width: 0, height: 0 });

  // The responders below are made ONCE per player and must outlive renders: a
  // PanResponder recreated mid-gesture loses the gesture. They read whatever
  // is current through these refs instead of closing over one render's props.
  const latest = useRef({ props, pitch });
  latest.current = { props, pitch };
  const benchRect = useRef<Rect | null>(null);
  const benchPills = useRef(new Map<UUID, Rect>());
  const rootPage = useRef({ x: 0, y: 0 });
  const root = useRef<View>(null);

  // The drag in progress: who, and where the floating copy is.
  const [drag, setDrag] = useState<{ id: UUID; x: number; y: number } | null>(null);
  const dragRef = useRef<{ id: UUID } | null>(null);

  const endDrag = () => {
    dragRef.current = null;
    setDrag(null);
    latest.current.props.onDragging?.(false);
  };
  // The screen going away mid-drag must not leave anything behind.
  useEffect(() => () => props.onDragging?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const measureRoot = () =>
    root.current?.measureInWindow((x, y) => {
      rootPage.current = { x, y };
    });

  const local = (e: GestureResponderEvent) => ({
    x: e.nativeEvent.pageX - rootPage.current.x,
    y: e.nativeEvent.pageY - rootPage.current.y,
  });

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
          const p = local(e);
          setDrag({ id, x: p.x, y: p.y });
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

  const pillWidth = Math.max(TOUCH_TARGET * 2, pitch.width * PILL_WIDTH_FRACTION);

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
          selected === id && s.selectedPill,
          dragging && s.dimmed,
        ]}
      >
        <Text style={[s.name, onBench && s.benchName]} numberOfLines={1}>
          {nameOf(id)}
        </Text>
        {detailOf && (
          <Text style={[s.detail, onBench && s.benchDetail]} numberOfLines={1}>
            {detailOf(id)}
          </Text>
        )}
      </View>
    );
  };

  return (
    <View ref={root} onLayout={measureRoot} style={s.root}>
      <View
        style={s.pitch}
        onLayout={(e: LayoutChangeEvent) => setPitch(e.nativeEvent.layout)}
      >
        <View style={s.halfway} />
        <View style={s.box} />
        <Text style={s.attacking}>Attacking this way ↑</Text>
        {pitch.width > 0 &&
          spots.map((spot) => {
            const who = sheet[spot.positionId] ?? null;
            return (
              <View
                key={spot.positionId}
                style={[
                  s.slot,
                  {
                    width: pillWidth,
                    left: spot.x * pitch.width - pillWidth / 2,
                    top: spot.y * pitch.height - PILL_HEIGHT / 2 - 14,
                  },
                ]}
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

      {drag && (
        <View
          pointerEvents="none"
          style={[
            s.pill,
            s.ghost,
            { width: pillWidth, left: drag.x - pillWidth / 2, top: drag.y - PILL_HEIGHT },
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
    aspectRatio: 3 / 3.8,
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
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colours.line,
    borderRadius: 12,
    padding: 6,
    minHeight: PILL_HEIGHT + 14,
  },
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
