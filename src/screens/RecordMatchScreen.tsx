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

import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import type { UUID } from '../types/index';
import { competitionLabel, whenLabel } from '../app/fixtures';
import { formatClock } from '../app/matchClock';
import { parsePeriodLengths, positionLine, structureLabel } from '../app/matchRecord';
import { scoreLabel, type PageGoal, type RecordMatchPage } from '../app/recordOnly';
import { NAME, sortRecordMinutes } from '../app/tableSort';
import { TALLY_CAPTION, tallyLineText } from '../app/tallies';
import { BackLink, CheckLine, FieldRow, FormSheet, RowNav, Section, SegmentedRow, SheetNote, TopBar } from './controls';
import { provenanceTag, type ProvenanceInfo } from '../app/provenance';
import { colours, screen } from './theme';
import { SortHeading, useTableSort } from './TableSort';

/** What the page may append to the record; each returns a reason when refused. */
export interface RecordActions {
  addEvent: (kind: 'goal' | 'conceded', playerId: UUID | null, note: string) => string | null;
  withdraw: (eventId: UUID, note: string) => string | null;
  correctStructure: (periodMs: number[], note: string) => string | null;
  /** #197: give an award; a second child for the same award is a joint winner. */
  giveAward: (awardTypeId: UUID, playerId: UUID, note: string) => string | null;
  /** #197: give it to someone else, or take it back (`to` null). Needs a note after the day. */
  changeAward: (awardTypeId: UUID, from: UUID, to: UUID | null, note: string) => string | null;
}

type PageAward = RecordMatchPage['awards'][number];

type Panel =
  | { kind: 'add'; event: 'goal' | 'conceded'; scorer: UUID | null; note: string; error: string }
  | { kind: 'withdraw'; goal: PageGoal; note: string; error: string }
  | { kind: 'structure'; lengths: string; note: string; error: string }
  | { kind: 'award'; typeId: UUID | null; playerId: UUID | null; note: string; error: string }
  | { kind: 'awardChange'; award: PageAward; to: UUID | null; note: string; error: string };

export function RecordMatchScreen({
  pitch = null,
  page,
  now,
  onBack,
  actions,
  trust = null,
  backLabel = 'Back',
}: {
  page: RecordMatchPage;
  now: Date;
  onBack: () => void;
  /** Null when the record cannot be written on this phone. */
  actions?: RecordActions | null;
  /** How far it can be trusted, and why (#199 AC3), derived from the record. */
  trust?: ProvenanceInfo | null;
  backLabel?: string;
  /** #254 AC12, AC20: the "Pitch and referee" row for this match. */
  pitch?: ReactNode;
}) {
  const { match } = page;
  // #208: most minutes first by default; a tap on a heading re-sorts.
  const { sort, onSort } = useTableSort('recordMinutes');
  const [panel, setPanel] = useState<Panel | null>(null);
  // What the sheet opened with, so a changed draft asks before it is thrown away (V30).
  const [opened, setOpened] = useState<Panel | null>(null);
  const openPanel = (p: Panel) => {
    setPanel(p);
    setOpened(p);
  };
  const unchanged = (p: Panel) => JSON.stringify({ ...p, error: '' });
  const panelDirty = panel !== null && opened !== null && unchanged(panel) !== unchanged(opened);
  // #264 C4 (QA D14): where the record needs a note, Save waits for one.
  const saveDisabled =
    panel === null ||
    ((panel.kind === 'add' || panel.kind === 'withdraw' || panel.kind === 'structure') && panel.note.trim() === '') ||
    (panel.kind === 'structure' && panel.lengths.trim() === '') ||
    (panel.kind === 'award' && (panel.typeId === null || panel.playerId === null));
  const [moreStats, setMoreStats] = useState(false);
  const competition = competitionLabel(match.competition);
  const st = page.structure;

  const submit = () => {
    if (!panel || !actions) return;
    let refused: string | null;
    if (panel.kind === 'add') refused = actions.addEvent(panel.event, panel.event === 'goal' ? panel.scorer : null, panel.note);
    else if (panel.kind === 'withdraw') refused = actions.withdraw(panel.goal.id, panel.note);
    else if (panel.kind === 'award') {
      refused =
        panel.typeId && panel.playerId
          ? actions.giveAward(panel.typeId, panel.playerId, panel.note)
          : 'Pick the award and who it is for.';
    } else if (panel.kind === 'awardChange') {
      refused = actions.changeAward(panel.award.awardTypeId, panel.award.playerId, panel.to, panel.note);
    } else {
      const lengths = parsePeriodLengths(panel.lengths);
      refused = lengths ? actions.correctStructure(lengths, panel.note) : 'Type each period’s minutes, e.g. 20 20 10 10.';
    }
    if (refused) setPanel({ ...panel, error: refused });
    else setPanel(null);
  };

  const goalText = (g: PageGoal, label: string) =>
    `${label}${g.timeKnown ? ` · ${periodName(match.periodCount)} ${g.period}` : ' · time unknown'}${g.note ? ` (${g.note})` : ''}`;
  // #264: with actions, each goal is a Row › opening the Take back sheet.
  const goalLine = (g: PageGoal, label: string) =>
    actions ? (
      <RowNav
        key={g.id}
        label={goalText(g, label)}
        value="Take back"
        accessibilityLabel={`Take back ${label}`}
        onPress={() => openPanel({ kind: 'withdraw', goal: g, note: '', error: '' })}
      />
    ) : (
      <View key={g.id} style={local.goalRow}>
        <Text style={local.goalText} numberOfLines={2}>
          {goalText(g, label)}
        </Text>
      </View>
    );

  const sheetTitle =
    panel === null
      ? ''
      : panel.kind === 'structure'
        ? 'How it was played'
        : panel.kind === 'withdraw'
          ? 'Take back this goal'
          : panel.kind === 'add'
            ? 'Add goal / conceded'
            : panel.kind === 'awardChange'
              ? panel.award.award
              : 'Add award';
  const saveLabel =
    panel === null
      ? 'Save'
      : panel.kind === 'withdraw' || (panel.kind === 'awardChange' && panel.to === null)
        ? 'Take it back'
        : panel.kind === 'add'
          ? 'Add it'
          : panel.kind === 'award'
            ? 'Give'
            : 'Save';

  return (
    <View style={screen.flex}>
      <KeyboardAvoidingView style={screen.flex} behavior="padding">
        <ScrollView contentContainerStyle={screen.scroll} keyboardShouldPersistTaps="handled">
          {/* #264 V31: one way back, top left (the second link at the foot went). */}
          <TopBar
            back={
              <BackLink label={backLabel === 'Back' ? 'Back' : backLabel.replace(/^Back to /, '')} accessibilityLabel={backLabel} onPress={onBack} />
            }
          />
          <Text style={screen.title} numberOfLines={1}>
            {(match.opponent ?? '').trim() || 'Opponent not recorded'}
          </Text>
          <Text style={screen.caption} numberOfLines={1}>
            {whenLabel(match.kickoffAt ? new Date(match.kickoffAt) : null, now)}
            {competition === '' ? '' : ` · ${competition}`}
          </Text>
          <Text style={match.score ? local.score : screen.caption}>{scoreLabel(match.score)}</Text>
          {pitch}
          {trust && <TrustRow trust={trust} />}
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
          {actions && (
            <RowNav
              label="Correct how it was played"
              onPress={() =>
                openPanel({
                  kind: 'structure',
                  lengths: st.periodMs.map((p) => String(Math.round((p / 60_000) * 10) / 10)).join(' '),
                  note: '',
                  error: '',
                })
              }
            />
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
          {actions && (
            <RowNav
              label="Add goal / conceded (time unknown)"
              onPress={() => openPanel({ kind: 'add', event: 'goal', scorer: null, note: '', error: '' })}
            />
          )}

          {/* #197: awards. One match's, so open to the coach (ADR-017 §3); never a fairness input. */}
          <Text style={screen.fieldLabel}>Awards</Text>
          {page.awards.length === 0 && <Text style={local.lineFaint}>No awards recorded for this match.</Text>}
          {page.awards.map((a) =>
            actions ? (
              <RowNav
                key={`${a.awardTypeId}:${a.playerId}`}
                label={`${a.award}: ${a.name}${a.note ? ` (${a.note})` : ''}`}
                value="Change"
                accessibilityLabel={`Change ${a.award} for ${a.name}`}
                onPress={() => openPanel({ kind: 'awardChange', award: a, to: null, note: '', error: '' })}
              />
            ) : (
              <View key={`${a.awardTypeId}:${a.playerId}`} style={local.goalRow}>
                <Text style={local.goalText} numberOfLines={2}>
                  {a.award}: {a.name}
                  {a.note ? ` (${a.note})` : ''}
                </Text>
              </View>
            )
          )}
          {actions && page.awardTypes.length > 0 && (
            <RowNav
              label="Add award"
              onPress={() =>
                openPanel({ kind: 'award', typeId: page.awardTypes[0].id, playerId: null, note: '', error: '' })
              }
            />
          )}

          {/* #198 AC3: the coach's tallies, collapsed and apart from the core; #264: a Section heading. */}
          {page.tallies.length > 0 && (
            <Section
              title="More stats"
              summary={`${page.tallies.length}`}
              open={moreStats}
              onToggle={() => setMoreStats((v) => !v)}
            >
              <Text style={local.lineFaint}>{TALLY_CAPTION}.</Text>
              {page.tallies.map((t) => (
                <Text key={t.kind} style={local.line} numberOfLines={3}>
                  {tallyLineText(t)}
                </Text>
              ))}
            </Section>
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
        </ScrollView>
      </KeyboardAvoidingView>

      {/* #264: every correction is a sheet (Cancel, Save); only Save writes, and each keeps its note (C4). */}
      <FormSheet
        visible={panel !== null}
        title={sheetTitle}
        saveLabel={saveLabel}
        onCancel={() => setPanel(null)}
        onSave={submit}
        saveDisabled={saveDisabled}
        dirty={panelDirty}
        thing={panel?.kind === 'award' || panel?.kind === 'awardChange' ? 'award' : 'correction'}
      >
        {panel?.kind === 'structure' && (
          <>
            <SheetNote>Each period’s minutes, in order, e.g. 20 20 10 10</SheetNote>
            <FieldRow
              label="Minutes"
              value={panel.lengths}
              onChangeText={(lengths) => setPanel({ ...panel, lengths, error: '' })}
              keyboardType="numbers-and-punctuation"
            />
            <NoteBox value={panel.note} onChange={(note) => setPanel({ ...panel, note, error: '' })} placeholder="Needed" />
          </>
        )}
        {panel?.kind === 'withdraw' && (
          <>
            <SheetNote>Take back this goal? It stays in the record, marked as taken back.</SheetNote>
            <NoteBox value={panel.note} onChange={(note) => setPanel({ ...panel, note, error: '' })} placeholder="Needed" />
          </>
        )}
        {panel?.kind === 'add' && (
          <>
            <SegmentedRow
              label="What"
              options={[
                { value: 'goal' as const, label: 'Our goal' },
                { value: 'conceded' as const, label: 'Goal against' },
              ]}
              value={panel.event}
              onChange={(event) => event && setPanel({ ...panel, event, error: '' })}
            />
            {panel.event === 'goal' && (
              <>
                <Text style={screen.fieldLabel}>Who scored?</Text>
                {page.minutes.map((m) => (
                  <CheckLine
                    key={m.playerId}
                    label={m.name}
                    checked={panel.scorer === m.playerId}
                    onPress={() => setPanel({ ...panel, scorer: m.playerId, error: '' })}
                  />
                ))}
                <CheckLine
                  label="Not known"
                  checked={panel.scorer === null}
                  onPress={() => setPanel({ ...panel, scorer: null, error: '' })}
                />
              </>
            )}
            <NoteBox
              value={panel.note}
              onChange={(note) => setPanel({ ...panel, note, error: '' })}
              placeholder="Where is it known from?"
            />
            <SheetNote>It counts in the score, and in no figure by period or time.</SheetNote>
          </>
        )}
        {panel?.kind === 'awardChange' && (
          <>
            <SheetNote>
              {panel.award.award}: give it to someone else, or take it back. The record keeps the earlier one.
            </SheetNote>
            {page.minutes
              .filter((m) => m.playerId !== panel.award.playerId)
              .map((m) => (
                <CheckLine
                  key={m.playerId}
                  label={m.name}
                  checked={panel.to === m.playerId}
                  onPress={() => setPanel({ ...panel, to: m.playerId, error: '' })}
                />
              ))}
            <CheckLine
              label="Take it back"
              checked={panel.to === null}
              onPress={() => setPanel({ ...panel, to: null, error: '' })}
            />
            <NoteBox
              value={panel.note}
              onChange={(note) => setPanel({ ...panel, note, error: '' })}
              placeholder="Needed after match day"
            />
          </>
        )}
        {panel?.kind === 'award' && (
          <>
            <Text style={screen.fieldLabel}>Award</Text>
            {page.awardTypes.map((t) => (
              <CheckLine
                key={t.id}
                label={t.name}
                checked={panel.typeId === t.id}
                onPress={() => setPanel({ ...panel, typeId: t.id, error: '' })}
              />
            ))}
            {page.awards.some((a) => a.awardTypeId === panel.typeId) && (
              <SheetNote>Already given: this adds a joint winner.</SheetNote>
            )}
            <Text style={screen.fieldLabel}>Who for?</Text>
            {page.minutes.map((m) => (
              <CheckLine
                key={m.playerId}
                label={m.name}
                checked={panel.playerId === m.playerId}
                onPress={() => setPanel({ ...panel, playerId: m.playerId, error: '' })}
              />
            ))}
            <NoteBox value={panel.note} onChange={(note) => setPanel({ ...panel, note, error: '' })} placeholder="Optional" />
          </>
        )}
        {panel !== null && panel.error !== '' && <Text style={screen.error}>{panel.error}</Text>}
      </FormSheet>
    </View>
  );
}

/** #199 AC3: "How was this recorded?", in the same words wherever the match is shown. */
export function TrustRow({ trust }: { trust: ProvenanceInfo }) {
  const tag = provenanceTag(trust.state);
  return (
    <View style={local.trust}>
      <Text style={screen.fieldLabel}>How was this recorded?</Text>
      <Text style={trust.state === 'pristine' ? local.lineFaint : local.reconstructed}>
        {tag ? `${tag}. ` : ''}
        {trust.why}
      </Text>
    </View>
  );
}

function NoteBox({ value, onChange, placeholder }: { value: string; onChange: (t: string) => void; placeholder: string }) {
  return <FieldRow label="Why" value={value} onChangeText={onChange} placeholder={placeholder} />;
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
  trust: { alignSelf: 'stretch' },
  reconstructed: {
    alignSelf: 'stretch',
    textAlign: 'left',
    color: colours.taint,
    fontSize: 13,
    includeFontPadding: false,
    marginTop: 8,
  },
  line: { alignSelf: 'stretch', color: colours.ink, fontSize: 15, includeFontPadding: false, marginTop: 4 },
  lineFaint: { alignSelf: 'stretch', color: colours.inkMuted, fontSize: 14, includeFontPadding: false, marginTop: 4 },
  goalRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', marginTop: 4 },
  goalText: { flex: 1, minWidth: 0, color: colours.ink, fontSize: 15, includeFontPadding: false },
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
