/**
 * The front door — #62.
 *
 * > *"when I enter the app I should immediately see a list of Future, Current,
 * > Past Fixtures if they exist."*
 *
 * This is a Tuesday screen and a Saturday screen at once, so the ordering does
 * the work: whatever is happening NOW is at the top, then the next thing to
 * prepare for, then history. A coach opening this at 9am on a Saturday sees
 * the match they are about to play without scrolling or thinking.
 */

import { useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from './Text';

import type { Match, UUID } from '../types/index';
import type { Score } from '../app/matchEvents';
import { scoreLabel, type RecordOnlyMatch } from '../app/recordOnly';
import { resultOf } from '../app/matchRecord';
import { provenanceTag, type Provenance } from '../app/provenance';
import {
  competitionLabel,
  fixtureList,
  inBucket,
  kickoffLabel,
  whenLabel,
  lengthLabel,
  opponentLabel,
  type MatchProgress,
  type StartedPeriod,
  type FixtureRow,
} from '../app/fixtures';
import { NO_MATCHES_YET, NOTHING_PLAYED_YET } from '../app/gettingStarted';
import { EmptyState } from './GettingStarted';
import { colours, screen, TOUCH_TARGET } from './theme';

export function FixturesScreen({
  squadName,
  matches,
  currentMatchId,
  now,
  onOpen,
  onDelete,
  onAdd,
  onPlan,
  plannedIds,
  housekeeping,
  onPlayNow,
  buildLabel,
  progress,
  scores,
  periods,
  notClosed,
  notice,
  recordOnly = [],
  onOpenRecord,
  guide,
  nothingPlayed = null,
  highlightPlayNow = false,
  provenance = new Map(),
}: {
  squadName: string;
  matches: Match[];
  currentMatchId: UUID | null;
  /** Injected so the list is testable and never reads the clock itself. */
  now: Date;
  onOpen: (matchId: UUID) => void;
  /** Only offered on a fixture that has never been kicked off. */
  onDelete: (matchId: UUID) => void;
  onAdd: () => void;
  /** Plan a fixture's periods before kick-off (#72). Offered only before it. */
  onPlan: (matchId: UUID) => void;
  /** Fixtures that already have something planned, so the link says so. */
  plannedIds: ReadonlySet<UUID>;
  /** Deleting and archiving — #76. The rules are in fixtures.ts. */
  housekeeping: Housekeeping;
  /**
   * Kick off now, from the defaults, with no fixture form — PO ruling,
   * 2026-09-20: *Play now: **yes.***
   *
   * Null while a match is already underway. Starting a second one would
   * orphan the first, and the In-progress card above is the way back into it.
   */
  onPlayNow: (() => void) | null;
  buildLabel: string;
  /** Each match's progress, live match included: what files it as Played. */
  progress: ReadonlyMap<UUID, MatchProgress>;
  /** The score of each match kicked off, folded from its events. */
  scores: ReadonlyMap<UUID, Score>;
  /** Each match's periods, so a Play-now match is dated by its kick-off (#126). */
  periods: ReadonlyMap<UUID, readonly StartedPeriod[]>;
  /** Played to the end, not yet closed with End match (ruling D): hinted on the card. */
  notClosed: ReadonlySet<UUID>;
  /** What launch found when the saved squad would not read (#173). Empty: nothing. */
  notice?: string;
  /** Played matches the minutes record holds with no fixture here, e.g. imported ones (#195). */
  recordOnly?: RecordOnlyMatch[];
  onOpenRecord?: (matchId: UUID) => void;
  /**
   * #218: the made-up team's line and the Getting started card, drawn by the
   * shell under the title. Absent on an established phone (AC6).
   */
  guide?: ReactNode;
  /**
   * #218 Q3: before the first match is played, Played says so, with the next
   * thing to do. Null once anything has been played, so an established
   * phone's Home is as it was (AC6).
   */
  nothingPlayed?: { label: string; onPress: () => void } | null;
  /** #218: the card's third step points at Play now for a moment. */
  highlightPlayNow?: boolean;
  /** How far each played match can be trusted (#199), derived from the record. */
  provenance?: ReadonlyMap<UUID, Provenance>;
}) {
  const rows = fixtureList(matches, now, currentMatchId, progress);
  const cardProps = { now, onOpen, onDelete, onPlan, plannedIds, housekeeping, scores, periods, notClosed, provenance };
  const current = inBucket(rows, 'current');
  const future = inBucket(rows, 'future');
  const past = inBucket(rows, 'past');

  return (
    <View style={screen.flex}>
      <ScrollView contentContainerStyle={screen.scroll}>
        <Text style={screen.title} numberOfLines={1}>
          {squadName}
        </Text>
        {notice ? <Text style={[screen.hint, screen.overtime]}>{notice}</Text> : null}
        {guide}

        {/* #131 (PO ruling 12): a live match stays on top; the two ways to
            start one come next, so they never scroll away as Played grows. */}
        <Section title="Now" rows={current} {...cardProps} />

        {onPlayNow && (
          <Pressable
            style={({ pressed }) => [
              screen.button,
              highlightPlayNow && local.playNowHighlight,
              pressed && screen.buttonPressed,
            ]}
            onPress={onPlayNow}
          >
            <Text style={screen.buttonLabel}>Play now</Text>
          </Pressable>
        )}
        {onPlayNow && (
          <Text style={screen.hint}>
            An unplanned kickabout, using your defaults. No form to fill in.
          </Text>
        )}

        <Pressable
          style={({ pressed }) => [screen.buttonQuiet, pressed && screen.buttonPressed]}
          onPress={onAdd}
        >
          <Text style={screen.buttonLabel}>Add a fixture</Text>
        </Pressable>

        {rows.length === 0 && recordOnly.length === 0 ? (
          housekeeping.archivedCount > 0 ? (
            <Text style={screen.caption}>Every fixture is archived.</Text>
          ) : (
            // #218 Q3: nothing has happened yet; the buttons it means are above.
            <EmptyState text={NO_MATCHES_YET} />
          )
        ) : (
          <>
            <Section title="Coming up" rows={future} {...cardProps} />
            {/* Finished matches. One never started stays in Coming up
                whatever its date, and can still be planned, played or
                deleted (#76, match day 4). */}
            <PlayedSection
              rows={past}
              recordOnly={recordOnly}
              onOpenRecord={onOpenRecord ?? (() => {})}
              {...cardProps}
            />
            {past.length === 0 && recordOnly.length === 0 && nothingPlayed && (
              <View style={local.section}>
                <Text style={screen.fieldLabel}>Played</Text>
                <EmptyState text={NOTHING_PLAYED_YET} action={nothingPlayed} style={local.emptyUnderLabel} />
              </View>
            )}
          </>
        )}

        {(housekeeping.archivedCount > 0 || housekeeping.showingArchived) && (
          <Pressable onPress={housekeeping.onToggleArchived} style={screen.linkHit}>
            <Text style={screen.link}>
              {housekeeping.showingArchived
                ? 'Hide archived'
                : `Show archived (${housekeeping.archivedCount})`}
            </Text>
          </Pressable>
        )}
      </ScrollView>

      <Text style={screen.buildLabel} numberOfLines={1}>
        {buildLabel}
      </Text>
    </View>
  );
}

export interface Housekeeping {
  /** Never kicked off: safe to delete wherever it is listed. */
  deletable: ReadonlySet<UUID>;
  /** Finished: can leave the list without anything being deleted. */
  archivable: ReadonlySet<UUID>;
  archived: ReadonlySet<UUID>;
  onArchive: (matchId: UUID, archived: boolean) => void;
  archivedCount: number;
  showingArchived: boolean;
  onToggleArchived: () => void;
}

interface CardActions {
  now: Date;
  onOpen: (matchId: UUID) => void;
  onDelete: (matchId: UUID) => void;
  onPlan: (matchId: UUID) => void;
  plannedIds: ReadonlySet<UUID>;
  housekeeping: Housekeeping;
  scores: ReadonlyMap<UUID, Score>;
  periods: ReadonlyMap<UUID, readonly StartedPeriod[]>;
  notClosed: ReadonlySet<UUID>;
  provenance: ReadonlyMap<UUID, Provenance>;
}

/** A bucket, omitted entirely when empty rather than shown as a bare heading. */
function Section({ title, rows, ...actions }: { title: string; rows: FixtureRow[] } & CardActions) {
  if (rows.length === 0) return null;
  return (
    <View style={local.section}>
      <Text style={screen.fieldLabel}>{title}</Text>
      {rows.map((row) => (
        <FixtureCard key={row.match.id} row={row} {...actions} />
      ))}
    </View>
  );
}

/**
 * Played: this phone's finished fixtures and the record's other matches in
 * one list, most recent first, undated last, as `fixtureList` orders them.
 */
function PlayedSection({
  rows,
  recordOnly,
  onOpenRecord,
  ...actions
}: { rows: FixtureRow[]; recordOnly: RecordOnlyMatch[]; onOpenRecord: (matchId: UUID) => void } & CardActions) {
  if (rows.length === 0 && recordOnly.length === 0) return null;
  const time = (iso: string | null) => {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) ? t : null;
  };
  const items = [
    ...rows.map((row) => ({ key: row.match.id, at: time(row.match.kickoffAt), row, record: null })),
    ...recordOnly.map((m) => ({ key: m.id, at: time(m.kickoffAt), row: null, record: m })),
  ].sort((a, b) => (a.at === null ? (b.at === null ? 0 : 1) : b.at === null ? -1 : b.at - a.at));
  return (
    <View style={local.section}>
      <Text style={screen.fieldLabel}>Played</Text>
      {items.map((item) =>
        item.row ? (
          <FixtureCard key={item.key} row={item.row} {...actions} />
        ) : (
          <RecordCard
            key={item.key}
            match={item.record!}
            now={actions.now}
            onOpen={onOpenRecord}
            state={actions.provenance.get(item.key) ?? 'reconstructed'}
          />
        )
      )}
    </View>
  );
}

/**
 * A match from the record with no fixture on this phone. Its treatment is the
 * one every card uses (#199, replacing #195's "always reconstructed"): a
 * dashed outline and "◐ reconstructed" when reconstructed, a fainter tag when
 * live but unsigned, none when pristine.
 */
function RecordCard({
  match,
  now,
  onOpen,
  state,
}: {
  match: RecordOnlyMatch;
  now: Date;
  onOpen: (matchId: UUID) => void;
  state: Provenance;
}) {
  const competition = competitionLabel(match.competition);
  const tag = provenanceTag(state);
  return (
    <Pressable
      onPress={() => onOpen(match.id)}
      style={({ pressed }) => [local.card, state === 'reconstructed' && local.cardRecord, pressed && screen.buttonPressed]}
    >
      <Text style={local.opponent} numberOfLines={1}>
        {(match.opponent ?? '').trim() || 'Opponent not recorded'}
      </Text>
      <Text style={local.meta} numberOfLines={1}>
        {whenLabel(match.kickoffAt ? new Date(match.kickoffAt) : null, now)}
        {competition === '' ? '' : ` · ${competition}`}
      </Text>
      <Text style={match.score ? local.score : local.meta} numberOfLines={1}>
        {scoreLabel(match.score)}
      </Text>
      <Text style={tag ? (state === 'reconstructed' ? local.reconstructed : local.unsigned) : local.meta} numberOfLines={1}>
        {tag ? `${tag} · ` : ''}from the minutes record
      </Text>
      {match.leftOut !== null && (
        <Text style={local.meta} numberOfLines={1}>
          Left out of the figures{match.leftOut ? ` · "${match.leftOut}"` : ''}
        </Text>
      )}
    </Pressable>
  );
}

function FixtureCard({
  row,
  now,
  onOpen,
  onDelete,
  onPlan,
  plannedIds,
  housekeeping,
  scores,
  periods,
  notClosed,
  provenance,
}: { row: FixtureRow } & CardActions) {
  // #199: only a played match has a provenance; a fixture to come has none.
  const state = row.match.status === 'completed' ? provenance.get(row.match.id) : undefined;
  const tag = provenanceTag(state);
  const { match } = row;
  const score = scores.get(match.id);
  const planned = plannedIds.has(match.id);
  const canDelete = housekeeping.deletable.has(match.id);
  const canArchive = housekeeping.archivable.has(match.id);
  const isArchived = housekeeping.archived.has(match.id);
  const competition = competitionLabel(match.competition);
  // Two taps, in place, no dialog module. A fixture is cheap to re-add, but
  // deleting one the coach meant to keep is not cheap to undo.
  const [confirming, setConfirming] = useState(false);
  return (
    <Pressable
      onPress={() => onOpen(match.id)}
      style={({ pressed }) => [
        local.card,
        row.bucket === 'current' && local.cardCurrent,
        state === 'reconstructed' && local.cardRecord,
        pressed && screen.buttonPressed,
      ]}
    >
      <Text style={local.opponent} numberOfLines={1}>
        {opponentLabel(match)}
      </Text>
      <Text style={local.meta} numberOfLines={1}>
        {kickoffLabel(match, now, periods.get(match.id))}
        {competition === '' ? '' : ` · ${competition}`}
      </Text>
      {/* This match's OWN length and periods, not the squad default (#70). */}
      <Text style={local.meta} numberOfLines={1}>
        {lengthLabel(match)}
      </Text>
      {score && (
        <Text style={local.score} numberOfLines={1}>
          {/* #196 AC1: a closed match shows its result too. */}
          {match.status === 'completed' ? `${resultOf(score)} ` : ''}
          {score.us} – {score.them}
        </Text>
      )}
      {tag && (
        <Text style={state === 'reconstructed' ? local.reconstructed : local.unsigned} numberOfLines={1}>
          {tag}
        </Text>
      )}
      {row.bucket === 'current' && <Text style={local.nowTag}>In progress</Text>}
      {/* Ruling D: played, but the coach has not pressed End match yet. */}
      {notClosed.has(match.id) && (
        <Text style={local.nowTag} numberOfLines={1}>
          Not closed: open it to End match
        </Text>
      )}
      {isArchived && <Text style={local.meta}>Archived</Text>}

      {/* Only before kick-off: once a match is played its plan is history. */}
      {match.status === 'planned' && (
        <Pressable onPress={() => onPlan(match.id)} style={local.confirmHit}>
          <Text style={local.plan}>{planned ? 'Edit the plan' : 'Plan this match'}</Text>
        </Pressable>
      )}

      {canArchive && (
        <Pressable
          onPress={() => housekeeping.onArchive(match.id, !isArchived)}
          style={local.confirmHit}
        >
          <Text style={local.remove}>{isArchived ? 'Unarchive' : 'Archive'}</Text>
        </Pressable>
      )}

      {canDelete &&
        (confirming ? (
          <View style={local.confirmRow}>
            <Pressable onPress={() => onDelete(match.id)} style={local.confirmHit}>
              <Text style={local.deleteConfirm}>Delete this fixture</Text>
            </Pressable>
            <Pressable onPress={() => setConfirming(false)} style={local.confirmHit}>
              <Text style={local.keep}>Keep</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setConfirming(true)} style={local.confirmHit}>
            <Text style={local.remove}>Remove</Text>
          </Pressable>
        ))}
    </Pressable>
  );
}

const local = StyleSheet.create({
  section: { alignSelf: 'stretch' },
  emptyUnderLabel: { marginTop: 4 },
  // The same outer size as the plain button: the border takes 3 of the 15
  // padding, so nothing below it moves while it shows.
  playNowHighlight: { borderWidth: 3, borderColor: colours.warn, paddingVertical: 12 },
  card: {
    alignSelf: 'stretch',
    backgroundColor: colours.pitchRaised,
    borderColor: colours.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  // Colour and border only — never a different font weight, which is what
  // clipped the last glyph off the choice boxes on a real phone.
  cardCurrent: { borderColor: colours.warn, backgroundColor: '#12543f' },
  // #195 / #199: the one reconstructed treatment, border style and colour only.
  cardRecord: { borderStyle: 'dashed', borderColor: colours.taint },
  reconstructed: { color: colours.taint, fontSize: 13, includeFontPadding: false, marginTop: 4 },
  unsigned: { color: colours.taint, opacity: 0.6, fontSize: 13, includeFontPadding: false, marginTop: 4 },
  opponent: {
    color: colours.ink,
    fontSize: 18,
    fontWeight: '600',
    includeFontPadding: false,
  },
  meta: {
    color: colours.inkMuted,
    fontSize: 14,
    includeFontPadding: false,
    marginTop: 2,
  },
  confirmRow: { flexDirection: 'row', alignItems: 'center' },
  // A real target rather than hitSlop: 13px text with 8px slop measured about
  // 31dp, under the 44 floor, on the control that deletes a fixture.
  confirmHit: {
    justifyContent: 'center',
    minHeight: TOUCH_TARGET,
    paddingRight: 16,
  },
  remove: {
    color: colours.inkFaint,
    fontSize: 13,
    includeFontPadding: false,
  },
  deleteConfirm: {
    color: colours.danger,
    fontSize: 13,
    includeFontPadding: false,
  },
  plan: {
    color: colours.ink,
    fontSize: 15,
    textDecorationLine: 'underline',
    includeFontPadding: false,
  },
  keep: { color: colours.inkMuted, fontSize: 13, includeFontPadding: false },
  score: { color: colours.ink, fontSize: 22, fontWeight: '700', marginTop: 4, includeFontPadding: false },
  nowTag: {
    color: colours.warn,
    fontSize: 13,
    includeFontPadding: false,
    marginTop: 4,
  },
});
