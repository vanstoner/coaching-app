/**
 * Teams on one phone: the store wrapper and the one-time move — #224 AC2,
 * AC3; ADR-022 D2, D3.
 *
 * The healthy cases first (a fresh install, a phone from before teams, the
 * everyday launch), then every way the move can be interrupted or refused.
 * The released stores themselves go through the move in
 * `releaseUpgrade.test.ts`.
 */

import { describe, expect, it } from "vitest";

import { createMemoryStore, inTurn, type KeyValueStore } from "../persistence";
import { TEST_CLOCK_KEY } from "../testKit";
import type { UUID } from "../../types/index";
import {
  BEFORE_TEAMS_PREFIX,
  forgetEveryTeam,
  MOVE_FAILED,
  TEAMS_INDEX_KEY,
  openTeams,
  parseTeamIndex,
  readOnlyStore,
  teamKey,
  teamStore,
} from "./teams";

const NOW = new Date("2026-10-26T12:00:00Z");
const T1 = "00000000-0000-4000-8000-0000000000a1" as UUID;
const T2 = "00000000-0000-4000-8000-0000000000a2" as UUID;
const ids = (...list: UUID[]) => {
  const queue = [...list];
  return () =>
    queue.shift() ?? ("00000000-0000-4000-8000-0000000000ff" as UUID);
};

/** A phone from before teams: today's keys at the root, an aside and the test clock. */
const BEFORE: Record<string, string> = {
  "coaching-app/session/v1": '{"schemaVersion":6,"squadName":"Mock FC"}',
  "coaching-app/ledger/v2": '{"ledger":"coaching-app/minutes","entries":[]}',
  "coaching-app/ledger/head": '{"n":3,"hash":"abc"}',
  "coaching-app/table-sort/v1": '{"report":"total"}',
  "coaching-app/getting-started/v1": "closed",
  "coaching-app/session/v1/unreadable/2026-10-01": "damaged",
  [TEST_CLOCK_KEY]: '{"offsetMs":0}',
};

async function phoneWith(dump: Record<string, string>): Promise<KeyValueStore> {
  const store = createMemoryStore();
  for (const [k, v] of Object.entries(dump)) await store.setItem(k, v);
  return store;
}

async function dump(store: KeyValueStore): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const k of [...(await store.allKeys!())].sort())
    out[k] = (await store.getItem(k)) as string;
  return out;
}

/** A store that fails every write after the first `n` writes: a crash mid-move. */
function crashingAfter(inner: KeyValueStore, n: number): KeyValueStore {
  let writes = 0;
  const fail = () => {
    writes++;
    if (writes > n) throw new Error("crash");
  };
  return {
    getItem: (k) => inner.getItem(k),
    setItem: async (k, v) => {
      fail();
      await inner.setItem(k, v);
    },
    removeItem: async (k) => {
      fail();
      await inner.removeItem(k);
    },
    allKeys: () => inner.allKeys!(),
  };
}

describe("teamStore (ADR-022 D2)", () => {
  it("a team sees today’s keys; the device holds them under the team’s prefix", async () => {
    const root = createMemoryStore();
    const team = teamStore(root, T1);
    await team.setItem("coaching-app/session/v1", "S");
    expect(await root.getItem(`coaching-app/teams/${T1}/session/v1`)).toBe("S");
    expect(await root.getItem("coaching-app/session/v1")).toBeNull();
    expect(await team.getItem("coaching-app/session/v1")).toBe("S");
    expect(await team.allKeys!()).toEqual(["coaching-app/session/v1"]);
  });

  it("nothing crosses between teams (#224 AC2)", async () => {
    const root = createMemoryStore();
    await teamStore(root, T1).setItem("coaching-app/session/v1", "one");
    await teamStore(root, T2).setItem("coaching-app/session/v1", "two");
    expect(await teamStore(root, T1).getItem("coaching-app/session/v1")).toBe(
      "one",
    );
    expect(await teamStore(root, T2).allKeys!()).toEqual([
      "coaching-app/session/v1",
    ]);
    await teamStore(root, T2).removeItem("coaching-app/session/v1");
    expect(await teamStore(root, T1).getItem("coaching-app/session/v1")).toBe(
      "one",
    );
  });

  it("the beta’s test clock is per install, not per team", async () => {
    const root = createMemoryStore();
    await teamStore(root, T1).setItem(TEST_CLOCK_KEY, "clock");
    expect(await root.getItem(TEST_CLOCK_KEY)).toBe("clock");
    expect(await teamStore(root, T2).getItem(TEST_CLOCK_KEY)).toBe("clock");
    expect(teamKey(T1, TEST_CLOCK_KEY)).toBe(TEST_CLOCK_KEY);
  });

  it("work on a team queues on the device store, so it never overtakes work asked for earlier", async () => {
    const root = createMemoryStore();
    const order: string[] = [];
    let release: () => void = () => {};
    const slow = inTurn(root, () =>
      new Promise<void>((r) => (release = r)).then(
        () => void order.push("root"),
      ),
    );
    const fast = inTurn(
      teamStore(root, T1),
      async () => void order.push("team"),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([]);
    release();
    await Promise.all([slow, fast]);
    expect(order).toEqual(["root", "team"]);
  });

  it("a read-only store refuses every write and reads as before", async () => {
    const root = await phoneWith(BEFORE);
    const ro = readOnlyStore(root);
    await expect(ro.setItem("coaching-app/session/v1", "x")).rejects.toThrow();
    await expect(ro.removeItem("coaching-app/session/v1")).rejects.toThrow();
    expect(await ro.getItem("coaching-app/session/v1")).toBe(
      BEFORE["coaching-app/session/v1"],
    );
  });
});

describe("opening teams at launch (ADR-022 D3, #224 AC3)", () => {
  it("a fresh install gets one empty team", async () => {
    const root = createMemoryStore();
    const opened = await openTeams(root, NOW, ids(T1));
    expect(opened).toMatchObject({ kind: "team", teamId: T1, moved: false });
    expect(
      parseTeamIndex(await root.getItem(TEAMS_INDEX_KEY))?.teams.map(
        (t) => t.id,
      ),
    ).toEqual([T1]);
    expect(await teamStore(root, T1).allKeys!()).toEqual([]);
  });

  it("a phone from before teams: its keys become team 1, byte for byte, asides included", async () => {
    const root = await phoneWith(BEFORE);
    const opened = await openTeams(root, NOW, ids(T1));
    expect(opened).toMatchObject({ kind: "team", teamId: T1, moved: true });
    const team = teamStore(root, T1);
    for (const [k, v] of Object.entries(BEFORE))
      expect(await team.getItem(k), k).toBe(v);
  });

  it("the originals are set aside unchanged, and nothing is left at the root but the index and test clock", async () => {
    const root = await phoneWith(BEFORE);
    await openTeams(root, NOW, ids(T1));
    for (const [k, v] of Object.entries(BEFORE)) {
      if (k === TEST_CLOCK_KEY) continue;
      expect(
        await root.getItem(
          BEFORE_TEAMS_PREFIX + k.slice("coaching-app/".length),
        ),
        k,
      ).toBe(v);
      expect(await root.getItem(k), `${k} left at the root`).toBeNull();
    }
    expect(await root.getItem(TEST_CLOCK_KEY)).toBe(BEFORE[TEST_CLOCK_KEY]);
  });

  it("the second launch opens the same team and changes nothing", async () => {
    const root = await phoneWith(BEFORE);
    await openTeams(root, NOW, ids(T1));
    const after = await dump(root);
    const again = await openTeams(root, NOW, ids(T2));
    expect(again).toMatchObject({ kind: "team", teamId: T1, moved: false });
    expect(await dump(root)).toEqual(after);
  });

  // A crash after each write the move makes, then a normal launch: the team
  // always ends up holding exactly the phone's data, and nothing is lost.
  for (let n = 0; n <= 20; n++) {
    it(`a crash after write ${n} is resumed at the next launch with nothing lost`, async () => {
      const disk = await phoneWith(BEFORE);
      await openTeams(crashingAfter(disk, n), NOW, ids(T1)).catch(
        () => undefined,
      );
      const opened = await openTeams(disk, NOW, ids(T2));
      if (opened.kind !== "team") throw new Error(opened.reason);
      // A crash before the index was first written leaves nothing to resume: the move starts afresh.
      expect(opened.teamId).toBe(n === 0 ? T2 : T1);
      const team = teamStore(disk, opened.teamId);
      for (const [k, v] of Object.entries(BEFORE))
        expect(await team.getItem(k), k).toBe(v);
      const left = (await disk.allKeys!()).filter(
        (k) =>
          k.startsWith("coaching-app/") &&
          !k.startsWith("coaching-app/teams/") &&
          !k.startsWith(BEFORE_TEAMS_PREFIX),
      );
      expect(left).toEqual([TEST_CLOCK_KEY]);
    });
  }

  it("a copy that does not read back stops the move: read-only, the originals untouched", async () => {
    const disk = await phoneWith(BEFORE);
    const lying: KeyValueStore = {
      ...disk,
      getItem: (k) => disk.getItem(k),
      setItem: (k, v) =>
        disk.setItem(
          k,
          k.includes("/teams/") && k.endsWith("ledger/v2") ? v.slice(1) : v,
        ),
      removeItem: (k) => disk.removeItem(k),
      allKeys: () => disk.allKeys!(),
    };
    const opened = await openTeams(lying, NOW, ids(T1));
    expect(opened).toEqual({ kind: "read-only", reason: MOVE_FAILED });
    for (const [k, v] of Object.entries(BEFORE))
      expect(await disk.getItem(k), k).toBe(v);
  });

  it("a store that cannot list its keys is never moved: read-only", async () => {
    const disk = await phoneWith(BEFORE);
    const unlisted: KeyValueStore = {
      getItem: (k) => disk.getItem(k),
      setItem: (k, v) => disk.setItem(k, v),
      removeItem: (k) => disk.removeItem(k),
    };
    expect(await openTeams(unlisted, NOW, ids(T1))).toEqual({
      kind: "read-only",
      reason: MOVE_FAILED,
    });
    expect(await dump(disk)).toEqual(
      Object.fromEntries(Object.entries(BEFORE).sort()),
    );
  });

  it("a key found at the root after the move is set aside, never copied over the team’s newer data", async () => {
    const root = await phoneWith(BEFORE);
    await openTeams(root, NOW, ids(T1));
    await teamStore(root, T1).setItem("coaching-app/session/v1", "newer");
    await root.setItem("coaching-app/session/v1", "stale");
    await openTeams(root, NOW, ids(T2));
    expect(await teamStore(root, T1).getItem("coaching-app/session/v1")).toBe(
      "newer",
    );
    expect(await root.getItem("coaching-app/session/v1")).toBeNull();
    expect(await root.getItem(`${BEFORE_TEAMS_PREFIX}session/v1`)).toBe(
      "stale",
    );
  });

  it("an index that will not read is rebuilt from the teams on the phone, never replaced by an empty team", async () => {
    const root = await phoneWith(BEFORE);
    await openTeams(root, NOW, ids(T1));
    await root.setItem(TEAMS_INDEX_KEY, "{damaged");
    const opened = await openTeams(root, NOW, ids(T2));
    expect(opened).toMatchObject({ kind: "team", teamId: T1 });
    expect(await teamStore(root, T1).getItem("coaching-app/session/v1")).toBe(
      BEFORE["coaching-app/session/v1"],
    );
  });
});

describe("Forget everything on a phone with teams (#207, #224 AC10)", () => {
  it("removes every team’s keys and the before-teams aside; keeps the test clock; the open team starts empty", async () => {
    const root = await phoneWith(BEFORE);
    await openTeams(root, NOW, ids(T1));
    await teamStore(root, T2).setItem("coaching-app/session/v1", "second team");
    await forgetEveryTeam(root, T1, NOW);
    expect(await root.allKeys!()).toEqual(
      expect.arrayContaining([TEST_CLOCK_KEY, TEAMS_INDEX_KEY]),
    );
    expect([...(await root.allKeys!())].sort()).toEqual(
      [TEAMS_INDEX_KEY, TEST_CLOCK_KEY].sort(),
    );
    const again = await openTeams(root, NOW, ids(T2));
    expect(again).toMatchObject({ kind: "team", teamId: T1, moved: false });
    expect(await teamStore(root, T1).allKeys!()).toEqual([]);
  });
});
