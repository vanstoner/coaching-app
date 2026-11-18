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
import type { AwardPick, AwardRow } from '../app/matchAwards';
import { Chip, ChipRow } from './Chip';
import { FieldRow, FormSheet, SheetNote } from './controls';
import { Text } from './Text';
import { colours, screen } from './theme';

type TakeBack = { typeId: UUID; playerId: UUID; note: string; error: string };

/** #266: the picks waiting under each award, and each award's one note. Screen state only. */
export type Picks = Record<string, { playerIds: UUID[]; note: string }>;

export function picksCount(picks: Picks): number {
  return Object.values(picks).reduce((n, p) => n + p.playerIds.length, 0);
}

export function picksList(picks: Picks): AwardPick[] {
  return Object.entries(picks)
    .filter(([, p]) => p.playerIds.length > 0)
    .map(([typeId, p]) => ({ typeId: typeId as UUID, playerIds: p.playerIds, note: p.note }));
}

/** "Give 3 awards", or "Pick names to give" with nothing picked (#266 C3). */
export function giveLabel(n: number): string {
  return n === 0 ? 'Pick names to give' : `Give ${n} award${n === 1 ? '' : 's'}`;
}

/**
 * The card (#266, Dee's prototype, Rob 7 Nov): tap names to pick them under
 * each award, then one Give writes them all. Picking writes nothing. A ticked
 * (given) name opens Take it back, as before. The picks are held by the
 * screen that draws the card, so Start, End match and Give them later can ask
 * about them first (C10).
 */
export function AwardCard({
  rows,
  childrenInMatch,
  picks,
  onPicks,
  onTakeBack,
  error,
  footer,
}: {
  rows: AwardRow[];
  /** The children who took part, in squad order. */
  childrenInMatch: { playerId: UUID; name: string }[];
  picks: Picks;
  onPicks: (next: Picks) => void;
  onTakeBack: (typeId: UUID, playerId: UUID, note: string) => string | null;
  /** A refused Give's reason; the picks stay as they were (C7). */
  error?: string;
  /** The Give button and anything under it, drawn by the screen. */
  footer?: ReactNode;
}) {
  const [taking, setTaking] = useState<TakeBack | null>(null);
  const nameOf = (id: UUID) => childrenInMatch.find((c) => c.playerId === id)?.name ?? '—';
  const both = (ids: UUID[]) => ids.map(nameOf).join(' and ');

  const toggle = (typeId: UUID, playerId: UUID) => {
    const was = picks[typeId] ?? { playerIds: [], note: '' };
    const playerIds = was.playerIds.includes(playerId)
      ? was.playerIds.filter((id) => id !== playerId)
      : [...was.playerIds, playerId];
    onPicks({ ...picks, [typeId]: { ...was, playerIds } });
  };

  const takeBack = () => {
    if (!taking) return;
    const refused = onTakeBack(taking.typeId, taking.playerId, taking.note);
    if (refused) setTaking({ ...taking, error: refused });
    else setTaking(null);
  };

  return (
    <View style={local.card}>
      <Text style={local.heading}>Awards for this match</Text>
      {rows.map((row) => {
        const has = new Set(row.winners.map((w) => w.playerId));
        const picked = picks[row.typeId]?.playerIds ?? [];
        const joint = row.winners.length + picked.length > 1;
        const line =
          row.winners.length > 0
            ? `given: ${row.winners.map((w) => w.name).join(' and ')}`
            : picked.length > 0
              ? `picked: ${both(picked)}`
              : 'not given';
        return (
          <View key={row.typeId} style={local.row}>
            <Text style={local.type} numberOfLines={2}>
              <Text style={local.typeName}>{row.name}</Text>
              {joint ? <Text style={local.joint}>{'  joint'}</Text> : null}
              {`  ${line}`}
            </Text>
            <ChipRow>
              {childrenInMatch.map((c) => (
                <Chip
                  key={c.playerId}
                  label={c.name}
                  tick={has.has(c.playerId)}
                  selected={has.has(c.playerId)}
                  picked={picked.includes(c.playerId)}
                  onPress={() =>
                    has.has(c.playerId)
                      ? setTaking({ typeId: row.typeId, playerId: c.playerId, note: '', error: '' })
                      : toggle(row.typeId, c.playerId)
                  }
                />
              ))}
            </ChipRow>
            {picked.length > 0 && (
              <FieldRow
                label="Note"
                value={picks[row.typeId]?.note ?? ''}
                onChangeText={(note) => onPicks({ ...picks, [row.typeId]: { playerIds: picked, note } })}
                placeholder={`Optional, for ${picked.length > 1 ? 'both' : nameOf(picked[0])}`}
              />
            )}
          </View>
        );
      })}
      <Text style={screen.hint}>Tap names to pick them; tap again to unpick. A ticked name is given: tap it to take it back.</Text>
      {error ? <Text style={screen.error}>{error}</Text> : null}
      {footer}
      <FormSheet
        visible={taking !== null}
        title="Take it back"
        saveLabel="Take it back"
        onCancel={() => setTaking(null)}
        onSave={takeBack}
        dirty={taking !== null && taking.note !== ''}
        thing="note"
      >
        {taking && (
          <>
            <SheetNote>
              {`Take ${rows.find((r) => r.typeId === taking.typeId)?.name ?? 'it'} back from ${nameOf(taking.playerId)}? The record keeps the earlier one.`}
            </SheetNote>
            <FieldRow
              label="Note"
              value={taking.note}
              onChangeText={(note) => setTaking({ ...taking, note, error: '' })}
              placeholder="Needed after match day"
            />
            {taking.error !== '' && <Text style={screen.error}>{taking.error}</Text>}
          </>
        )}
      </FormSheet>
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
  type: { color: colours.inkMuted, fontSize: 14, marginBottom: 6, includeFontPadding: false },
  typeName: { color: colours.ink, fontSize: 16, fontWeight: '600' },
  joint: { color: colours.warn, fontSize: 13, fontWeight: '600' },
});
