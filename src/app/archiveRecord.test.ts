/**
 * Rob, 7 Nov: "Can't archive reconstructed". A match from the record with no
 * fixture on this phone can be archived here, as a view choice only.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseArchivedRecords } from './recordOnly';

describe('archiving a match from the record', () => {
  it('reads the phone list, and anything unreadable as none archived', () => {
    expect([...parseArchivedRecords(JSON.stringify(['a', 'b']))]).toEqual(['a', 'b']);
    expect(parseArchivedRecords(null).size).toBe(0);
    expect(parseArchivedRecords('junk').size).toBe(0);
    expect([...parseArchivedRecords(JSON.stringify(['a', 3, null]))]).toEqual(['a']);
  });

  it('the record card offers Archive and Unarchive; it writes no record, only this phone', () => {
    const card = readFileSync(new URL('../screens/FixturesScreen.tsx', import.meta.url), 'utf8');
    expect(card).toContain("<Action label={match.archived ? 'Unarchive' : 'Archive'} onPress={() => onArchive(match.id, !match.archived)} />");
    expect(card).toContain('onArchive={actions.housekeeping.onArchiveRecord}');
    const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
    const handler = app.slice(app.indexOf('onArchiveRecord:'), app.indexOf('onArchiveRecord:') + 400);
    expect(handler).toContain('store.setItem(ARCHIVED_RECORDS_KEY');
    expect(handler).not.toMatch(/commitLedger|appendRecords/);
  });
});
