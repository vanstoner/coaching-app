/**
 * #54 AC3: nothing with a space is saved without the coach's confirmation.
 * Node can't render the screens, so this reads their source: every way a
 * name is added or changed goes through `validateName`, and a
 * `more-than-one-word` result stops at the warning instead of saving.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

describe('the name warning cannot be skipped (#54 AC3)', () => {
  it('Squad › Add: the button and the keyboard both run the one checked path', () => {
    const squad = read('screens/SquadScreen.tsx');
    expect(squad).toMatch(/onSubmitEditing=\{add\}/);
    expect(squad).toMatch(/onPress=\{add\}/);
    const add = squad.split('const add = useCallback(')[1].split('}, [')[0];
    expect(add).toMatch(/validateName\(draft\)/);
    // The warning is raised before anything can be saved.
    expect(add.indexOf("'more-than-one-word'")).toBeLessThan(add.indexOf('settle('));
    expect(add).not.toMatch(/makePlayer|onPlayers/);
  });

  it('the child page’s Rename runs the same check and warning', () => {
    const child = read('screens/ChildScreen.tsx');
    const save = child.split('function Rename(')[1].split('const save = () => {')[1].split('\n  };')[0];
    expect(save).toMatch(/validateName\(/);
    expect(save.indexOf("'more-than-one-word'")).toBeLessThan(save.indexOf('settle('));
    expect(save).not.toMatch(/onPlayers/);
  });

  it('every new player from a typed name is split into first name and suffix (AC7)', () => {
    for (const f of ['screens/SquadScreen.tsx', '../App.tsx']) {
      const src = read(f);
      for (const call of src.match(/makePlayer\(squadId, [^)]*\)/g) ?? []) {
        expect(call, `${f}: ${call}`).toMatch(/displaySuffix/);
      }
    }
  });
});
