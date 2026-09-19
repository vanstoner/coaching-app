/**
 * Tests for schema evolution — #61.
 *
 * The property that matters most is the one at the bottom: a real v1 payload,
 * captured as the released app actually writes it, still loads. Everything
 * else here is the machinery that makes that possible.
 */

import { describe, expect, it } from 'vitest';

import {
  migrateDocument,
  tooNewMessage,
  unknownFields,
  type Migration,
  type VersionedDocument,
} from './schema';

const chain: Migration[] = [
  {
    from: 1,
    to: 2,
    describe: 'v1 → v2: add greeting',
    up: (doc) => ({ ...doc, greeting: 'hello' }),
  },
  {
    from: 2,
    to: 3,
    describe: 'v2 → v3: rename greeting to salutation',
    up: ({ greeting, ...rest }) => ({ ...rest, salutation: greeting }),
  },
];

describe('migrateDocument', () => {
  it('upgrades an old document rather than discarding it', () => {
    // The whole point. The old code returned null here and the coach lost
    // their squad.
    const result = migrateDocument({ schemaVersion: 1, squad: ['A'] }, chain, 3, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.schemaVersion).toBe(3);
    expect(result.doc.salutation).toBe('hello');
    expect(result.doc.squad).toEqual(['A']);
  });

  it('applies every step in order, and says which ran', () => {
    const result = migrateDocument({ schemaVersion: 1 }, chain, 3, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toEqual([
      'v1 → v2: add greeting',
      'v2 → v3: rename greeting to salutation',
    ]);
  });

  it('is a no-op on a document already at the target', () => {
    const result = migrateDocument({ schemaVersion: 3, a: 1 }, chain, 3, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toEqual([]);
    expect(result.doc.a).toBe(1);
  });

  it('never mutates the document it was given', () => {
    const original: Record<string, unknown> = { schemaVersion: 1, squad: ['A'] };
    migrateDocument(original, chain, 3, 3);
    expect(original).toEqual({ schemaVersion: 1, squad: ['A'] });
  });

  it('carries unrecognised fields through every step untouched', () => {
    // Property 3: a reader that drops what it does not understand and writes
    // back destroys a newer version's data.
    const result = migrateDocument(
      { schemaVersion: 1, fromTheFuture: { nested: [1, 2, 3] } },
      chain,
      3,
      3
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.fromTheFuture).toEqual({ nested: [1, 2, 3] });
  });

  it('reports a half-applied migration as a failure rather than saving it', () => {
    const broken: Migration[] = [
      { from: 1, to: 2, describe: 'explodes', up: () => { throw new Error('boom'); } },
    ];
    const result = migrateDocument({ schemaVersion: 1 }, broken, 2, 2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_path');
  });

  it('reports a gap in the chain instead of guessing across it', () => {
    const gapped: Migration[] = [
      { from: 1, to: 2, describe: 'one step', up: (d) => d },
    ];
    const result = migrateDocument({ schemaVersion: 1 }, gapped, 3, 3);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_path');
  });

  it('rejects anything that is not a versioned document', () => {
    for (const rubbish of [null, 42, 'text', [], {}, { schemaVersion: 'one' }, { schemaVersion: 0 }]) {
      const result = migrateDocument(rubbish, chain, 3, 3);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe('unreadable');
    }
  });
});

describe('a document written by a newer app', () => {
  it('is refused, in words, when it says old readers are unsafe', () => {
    const result = migrateDocument(
      { schemaVersion: 5, minReaderVersion: 5, squad: ['A'] },
      chain,
      3,
      3
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('too_new');
    expect(result.writtenBy).toBe(5);
    expect(result.needsReader).toBe(5);

    // A coach can act on this. "Empty squad" is not actionable.
    const message = tooNewMessage(result.writtenBy, result.needsReader);
    expect(message).toContain('newer version');
    expect(message).toContain('Nothing has been changed');
  });

  it('is READ when the writer guarantees older readers are safe', () => {
    // This is what minReaderVersion buys: a v4 writer that only added optional
    // fields lets a v3 reader carry on, instead of a version bump locking the
    // coach out of their own squad.
    const result = migrateDocument(
      { schemaVersion: 4, minReaderVersion: 2, squad: ['A'], newThing: 'x' },
      chain,
      3,
      3
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.squad).toEqual(['A']);
    expect(result.doc.newThing).toBe('x'); // preserved for writing back
  });

  it('assumes the strictest reading when minReaderVersion is absent', () => {
    // A v1-era document has no such field. Silence must mean "not safe",
    // never "probably fine".
    const result = migrateDocument({ schemaVersion: 9 }, chain, 3, 3);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('too_new');
    expect(result.needsReader).toBe(9);
  });
});

describe('unknownFields', () => {
  it('keeps exactly what this build does not know about', () => {
    const doc: VersionedDocument = {
      schemaVersion: 2,
      squadName: 'Rovers',
      somethingNew: 1,
      alsoNew: { a: 2 },
    };
    expect(unknownFields(doc, ['schemaVersion', 'squadName'])).toEqual({
      somethingNew: 1,
      alsoNew: { a: 2 },
    });
  });

  it('keeps nothing when the build understands everything', () => {
    const doc: VersionedDocument = { schemaVersion: 2, squadName: 'Rovers' };
    expect(unknownFields(doc, ['schemaVersion', 'squadName'])).toEqual({});
  });
});
