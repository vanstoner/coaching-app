/**
 * Freeze what a released build stores — #167 AC1.
 *
 * Run INSIDE a worktree of the release commit, never against the current
 * code: the point is that the fixture is what the RELEASED app wrote. From
 * the main checkout, for release X built from commit C:
 *
 *   WT=<scratch dir outside the repo>/wt
 *   git worktree add "$WT" C
 *   ln -s "$PWD/node_modules" "$WT/node_modules"     # or: (cd "$WT" && npm ci)
 *   mkdir -p "$WT/scripts" && cp scripts/freeze-release-fixture.ts "$WT/scripts/"
 *   cp src/app/releaseFigures.ts "$WT/src/app/"
 *   (cd "$WT" && TZ=UTC npx vite-node scripts/freeze-release-fixture.ts -- \
 *       --version X --out "$PWD/src/app/fixtures/release-X")
 *   git worktree remove --force "$WT"
 *
 * Then add X to `src/app/fixtures/releases.json` with the hashes the script
 * prints. The output is never edited afterwards.
 *
 * What it does, at that commit, with that commit's own code:
 *  1. seeds the Test kit's made-up squad and past season exactly as the
 *     demo's first open does (`seedDemo`, after `emptyLedger`), on a fixed
 *     clock and with ids from a counter, so two runs write the same bytes;
 *  2. signs its entries with a fixed made-up key, if that release signs (#193);
 *  3. saves through `saveSession` and `saveLedger` into an in-memory store;
 *  4. dumps every stored key and value, byte for byte (`store.json`);
 *  5. reads the store back through `loadSession` and `openStoredLedger`, and
 *     writes the figures that code shows (`expected.json`).
 *
 * Made-up first names only (invariant 4). Nothing here touches a device.
 */

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Fixed, so the fixture is reproducible. */
const NOW = new Date('2026-10-07T09:00:00.000Z');
/** From 2.0.0, the made-up team the release saves into (ADR-022 D2). */
const FIXTURE_TEAM_ID = '00000000-0000-4000-8000-0000000f1e1d';

/** The made-up install that signs a fixture's entries, for a release that signs. */
const FIXTURE_DEVICE_ID = '00000000-0000-4000-8000-00000000fee1';

function arg(name: string): string {
  const at = process.argv.indexOf(`--${name}`);
  const value = at === -1 ? undefined : process.argv[at + 1];
  if (!value) throw new Error(`missing --${name}`);
  return value;
}

/** Ids from a counter, installed before any app code runs. */
function deterministicIds(): void {
  let n = 0;
  const randomUUID = (): string => {
    n++;
    const hex = n.toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${hex}`;
  };
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID },
    configurable: true,
    writable: true,
  });
}

/**
 * The device clock pinned to NOW. Some seed paths stamp `createdAt` from the
 * device clock rather than the `now` they are given; without this two runs
 * differ by the second they were run in.
 */
function fixedClock(): void {
  const Real = Date;
  const at = NOW.getTime();
  class Fixed extends Real {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(at);
      else super(...(args as [string | number | Date]));
    }
    static now(): number {
      return at;
    }
  }
  globalThis.Date = Fixed as DateConstructor;
}

async function main(): Promise<void> {
  const version = arg('version');
  const out = resolve(arg('out'));
  deterministicIds();
  fixedClock();

  // Imported after the ids are fixed: anything minted at module load uses them.
  const { createMemoryStore, loadSession, saveSession, STORAGE_KEY } = await import('../src/app/persistence');
  const { openStoredLedger, saveLedger, LEDGER_STORAGE_KEY, LEDGER_HEAD_KEY } = await import('../src/app/storage/ledgerStore').catch(() => import('../src/app/ledgerStore'));
  // 2.0.0 moved the storage modules into src/app/storage/ (ADR-022 D2); a release before it has them in src/app/.
  const { emptyLedger } = await import('../src/app/ledger');
  const { seedDemo } = await import('../src/app/demoSeed');
  const { DEFAULT_QUARTER_COUNT, DEFAULT_TOTAL_MINUTES, PLACEHOLDER_SQUAD_NAME, makeSevenASideFormat } =
    await import('../src/app/placeholderSquad');
  const { BUZZ_WHEN_SUB_DUE_DEFAULT } = await import('../src/app/settings');
  const { uuid } = await import('../src/types/index');
  const { releaseFigures } = await import('../src/app/releaseFigures');

  const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  console.log(`freezing release ${version} from commit ${commit}`);

  // A release that signs its entries (#193) signs them here too, as the phone
  // does once `installDeviceSigner` has run. The key is made up and fixed, and
  // Ed25519 is deterministic, so two runs write the same bytes. A release
  // from before signing has no such module and stores unsigned entries.
  const signing = await import('../src/app/entrySigning').catch(() => null);
  if (signing) {
    signing.setEntrySigner(signing.signerFromSecret(FIXTURE_DEVICE_ID, new Uint8Array(32).fill(7)));
    console.log(`signing entries as made-up device ${FIXTURE_DEVICE_ID}`);
  }

  // App.tsx's launch on an empty phone, in order: the defaults, an empty
  // ledger, the demo seed, then the saves that follow launch.
  const squadId = uuid();
  const format = makeSevenASideFormat();
  const ledger0 = emptyLedger(squadId, PLACEHOLDER_SQUAD_NAME, NOW);
  const seeded = seedDemo(
    null,
    ledger0,
    {
      squadName: PLACEHOLDER_SQUAD_NAME,
      squadId,
      format,
      totalMinutes: DEFAULT_TOTAL_MINUTES,
      periodCount: DEFAULT_QUARTER_COUNT,
      buzzWhenSubDue: BUZZ_WHEN_SUB_DUE_DEFAULT,
    },
    NOW
  );
  if (!seeded.ledger) throw new Error('the seed produced no ledger');

  // From 2.0.0 a phone keeps each team under its own keys, listed in a team
  // index (ADR-022 D2): the release saves into its first team, as the coach's
  // phone does once a team is added. Before 2.0.0 the keys sit at the root.
  const teams = await import('../src/app/storage/teams').catch(() => null);
  const root = createMemoryStore();
  let store = root;
  if (teams) {
    if (!(await teams.addTeam(root, FIXTURE_TEAM_ID, NOW))) throw new Error('the team index was not written');
    store = teams.teamStore(root, FIXTURE_TEAM_ID);
    console.log(`saving into made-up team ${FIXTURE_TEAM_ID}`);
  }
  const s = seeded.session;
  const savedSession = await saveSession(store, {
    squadName: s.squadName,
    squadId: s.squadId,
    players: s.players,
    format: s.format,
    totalMinutes: s.totalMinutes,
    periodCount: s.periodCount,
    buzzWhenSubDue: s.buzzWhenSubDue,
    plan: s.plan,
    matches: s.matches,
    state: null,
    now: NOW,
  });
  const savedLedger = await saveLedger(store, seeded.ledger);
  if (!savedSession || !savedLedger) throw new Error('a save failed');

  // Every key, byte for byte. Before 2.0.0 the keys this build writes are
  // named (that memory store had no listing); with teams, every key there is.
  const dump: Record<string, string> = {};
  const keys = teams && root.allKeys ? await root.allKeys() : [STORAGE_KEY, LEDGER_STORAGE_KEY, LEDGER_HEAD_KEY];
  for (const key of keys) {
    const value = await root.getItem(key);
    if (value !== null) dump[key] = value;
  }
  const at = (key: string) => (teams ? teams.teamKey(FIXTURE_TEAM_ID, key) : key);

  // Read back as this release reads it at launch: the team first, if it has teams.
  if (teams) {
    const t = await teams.openTeams(root, NOW, () => {
      throw new Error('the release made a new team instead of opening its own');
    });
    if (t.kind !== 'team' || t.teamId !== FIXTURE_TEAM_ID) throw new Error(`the release opened ${t.kind}`);
  }
  const loaded = await loadSession(store);
  const opened = await openStoredLedger(store, NOW);
  if (!loaded || !opened.ledger || !opened.writable || opened.message) {
    throw new Error(`the release could not read its own store: ${opened.message}`);
  }
  const expected = releaseFigures(loaded, opened.ledger, NOW);

  mkdirSync(out, { recursive: true });
  const files: Record<string, string> = {
    'store.json': `${JSON.stringify(dump, null, 2)}\n`,
    'expected.json': `${JSON.stringify(expected, null, 2)}\n`,
    'release.json': `${JSON.stringify(
      {
        version,
        commit,
        now: NOW.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        script: 'scripts/freeze-release-fixture.ts',
        ...(teams ? { layout: 'teams', teamId: FIXTURE_TEAM_ID } : {}),
        sessionSchemaVersion: JSON.parse(dump[at(STORAGE_KEY)]).schemaVersion,
        ledgerVersion: JSON.parse(dump[at(LEDGER_STORAGE_KEY)]).ledgerVersion,
        migrations: (await import('../src/app/persistence')).MIGRATIONS.map((m) => ({ from: m.from, to: m.to })),
      },
      null,
      2
    )}\n`,
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(resolve(out, name), text);
    console.log(`wrote ${name}  sha256 ${createHash('sha256').update(text).digest('hex')}`);
  }
  console.log(`keys: ${Object.keys(dump).join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
