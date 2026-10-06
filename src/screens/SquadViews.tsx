/**
 * The squad views — #143, building the design Rob approved on #138.
 *
 * Four tiles above the Squad list, each showing its answer before it is
 * tapped (AC1), and the four views they open: Season grid, Fairness at a
 * glance, Going into Saturday and Positions tried. Every figure arrives
 * folded from the ledger by `src/app/squadViews.ts`; these only draw it
 * (invariant 1). Every list keeps the squad's order and nothing is ranked
 * (AC7). Each view has a way back at its top and its foot.
 *
 * Charts are boxes drawn with Views (ADR-016), from `./Charts`.
 *
 * First names only (invariant 4).
 */

import { useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import type { UUID } from '../types/index';
import { MAIN_KEEPER_NOTE } from '../app/childSeason';
import { KEEPER_LABEL } from '../app/squad';
import { UNIT_LABEL } from '../app/ledger';
import {
  OWED_MIN,
  UNITS,
  VIEW_TITLE,
  axisLabels,
  mainKeeperWords,
  offsetWords,
  owedText,
  squadTiles,
  trendLabel,
  type SquadView,
  type SquadViews,
} from '../app/squadViews';
import { BandDot, ColumnChart, KeyItem, OwedBar, UnitStack, chartColours, unitColours } from './Charts';
import { colours, screen, TOUCH_TARGET } from './theme';

// ============================================================================
// The tiles (AC1)
// ============================================================================

export function SquadTiles({ views, onOpen }: { views: SquadViews; onOpen: (view: SquadView) => void }) {
  const tiles = squadTiles(views);
  const pairs = [tiles.slice(0, 2), tiles.slice(2, 4)];
  return (
    <View style={local.tilesBlock}>
      <Text style={screen.fieldLabel}>Squad views</Text>
      {pairs.map((pair, k) => (
        <View key={k} style={local.tileRow}>
          {pair.map((t) => (
            <Pressable
              key={t.view}
              onPress={() => onOpen(t.view)}
              style={({ pressed }) => [local.tile, pressed && screen.buttonPressed]}
              accessibilityRole="button"
              accessibilityLabel={`${t.title}: ${t.answer}`}
            >
              <View style={local.tileHead}>
                <Text style={local.tileTitle}>{t.title}</Text>
                <Text style={local.chevron}>›</Text>
              </View>
              <Text style={local.tileAnswer}>{t.answer}</Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

// ============================================================================
// The frame every view shares: a way back at the top and at the foot
// ============================================================================

interface ViewProps {
  views: SquadViews;
  onChild: (playerId: UUID) => void;
  onBack: () => void;
}

function ViewFrame({ view, onBack, children }: { view: SquadView; onBack: () => void; children: ReactNode }) {
  return (
    <View style={screen.flex}>
      <ScrollView contentContainerStyle={screen.scroll}>
        <Pressable onPress={onBack} style={screen.linkHit}>
          <Text style={screen.link}>Back to Squad</Text>
        </Pressable>
        <Text style={screen.title}>{VIEW_TITLE[view]}</Text>
        {children}
        <Pressable style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]} onPress={onBack}>
          <Text style={screen.buttonLabel}>Back to Squad</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Empty({ children }: { children: string }) {
  return <Text style={[screen.caption, local.empty]}>{children}</Text>;
}

/** What a tapped cell or column says; tap it again to put it away. */
export function Picked({ text, onClear }: { text: string | null; onClear: () => void }) {
  if (text === null) return null;
  return (
    <Pressable onPress={onClear} style={local.picked} accessibilityLiveRegion="polite">
      <Text style={local.pickedText}>{text}</Text>
    </Pressable>
  );
}

function MainKeeperHint({ names, tail }: { names: string[]; tail: string }) {
  if (names.length === 0) return null;
  return <Text style={screen.hint}>{`${mainKeeperWords(names)}, ${tail}`}</Text>;
}

// ============================================================================
// Season grid (AC2)
// ============================================================================

export function SeasonGridView({ views, onChild, onBack }: ViewProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const scroller = useRef<ScrollView>(null);
  const { matches, grid, fairness } = views;
  if (matches.length === 0) {
    return (
      <ViewFrame view="grid" onBack={onBack}>
        <Empty>{'No matches yet.\nEach match appears here as a column once it is closed.'}</Empty>
      </ViewFrame>
    );
  }
  return (
    <ViewFrame view="grid" onBack={onBack}>
      <Text style={screen.caption}>Minutes on the pitch each match, oldest first</Text>
      <View style={local.grid}>
        {/* The name and "a game" columns stay put while the matches scroll. */}
        <View style={local.gFixed}>
          <View style={[local.gRow, local.gHeadRow]}>
            <Text style={[local.gNameCell, local.gHeadText]} numberOfLines={1}>
              Child
            </Text>
            <Text style={[local.gAvgCell, local.gHeadText]} numberOfLines={1}>
              a game
            </Text>
          </View>
          {grid.map((r) => (
            <View key={r.playerId} style={local.gRow}>
              <Pressable
                onPress={() => onChild(r.playerId)}
                style={[local.gNameCell, local.gNameHit]}
                accessibilityRole="button"
                accessibilityLabel={`${r.name}${r.mainKeeper ? ', Main keeper' : ''}: open their page`}
              >
                <Text style={local.gName} numberOfLines={1}>
                  {r.name}
                </Text>
                {r.mainKeeper && <Text style={local.gkBadge}>GK</Text>}
              </Pressable>
              <Text style={[local.gAvgCell, local.gAvg]} numberOfLines={1}>
                {r.perGame ?? ''}
              </Text>
            </View>
          ))}
        </View>
        <ScrollView
          ref={scroller}
          horizontal
          showsHorizontalScrollIndicator={false}
          // A phone opens on the newest match.
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
        >
          <View style={local.gScrollBody}>
            <View style={[local.gRow, local.gHeadRow]}>
              {matches.map((m) => (
                <Pressable
                  key={m.matchId}
                  onPress={() => setPicked(m.label)}
                  style={local.gCell}
                  accessibilityRole="button"
                  accessibilityLabel={m.label}
                >
                  <Text style={local.gDay} numberOfLines={1}>
                    {m.day}
                  </Text>
                  <Text style={local.gComp} numberOfLines={1}>
                    {m.competitionShort}
                  </Text>
                </Pressable>
              ))}
            </View>
            {grid.map((r) => (
              <View key={r.playerId} style={local.gRow}>
                {r.cells.map((c, j) =>
                  c === null ? (
                    <View
                      key={j}
                      style={local.gCell}
                      accessible
                      accessibilityLabel={`${r.name}, ${matches[j].date}: not there`}
                    />
                  ) : (
                    <Pressable
                      key={j}
                      onPress={() => setPicked(c.text)}
                      style={local.gCell}
                      accessibilityRole="button"
                      accessibilityLabel={c.text}
                    >
                      {c.goal > 0 && <View style={local.gkMark} />}
                      <Text style={local.gTotal} numberOfLines={1}>
                        {c.total}
                      </Text>
                      {c.goal > 0 && (
                        <Text style={local.gGoal} numberOfLines={1}>
                          GK {c.goal}
                        </Text>
                      )}
                    </Pressable>
                  )
                )}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
      <Picked text={picked} onClear={() => setPicked(null)} />
      <View style={local.key}>
        <KeyItem shape="mark" label="GK 12: of which in goal" />
        <Text style={local.keyWords}>Blank: not there</Text>
        <Text style={local.keyWords}>L, C, F, T: league, cup, friendly, tournament</Text>
      </View>
      <Text style={screen.hint}>
        {`"a game" is minutes a game this season.${
          fairness ? ` Squad average ${fairness.average}.` : ''
        }${fairness && fairness.mainKeepers.length > 0 ? ` ${mainKeeperWords(fairness.mainKeepers)}, so not in it.` : ''} Tap a number for the match, a name for that child.`}
      </Text>
    </ViewFrame>
  );
}

// ============================================================================
// Fairness at a glance (AC3)
// ============================================================================

export function FairnessView({ views, onChild, onBack }: ViewProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const f = views.fairness;
  if (f === null) {
    return (
      <ViewFrame view="fairness" onBack={onBack}>
        <Empty>Fairness appears here after the first match is closed.</Empty>
      </ViewFrame>
    );
  }
  const reach = Math.max(f.gap, 2) + 2;
  const lo = f.average - reach;
  const hi = f.average + reach;
  const labels = axisLabels(views.matches);
  const top = Math.ceil(Math.max(5, ...views.trend.map((t) => t.gap ?? 0)) / 5) * 5;
  const columns = views.trend.map((t, j) => ({
    segments: t.gap === null ? null : [{ value: t.gap, colour: chartColours.outfield }],
    value: t.gap === null ? '–' : String(t.gap),
    day: labels[j].day,
    month: labels[j].month,
    label: trendLabel(t, views.matches[j], j, views.matches.length),
  }));

  return (
    <ViewFrame view="fairness" onBack={onBack}>
      <View accessible accessibilityLabel={`Everyone within ${f.gap} min a game of the squad average, ${f.average}`}>
        <Text style={local.heroLine}>Everyone within</Text>
        <Text style={local.heroFigure} numberOfLines={1}>
          {f.gap}
        </Text>
        <Text style={local.heroLine}>min a game</Text>
        <Text style={local.heroLine}>of the squad average, {f.average}</Text>
      </View>
      <MainKeeperHint names={f.mainKeepers} tail="so not in the squad average." />

      <Text style={screen.fieldLabel}>Where everyone is</Text>
      <View style={local.key}>
        <KeyItem shape="band" label={`Within ${f.gap} of the average`} />
        <KeyItem shape="tick" label={`Squad average, ${f.average}`} />
      </View>
      {f.rows.map((r) => {
        if (r.perGame === null) {
          return (
            <View key={r.playerId} style={local.drow}>
              <Text style={local.dName} numberOfLines={1}>
                {r.name}
              </Text>
              <Text style={local.dNote}>No matches yet</Text>
            </View>
          );
        }
        const words = r.offset === null ? MAIN_KEEPER_NOTE : offsetWords(r.offset);
        return (
          <Pressable
            key={r.playerId}
            onPress={() => onChild(r.playerId)}
            style={local.drow}
            accessibilityRole="button"
            accessibilityLabel={`${r.name}, ${r.perGame} min a game, ${words}`}
          >
            <Text style={local.dName} numberOfLines={1}>
              {r.name}
            </Text>
            {r.offset === null ? (
              <Text style={local.dNote}>{MAIN_KEEPER_NOTE}</Text>
            ) : (
              <BandDot value={r.perGame} average={f.average} gap={f.gap} lo={lo} hi={hi} />
            )}
            <Text style={local.dValue} numberOfLines={1}>
              {r.perGame}
            </Text>
          </Pressable>
        );
      })}
      <View style={local.dScale}>
        <View style={local.dNameSpace} />
        <View style={local.dAxis}>
          <Text style={local.scaleText}>{lo}</Text>
          <Text style={local.scaleText}>{f.average}</Text>
          <Text style={local.scaleText}>{hi}</Text>
        </View>
        <View style={local.dValueSpace} />
      </View>

      <Text style={screen.fieldLabel}>How the gap changed</Text>
      <Text style={[screen.hint, local.left]}>After each match, for the season so far. Minutes a game.</Text>
      <ColumnChart columns={columns} max={top} step={5} onSelect={(j) => setPicked(columns[j].label)} />
      <Picked text={picked} onClear={() => setPicked(null)} />
      <Text style={[screen.hint, local.left]}>The first matches swing most: there are only one or two games to average.</Text>
    </ViewFrame>
  );
}

// ============================================================================
// Going into Saturday (AC4)
// ============================================================================

export function SaturdayView({ views, onChild, onBack }: ViewProps) {
  const f = views.fairness;
  if (f === null) {
    return (
      <ViewFrame view="saturday" onBack={onBack}>
        <Empty>{'Nobody is owed time yet.\nAfter the first match, this shows who is owed minutes.'}</Empty>
      </ViewFrame>
    );
  }
  const named = views.owed.filter((r) => r.named);
  const max = Math.max(1, ...views.owed.map((r) => Math.abs(r.owed ?? 0)));
  return (
    <ViewFrame view="saturday" onBack={onBack}>
      <View style={local.owedBox}>
        {named.length > 0 ? (
          <>
            <Text style={local.owedHead}>Owed {OWED_MIN} min or more this season</Text>
            <Text style={local.owedNames}>{named.map((r) => `${r.name} ${r.owed}`).join(' · ')}</Text>
          </>
        ) : (
          <Text style={local.owedHead}>Nobody is owed {OWED_MIN} min or more this season.</Text>
        )}
      </View>
      <Text style={[screen.hint, local.left]}>
        Owed: the squad average for each game they played, minus the minutes they had. A missed match is never
        owed time.
      </Text>

      <Text style={screen.fieldLabel}>Everyone, in squad order</Text>
      <View style={local.oKey}>
        <Text style={local.oKeyText}>← Owed</Text>
        <Text style={local.oKeyText}>Level</Text>
        <Text style={local.oKeyText}>Had more →</Text>
      </View>
      {views.owed.map((r) => {
        if (r.perGame === null) {
          return (
            <View key={r.playerId} style={local.orow}>
              <View style={local.oLine}>
                <Text style={local.oName} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text style={local.oNote}>No matches yet</Text>
              </View>
            </View>
          );
        }
        if (r.owed === null) {
          return (
            <Pressable
              key={r.playerId}
              onPress={() => onChild(r.playerId)}
              style={local.orow}
              accessibilityRole="button"
              accessibilityLabel={`${r.name}, ${MAIN_KEEPER_NOTE}`}
            >
              <View style={local.oLine}>
                <Text style={local.oName} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text style={local.oNote}>{MAIN_KEEPER_NOTE}</Text>
              </View>
            </Pressable>
          );
        }
        const text = owedText(r.owed);
        return (
          <Pressable
            key={r.playerId}
            onPress={() => onChild(r.playerId)}
            style={local.orow}
            accessibilityRole="button"
            accessibilityLabel={`${r.name}, ${text.toLowerCase()} this season, ${r.perGame} min a game, played ${r.played}`}
          >
            <View style={local.oLine}>
              <Text style={local.oName} numberOfLines={1}>
                {r.name}
              </Text>
              {/* Colour only marks the named: a weight change re-measures and clips (theme.ts). */}
              <Text style={[local.oText, r.named && local.oNamed]} numberOfLines={1}>
                {text}
              </Text>
              <Text style={local.oMeta} numberOfLines={1}>
                {r.perGame} a game · played {r.played}
              </Text>
            </View>
            <OwedBar owed={r.owed} max={max} strong={r.named} />
          </Pressable>
        );
      })}
      <MainKeeperHint names={f.mainKeepers} tail="so not in the squad average and never shown as owed." />
    </ViewFrame>
  );
}

// ============================================================================
// Positions tried (AC5)
// ============================================================================

export function UnitKey() {
  return (
    <View style={local.key}>
      {UNITS.map((u) => (
        <KeyItem key={u} fill={unitColours[u]} label={UNIT_LABEL[u]} />
      ))}
    </View>
  );
}

export function PositionsView({ views, onChild, onBack }: ViewProps) {
  if (views.matches.length === 0) {
    return (
      <ViewFrame view="positions" onBack={onBack}>
        <Text style={screen.caption}>Time in each position this season</Text>
        <Empty>{'Nobody has played yet.\nTime in each position appears after the first match.'}</Empty>
      </ViewFrame>
    );
  }
  const unplaced = views.positions.some((r) => r.unplacedMs > 0);
  return (
    <ViewFrame view="positions" onBack={onBack}>
      <Text style={screen.caption}>Time in each position this season</Text>
      <Text style={screen.hint}>
        Positions follow each child&apos;s strengths and your choices, so this is a record, not a target. Fairness
        is total time on the pitch.
      </Text>
      <UnitKey />
      {views.positions.map((r) => {
        const role = r.keeper ? KEEPER_LABEL[r.keeper] : '';
        if (r.played === 0) {
          return (
            <View key={r.playerId} style={local.prow}>
              <View style={local.pLine}>
                <Text style={local.pName} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text style={local.pRole}>No matches yet</Text>
              </View>
            </View>
          );
        }
        return (
          <Pressable
            key={r.playerId}
            onPress={() => onChild(r.playerId)}
            style={local.prow}
            accessibilityRole="button"
            accessibilityLabel={r.text === '' ? `${r.name}: no time on the pitch yet` : `${r.name}: ${r.text} minutes`}
          >
            <View style={local.pLine}>
              <Text style={local.pName} numberOfLines={1}>
                {r.name}
              </Text>
              <Text style={local.pRole} numberOfLines={1}>
                {role}
              </Text>
            </View>
            {r.total > 0 && <UnitStack minutes={r.minutes} />}
            <Text style={local.pText}>{r.text === '' ? 'No time on the pitch yet' : `${r.text} min`}</Text>
          </Pressable>
        );
      })}
      <Text style={[screen.hint, local.left]}>
        Each bar is that child&apos;s own time, so a child who missed matches has a full bar too.
      </Text>
      {unplaced && (
        <Text style={[screen.hint, local.left]}>
          Time from early matches with no position recorded is not in these bars.
        </Text>
      )}
    </ViewFrame>
  );
}

const GRID_NAME = 96;
const GRID_AVG = 52;
const GRID_CELL = 46;
const GRID_ROW = 46;

const local = StyleSheet.create({
  // --- tiles
  tilesBlock: { alignSelf: 'stretch', marginBottom: 6 },
  tileRow: { flexDirection: 'row', alignSelf: 'stretch', gap: 8, marginBottom: 8 },
  tile: {
    flex: 1,
    minHeight: 78,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: colours.pitchRaised,
    borderColor: colours.line,
    borderWidth: 1,
    borderRadius: 12,
  },
  tileHead: { flexDirection: 'row', alignItems: 'flex-start' },
  tileTitle: { flex: 1, color: colours.ink, fontSize: 16, fontWeight: '600', includeFontPadding: false },
  chevron: { color: colours.inkFaint, fontSize: 18, includeFontPadding: false, flexShrink: 0, marginLeft: 6 },
  tileAnswer: { alignSelf: 'stretch', color: colours.inkMuted, fontSize: 14, includeFontPadding: false, marginTop: 4 },

  // --- shared
  empty: { marginTop: 24, lineHeight: 22 },
  left: { textAlign: 'left' },
  key: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', alignSelf: 'stretch', marginTop: 8 },
  keyWords: { color: colours.inkMuted, fontSize: 13, includeFontPadding: false, marginRight: 14, marginBottom: 4 },
  picked: {
    alignSelf: 'stretch',
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#f2f7f4',
    borderRadius: 8,
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
  },
  pickedText: { color: colours.pitch, fontSize: 15, includeFontPadding: false },
  scaleText: { color: colours.inkFaint, fontSize: 12, includeFontPadding: false, flexShrink: 0 },

  // --- season grid: fixed widths and heights, so the two halves line up
  grid: { flexDirection: 'row', marginHorizontal: -18, marginTop: 10 },
  // Width includes the border: one more than the two columns.
  gFixed: { width: GRID_NAME + GRID_AVG + 1, borderRightWidth: 1, borderRightColor: colours.line },
  gScrollBody: { paddingRight: 18 },
  gRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: GRID_ROW,
    borderBottomWidth: 1,
    borderBottomColor: '#164f3c',
  },
  gHeadRow: { height: 48, borderBottomColor: colours.line },
  gHeadText: { color: colours.inkMuted, fontSize: 12, includeFontPadding: false },
  gNameCell: { width: GRID_NAME, paddingLeft: 18, paddingRight: 4 },
  gNameHit: { flexDirection: 'row', alignItems: 'center', height: GRID_ROW - 1 },
  gName: { flexShrink: 1, color: colours.ink, fontSize: 16, includeFontPadding: false },
  gkBadge: {
    flexShrink: 0,
    marginLeft: 4,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: colours.line,
    borderRadius: 4,
    color: colours.inkMuted,
    fontSize: 11,
    includeFontPadding: false,
  },
  gAvgCell: { width: GRID_AVG, textAlign: 'center' },
  gAvg: { color: colours.ink, fontSize: 15, includeFontPadding: false },
  gCell: { width: GRID_CELL, height: '100%', alignItems: 'center', justifyContent: 'center' },
  gDay: { width: GRID_CELL, textAlign: 'center', color: colours.inkMuted, fontSize: 12, includeFontPadding: false },
  gComp: { width: GRID_CELL, textAlign: 'center', color: colours.inkFaint, fontSize: 11, includeFontPadding: false },
  gTotal: { width: GRID_CELL, textAlign: 'center', color: colours.ink, fontSize: 16, includeFontPadding: false },
  gGoal: {
    width: GRID_CELL,
    textAlign: 'center',
    color: colours.inkMuted,
    fontSize: 10,
    includeFontPadding: false,
    marginTop: 2,
  },
  gkMark: {
    position: 'absolute',
    left: 4,
    top: 9,
    bottom: 9,
    width: 3,
    borderRadius: 2,
    backgroundColor: chartColours.goal,
  },

  // --- fairness
  heroLine: {
    alignSelf: 'stretch',
    textAlign: 'center',
    color: colours.inkMuted,
    fontSize: 17,
    includeFontPadding: false,
  },
  heroFigure: {
    alignSelf: 'stretch',
    textAlign: 'center',
    color: colours.ink,
    fontSize: 64,
    includeFontPadding: false,
    flexShrink: 0,
    marginVertical: 2,
  },
  drow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    minHeight: TOUCH_TARGET,
    borderBottomWidth: 1,
    borderBottomColor: '#164f3c',
  },
  dName: { width: 72, color: colours.ink, fontSize: 16, includeFontPadding: false, marginRight: 8 },
  dNote: { flex: 1, color: colours.inkFaint, fontSize: 13, includeFontPadding: false, paddingVertical: 6 },
  dValue: {
    width: 34,
    textAlign: 'right',
    color: colours.ink,
    fontSize: 15,
    includeFontPadding: false,
    marginLeft: 8,
    flexShrink: 0,
  },
  dScale: { flexDirection: 'row', alignSelf: 'stretch', marginTop: 4 },
  dNameSpace: { width: 72, marginRight: 8 },
  dValueSpace: { width: 34, marginLeft: 8 },
  dAxis: { flex: 1, flexDirection: 'row', justifyContent: 'space-between' },

  // --- going into Saturday
  owedBox: {
    alignSelf: 'stretch',
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colours.pitchRaised,
    borderColor: colours.line,
    borderWidth: 1,
    borderRadius: 12,
  },
  owedHead: { alignSelf: 'stretch', color: colours.inkMuted, fontSize: 14, includeFontPadding: false },
  owedNames: { alignSelf: 'stretch', color: colours.ink, fontSize: 20, includeFontPadding: false, marginTop: 4 },
  oKey: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch', marginBottom: 2 },
  oKeyText: { color: colours.inkFaint, fontSize: 12, includeFontPadding: false, flexShrink: 0 },
  orow: {
    alignSelf: 'stretch',
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingTop: 9,
    paddingBottom: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#164f3c',
  },
  oLine: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  oName: { width: 72, color: colours.ink, fontSize: 17, includeFontPadding: false, marginRight: 6 },
  oText: { flex: 1, color: colours.inkMuted, fontSize: 15, includeFontPadding: false },
  oNamed: { color: colours.ink },
  oNote: { flex: 1, color: colours.inkFaint, fontSize: 13, includeFontPadding: false },
  oMeta: {
    width: 136,
    textAlign: 'right',
    color: colours.inkFaint,
    fontSize: 13,
    includeFontPadding: false,
    flexShrink: 0,
  },

  // --- positions tried
  prow: {
    alignSelf: 'stretch',
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingTop: 9,
    paddingBottom: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#164f3c',
  },
  pLine: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  pName: { width: 96, color: colours.ink, fontSize: 17, includeFontPadding: false, marginRight: 6 },
  pRole: { flex: 1, color: colours.inkFaint, fontSize: 13, includeFontPadding: false },
  pText: { alignSelf: 'stretch', color: colours.inkMuted, fontSize: 14, includeFontPadding: false, marginTop: 5 },
});
