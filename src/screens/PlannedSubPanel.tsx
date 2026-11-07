/**
 * One planned sub, added or changed (#264 V20, V21), shared by the Plan and
 * the Team sheet so a sub is made the same way on every screen that plans
 * one (Rob, 7 Nov: "it should work in all team selection screens").
 *
 * A tap on a bench child opens their sub, coming on; a tap on a child on the
 * pitch, then "Sub off", opens a sub with them coming off (`subRequestFor`).
 * At is on the 15 s stepper; For is a list with a tick, "Whoever is on
 * longest" first.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import type { Player, UUID } from '../types/index';
import { displayName } from '../app/squad';
import { formatSubTime } from '../app/matchClock';
import {
  addSwap,
  clampSwapTime,
  longestOnAt,
  newSubTimeMs,
  removeSwap,
  SUB_STEP_MS,
  swapChoices,
  updateSwap,
  type MatchPlan,
} from '../app/matchPlan';
import type { Format } from '../types/index';
import type { SubRequest } from '../app/teamSheetEdit';
export { subRequestFor, type SubRequest } from '../app/teamSheetEdit';
import { Action, CheckLine, FormSheet, Stepper } from './controls';
import { colours, screen, TOUCH_TARGET } from './theme';

interface SubDraft {
  swapIndex: number;
  onId: UUID | null;
  offId: UUID | null;
  /** "Whoever is on longest" ticked: resolved to a name on Save (`longestOnAt`). */
  longest: boolean;
  atMs: number;
}

export function PlannedSubPanel({
  request,
  plan,
  periodIndex,
  periodMs,
  format,
  players,
  noun,
  name,
  onChange,
  onClose,
  onPutInLineup,
}: {
  /** The sub to open, or null when closed. */
  request: SubRequest | null;
  plan: MatchPlan;
  periodIndex: number;
  periodMs: number;
  format: Format;
  /** Who can come on or off: the children coming. */
  players: Player[];
  /** "Quarter" or "Half". */
  noun: string;
  name: (id: UUID | null) => string;
  onChange: (next: MatchPlan) => void;
  onClose: () => void;
  /** Offered for a bench child: put them in the starting lineup instead. */
  onPutInLineup?: (id: UUID) => void;
}) {
  const period = plan.periods[periodIndex];
  const [draft, setDraft] = useState<SubDraft | null>(null);
  useEffect(() => {
    if (!request || !period) {
      setDraft(null);
      return;
    }
    const swap = request.swapIndex === -1 ? null : period.subs[request.swapIndex];
    setDraft({
      swapIndex: request.swapIndex,
      onId: swap ? swap.onId : request.onId,
      offId: swap ? swap.offId : request.offId,
      longest: false,
      atMs: swap ? swap.atMs : newSubTimeMs(periodMs),
    });
    // A new request object opens the panel afresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const on = new Set(Object.values(period?.slots ?? {}).filter((id): id is UUID => id !== null));

  /** Who the sub can bring on and take off at its time (`swapChoices`, match day 4). */
  const choices = (() => {
    if (!draft || !period) return { on: [] as Player[], off: [] as Player[] };
    const probe = { onId: draft.onId, offId: draft.offId, atMs: draft.atMs };
    const subs = draft.swapIndex === -1 ? [...period.subs, probe] : period.subs.map((s, i) => (i === draft.swapIndex ? probe : s));
    const index = draft.swapIndex === -1 ? subs.length - 1 : draft.swapIndex;
    const c = swapChoices({ ...period, subs }, index, players);
    return { on: c.on.filter((p) => p.id !== draft.offId), off: c.off.filter((p) => p.id !== draft.onId) };
  })();

  // QA on #260 (D12): who "whoever is on longest" is at the sub's time, by the plan.
  const longestId = draft && period ? longestOnAt(period, draft.swapIndex, clampSwapTime(draft.atMs, periodMs), format) : null;
  const forId = draft ? (draft.longest ? longestId : draft.offId) : null;

  const save = () => {
    if (!draft || draft.onId === null || forId === null) return;
    const sub = { onId: draft.onId, offId: forId, atMs: clampSwapTime(draft.atMs, periodMs) };
    if (draft.swapIndex === -1) {
      const added = addSwap(plan, periodIndex, periodMs);
      onChange(updateSwap(added, periodIndex, added.periods[periodIndex].subs.length - 1, sub));
    } else {
      onChange(updateSwap(plan, periodIndex, draft.swapIndex, sub));
    }
    onClose();
  };

  // Who comes on is asked unless a bench child's tap already said.
  const askOn = draft !== null && (draft.swapIndex !== -1 || draft.onId === null);
  const title = draft?.onId
    ? `${name(draft.onId)} comes on`
    : draft?.offId && !draft.longest
      ? `${name(draft.offId)} comes off`
      : 'A sub';

  return (
    <FormSheet
      visible={request !== null && draft !== null}
      title={title}
      onCancel={onClose}
      onSave={save}
      // Save waits for who comes on and For (QA on #260, D12).
      saveDisabled={draft === null || draft.onId === null || forId === null}
    >
      {draft && (
        <>
          {askOn && (
            <>
              <Text style={screen.fieldLabel}>Who comes on</Text>
              {choices.on.map((p) => (
                <CheckLine key={p.id} label={displayName(p)} checked={draft.onId === p.id} onPress={() => setDraft({ ...draft, onId: p.id })} />
              ))}
            </>
          )}
          <View style={local.atRow}>
            <Text style={local.atLabel}>At</Text>
            <Text style={local.atValue} numberOfLines={1}>
              {formatSubTime(draft.atMs)}
            </Text>
            <Stepper
              minusLabel="15 seconds earlier"
              plusLabel="15 seconds later"
              onMinus={() => setDraft({ ...draft, atMs: clampSwapTime(draft.atMs - SUB_STEP_MS, periodMs) })}
              onPlus={() => setDraft({ ...draft, atMs: clampSwapTime(draft.atMs + SUB_STEP_MS, periodMs) })}
            />
          </View>
          <Text style={screen.fieldLabel}>For</Text>
          {choices.off.length === 0 ? (
            <Text style={local.note}>Nobody is on the pitch yet this {noun.toLowerCase()}. Pick the starters first.</Text>
          ) : (
            <>
              {/* First, as on the lineup's planned-sub sheet (#264 V20). */}
              <CheckLine
                label="Whoever is on longest"
                detail={longestId !== null ? name(longestId) : undefined}
                checked={draft.longest}
                onPress={() => setDraft({ ...draft, longest: true, offId: null })}
              />
              {choices.off.map((p) => (
                <CheckLine
                  key={p.id}
                  label={displayName(p)}
                  checked={!draft.longest && draft.offId === p.id}
                  onPress={() => setDraft({ ...draft, longest: false, offId: p.id })}
                />
              ))}
            </>
          )}
          {draft.swapIndex !== -1 && (
            <Action
              label="Remove this sub"
              onPress={() => {
                onChange(removeSwap(plan, periodIndex, draft.swapIndex));
                onClose();
              }}
            />
          )}
          {onPutInLineup && draft.onId !== null && !on.has(draft.onId) && (
            <Action
              label="Put in the starting lineup…"
              onPress={() => {
                onPutInLineup(draft.onId!);
                onClose();
              }}
            />
          )}
        </>
      )}
    </FormSheet>
  );
}

const local = StyleSheet.create({
  note: { color: colours.inkFaint, fontSize: 14, includeFontPadding: false, marginBottom: 4 },
  atRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOUCH_TARGET,
    borderBottomWidth: 1,
    borderBottomColor: colours.hair,
  },
  atLabel: { flex: 1, color: colours.ink, fontSize: 16, includeFontPadding: false },
  // A fixed width: "6:15" and "12:30" share the slot (theme.ts).
  atValue: {
    width: 68,
    flexShrink: 0,
    textAlign: 'right',
    paddingRight: 8,
    color: colours.ink,
    fontSize: 16,
    includeFontPadding: false,
  },
});
