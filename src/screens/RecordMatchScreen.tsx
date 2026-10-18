/**
 * A played match as the minutes record holds it — #195 AC1; #196.
 *
 * Folded from the record on each render (`recordMatchPage`); nothing shown
 * here is stored (invariant 1). Opened from Played for a match with no
 * fixture on this phone, and from a match report.
 *
 * #196 adds the result (W/D/L), how the match was actually played, minutes
 * per position, and three noted acts that append to the record, never edit
 * it (invariant 5): add a goal or a goal against whose time is unknown (the
 * 3 Oct cup match), take one back, and correct the structure.
 *
 * Full screen with an explicit Back, like the match report. Invariant 3: the
 * figure is total pitch time, goal plus outfield; "in goal" is its breakdown.
 */

import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text } from './Text';

import type { UUID } from '../types/index';
import { competitionLabel, whenLabel } from '../app/fixtures';
import { formatClock } from '../app/matchClock';
import { parsePeriodLengths, positionLine, structureLabel } from '../app/matchRecord';
import { scoreLabel, type PageGoal, type RecordMatchPage } from '../app/recordOnly';
import { NAME, sortRecordMinutes } from '../app/tableSort';
import { Chip, ChipRow } from './Chip';
import { colours, screen } from './theme';
import { SortHeading, useTableSort } from './TableSort';

/** What the page may append to the record; each returns a reason when refused. */
export interface RecordActions {
  addEvent: (kind: 'goal' | 'conceded', playerId: UUID | null, note: string) => string | null;
  withdraw: (eventId: UUID, note: string) => string | null;
  correctStructure: (periodMs: number[], note: string) => string | null;
}

type Panel =
  | { kind: 'add'; event: 'goal' | 'conceded'; scorer: UUID | null; note: string; error: string }
  | { kind: 'withdraw'; goal: PageGoal; note: string; error: string }
  | { kind: 'structure'; lengths: string; note: string; error: string };

export function RecordMatchScreen({
  page,
  now,
  onBack,
  actions,
  playedHere = false,
  backLabel = 'Back',
}: {
  page: RecordMatchPage;
  now: Date;
  onBack: () => void;
  /** Null when the record cannot be written on this phone. */
  actions?: RecordActions | null;
  /** Played on this phone: not reconstructed by definition. */
  playedHere?: boolean;
  backLabel?: string;
}) {
  const { match } = page;
  // #208: most minutes first by default; a tap on a heading re-sorts.
  const { sort, onSort } = useTableSort('recordMinutes');
  const [panel, setPanel] = useState<Panel | null>(null);
  const competition = competitionLabel(match.competition);
  const st = page.structure;

  const submit = () => {
    if (!panel || !actions) return;
    let refused: string | null;
    if (panel.kind === 'add') refused = actions.addEvent(panel.event, panel.event === 'goal' ? panel.scorer : null, panel.note);
    else if (panel.kind === 'withdraw') refused = actions.withdraw(panel.goal.id, panel.note);
    else {
      const lengths = parsePeriodLengths(panel.lengths);
      refused = lengths ? actions.correctStructure(lengths, panel.note) : 'Type each period’s minutes, e.g. 20 20 10 10.';
    }
    if (refused) setPanel({ ...panel, error: refused });
    else setPanel(null);
  };

  const goalLine = (g: PageGoal, label: string) => (
    <View key={g.id} style={local.goalRow}>
      <Text style={local.goalText} numberOfLines={2}>
        {label}
        {g.timeKnown ? ` · ${periodName(match.periodCount)} ${g.period}` : ' · time unknown'}
        {g.note ? ` (${g.note})` : ''}
      </Text>
      {actions && (
        <Pressable
          onPress={() => setPanel({ kind: 'withdraw', goal: g, note: '', error: '' })}
          style={local.takeBack}
          accessibilityRole="button"
          accessibilityLabel={`Take back ${label}`}
        >
          <Text style={screen.link}>Take back</Text>
        </Pressable>
      )}
    </View>
  );

  return (
    <View style={screen.flex}>
      <KeyboardAvoidingView style={screen.flex} behavior="padding">
        <ScrollView contentContainerStyle={screen.scroll} keyboardShouldPersistTaps="handled">
          <Pressable onPress={onBack} style={screen.linkHit}>
            <Text style={screen.link}>{backLabel}</Text>
          </Pressable>
          <Text style={screen.title} numberOfLines={1}>
            {(match.opponent ?? '').trim() || 'Opponent not recorded'}
          </Text>
          <Text style={screen.caption} numberOfLines={1}>
            {whenLabel(match.kickoffAt ? new Date(match.kickoffAt) : null, now)}
            {competition === '' ? '' : ` · ${competition}`}
          </Text>
          <Text style={match.score ? local.score : screen.caption}>{scoreLabel(match.score)}</Text>
          {!playedHere && (
            <Text style={local.reconstructed}>
              ◐ Reconstructed: this match is in the minutes record but was not played on this phone, so its
              times may be approximate.
            </Text>
          )}
          {match.leftOut !== null && (
            <Text style={screen.hint}>
              Left out of the figures{match.leftOut ? `: "${match.leftOut}"` : ''}
            </Text>
          )}

          <Text style={screen.fieldLabel}>How it was played</Text>
          <Text style={local.line}>
            {structureLabel(st)}
            {st.onField ? ` · ${st.onField} a side` : ''}
          </Text>
          <Text style={local.lineFaint}>
            {st.source === 'planned'
              ? 'As planned: recorded before the app kept how matches were played.'
              : st.source === 'corrected'
                ? `Corrected: "${st.note}"`
                : 'As the clock ran.'}
          </Text>
          {actions && panel?.kind !== 'structure' && (
            <Pressable
              onPress={() =>
                setPanel({
                  kind: 'structure',
                  lengths: st.periodMs.map((p) => String(Math.round((p / 60_000) * 10) / 10)).join(' '),
                  note: '',
                  error: '',
                })
              }
              style={screen.linkHit}
            >
              <Text style={screen.link}>Correct how it was played</Text>
            </Pressable>
          )}
          {panel?.kind === 'structure' && (
            <View style={local.panel}>
              <Text style={screen.hint}>Each period’s minutes, in order, e.g. 20 20 10 10</Text>
              <TextInput
                style={screen.input}
                value={panel.lengths}
                onChangeText={(lengths) => setPanel({ ...panel, lengths, error: '' })}
                keyboardType="numbers-and-punctuation"
              />
              <NoteBox value={panel.note} onChange={(note) => setPanel({ ...panel, note, error: '' })} placeholder="Why? (needed)" />
              <PanelButtons error={panel.error} label="Save the correction" onSave={submit} onCancel={() => setPanel(null)} />
            </View>
          )}

          <Text style={screen.fieldLabel}>Goals</Text>
          {page.goals.length === 0 && page.conceded === 0 ? (
            <Text style={local.lineFaint}>No goals in the record for this match.</Text>
          ) : (
            <>
              {page.goals.map((g) => goalLine(g, g.name))}
              {page.concededGoals.map((g) => goalLine(g, 'Goal against'))}
            </>
          )}
          {panel?.kind === 'withdraw' && (
            <View style={local.panel}>
              <Text style={screen.hint}>Take back this goal? It stays in the record, marked as taken back.</Text>
              <NoteBox value={panel.note} onChange={(note) => setPanel({ ...panel, note, error: '' })} placeholder="Why? (needed)" />
              <PanelButtons error={panel.error} label="Take it back" onSave={submit} onCancel={() => setPanel(null)} />
            </View>
          )}
          {actions && panel?.kind !== 'add' && (
            <Pressable
              onPress={() => setPanel({ kind: 'add', event: 'goal', scorer: null, note: '', error: '' })}
              style={screen.linkHit}
            >
              <Text style={screen.link}>Add goal / conceded (time unknown)</Text>
            </Pressable>
          )}
          {panel?.kind === 'add' && (
            <View style={local.panel}>
              <ChipRow>
                <Chip label="Our goal" selected={panel.event === 'goal'} onPress={() => setPanel({ ...panel, event: 'goal', error: '' })} />
                <Chip
                  label="Goal against"
                  selected={panel.event === 'conceded'}
                  onPress={() => setPanel({ ...panel, event: 'conceded', error: '' })}
                />
              </ChipRow>
              {panel.event === 'goal' && (
                <>
                  <Text style={screen.hint}>Who scored?</Text>
                  <ChipRow>
                    {page.minutes.map((m) => (
                      <Chip
                        key={m.playerId}
                        label={m.name}
                        narrow
                        selected={panel.scorer === m.playerId}
                        onPress={() => setPanel({ ...panel, scorer: m.playerId, error: '' })}
                      />
                    ))}
                    <Chip label="Not known" selected={panel.scorer === null} onPress={() => setPanel({ ...panel, scorer: null, error: '' })} />
                  </ChipRow>
                </>
              )}
              <NoteBox
                value={panel.note}
                onChange={(note) => setPanel({ ...panel, note, error: '' })}
                placeholder="Where is this known from? (needed)"
              />
              <Text style={screen.hint}>
                It counts in the score, and in no figure by period or time.
              </Text>
              <PanelButtons error={panel.error} label="Add it" onSave={submit} onCancel={() => setPanel(null)} />
            </View>
          )}

          <Text style={screen.fieldLabel}>Minutes on the pitch</Text>
          <View style={local.head}>
            <SortHeading label="Player" column={NAME} sort={sort} onSort={onSort} align="left" style={local.nameHead} />
            <SortHeading label="Minutes" column="total" sort={sort} onSort={onSort} style={local.figureHead} />
            <SortHeading label="GK" column="gk" sort={sort} onSort={onSort} style={local.goalHead} />
          </View>
          {sortRecordMinutes(page.minutes, sort).map((m) => (
            <View key={m.playerId} style={local.rowWrap}>
              <View style={local.row}>
                <Text style={local.name} numberOfLines={1}>
                  {m.name}
                </Text>
                <Text style={local.figure} numberOfLines={1}>
                  {formatClock(m.totalMs)}
                </Text>
                <Text style={[local.goal, m.goalMs === 0 && local.faint]} numberOfLines={1}>
                  {m.goalMs > 0 ? `GK ${formatClock(m.goalMs)}` : ''}
                </Text>
              </View>
              {/* #196 AC4: where they played. A record, not a ranking (invariant 3). */}
              <Text style={local.positions} numberOfLines={2}>
                {positionLine(page.positions.get(m.playerId) ?? [])}
              </Text>
            </View>
          ))}

          <Pressable onPress={onBack} style={screen.linkHit}>
            <Text style={screen.link}>{backLabel}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function NoteBox({ value, onChange, placeholder }: { value: string; onChange: (t: string) => void; placeholder: string }) {
  return (
    <TextInput
      style={screen.input}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colours.inkFaint}
    />
  );
}

function PanelButtons({
  error,
  label,
  onSave,
  onCancel,
}: {
  error: string;
  label: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      {error !== '' && <Text style={screen.error}>{error}</Text>}
      <Pressable style={({ pressed }) => [screen.button, pressed && screen.buttonPressed]} onPress={onSave}>
        <Text style={screen.buttonLabel}>{label}</Text>
      </Pressable>
      <Pressable onPress={onCancel} style={screen.linkHit}>
        <Text style={screen.link}>Cancel</Text>
      </Pressable>
    </>
  );
}

const periodName = (count: number) => (count === 2 ? 'half' : 'Q');

const local = StyleSheet.create({
  score: {
    alignSelf: 'stretch',
    textAlign: 'center',
    color: colours.ink,
    fontSize: 34,
    fontWeight: '700',
    includeFontPadding: false,
    marginTop: 4,
  },
  reconstructed: {
    alignSelf: 'stretch',
    textAlign: 'center',
    color: colours.taint,
    fontSize: 13,
    includeFontPadding: false,
    marginTop: 8,
  },
  line: { alignSelf: 'stretch', color: colours.ink, fontSize: 15, includeFontPadding: false, marginTop: 4 },
  lineFaint: { alignSelf: 'stretch', color: colours.inkMuted, fontSize: 14, includeFontPadding: false, marginTop: 4 },
  goalRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', marginTop: 4 },
  goalText: { flex: 1, minWidth: 0, color: colours.ink, fontSize: 15, includeFontPadding: false },
  takeBack: { flexShrink: 0, paddingVertical: 6, paddingLeft: 12 },
  panel: { alignSelf: 'stretch', marginTop: 8 },
  rowWrap: { alignSelf: 'stretch', borderBottomWidth: 1, borderBottomColor: '#164f3c', paddingBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    paddingTop: 6,
  },
  positions: { alignSelf: 'stretch', color: colours.inkMuted, fontSize: 12, includeFontPadding: false, marginTop: 2 },
  name: { flex: 1, minWidth: 0, color: colours.ink, fontSize: 15, includeFontPadding: false },
  // Fixed widths and no shrink: a time beside a flex sibling loses its tail.
  figure: { width: 64, flexShrink: 0, textAlign: 'right', color: colours.ink, fontSize: 15, includeFontPadding: false },
  goal: { width: 84, flexShrink: 0, textAlign: 'right', color: colours.inkMuted, fontSize: 13, includeFontPadding: false },
  faint: { color: colours.inkFaint },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    borderBottomWidth: 1,
    borderBottomColor: colours.line,
  },
  nameHead: { flex: 1, flexShrink: 1 },
  figureHead: { width: 64, flexShrink: 0 },
  goalHead: { width: 84, flexShrink: 0 },
});
