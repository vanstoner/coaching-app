/**
 * The plan image, out of the phone — #165 ("approve view-shot").
 *
 * The only file that touches the capture and share modules for the plan
 * image. Not imported by any test, like `ledgerFile.ts`: the native modules
 * are not there in Node. What the image says is built and tested in
 * `planImage.ts`.
 *
 * The coach chooses to share, and chooses where it goes. The app itself
 * stores nothing and sends nothing: the PNG is a temporary capture in the
 * app's cache, handed to the phone's share sheet, and released on the next
 * share or when the plan screen closes.
 */

import type { RefObject } from 'react';
import type { View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { captureRef, releaseCapture } from 'react-native-view-shot';

export type ShareOutcome = { ok: true } | { ok: false; reason: string };

let lastCapture: string | null = null;

/** Let go of the last capture, if any. Safe to call at any time. */
export function releasePlanImage(): void {
  if (lastCapture === null) return;
  try {
    releaseCapture(lastCapture);
  } catch {
    // Already gone: nothing to release.
  }
  lastCapture = null;
}

/**
 * Capture the laid-out image at exactly `width` pixels and open the share
 * sheet. `size` is the view's laid-out size in dp, so the height scales with
 * the width (the module resizes only when given both).
 */
export async function sharePlanImage(
  view: RefObject<View | null>,
  width: number,
  size: { width: number; height: number }
): Promise<ShareOutcome> {
  try {
    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, reason: 'This phone cannot share images.' };
    }
    releasePlanImage();
    const height = Math.round((size.height * width) / size.width);
    const uri = await captureRef(view, { format: 'png', result: 'tmpfile', width, height });
    lastCapture = uri;
    await Sharing.shareAsync(uri, {
      mimeType: 'image/png',
      UTI: 'public.png',
      dialogTitle: 'Share the plan',
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'The plan image could not be made.' };
  }
}
