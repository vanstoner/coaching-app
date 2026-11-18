/**
 * #282 (Rob, 7 Nov): share the match highlights with parents, and the full
 * match log with coaches ("Log as recommended"), through the phone's share
 * sheet as text. The texts come from the record (`src/app/highlights.ts`).
 */

import { Share } from 'react-native';
import { Action, MainButton } from './controls';

export function shareText(message: string): void {
  void Share.share({ message }).catch(() => undefined);
}

export function ShareTexts({ highlights, log, main = false }: { highlights: string | null; log: string | null; main?: boolean }) {
  return (
    <>
      {highlights !== null &&
        (main ? (
          <MainButton label="Share match highlights" onPress={() => shareText(highlights)} />
        ) : (
          <Action label="Share match highlights" onPress={() => shareText(highlights)} />
        ))}
      {log !== null && <Action label="Share the full match log (for coaches)" onPress={() => shareText(log)} />}
    </>
  );
}
