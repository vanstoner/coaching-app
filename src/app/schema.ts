/**
 * Schema evolution — #61.
 *
 * Pure TypeScript. No storage, no I/O, so every rule here is provable in Node.
 *
 * ---------------------------------------------------------------------------
 * The defect this replaces
 * ---------------------------------------------------------------------------
 *
 * `parseSession` used to say:
 *
 *     if (s.schemaVersion !== SCHEMA_VERSION) return null;
 *
 * That is not a migration strategy, it is data loss on upgrade. The moment the
 * version moved to 2, every existing save was discarded and the coach opened
 * the app to an empty squad — with `allowBackup="false"` (ADR-011) and no
 * export, unrecoverably.
 *
 * The comment above it was right about NEWER saves and wrong about OLDER ones,
 * which are exactly what an upgrade produces and are the common case.
 *
 * ---------------------------------------------------------------------------
 * The four properties, and why each is here
 * ---------------------------------------------------------------------------
 *
 * **1. Forward migrations as a chain.** `v1 → v2 → v3`, pure functions applied
 * in order from whatever was found. A coach who skips four releases is not a
 * special case, it is four steps. This is the Rails/Flyway shape and it is the
 * core of the answer.
 *
 * **2. Tolerant reader.** An unrecognised field is not an error. Postel's rule,
 * and what Protobuf and Avro both do.
 *
 * **3. Unknown fields survive a round trip.** A reader that drops what it does
 * not understand and then WRITES BACK destroys data belonging to a version it
 * has never heard of. On one device that is invisible. The moment there is a
 * master and a second device it is silent corruption: the assistant's older app
 * opens the file, saves, and deletes the head coach's newer fields.
 *
 * The PO named this future directly — *"we may need to reconcile that with a
 * general ledger"* — so it is built now, while it costs a few lines.
 *
 * **4. Two numbers, not one.** `schemaVersion` says what wrote the file.
 * `minReaderVersion` says the oldest reader that can safely read it. One number
 * cannot tell "I added an optional field, anyone can read this" from "I
 * restructured, old readers must not touch this". Avro and Protobuf separate
 * them for the same reason.
 *
 * A reader too old to be safe says so IN WORDS a coach can act on, rather than
 * showing an empty squad.
 */

/** Everything a stored document must carry, plus whatever else it has. */
export interface VersionedDocument {
  schemaVersion: number;
  /** The oldest reader that can safely read this. Absent in v1 documents. */
  minReaderVersion?: number;
  [key: string]: unknown;
}

/** One step of the chain. Pure: takes a document, returns the next one. */
export interface Migration {
  from: number;
  to: number;
  /** A one-line description, printed when a migration runs. */
  describe: string;
  up: (doc: VersionedDocument) => VersionedDocument;
}

export type MigrationOutcome =
  | { ok: true; doc: VersionedDocument; applied: string[] }
  /** The file was written by something this build is too old to read safely. */
  | { ok: false; reason: 'too_new'; writtenBy: number; needsReader: number }
  /** The file is not a versioned document at all. */
  | { ok: false; reason: 'unreadable' }
  /** No path from the stored version to the target. */
  | { ok: false; reason: 'no_path'; from: number; to: number };

/**
 * Apply the chain from whatever version the document is at, up to `target`.
 *
 * Never mutates its input: each step receives the previous step's output. A
 * migration that throws is caught and reported rather than left half-applied,
 * because a half-migrated save is worse than an unmigrated one.
 */
export function migrateDocument(
  input: unknown,
  migrations: Migration[],
  target: number,
  readerVersion: number
): MigrationOutcome {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, reason: 'unreadable' };
  }

  const doc = { ...(input as Record<string, unknown>) } as VersionedDocument;
  const version = doc.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, reason: 'unreadable' };
  }

  // Written by something newer. Safe to read ONLY if it says so.
  if (version > target) {
    const needs = typeof doc.minReaderVersion === 'number' ? doc.minReaderVersion : version;
    if (needs > readerVersion) {
      return { ok: false, reason: 'too_new', writtenBy: version, needsReader: needs };
    }
    // The writer guarantees older readers are safe: read it as it is, keeping
    // every field we do not understand so writing back does not destroy them.
    return { ok: true, doc, applied: [] };
  }

  let current = doc;
  const applied: string[] = [];
  let at = version;

  while (at < target) {
    const step = migrations.find((m) => m.from === at);
    if (!step) return { ok: false, reason: 'no_path', from: at, to: target };
    try {
      current = { ...step.up(current), schemaVersion: step.to };
    } catch {
      return { ok: false, reason: 'no_path', from: at, to: target };
    }
    applied.push(step.describe);
    at = step.to;
  }

  return { ok: true, doc: current, applied };
}

/**
 * The fields a document carries that this build does not know about.
 *
 * Kept so they can be written back untouched. This is property 3, and it is the
 * one that decides whether a future second device works or silently eats data.
 */
export function unknownFields(
  doc: VersionedDocument,
  known: readonly string[]
): Record<string, unknown> {
  const keep: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (!known.includes(key)) keep[key] = value;
  }
  return keep;
}

/** What to tell a coach whose phone is behind the file it is holding. */
export function tooNewMessage(writtenBy: number, needsReader: number): string {
  return (
    `This was saved by a newer version of the app (format ${writtenBy}, ` +
    `needs ${needsReader}). Update the app to open it. Nothing has been changed.`
  );
}
