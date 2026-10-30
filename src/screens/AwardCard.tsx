/**
 * The award card — #228 item 6 (Dee's design, approved 23 Oct). One row of
 * name chips per active award type, showing who already has it. Tap a name
 * to give it (with an optional note), tap a ticked name to take it back. Each
 * act is the record's existing `award` event (#197): the earlier record stays
 * in the chain, and a change after the day of the match needs its note.
 *
 * Joint winners are allowed, one by default on screen (PO ruling, 18 Oct):
 * a second name for the same award is an explicit, labelled step.
 *
 * Drawn on the report when End match asks for awards (Q5) and, from the
 * clock, at a break between periods.
 *
 * #264: a winner's tick is an icon, not "✓" text (V2); giving or taking back
 * opens a sheet (Cancel, Save) with its note, so a tap outside gives nothing.
 */

import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { UUID } from '../types/index';
import type { AwardRow } from '../app/matchAwards';
import { Chip, ChipRow } from './Chip';
import { FieldRow, FormSheet, SheetNote } from './controls';
import { Text } from './Text';
import { colours, screen } from './theme';

type Pending = { mode: 'give' | 'take'; typeId: UUID; playerId: UUID; note: string; error: string };

export function AwardCard({
  rows,
  childrenInMatch,
  onGive,
  onTakeBack,
  footer,
}: {
  rows: AwardRow[];
  /** The children who took part, in squad order. */
  childrenInMatch: { playerId: UUID; name: string }[];
  /** The reason when refused, else null. */
  onGive: (typeId: UUID, playerId: UUID, note: string) => string | null;
  onTakeBack: (typeId: UUID, playerId: UUID, note: string) => string | null;
  footer?: ReactNode;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const nameOf = (id: UUID) => childrenInMatch.find((c) => c.playerId === id)?.name ?? '—';

  const submit = () => {
    if (!pending) return;
    const refused =
      pending.mode === 'give'
        ? onGive(pending.typeId, pending.playerId, pending.note)
        : onTakeBack(pending.typeId, pending.playerId, pending.note);
    if (refused) setPending({ ...pending, error: refused });
    else setPending(null);
  };

  return (
    <View style={local.card}>
      <Text style={local.heading}>Awards for this match</Text>
      {rows.map((row) => {
        const has = new Set(row.winners.map((w) => w.playerId));
        const open = pending?.typeId === row.typeId ? pending : null;
        return (
          <View key={row.typeId} style={local.row}>
            <Text style={local.type} numberOfLines={2}>
              {row.name}
              {row.winners.length > 0 ? ` · given: ${row.winners.map((w) => w.name).join(', ')}` : ''}
            </Text>
            <ChipRow>
              {childrenInMatch.map((c) => (
                <Chip
                  key={c.playerId}
                  label={c.name}
                  tick={has.has(c.playerId)}
                  selected={has.has(c.playerId) || open?.playerId === c.playerId}
                  onPress={() =>
                    setPending({
                      mode: has.has(c.playerId) ? 'take' : 'give',
                      typeId: row.typeId,
                      playerId: c.playerId,
                      note: '',
                      error: '',
                    })
                  }
                />
              ))}
            </ChipRow>
            <FormSheet
              visible={open !== null}
              title={row.name}
              saveLabel={open?.mode === 'take' ? 'Take it back' : 'Give'}
              onCancel={() => setPending(null)}
              onSave={submit}
            >
              {open && (
                <>
                  <SheetNote>
                    {open.mode === 'take'
                      ? `Take ${row.name} back from ${nameOf(open.playerId)}? The record keeps the earlier one.`
                      : row.winners.length > 0
                        ? `Already given: this adds ${nameOf(open.playerId)} as a joint winner.`
                        : `${row.name} for ${nameOf(open.playerId)}.`}
                  </SheetNote>
                  <FieldRow
                    label="Note"
                    value={open.note}
                    onChangeText={(note) => setPending({ ...open, note, error: '' })}
                    placeholder={open.mode === 'take' ? 'Needed after match day' : 'Optional'}
                  />
                  {open.error !== '' && <Text style={screen.error}>{open.error}</Text>}
                </>
              )}
            </FormSheet>
          </View>
        );
      })}
      {footer}
    </View>
  );
}

const local = StyleSheet.create({
  card: {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colours.line,
    backgroundColor: colours.pitchRaised,
  },
  heading: { color: colours.ink, fontSize: 18, fontWeight: '700', includeFontPadding: false },
  row: { marginTop: 10 },
  type: { color: colours.inkMuted, fontSize: 15, marginBottom: 4, includeFontPadding: false },
});
