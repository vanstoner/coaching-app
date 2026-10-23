/**
 * The clock's planned subs — #203, built to the prototype Rob approved
 * ("approve C1–C10", 2026-10-17).
 *
 * - `SubPrompts`: the "Bring on Ava for:" panel, rising 30 s before a sub,
 *   green then amber then red, with the countdown always in words (AC3).
 *   Subs due at the same time share one panel, a row each (C2).
 * - `SubPlanList`: this period's subs, always in view above the pitch (AC1).
 * - `SubPlanSheet`: change one sub during the period (AC2). The plan only.
 *
 * Every word and colour comes from `src/app/clockSubs.ts`, worked out on each
 * paint from the anchors' elapsed time (invariant 2). These only draw.
 *
 * The text rules are the theme's: colour changes between states, never
 * weight; fixed widths with `flexShrink: 0` for anything showing a time.
 */

import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import type { UUID } from '../types/index';
import { formatSubTime } from '../app/matchClock';
import { subCountdown, type SubBand, type SubList } from '../app/clockSubs';
import { isPlanned, type PlannedSub } from '../app/subPlan';
import { Chip, ChipRow } from './Chip';
import { ActionSheet, SheetButton } from './Sheet';
import { colours, screen, TOUCH_TARGET } from './theme';
import { SUB_PROMPT } from './subPromptColours';

/** Each band's panel, and the ink on it (C3: dark ink on the brighter amber; #227: 4.5:1). */
const BAND = SUB_PROMPT;

/** The list's dot and status colours, on the dark pitch. */
const DOT: Record<SubBand, string> = { green: '#4fd18b', amber: colours.amber, red: '#ff6b57' };
// #228 item 4: amber's status text is the same sand as its dot (7.12:1 on the pitch).
const STATUS: Record<SubBand, string> = { green: '#7fe0a9', amber: colours.amber, red: colours.danger };

// ---------------------------------------------------------------------------
// The prompts
// ---------------------------------------------------------------------------

export function SubPrompts({
  groups,
  band,
  elapsedMs,
  outfieldOn,
  chosenOff,
  expanded,
  nameOf,
  onChoose,
  onExpand,
  onDone,
  onNotNow,
}: {
  groups: PlannedSub[][];
  band: (sub: PlannedSub) => SubBand | null;
  elapsedMs: number;
  outfieldOn: UUID[];
  /** Who comes off for this sub if Done is pressed now. */
  chosenOff: (sub: PlannedSub) => UUID | null;
  /** The row of a shared panel whose choices are open (C2). */
  expanded: UUID | null;
  nameOf: (id: UUID) => string;
  onChoose: (sub: PlannedSub, offId: UUID) => void;
  onExpand: (playerId: UUID | null) => void;
  onDone: (sub: PlannedSub, offId: UUID) => void;
  onNotNow: (subs: PlannedSub[]) => void;
}) {
  return (
    <>
      {groups.map((group) => {
        const tone = BAND[band(group[0]) ?? 'green'];
        const ink = { color: tone.ink };
        const choices = (sub: PlannedSub, chosen: UUID | null) => (
          <View style={local.choiceRow}>
            {outfieldOn.map((id) => {
              const on = chosen === id;
              return (
                <Pressable
                  key={id}
                  onPress={() => onChoose(sub, id)}
                  style={[local.choice, { borderColor: tone.ink }, on && { backgroundColor: tone.ink }]}
                >
                  <Text style={[local.choiceText, { color: on ? tone.onInk : tone.ink }]} numberOfLines={1}>
                    {nameOf(id)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        );
        const countdown = (
          <View style={[local.countdown, { backgroundColor: tone.ink }]}>
            <Text style={[local.countdownText, { color: tone.onInk }]} numberOfLines={1}>
              {subCountdown(group[0], elapsedMs)}
            </Text>
          </View>
        );
        const notNow = (
          <Pressable onPress={() => onNotNow(group)} style={local.notNowHit}>
            <Text style={[local.notNow, ink]}>Not now</Text>
          </Pressable>
        );

        if (group.length === 1) {
          const sub = group[0];
          const chosen = chosenOff(sub);
          return (
            <View key={sub.playerId} style={[local.panel, { backgroundColor: tone.bg }]}>
              <View style={local.panelHead}>
                <Text style={[local.panelText, ink]} numberOfLines={2}>
                  Bring on {nameOf(sub.playerId)} for:
                </Text>
                {countdown}
              </View>
              {choices(sub, chosen)}
              <View style={local.actions}>
                {notNow}
                {chosen && (
                  <Pressable
                    onPress={() => onDone(sub, chosen)}
                    style={({ pressed }) => [
                      local.done,
                      { backgroundColor: tone.ink },
                      pressed && screen.buttonPressed,
                    ]}
                  >
                    <Text style={[local.doneText, { color: tone.onInk }]}>Done</Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        }

        // C2: two or more due at once, one panel, one row each.
        return (
          <View key={group[0].playerId} style={[local.panel, { backgroundColor: tone.bg }]}>
            <View style={local.panelHead}>
              <Text style={[local.panelText, ink]} numberOfLines={1}>
                {group.length} subs: bring on
              </Text>
              {countdown}
            </View>
            {group.map((sub) => {
              const chosen = chosenOff(sub);
              const open = expanded === sub.playerId;
              return (
                <View key={sub.playerId}>
                  <View style={local.pairRow}>
                    <Text style={[local.pairText, ink]} numberOfLines={1}>
                      {nameOf(sub.playerId)} for
                    </Text>
                    <Pressable
                      onPress={() => onExpand(open ? null : sub.playerId)}
                      style={[local.pairChip, { backgroundColor: tone.ink }]}
                    >
                      <Text style={[local.choiceText, { color: tone.onInk }]} numberOfLines={1}>
                        {chosen ? nameOf(chosen) : 'Pick'} {open ? '▴' : '▾'}
                      </Text>
                    </Pressable>
                    {chosen && (
                      <Pressable
                        onPress={() => onDone(sub, chosen)}
                        style={({ pressed }) => [
                          local.pairDone,
                          { backgroundColor: tone.ink },
                          pressed && screen.buttonPressed,
                        ]}
                      >
                        <Text style={[local.doneText, { color: tone.onInk }]}>Done</Text>
                      </Pressable>
                    )}
                  </View>
                  {open && choices(sub, chosen)}
                </View>
              );
            })}
            <View style={local.actions}>{notNow}</View>
          </View>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export function SubPlanList({
  title,
  list,
  nameOf,
  onOpen,
}: {
  /** "Subs this quarter". */
  title: string;
  list: SubList;
  nameOf: (id: UUID) => string;
  /** A line, or a "Not planned" name, opens the sheet (AC2, C7). */
  onOpen: (playerId: UUID) => void;
}) {
  const empty = list.lines.length === 0 && list.notPlanned.length === 0;
  return (
    <View style={local.plan}>
      <Text style={local.planHead}>{title}</Text>
      {empty && <Text style={local.planEmpty}>No subs planned.</Text>}
      {list.lines.map((line, i) =>
        line.done ? (
          <View key={line.playerId} style={[local.line, local.lineDone, i > 0 && local.lineRule]}>
            <Text style={local.tick}>✓</Text>
            <Text style={[local.lineText, local.lineTextDone]} numberOfLines={2}>
              {line.text}
            </Text>
          </View>
        ) : (
          <Pressable
            key={line.playerId}
            onPress={() => onOpen(line.playerId)}
            style={({ pressed }) => [local.line, i > 0 && local.lineRule, pressed && local.linePressed]}
          >
            <View style={[local.dot, line.band && { backgroundColor: DOT[line.band] }]} />
            <Text style={local.lineText} numberOfLines={2}>
              {line.text}
            </Text>
            <Text style={[local.status, line.band && { color: STATUS[line.band] }]} numberOfLines={1}>
              {line.status}
            </Text>
            <Text style={local.chevron}>›</Text>
          </Pressable>
        )
      )}
      {list.notPlanned.length > 0 && (
        <View style={[local.notPlanned, list.lines.length > 0 && local.lineRule]}>
          <Text style={local.notPlannedLabel}>Not planned:</Text>
          {list.notPlanned.map((id) => (
            <Pressable key={id} onPress={() => onOpen(id)} style={local.notPlannedHit}>
              <Text style={local.notPlannedName} numberOfLines={1}>
                {nameOf(id)}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

export function SubPlanSheet({
  sub,
  nameOf,
  outfieldOn,
  suggested,
  canPromptAgain,
  onMove,
  onSetFor,
  onPromptAgain,
  onRemove,
  onClose,
}: {
  sub: PlannedSub | null;
  nameOf: (id: UUID) => string;
  outfieldOn: UUID[];
  /** Who the app would take off if the coach does not say. */
  suggested: UUID | null;
  /** "Not now" was pressed and the warning is on: offer the prompt back. */
  canPromptAgain: boolean;
  onMove: (deltaMs: number) => void;
  onSetFor: (offId: UUID | null) => void;
  onPromptAgain: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const planned = sub !== null && isPlanned(sub);
  const title = !sub
    ? ''
    : planned
      ? `${nameOf(sub.playerId)} on${sub.forPlayerId ? ` for ${nameOf(sub.forPlayerId)}` : ''} · ${formatSubTime(sub.atMs)}`
      : `${nameOf(sub.playerId)}: not planned`;
  return (
    <ActionSheet visible={sub !== null} title={title} onClose={onClose} closeLabel="Close">
      {sub && (
        <>
          <Text style={local.sheetHint}>Changes the plan only. Nothing is recorded.</Text>
          <Text style={screen.fieldLabel}>When</Text>
          <View style={local.timeRow}>
            <Pressable
              onPress={() => onMove(-30_000)}
              disabled={!planned}
              style={[local.step, !planned && local.stepOff]}
              accessibilityLabel="30 seconds earlier"
            >
              <Text style={local.stepText}>−30 s</Text>
            </Pressable>
            <Text style={local.timeValue} numberOfLines={1}>
              {planned ? formatSubTime(sub.atMs) : '–'}
            </Text>
            <Pressable onPress={() => onMove(30_000)} style={local.step} accessibilityLabel="30 seconds later">
              <Text style={local.stepText}>+30 s</Text>
            </Pressable>
          </View>
          <Text style={screen.fieldLabel}>Who comes off</Text>
          <ChipRow>
            <Chip
              label={suggested ? `Suggest (now ${nameOf(suggested)})` : 'Suggest'}
              selected={sub.forPlayerId === null}
              onPress={() => onSetFor(null)}
              wide
            />
            {outfieldOn.map((id) => (
              <Chip key={id} label={nameOf(id)} selected={sub.forPlayerId === id} onPress={() => onSetFor(id)} />
            ))}
          </ChipRow>
          <View style={local.sheetGap} />
          {canPromptAgain && <SheetButton label="Show the prompt again" strong onPress={onPromptAgain} />}
          {planned && <SheetButton label="Remove this sub" against onPress={onRemove} />}
        </>
      )}
    </ActionSheet>
  );
}

const local = StyleSheet.create({
  // --- prompts ---
  panel: {
    alignSelf: 'stretch',
    borderRadius: 10,
    paddingTop: 10,
    paddingBottom: 6,
    paddingHorizontal: 12,
    marginTop: 10,
  },
  panelHead: { flexDirection: 'row', alignItems: 'center' },
  panelText: { flex: 1, fontSize: 16, fontWeight: '700', includeFontPadding: false },
  countdown: { width: 96, flexShrink: 0, borderRadius: 8, paddingVertical: 5, marginLeft: 8 },
  countdownText: {
    alignSelf: 'stretch',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    includeFontPadding: false,
  },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  choice: {
    width: 96,
    minHeight: TOUCH_TARGET,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
    marginBottom: 6,
  },
  choiceText: {
    alignSelf: 'stretch',
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
    includeFontPadding: false,
    paddingHorizontal: 4,
  },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  notNowHit: { minHeight: TOUCH_TARGET, justifyContent: 'center', paddingRight: 12, flexShrink: 0 },
  notNow: { fontSize: 15, textDecorationLine: 'underline', includeFontPadding: false },
  done: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: { fontSize: 15, fontWeight: '700', includeFontPadding: false },
  pairRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  pairText: { flex: 1, fontSize: 15, fontWeight: '700', includeFontPadding: false },
  pairChip: {
    width: 110,
    flexShrink: 0,
    minHeight: TOUCH_TARGET,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  pairDone: {
    width: 80,
    flexShrink: 0,
    minHeight: TOUCH_TARGET,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },

  // --- the list ---
  plan: {
    alignSelf: 'stretch',
    backgroundColor: colours.pitchRaised,
    borderColor: colours.line,
    borderWidth: 1,
    borderRadius: 10,
    marginTop: 10,
    paddingBottom: 2,
  },
  planHead: {
    color: colours.inkMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    includeFontPadding: false,
    paddingTop: 8,
    paddingHorizontal: 12,
  },
  planEmpty: { color: colours.inkFaint, fontSize: 13, includeFontPadding: false, padding: 12 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOUCH_TARGET,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 4,
  },
  lineRule: { borderTopWidth: 1, borderTopColor: '#164f3c' },
  linePressed: { backgroundColor: '#164f3c' },
  lineDone: { minHeight: 30 },
  dot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0, marginRight: 8 },
  tick: { width: 18, flexShrink: 0, color: colours.inkFaint, fontSize: 13, includeFontPadding: false },
  lineText: { flex: 1, color: colours.ink, fontSize: 15, includeFontPadding: false },
  lineTextDone: { color: colours.inkFaint, fontSize: 14 },
  status: {
    width: 78,
    flexShrink: 0,
    textAlign: 'right',
    color: colours.inkMuted,
    fontSize: 13,
    fontWeight: '700',
    includeFontPadding: false,
  },
  chevron: { width: 14, flexShrink: 0, textAlign: 'right', color: colours.inkMuted, fontSize: 18, includeFontPadding: false },
  notPlanned: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', paddingHorizontal: 12 },
  notPlannedLabel: { color: colours.inkMuted, fontSize: 13, includeFontPadding: false, marginRight: 4 },
  notPlannedHit: { minHeight: TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 6 },
  notPlannedName: { color: colours.ink, fontSize: 14, textDecorationLine: 'underline', includeFontPadding: false },

  // --- the sheet ---
  sheetHint: { color: colours.inkMuted, fontSize: 13, includeFontPadding: false },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  step: {
    width: 88,
    minHeight: TOUCH_TARGET,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colours.line,
    backgroundColor: colours.pitch,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepOff: { opacity: 0.4 },
  stepText: { color: colours.ink, fontSize: 16, fontWeight: '600', includeFontPadding: false },
  timeValue: {
    width: 96,
    flexShrink: 0,
    textAlign: 'center',
    color: colours.ink,
    fontSize: 28,
    fontWeight: '300',
    includeFontPadding: false,
  },
  sheetGap: { height: 10 },
});
