/**
 * `npm run test-season-file` — writes test-data/test-season.json (#157).
 *
 * The made-up test season, as Export minutes file would write it, for a
 * TestFlight tester to bring in with Settings › Import minutes file.
 * Run again whenever the ledger format changes: testSeasonFile.test.ts fails
 * until it is.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { testSeasonFile } from '../src/app/testSeasonFile';

const out = resolve(__dirname, '../test-data/test-season.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, testSeasonFile(new Date()));
console.log(`wrote ${out}`);
