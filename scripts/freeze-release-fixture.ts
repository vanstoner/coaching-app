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
 *  2. saves through `saveSession` and `saveLedger` into an in-memory store;
 *  3. dumps every stored key and value, byte for byte (`store.json`);
 *  4. reads the store back through `loadSession` and `openStoredLedger`, and
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
  const { openStoredLedger, saveLedger, LEDGER_STORAGE_KEY, LEDGER_HEAD_KEY } = await import('../src/app/ledgerStore');
  const { emptyLedger } = await import('../src/app/ledger');
  const { seedDemo } = await import('../src/app/demoSeed');
  const { DEFAULT_QUARTER_COUNT, DEFAULT_TOTAL_MINUTES, PLACEHOLDER_SQUAD_NAME, makeSevenASideFormat } =
    await import('../src/app/placeholderSquad');
  const { BUZZ_WHEN_SUB_DUE_DEFAULT } = await import('../src/app/settings');
  const { uuid } = await import('../src/types/index');
  const { releaseFigures } = await import('../src/app/releaseFigures');

  const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  console.log(`freezing release ${version} from commit ${commit}`);

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

  const store = createMemoryStore();
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

  // Every key, byte for byte. The memory store has no listing, so the keys
  // this build writes are named; any other key it wrote would be missed, so
  // the README says which these are.
  const dump: Record<string, string> = {};
  for (const key of [STORAGE_KEY, LEDGER_STORAGE_KEY, LEDGER_HEAD_KEY]) {
    const value = await store.getItem(key);
    if (value !== null) dump[key] = value;
  }

  // Read back as this release reads it at launch.
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
        sessionSchemaVersion: JSON.parse(dump[STORAGE_KEY]).schemaVersion,
        ledgerVersion: JSON.parse(dump[LEDGER_STORAGE_KEY]).ledgerVersion,
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
