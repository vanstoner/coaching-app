/**
 * The minutes file, in and out of the phone — #75, ADR-011 §4.
 *
 * The only file that touches the native file and share modules. Not imported
 * by any test, for the same reason `storage.ts` is not: the modules are not
 * there in Node. Everything it moves is built and checked in `ledger.ts`.
 *
 * Export is an explicit action by the coach, to a destination they choose,
 * which is what ADR-011 §4 permits. The file carries children's first names
 * (PO ruling 3A); the screen that calls this says so.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { ledgerFileName, serialiseLedger, type Ledger } from './ledger';

export type FileOutcome = { ok: true } | { ok: false; reason: string };

export async function exportLedgerFile(ledger: Ledger, now: Date): Promise<FileOutcome> {
  try {
    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, reason: 'This phone cannot share files.' };
    }
    const file = new File(Paths.cache, ledgerFileName(now));
    if (file.exists) file.delete();
    file.create();
    file.write(serialiseLedger(ledger));
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      dialogTitle: 'Save the minutes file somewhere private',
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'The minutes file could not be written.' };
  }
}

/** The picked file's text, null if the coach cancelled. */
export async function pickLedgerFile(): Promise<
  { ok: true; text: string | null } | { ok: false; reason: string }
> {
  try {
    const picked = await File.pickFileAsync({ mimeTypes: ['application/json', '*/*'] });
    if (picked.canceled) return { ok: true, text: null };
    return { ok: true, text: await picked.result.text() };
  } catch {
    return { ok: false, reason: 'That file could not be opened.' };
  }
}
