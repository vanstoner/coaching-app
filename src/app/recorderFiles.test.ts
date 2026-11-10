/**
 * #281 (ADR-025): the recorder pack out, the recorded match back, and the
 * import with its refusals. Made-up names only.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/MatchEngine';
import { uuid } from '../types/index';
import type { UUID } from '../types/index';
import { makePlayer } from './squad';
import { makeFormat } from './shapes';
import { addUnknownTimeEvent, appendRecords, emptyLedger, recordMatches, serialiseLedger, type Ledger } from './ledger';
import { fixtureRecord } from './ledgerSetup';
import { provenanceOf } from './provenance';
import { readTeamRow } from './teamRows';
import { setEntrySigner, signerFromSecret } from './entrySigning';
import {
  ALREADY_IN_RECORD,
  borrowedFor,
  borrowedMatchFinished,
  openPack,
  sameChildren,
  importRecordedMatch,
  makeRecordedMatch,
  makeRecorderPack,
  packLedger,
  readRecorderFile,
  RECORDED_HERE_TOO,
  recordedElsewhere,
} from './recorderFiles';

const squadId = uuid();
const players = ['Ava', 'Ben', 'Cal', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal'].map((n) => makePlayer(squadId, n));
const format = makeFormat('2-3-1');
const T0 = new Date('2026-11-01T09:00:00Z');

function coachWithFixture() {
  const engine = new MatchEngine({ nowFn: () => T0 });
  const state = engine.createMatch(squadId, format.id, { totalMinutes: 50, quarterCount: 4, availablePlayerIds: players.map((p) => p.id) });
  state.match.opponent = 'Rovers';
  let coach = emptyLedger(squadId, 'Test FC', T0);
  coach = recordMatches(coach, [], players, 'Test FC', T0);
  coach = appendRecords(coach, players.map((p) => ({ type: 'player', id: p.id, firstName: p.firstName, displaySuffix: null, active: true })), T0);
  coach = appendRecords(coach, [fixtureRecord({ match: state.match, format } as never)], T0);
  return { coach, state };
}

/** The recorder's borrowed team plays the fixture through and closes it. */
function recordOnBorrowed(pack: Ledger, fixtureMatch: ReturnType<typeof coachWithFixture>['state']) {
  let now = new Date('2026-11-08T10:00:00Z');
  const engine = new MatchEngine({ nowFn: () => now });
  const state = engine.createMatch(squadId, format.id, { totalMinutes: 50, quarterCount: 4, availablePlayerIds: players.map((p) => p.id) });
  state.match = { ...state.match, id: fixtureMatch.match.id, opponent: 'Rovers' };
  state.quarters.forEach((q) => (q.matchId = state.match.id));
  const sheet = new Map<UUID, UUID>();
  format.positions.forEach((p, i) => sheet.set(p.id, players[i].id));
  for (const q of state.quarters) {
    engine.startQuarter(state, q, sheet, format);
    now = new Date(now.getTime() + 12.5 * 60_000);
    engine.endQuarter(state, q);
  }
  engine.completeMatch(state);
  return recordMatches(pack, [{ ...state, format }], players, 'Test FC', now);
}

describe('the recorder pack (ADR-025 D1, D2)', () => {
  it('holds the team name, active children, the fixture and a pack record; no history', () => {
    const { coach, state } = coachWithFixture();
    const pack = packLedger(coach, state.match.id, T0);
    expect(pack.squad.name).toBe('Test FC');
    expect(pack.players.map((p) => p.firstName).sort()).toEqual(players.map((p) => p.firstName).sort());
    expect(pack.fixtures.map((f) => f.id)).toEqual([state.match.id]);
    expect(pack.matches).toEqual([]);
    expect(pack.entries.flatMap((e) => e.records).some((r) => r.type === 'pack' && r.fixtureId === state.match.id)).toBe(true);
  });

  it('reads back by kind; a bare minutes file goes to Import minutes file; a newer file is refused', () => {
    const { coach, state } = coachWithFixture();
    const file = makeRecorderPack(coach, state.match.id, null, [], T0);
    const back = readRecorderFile(JSON.stringify(file));
    expect(back.kind).toBe('pack');
    expect(readRecorderFile(serialiseLedger(coach)).kind).toBe('minutes');
    expect(readRecorderFile(JSON.stringify({ ...file, minReaderVersion: 2 }))).toMatchObject({ kind: 'refused' });
  });
});

describe('importing the recorded match (ADR-025 D5)', () => {
  it('appends the match unchanged, with a received record; then refuses it twice', () => {
    const { coach, state } = coachWithFixture();
    const pack = packLedger(coach, state.match.id, T0);
    const borrowed = recordOnBorrowed(pack, state);
    const file = makeRecordedMatch(borrowed, state.match.id, new Date('2026-11-08T11:00:00Z'));
    const read = readRecorderFile(JSON.stringify(file));
    if (read.kind !== 'match') throw new Error(read.kind);
    const r = importRecordedMatch(coach, read.file, read.ledger, false, new Date('2026-11-08T12:00:00Z'));
    if (!r.ok) throw new Error(r.reason);
    const m = r.ledger.matches.find((x) => x.id === state.match.id)!;
    expect(m.status).toBe('completed');
    const theirs = read.ledger.matches.find((x) => x.id === state.match.id)!;
    expect(m.intervals.map((i) => i.id).sort()).toEqual(theirs.intervals.map((i) => i.id).sort());
    expect(recordedElsewhere(r.ledger, state.match.id)).toBe(true);
    expect(importRecordedMatch(r.ledger, read.file, read.ledger, false, new Date())).toEqual({ ok: false, reason: ALREADY_IN_RECORD });
  });

  it('refuses when this phone recorded the match too, or holds it live; nothing written', () => {
    const { coach, state } = coachWithFixture();
    const pack = packLedger(coach, state.match.id, T0);
    const borrowed = recordOnBorrowed(pack, state);
    const read = readRecorderFile(JSON.stringify(makeRecordedMatch(borrowed, state.match.id, new Date())));
    if (read.kind !== 'match') throw new Error(read.kind);
    expect(importRecordedMatch(coach, read.file, read.ledger, true, new Date())).toEqual({ ok: false, reason: RECORDED_HERE_TOO });
    const ownCopy = recordOnBorrowed(coach, state);
    expect(importRecordedMatch(ownCopy, read.file, read.ledger, false, new Date())).toEqual({ ok: false, reason: RECORDED_HERE_TOO });
  });

  it('refuses a match that is not one of this team\'s fixtures, or not finished', () => {
    const { coach, state } = coachWithFixture();
    const other = coachWithFixture();
    const read = readRecorderFile(JSON.stringify(makeRecordedMatch(recordOnBorrowed(packLedger(other.coach, other.state.match.id, T0), other.state), other.state.match.id, new Date())));
    if (read.kind !== 'match') throw new Error(read.kind);
    expect(importRecordedMatch(coach, read.file, read.ledger, false, new Date())).toMatchObject({ ok: false, reason: expect.stringMatching(/not one of this team/) });
    const unfinished = readRecorderFile(JSON.stringify(makeRecordedMatch(packLedger(coach, state.match.id, T0), state.match.id, new Date())));
    if (unfinished.kind !== 'match') throw new Error(unfinished.kind);
    expect(importRecordedMatch(coach, unfinished.file, unfinished.ledger, false, new Date())).toMatchObject({ ok: false, reason: expect.stringMatching(/not been finished/) });
  });
});

describe('the coach\'s screens (#281)', () => {
  it('a fixture card offers Share for a recorder; Import minutes file routes a recorded match to the import', async () => {
    const { readFileSync } = await import('node:fs');
    const card = readFileSync(new URL('../screens/FixturesScreen.tsx', import.meta.url), 'utf8');
    expect(card).toContain('label="Share for a recorder"');
    expect(card).toContain('Recorded on another phone');
    const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
    expect(app).toContain('const routed = readRecorderFile(picked.text);');
    expect(app).toContain('importRecordedMatch(ours, routed.file, routed.ledger, held, appNow())');
    expect(app).toContain("send it only to the adult recording the match");
  });
});

describe("the recorder's phone (ADR-025 D3)", () => {
  it('opens a pack as a borrowed team: its children, the one fixture, the plan and Who is coming', () => {
    const { coach, state } = coachWithFixture();
    const plan = { periods: [{ slots: {}, subs: [] }] };
    const coming: [UUID, string][] = [[players[0].id, 'absent'], [players[1].id, 'available'], [uuid(), 'available'], [players[2].id, 'nonsense']];
    const read = readRecorderFile(JSON.stringify(makeRecorderPack(coach, state.match.id, plan, coming, T0)));
    if (read.kind !== 'pack') throw new Error(read.kind);
    const base = emptyLedger(uuid(), '', T0);
    const opened = openPack(base, read.file, read.ledger, format, T0);
    if (!opened.ok) throw new Error(opened.reason);
    expect(borrowedFor(opened.ledger)).toBe(state.match.id);
    expect(borrowedFor(coach)).toBeNull();
    expect(opened.restored.squadName).toBe('Test FC');
    expect(opened.restored.players.map((p) => p.id).sort()).toEqual(players.map((p) => p.id).sort());
    expect(opened.matches.map((m) => m.match.id)).toEqual([state.match.id]);
    const fixture = opened.matches[0];
    expect(fixture.plan).toEqual(plan);
    // A child the coach marked Can't stays so; a stranger or a status this build does not know is ignored.
    expect(new Map(fixture.availability).get(players[0].id)).toBe('absent');
    expect(new Map(fixture.availability).get(players[1].id)).toBe('available');
    expect(fixture.availability.some(([id]) => !players.some((p) => p.id === id))).toBe(false);
  });

  it('a pack whose chain names another fixture is refused; a bad plan is left out', () => {
    const { coach, state } = coachWithFixture();
    const file = makeRecorderPack(coach, state.match.id, { nope: true }, [], T0);
    const read = readRecorderFile(JSON.stringify({ ...file, fixtureId: uuid() }));
    if (read.kind !== 'pack') throw new Error(read.kind);
    expect(openPack(emptyLedger(uuid(), '', T0), read.file, read.ledger, format, T0)).toMatchObject({ ok: false });
    const good = readRecorderFile(JSON.stringify(file));
    if (good.kind !== 'pack') throw new Error(good.kind);
    const opened = openPack(emptyLedger(uuid(), '', T0), good.file, good.ledger, format, T0);
    expect(opened.ok && opened.matches[0].plan).toBeFalsy();
  });

  it('round trip: recorded in the borrowed team, sent, and added on the coach phone', () => {
    const { coach, state } = coachWithFixture();
    const read = readRecorderFile(JSON.stringify(makeRecorderPack(coach, state.match.id, null, [], T0)));
    if (read.kind !== 'pack') throw new Error(read.kind);
    const opened = openPack(emptyLedger(uuid(), '', T0), read.file, read.ledger, format, T0);
    if (!opened.ok) throw new Error(opened.reason);
    const borrowed = recordOnBorrowed(opened.ledger, state);
    expect(borrowedMatchFinished(opened.ledger, state.match.id)).toBe(false);
    expect(borrowedMatchFinished(borrowed, state.match.id)).toBe(true);
    const back = readRecorderFile(JSON.stringify(makeRecordedMatch(borrowed, state.match.id, T0)));
    if (back.kind !== 'match') throw new Error(back.kind);
    const r = importRecordedMatch(coach, back.file, back.ledger, false, T0);
    if (!r.ok) throw new Error(r.reason);
    expect(recordedElsewhere(r.ledger, state.match.id)).toBe(true);
    expect(r.ledger.matches.find((m) => m.id === state.match.id)?.intervals.length).toBeGreaterThan(0);
  });
});

describe("the recorder's screens (#281, ADR-025 D3, D4, D7)", () => {
  it('a borrowed team may change who is here, never who exists or their names', () => {
    const kids = players.slice(0, 3);
    expect(sameChildren(kids, kids.map((p) => ({ ...p, keeper: 'prefers' as never })))).toBe(true);
    expect(sameChildren(kids, [...kids, makePlayer(squadId, 'Zed')])).toBe(false);
    expect(sameChildren(kids, kids.slice(1))).toBe(false);
    expect(sameChildren(kids, kids.map((p, i) => (i === 0 ? { ...p, firstName: 'Avery' } : p)))).toBe(false);
  });

  it('App opens a pack as a borrowed team, offers Send and Remove on Fixtures, and erases it', async () => {
    const { readFileSync } = await import('node:fs');
    const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
    const teams = readFileSync(new URL('../screens/Teams.tsx', import.meta.url), 'utf8');
    // D1: both pickers route a pack; the first screen too, for a recorder with no team.
    expect(app).toContain('team.onOpenPack({ file: routed.file, ledger: routed.ledger });');
    expect(app).toContain('return openPackTeam({ file: routed.file, ledger: routed.ledger });');
    // D3: the new team adopts the pack on its first open; the demo seed never lands on it.
    expect(app).toMatch(/if \(pack !== null && ledgerRef\.current\) \{\s*const opened = openPack\(/);
    expect(app).toContain('if (initial === null && pack === null && shouldAutoSeed(');
    // D3: one fixture, the coach's children, and no pack shared on from a borrowed team.
    expect(app).toContain("onAdd={borrowedFixture === null ? () => setStep('fixtureForm') : undefined}");
    expect(app).toContain('onShareForRecorder={borrowedFixture !== null ? undefined :');
    expect(app).toMatch(/borrowedFixture === null\s*\? changeSquad/);
    // Rob, 9 Nov: a refused change is never confirmed as done ("removed" showed when nothing was).
    expect(app).toMatch(/showToast\("This is a temporary team[^"]*"\);\s*return false;/);
    const squad = readFileSync(new URL('../screens/SquadScreen.tsx', import.meta.url), 'utf8');
    expect(squad).toContain('if (onPlayers(removePlayer(everyone, p.id, played)) === false) return;');
    expect(squad).toContain('if (onPlayers([...everyone, makePlayer(squadId, firstName, displaySuffix)]) === false) return;');
    const child = readFileSync(new URL('../screens/ChildScreen.tsx', import.meta.url), 'utf8');
    expect(child).toContain('if (onPlayers(p) !== false) tick.mark();');
    // D4: Send to the coach is the match file, once the match is finished.
    expect(app).toContain('ready={borrowedMatchFinished(ledger, borrowedFixture)}');
    expect(app).toContain('JSON.stringify(makeRecordedMatch(l, borrowedFixture, appNow()))');
    // D7: removing erases, never sets aside.
    expect(app).toContain('void eraseTeam(root, teamId)');
    expect(app).toContain('onRemove={team.onErase}');
    expect(teams).toContain("setAsking(!ready ? 'unsent' : sent ? 'remove' : 'check')");
  });
});

describe('how an imported match was recorded (ADR-025 D6)', () => {
  function imported() {
    const { coach, state } = coachWithFixture();
    const read = readRecorderFile(JSON.stringify(makeRecorderPack(coach, state.match.id, null, [], T0)));
    if (read.kind !== 'pack') throw new Error(read.kind);
    const opened = openPack(emptyLedger(uuid(), '', T0), read.file, read.ledger, format, T0);
    if (!opened.ok) throw new Error(opened.reason);
    const borrowed = recordOnBorrowed(opened.ledger, state);
    const back = readRecorderFile(JSON.stringify(makeRecordedMatch(borrowed, state.match.id, T0)));
    if (back.kind !== 'match') throw new Error(back.kind);
    return { coach, state, borrowed, back };
  }

  it('is judged by the recorder entries, exactly as on the recording phone', () => {
    const { coach, state, borrowed, back } = imported();
    const r = importRecordedMatch(coach, back.file, back.ledger, false, T0);
    if (!r.ok) throw new Error(r.reason);
    const there = provenanceOf(borrowed, state.match.id);
    const here = provenanceOf(r.ledger, state.match.id);
    expect(here).toEqual(there);
  });

  it('a copy that differs from what the recorder signed is reconstructed, and says so', () => {
    const { coach, state, back } = imported();
    const r = importRecordedMatch(coach, back.file, back.ledger, false, T0);
    if (!r.ok) throw new Error(r.reason);
    // Tamper with one copied interval in the import entry, leaving the originals as signed.
    const last = r.ledger.entries[r.ledger.entries.length - 1];
    const forged = {
      ...r.ledger,
      entries: [
        ...r.ledger.entries.slice(0, -1),
        { ...last, records: last.records.map((x) => (x.type === 'interval' && x === last.records.find((y) => y.type === 'interval') ? { ...x, endMs: 1 } : x)) },
      ],
    };
    const p = provenanceOf(forged, state.match.id);
    expect(p?.state).toBe('reconstructed');
    expect(p?.why).toContain('The copy differs from what the recording phone signed');
  });

  it('the recorder phone key comes with the import, once', () => {
    const { coach, back } = imported();
    const r = importRecordedMatch(coach, back.file, back.ledger, false, T0);
    if (!r.ok) throw new Error(r.reason);
    const device = r.ledger.entries.flatMap((e) => e.records).find((x) => x.type === 'received')?.device;
    const keys = r.ledger.entries.flatMap((e) => e.records).filter((x) => x.type === 'device' && x.id === device);
    expect(keys.length).toBeLessThanOrEqual(1);
    if (typeof device === 'string') expect(keys.length).toBe(1);
  });
});

describe('signed by two phones (ADR-025 D6, ruling 3)', () => {
  const coachPhone = signerFromSecret('coach-phone', new Uint8Array(32).fill(3));
  const recorderPhone = signerFromSecret('recorder-phone', new Uint8Array(32).fill(4));
  afterEach(() => setEntrySigner(null));

  it('recorded live on the recorder phone and imported unchanged is pristine; a goal added after is not', () => {
    const kickoff = new Date('2026-11-08T10:00:00Z');
    setEntrySigner(coachPhone);
    const engine0 = new MatchEngine({ nowFn: () => T0 });
    const planned = engine0.createMatch(squadId, format.id, { totalMinutes: 50, quarterCount: 4, availablePlayerIds: players.map((p) => p.id) });
    planned.match.opponent = 'Rovers';
    planned.match.kickoffAt = kickoff.toISOString();
    let coach = emptyLedger(squadId, 'Test FC', T0);
    coach = appendRecords(coach, players.map((p) => ({ type: 'player', id: p.id, firstName: p.firstName, displaySuffix: null, active: true })), T0);
    coach = appendRecords(coach, [fixtureRecord({ match: planned.match, format } as never)], T0);
    const read = readRecorderFile(JSON.stringify(makeRecorderPack(coach, planned.match.id, null, [], T0)));
    if (read.kind !== 'pack') throw new Error(read.kind);

    setEntrySigner(recorderPhone);
    const opened = openPack(emptyLedger(uuid(), '', T0), read.file, read.ledger, format, T0);
    if (!opened.ok) throw new Error(opened.reason);
    let now = kickoff;
    const engine = new MatchEngine({ nowFn: () => now });
    const state = engine.createMatch(squadId, format.id, { totalMinutes: 50, quarterCount: 4, availablePlayerIds: players.map((p) => p.id) });
    state.match = { ...state.match, id: planned.match.id, opponent: 'Rovers', kickoffAt: kickoff.toISOString() };
    state.quarters.forEach((q) => (q.matchId = state.match.id));
    const sheet = new Map<UUID, UUID>();
    format.positions.forEach((p, i) => sheet.set(p.id, players[i].id));
    let borrowed = opened.ledger;
    for (const q of state.quarters) {
      engine.startQuarter(state, q, sheet, format);
      now = new Date(now.getTime() + 12.5 * 60_000);
      engine.endQuarter(state, q);
      borrowed = recordMatches(borrowed, [{ ...state, format }], players, 'Test FC', now);
    }
    engine.completeMatch(state);
    borrowed = recordMatches(borrowed, [{ ...state, format }], players, 'Test FC', now);
    expect(provenanceOf(borrowed, state.match.id)?.state).toBe('pristine');

    setEntrySigner(coachPhone);
    const back = readRecorderFile(JSON.stringify(makeRecordedMatch(borrowed, state.match.id, now)));
    if (back.kind !== 'match') throw new Error(back.kind);
    const later = new Date(now.getTime() + 2 * 24 * 3_600_000);
    const r = importRecordedMatch(coach, back.file, back.ledger, false, later);
    if (!r.ok) throw new Error(r.reason);
    // Imported two days later on another phone, and still pristine: judged by what the recorder signed.
    expect(provenanceOf(r.ledger, state.match.id)?.state).toBe('pristine');

    // A goal the coach adds afterwards makes it reconstructed, exactly as on the coach's own phone.
    const added = addUnknownTimeEvent(r.ledger, state.match.id, 'goal', players[0].id, 'Missed on the day', later);
    if (!added.ok) throw new Error(added.reason);
    expect(provenanceOf(added.ledger, state.match.id)?.state).toBe('reconstructed');
  });
});

describe('a borrowed team is unmistakable (Rob, 9 Nov, "approve 4")', () => {
  it('its row says borrowed; a team of one\'s own does not', () => {
    const { coach, state } = coachWithFixture();
    const read = readRecorderFile(JSON.stringify(makeRecorderPack(coach, state.match.id, null, [], T0)));
    if (read.kind !== 'pack') throw new Error(read.kind);
    const opened = openPack(emptyLedger(uuid(), '', T0), read.file, read.ledger, format, T0);
    if (!opened.ok) throw new Error(opened.reason);
    expect(readTeamRow(null, serialiseLedger(opened.ledger)).borrowed).toBe(true);
    expect(readTeamRow(null, serialiseLedger(coach)).borrowed).toBe(false);
  });

  it('opening a pack of this phone\'s own team asks first; Cancel changes nothing; the chip and list say borrowed', async () => {
    const { readFileSync } = await import('node:fs');
    const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
    expect(app).toContain('const own = summaries.find((t) => !t.removed && !t.borrowed && sameTeamName(t.name, p.ledger.squad.name));');
    expect(app).toMatch(/if \(!asked && own\) \{\s*setSheet\(null\);\s*setPackAsk\(/);
    expect(app).toContain('onCancel={() => setPackAsk(null)}');
    expect(app).toContain("It's meant for the adult recording the match. Open it here as a separate temporary team anyway?");
    expect(app).toContain('name={borrowedFixture !== null ? `${squadName} (temporary)` : squadName}');
    // Rob, 10 Nov: a strip on every screen of a temporary team.
    expect(app).toContain("{borrowedFixture !== null && <TemporaryTeamStrip onPress={() => goToTab('home')} />}");
    const teams = readFileSync(new URL('./storage/teams.ts', import.meta.url), 'utf8');
    expect(teams).toContain("season: r.borrowed ? 'Temporary · imported to record one match' : r.season,");
    expect(teams).toContain('r.borrowed ? `${r.name} (temporary)` : r.name');
  });
});
