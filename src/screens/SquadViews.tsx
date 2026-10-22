/**
 * The squad views — #143, building the design Rob approved on #138.
 *
 * Four tiles above the Squad list, each showing its answer before it is
 * tapped (AC1), and the four views they open: Season grid, Fairness at a
 * glance, Going into Saturday and Positions tried. Every figure arrives
 * folded from the ledger by `src/app/squadViews.ts`; these only draw it
 * (invariant 1). Each view has a way back at its top and its foot.
 *
 * #208 (overturning PO ruling Q1's squad order for these views): every table
 * sorts by its numbers, most first by default, and a tap on a heading
 * re-sorts it. Ties keep squad order; a Main keeper is listed last whatever
 * the sort. The bars and dots in each row are drawn in the same order, so a
 * chart and its table always agree.
 *
 * Charts are boxes drawn with Views (ADR-016), from `./Charts`.
 *
 * First names only (invariant 4).
 */

import { useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import type { UUID } from '../types/index';
import { FILL_IN_NOTE, MAIN_KEEPER_NOTE } from '../app/childSeason';
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
  positionsLine,
  squadTiles,
  trendLabel,
  type SquadView,
  type SquadViews,
} from '../app/squadViews';
import { NAME, TABLE_DEFAULTS, matchKey, sortFairness, sortGrid, sortOwed, sortPositions } from '../app/tableSort';
import { SortHeading, useTableSort } from './TableSort';
import { BandDot, ColumnChart, KeyItem, OwedBar, UnitStack, chartColours, unitColours } from './Charts';
import { VIEW_NOTHING_YET } from '../app/gettingStarted';
import { EmptyState } from './GettingStarted';
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
  /**
   * #218 Q3: before the first match is played, an empty view says what it
   * will show and offers the next thing to do. Null once anything has been
   * played, so an established phone's views are as they were (AC6).
   */
  firstTime?: { label: string; onPress: () => void } | null;
}

function ViewFrame({
  view,
  onBack,
  note = null,
  children,
}: {
  view: SquadView;
  onBack: () => void;
  /** ADR-015 §6a (#223): how many matches the figures leave out for their format, and why. */
  note?: string | null;
  children: ReactNode;
}) {
  return (
    <View style={screen.flex}>
      <ScrollView contentContainerStyle={screen.scroll}>
        <Pressable onPress={onBack} style={screen.linkHit}>
          <Text style={screen.link}>Back to Squad</Text>
        </Pressable>
        <Text style={screen.title}>{VIEW_TITLE[view]}</Text>
        {note !== null && <Text style={screen.caption}>{note}.</Text>}
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

/** A view with nothing in it: the first-time sentence and button (#218), else as before. */
function Nothing({
  view,
  firstTime,
  before,
}: {
  view: SquadView;
  firstTime: ViewProps['firstTime'];
  before: string;
}) {
  if (firstTime) return <EmptyState text={VIEW_NOTHING_YET[view]} action={firstTime} />;
  return <Empty>{before}</Empty>;
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

export function SeasonGridView({ views, onChild, onBack, firstTime }: ViewProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const scroller = useRef<ScrollView>(null);
  const { matches, fairness } = views;
  const { sort, onSort } = useTableSort('squadGrid', (key) => matches.some((m) => matchKey(m.matchId) === key));
  const grid = sortGrid(views.grid, matches, sort);
  if (matches.length === 0) {
    return (
      <ViewFrame view="grid" onBack={onBack}>
        <Nothing
          view="grid"
          firstTime={firstTime}
          before={'No matches yet.\nEach match appears here as a column once it is closed.'}
        />
      </ViewFrame>
    );
  }
  return (
    <ViewFrame view="grid" onBack={onBack} note={views.season.formatNote}>
      <Text style={screen.caption}>Minutes on the pitch each match, oldest first</Text>
      <View style={local.grid}>
        {/* The name and "a game" columns stay put while the matches scroll. */}
        <View style={local.gFixed}>
          <View style={[local.gRow, local.gHeadRow]}>
            <SortHeading label="Child" column={NAME} sort={sort} onSort={onSort} align="left" style={local.gNameCell} />
            <SortHeading label="a game" column="perGame" sort={sort} onSort={onSort} align="center" style={local.gAvgCell} />
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
                // A tap sorts by this match's minutes and says which match it is.
                <SortHeading
                  key={m.matchId}
                  label={m.label}
                  column={matchKey(m.matchId)}
                  sort={sort}
                  onSort={(key) => {
                    onSort(key);
                    setPicked(m.label);
                  }}
                  align="center"
                  style={[local.gCell, !m.counted && local.gOff]}
                >
                  <Text style={local.gDay} numberOfLines={1}>
                    {m.day}
                  </Text>
                  <Text style={local.gComp} numberOfLines={1}>
                    {m.competitionShort}
                  </Text>
                </SortHeading>
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
                      style={[local.gCell, c.counted === false && local.gOff]}
                      accessibilityRole="button"
                      accessibilityLabel={c.text}
                    >
                      {c.goal > 0 && <View style={local.gkMark} />}
                      {/* #199: a reconstructed match's figures, italic and muted, in a fixed-width cell. */}
                      <Text style={[local.gTotal, c.reconstructed && local.gTainted]} numberOfLines={1}>
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
        {matches.some((m) => !m.counted && m.offFormat === null) && (
          <Text style={local.keyWords}>Faded: left out of the figures</Text>
        )}
        {/* §6a: still the child's minutes, in their totals; only fairness leaves them out. */}
        {matches.some((m) => m.offFormat !== null) && (
          <Text style={local.keyWords}>Faded: another format, not in fairness</Text>
        )}
        {matches.some((m) => m.provenance === 'reconstructed') && (
          <Text style={local.keyWords}>Italic: reconstructed, times may be approximate</Text>
        )}
        <Text style={local.keyWords}>L, C, F, T: league, cup, friendly, tournament</Text>
      </View>
      <Text style={screen.hint}>
        {`"a game" is minutes a game this season.${
          fairness ? ` Squad average ${fairness.average}.` : ''
        }${fairness && fairness.mainKeepers.length > 0 ? ` ${mainKeeperWords(fairness.mainKeepers)}, so not in it.` : ''} Tap a number for the match, a name for that child, a heading to sort by it.`}
      </Text>
    </ViewFrame>
  );
}

// ============================================================================
// Fairness at a glance (AC3)
// ============================================================================

export function FairnessView({ views, onChild, onBack, firstTime }: ViewProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const { sort, onSort } = useTableSort('squadFairness');
  const f = views.fairness;
  if (f === null) {
    return (
      <ViewFrame view="fairness" onBack={onBack}>
        <Nothing view="fairness" firstTime={firstTime} before="Fairness appears here after the first match is closed." />
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
    <ViewFrame view="fairness" onBack={onBack} note={views.season.formatNote}>
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
      <View style={local.dHead}>
        <SortHeading label="Child" column={NAME} sort={sort} onSort={onSort} align="left" style={local.dNameHead} />
        <SortHeading
          label="From the average"
          column="offset"
          sort={sort}
          onSort={onSort}
          align="center"
          style={local.dBandHead}
        />
        <SortHeading label="a game" column="perGame" sort={sort} onSort={onSort} style={local.dValueHead} />
      </View>
      {sortFairness(f.rows, sort).map((r) => {
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
        const outside = r.fillIn ? FILL_IN_NOTE : MAIN_KEEPER_NOTE;
        const words = r.offset === null ? outside : offsetWords(r.offset);
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
              <Text style={local.dNote}>{outside}</Text>
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

export function SaturdayView({ views, onChild, onBack, firstTime }: ViewProps) {
  const { sort, onSort } = useTableSort('squadSaturday');
  const f = views.fairness;
  if (f === null) {
    return (
      <ViewFrame view="saturday" onBack={onBack}>
        <Nothing
          view="saturday"
          firstTime={firstTime}
          before={'Nobody is owed time yet.\nAfter the first match, this shows who is owed minutes.'}
        />
      </ViewFrame>
    );
  }
  // Most owed first, whatever the table below is sorted by (#208).
  const named = sortOwed(views.owed, TABLE_DEFAULTS.squadSaturday).filter((r) => r.named);
  const max = Math.max(1, ...views.owed.map((r) => Math.abs(r.owed ?? 0)));
  return (
    <ViewFrame view="saturday" onBack={onBack} note={views.season.formatNote}>
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

      <Text style={screen.fieldLabel}>Everyone</Text>
      <View style={local.oHead}>
        <SortHeading label="Child" column={NAME} sort={sort} onSort={onSort} align="left" style={local.oNameHead} />
        <SortHeading label="Owed" column="owed" sort={sort} onSort={onSort} align="left" style={local.oTextHead} />
        <SortHeading label="a game" column="perGame" sort={sort} onSort={onSort} style={local.oMetaHead} />
        <SortHeading label="played" column="played" sort={sort} onSort={onSort} style={local.oMetaHead} />
      </View>
      <View style={local.oKey}>
        <Text style={local.oKeyText}>← Owed</Text>
        <Text style={local.oKeyText}>Level</Text>
        <Text style={local.oKeyText}>Had more →</Text>
      </View>
      {sortOwed(views.owed, sort).map((r) => {
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
              accessibilityLabel={`${r.name}, ${r.fillIn ? FILL_IN_NOTE : MAIN_KEEPER_NOTE}`}
            >
              <View style={local.oLine}>
                <Text style={local.oName} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text style={local.oNote}>{r.fillIn ? FILL_IN_NOTE : MAIN_KEEPER_NOTE}</Text>
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

export function PositionsView({ views, onChild, onBack, firstTime }: ViewProps) {
  const { sort, onSort } = useTableSort('squadPositions');
  if (views.matches.length === 0) {
    return (
      <ViewFrame view="positions" onBack={onBack}>
        {firstTime ? null : <Text style={screen.caption}>Time in each position this season</Text>}
        <Nothing
          view="positions"
          firstTime={firstTime}
          before={'Nobody has played yet.\nTime in each position appears after the first match.'}
        />
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
      <View style={local.pHead}>
        <SortHeading label="Child" column={NAME} sort={sort} onSort={onSort} align="left" style={local.pNameHead} />
        {UNITS.map((u) => (
          <SortHeading
            key={u}
            label={UNIT_LABEL[u]}
            column={u}
            sort={sort}
            onSort={onSort}
            align="center"
            style={local.pUnitHead}
          />
        ))}
        <SortHeading label="Total" column="total" sort={sort} onSort={onSort} align="center" style={local.pUnitHead} />
      </View>
      {sortPositions(views.positions, sort).map((r) => {
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
            accessibilityLabel={`${r.name}: ${positionsLine(r)}`}
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
            <Text style={local.pText}>{positionsLine(r)}</Text>
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
  /** A match the coach left out of the figures (ADR-020): still there, plainly set back. */
  gOff: { opacity: 0.4 },
  gTainted: { fontStyle: 'italic', color: colours.taint },
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
    width: 48,
    textAlign: 'right',
    color: colours.ink,
    fontSize: 15,
    includeFontPadding: false,
    marginLeft: 8,
    flexShrink: 0,
  },
  dScale: { flexDirection: 'row', alignSelf: 'stretch', marginTop: 4 },
  dNameSpace: { width: 72, marginRight: 8 },
  dValueSpace: { width: 48, marginLeft: 8 },
  dHead: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    marginTop: 4,
    borderBottomWidth: 1,
    borderBottomColor: colours.line,
  },
  dNameHead: { width: 72, marginRight: 8 },
  dBandHead: { flex: 1, flexShrink: 1 },
  dValueHead: { width: 48, marginLeft: 8 },
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
  oHead: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    borderBottomWidth: 1,
    borderBottomColor: colours.line,
  },
  oNameHead: { width: 72, marginRight: 6 },
  oTextHead: { flex: 1, flexShrink: 1 },
  // The two halves of the 136 under "50 a game · played 9".
  oMetaHead: { width: 68 },
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
  pHead: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    marginTop: 4,
    borderBottomWidth: 1,
    borderBottomColor: colours.line,
  },
  pNameHead: { width: 96, marginRight: 6 },
  pUnitHead: { flex: 1, flexShrink: 1 },
  pName: { width: 96, color: colours.ink, fontSize: 17, includeFontPadding: false, marginRight: 6 },
  pRole: { flex: 1, color: colours.inkFaint, fontSize: 13, includeFontPadding: false },
  pText: { alignSelf: 'stretch', color: colours.inkMuted, fontSize: 14, includeFontPadding: false, marginTop: 5 },
});
